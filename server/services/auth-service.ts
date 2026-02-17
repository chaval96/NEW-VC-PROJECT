import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { v4 as uuid } from "uuid";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "owner";
  emailVerified: boolean;
}

interface AuthUserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  email_verified_at: string | null;
}

interface SignupResult {
  user: AuthUser;
  verificationEmailSent: boolean;
  verificationUrl?: string;
}

class AuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SESSION_TTL_DAYS = 14;
const VERIFICATION_TTL_HOURS = 24;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, digestHex] = storedHash.split(":");
  if (!salt || !digestHex) return false;

  const incoming = scryptSync(password, salt, 64);
  const stored = Buffer.from(digestHex, "hex");
  if (incoming.length !== stored.length) return false;
  return timingSafeEqual(incoming, stored);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toAuthUser(row: AuthUserRecord): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: (row.role === "owner" ? "owner" : "owner") as "owner",
    emailVerified: Boolean(row.email_verified_at)
  };
}

export class AuthService {
  private readonly databaseUrl = process.env.DATABASE_URL;
  private pool: Pool | null = null;

  private readonly memoryUsers = new Map<string, AuthUserRecord>();
  private readonly memorySessions = new Map<string, AuthUser>();
  private readonly memoryMemberships = new Map<string, Set<string>>();
  private readonly memoryVerificationTokens = new Map<string, { userId: string; expiresAt: number; used: boolean }>();

  private readonly defaultEmail = normalizeEmail(process.env.AUTH_EMAIL ?? "founder@vcops.local");
  private readonly defaultPassword = process.env.AUTH_PASSWORD ?? "ChangeMe123!";
  private readonly defaultName = process.env.AUTH_NAME ?? "Founder";

  async init(): Promise<void> {
    if (this.databaseUrl) {
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false }
      });

      const schemaPath = path.resolve(process.cwd(), "server/db/schema.sql");
      const schemaSql = await readFile(schemaPath, "utf8");
      await this.pool.query(schemaSql);
      await this.ensureDefaultOwnerInDb();
      return;
    }

    const id = uuid();
    const user: AuthUserRecord = {
      id,
      email: this.defaultEmail,
      password_hash: passwordHash(this.defaultPassword),
      name: this.defaultName,
      role: "owner",
      email_verified_at: new Date().toISOString()
    };
    this.memoryUsers.set(user.email, user);
  }

  private async ensureDefaultOwnerInDb(): Promise<void> {
    if (!this.pool) return;

    const existing = await this.pool.query<AuthUserRecord>(
      `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE email = $1 LIMIT 1`,
      [this.defaultEmail]
    );

    if (existing.rows.length > 0) {
      return;
    }

    await this.pool.query(
      `INSERT INTO users (id, email, password_hash, name, role, email_verified_at)
       VALUES ($1, $2, $3, $4, 'owner', NOW())`,
      [uuid(), this.defaultEmail, passwordHash(this.defaultPassword), this.defaultName]
    );
  }

  async signup(payload: { email: string; password: string; name: string }): Promise<SignupResult> {
    const email = normalizeEmail(payload.email);
    const name = payload.name.trim();

    if (name.length < 2) {
      throw new AuthError(400, "Name must be at least 2 characters");
    }

    if (payload.password.length < 8) {
      throw new AuthError(400, "Password must be at least 8 characters");
    }

    if (this.pool) {
      const existing = await this.pool.query<AuthUserRecord>(
        `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );
      if (existing.rows.length > 0) {
        throw new AuthError(409, "This email is already registered");
      }

      const userId = uuid();
      const now = new Date().toISOString();
      const hash = passwordHash(payload.password);

      await this.pool.query(
        `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'owner', $5, $5)`,
        [userId, email, hash, name, now]
      );

      const verifyToken = randomBytes(32).toString("hex");
      await this.pool.query(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${VERIFICATION_TTL_HOURS} hours')`,
        [uuid(), userId, tokenHash(verifyToken)]
      );

      const url = this.buildVerificationUrl(verifyToken);
      const sent = await this.sendVerificationEmail(email, name, url);

      await this.writeAudit({ userId, action: "auth.signup", entityType: "user", entityId: userId, metadata: { email } });

      return {
        user: {
          id: userId,
          email,
          name,
          role: "owner",
          emailVerified: false
        },
        verificationEmailSent: sent,
        verificationUrl: process.env.NODE_ENV === "production" ? undefined : url
      };
    }

    if (this.memoryUsers.has(email)) {
      throw new AuthError(409, "This email is already registered");
    }

    const userId = uuid();
    const verifyToken = randomBytes(32).toString("hex");
    this.memoryUsers.set(email, {
      id: userId,
      email,
      password_hash: passwordHash(payload.password),
      name,
      role: "owner",
      email_verified_at: null
    });
    this.memoryVerificationTokens.set(tokenHash(verifyToken), {
      userId,
      expiresAt: Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
      used: false
    });

    const url = this.buildVerificationUrl(verifyToken);
    return {
      user: { id: userId, email, name, role: "owner", emailVerified: false },
      verificationEmailSent: false,
      verificationUrl: url
    };
  }

  async verifyEmail(token: string): Promise<AuthUser> {
    const hashed = tokenHash(token);

    if (this.pool) {
      const result = await this.pool.query<{
        token_id: string;
        user_id: string;
        expires_at: string;
        used_at: string | null;
        id: string;
        email: string;
        password_hash: string;
        name: string;
        role: string;
        email_verified_at: string | null;
      }>(
        `SELECT evt.id AS token_id, evt.user_id, evt.expires_at, evt.used_at,
                u.id, u.email, u.password_hash, u.name, u.role, u.email_verified_at
         FROM email_verification_tokens evt
         JOIN users u ON u.id = evt.user_id
         WHERE evt.token_hash = $1
         LIMIT 1`,
        [hashed]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AuthError(400, "Invalid verification token");
      }
      if (row.used_at) {
        throw new AuthError(400, "Verification token already used");
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        throw new AuthError(400, "Verification token expired");
      }

      await this.pool.query("BEGIN");
      try {
        await this.pool.query(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [row.token_id]);
        await this.pool.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = $1`, [row.user_id]);
        await this.pool.query("COMMIT");
      } catch (error) {
        await this.pool.query("ROLLBACK");
        throw error;
      }

      const user: AuthUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: "owner",
        emailVerified: true
      };

      await this.writeAudit({ userId: user.id, action: "auth.email_verified", entityType: "user", entityId: user.id });
      return user;
    }

    const memoryToken = this.memoryVerificationTokens.get(hashed);
    if (!memoryToken) throw new AuthError(400, "Invalid verification token");
    if (memoryToken.used) throw new AuthError(400, "Verification token already used");
    if (memoryToken.expiresAt < Date.now()) throw new AuthError(400, "Verification token expired");

    memoryToken.used = true;

    const user = [...this.memoryUsers.values()].find((entry) => entry.id === memoryToken.userId);
    if (!user) throw new AuthError(404, "User not found");

    user.email_verified_at = new Date().toISOString();
    return toAuthUser(user);
  }

  async login(emailInput: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const email = normalizeEmail(emailInput);

    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );
      const row = result.rows[0];

      if (!row || !verifyPassword(password, row.password_hash)) {
        throw new AuthError(401, "Invalid credentials");
      }

      if (!row.email_verified_at) {
        throw new AuthError(403, "Email is not verified. Please verify your email first.");
      }

      const token = randomBytes(32).toString("hex");
      await this.pool.query(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${SESSION_TTL_DAYS} days')`,
        [uuid(), row.id, tokenHash(token)]
      );

      const user = toAuthUser(row);
      await this.writeAudit({ userId: user.id, action: "auth.login", entityType: "user", entityId: user.id });
      return { token, user };
    }

    const row = this.memoryUsers.get(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new AuthError(401, "Invalid credentials");
    }
    if (!row.email_verified_at) {
      throw new AuthError(403, "Email is not verified. Please verify your email first.");
    }

    const token = randomBytes(32).toString("hex");
    this.memorySessions.set(tokenHash(token), toAuthUser(row));
    return { token, user: toAuthUser(row) };
  }

  async getUserByToken(token: string): Promise<AuthUser | null> {
    const hashed = tokenHash(token);

    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `SELECT u.id, u.email, u.password_hash, u.name, u.role, u.email_verified_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > NOW()
         LIMIT 1`,
        [hashed]
      );

      if (result.rows.length === 0) return null;
      return toAuthUser(result.rows[0]);
    }

    return this.memorySessions.get(hashed) ?? null;
  }

  async logout(token: string): Promise<void> {
    const hashed = tokenHash(token);

    if (this.pool) {
      await this.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1`, [hashed]);
      return;
    }

    this.memorySessions.delete(hashed);
  }

  async addWorkspaceMembership(userId: string, workspaceId: string, role: "owner" = "owner"): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [uuid(), workspaceId, userId, role]
      );
      return;
    }

    const set = this.memoryMemberships.get(userId) ?? new Set<string>();
    set.add(workspaceId);
    this.memoryMemberships.set(userId, set);
  }

  async listWorkspaceIds(userId: string): Promise<string[]> {
    if (this.pool) {
      const rows = await this.pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1`,
        [userId]
      );
      return rows.rows.map((row) => row.workspace_id);
    }

    return [...(this.memoryMemberships.get(userId) ?? new Set<string>())];
  }

  async userHasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    if (this.pool) {
      const result = await this.pool.query<{ present: number }>(
        `SELECT 1 AS present FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
        [userId, workspaceId]
      );
      return result.rows.length > 0;
    }

    return this.memoryMemberships.get(userId)?.has(workspaceId) ?? false;
  }

  async ensureMembershipsForUser(userEmail: string, workspaceIds: string[]): Promise<void> {
    const normalized = normalizeEmail(userEmail);

    if (this.pool) {
      const user = await this.pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [normalized]);
      if (user.rows.length === 0) return;
      const userId = user.rows[0].id;

      for (const workspaceId of workspaceIds) {
        await this.addWorkspaceMembership(userId, workspaceId, "owner");
      }
      return;
    }

    const memoryUser = this.memoryUsers.get(normalized);
    if (!memoryUser) return;
    for (const workspaceId of workspaceIds) {
      await this.addWorkspaceMembership(memoryUser.id, workspaceId, "owner");
    }
  }

  private buildVerificationUrl(token: string): string {
    const base = process.env.APP_BASE_URL ?? "http://localhost:5173";
    return `${base.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private async sendVerificationEmail(email: string, name: string, verificationUrl: string): Promise<boolean> {
    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!resendKey || !from) {
      console.log(`Verification link for ${email}: ${verificationUrl}`);
      return false;
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Verify your VCReach account",
          html: `<p>Hello ${name},</p><p>Please verify your email to activate your account:</p><p><a href=\"${verificationUrl}\">Verify Email</a></p>`
        })
      });

      if (!response.ok) {
        const payload = await response.text();
        console.error("Resend verification email failed:", payload);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Verification email send error:", error);
      return false;
    }
  }

  private async writeAudit(payload: {
    userId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(
      `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        uuid(),
        payload.userId ?? null,
        payload.action,
        payload.entityType ?? null,
        payload.entityId ?? null,
        JSON.stringify(payload.metadata ?? {})
      ]
    );
  }
}
