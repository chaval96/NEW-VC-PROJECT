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

interface ResendVerificationResult {
  email: string;
  verificationEmailSent: boolean;
  verificationUrl?: string;
  alreadyVerified: boolean;
}

interface PasswordResetRequestResult {
  email: string;
  resetEmailSent: boolean;
  resetUrl?: string;
}

export interface AuthPruneResult {
  removedSessions: number;
  removedVerificationTokens: number;
  removedPasswordResetTokens: number;
  removedAuditLogs: number;
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
const PASSWORD_RESET_TTL_HOURS = 2;

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
  private readonly memoryPasswordResetTokens = new Map<string, { userId: string; expiresAt: number; used: boolean }>();

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

  async pruneExpiredArtifacts(options: { auditRetentionDays?: number } = {}): Promise<AuthPruneResult> {
    const auditRetentionDays = Math.max(7, options.auditRetentionDays ?? 180);

    if (this.pool) {
      const sessions = await this.pool.query(
        `DELETE FROM auth_sessions
         WHERE revoked_at IS NOT NULL OR expires_at < NOW()`
      );

      const verificationTokens = await this.pool.query(
        `DELETE FROM email_verification_tokens
         WHERE used_at IS NOT NULL OR expires_at < NOW()`
      );

      const passwordResetTokens = await this.pool.query(
        `DELETE FROM password_reset_tokens
         WHERE used_at IS NOT NULL OR expires_at < NOW()`
      );

      const auditLogs = await this.pool.query(
        `DELETE FROM audit_logs
         WHERE created_at < NOW() - make_interval(days => $1::int)`,
        [auditRetentionDays]
      );

      return {
        removedSessions: sessions.rowCount ?? 0,
        removedVerificationTokens: verificationTokens.rowCount ?? 0,
        removedPasswordResetTokens: passwordResetTokens.rowCount ?? 0,
        removedAuditLogs: auditLogs.rowCount ?? 0
      };
    }

    const now = Date.now();
    const beforeSessionCount = this.memorySessions.size;
    const beforeVerificationCount = this.memoryVerificationTokens.size;
    const beforeResetCount = this.memoryPasswordResetTokens.size;

    for (const [token, sessionUser] of this.memorySessions.entries()) {
      if (!sessionUser) {
        this.memorySessions.delete(token);
      }
    }

    for (const [hash, token] of this.memoryVerificationTokens.entries()) {
      if (token.used || token.expiresAt <= now) {
        this.memoryVerificationTokens.delete(hash);
      }
    }

    for (const [hash, token] of this.memoryPasswordResetTokens.entries()) {
      if (token.used || token.expiresAt <= now) {
        this.memoryPasswordResetTokens.delete(hash);
      }
    }

    return {
      removedSessions: beforeSessionCount - this.memorySessions.size,
      removedVerificationTokens: beforeVerificationCount - this.memoryVerificationTokens.size,
      removedPasswordResetTokens: beforeResetCount - this.memoryPasswordResetTokens.size,
      removedAuditLogs: 0
    };
  }

  private cleanEnv(value?: string): string {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return "";

    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }

    return trimmed;
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

  async resendVerificationEmail(emailInput: string): Promise<ResendVerificationResult> {
    const email = normalizeEmail(emailInput);

    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );
      const row = result.rows[0];
      if (!row) {
        return { email, verificationEmailSent: false, alreadyVerified: false };
      }

      if (row.email_verified_at) {
        return { email, verificationEmailSent: false, alreadyVerified: true };
      }

      const verifyToken = randomBytes(32).toString("hex");
      await this.pool.query(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${VERIFICATION_TTL_HOURS} hours')`,
        [uuid(), row.id, tokenHash(verifyToken)]
      );

      const url = this.buildVerificationUrl(verifyToken);
      const sent = await this.sendVerificationEmail(row.email, row.name, url);
      await this.writeAudit({ userId: row.id, action: "auth.verification_resent", entityType: "user", entityId: row.id });

      return {
        email,
        verificationEmailSent: sent,
        verificationUrl: process.env.NODE_ENV === "production" ? undefined : url,
        alreadyVerified: false
      };
    }

    const row = this.memoryUsers.get(email);
    if (!row) {
      return { email, verificationEmailSent: false, alreadyVerified: false };
    }
    if (row.email_verified_at) {
      return { email, verificationEmailSent: false, alreadyVerified: true };
    }

    const verifyToken = randomBytes(32).toString("hex");
    this.memoryVerificationTokens.set(tokenHash(verifyToken), {
      userId: row.id,
      expiresAt: Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
      used: false
    });

    const url = this.buildVerificationUrl(verifyToken);
    return {
      email,
      verificationEmailSent: false,
      verificationUrl: url,
      alreadyVerified: false
    };
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

  async getUserById(userId: string): Promise<AuthUser | null> {
    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const row = result.rows[0];
      return row ? toAuthUser(row) : null;
    }

    const row = [...this.memoryUsers.values()].find((entry) => entry.id === userId);
    return row ? toAuthUser(row) : null;
  }

  async updateProfile(userId: string, payload: { name?: string }): Promise<AuthUser> {
    const nextName = payload.name?.trim();
    if (!nextName || nextName.length < 2) {
      throw new AuthError(400, "Name must be at least 2 characters");
    }

    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `UPDATE users
         SET name = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, password_hash, name, role, email_verified_at`,
        [userId, nextName]
      );
      const row = result.rows[0];
      if (!row) {
        throw new AuthError(404, "User not found");
      }
      await this.writeAudit({ userId, action: "auth.profile_updated", entityType: "user", entityId: userId, metadata: { name: nextName } });
      return toAuthUser(row);
    }

    const row = [...this.memoryUsers.values()].find((entry) => entry.id === userId);
    if (!row) throw new AuthError(404, "User not found");
    row.name = nextName;
    return toAuthUser(row);
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    if (nextPassword.length < 8) {
      throw new AuthError(400, "New password must be at least 8 characters");
    }

    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const row = result.rows[0];
      if (!row) throw new AuthError(404, "User not found");
      if (!verifyPassword(currentPassword, row.password_hash)) {
        throw new AuthError(401, "Current password is incorrect");
      }

      await this.pool.query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [userId, passwordHash(nextPassword)]);
      await this.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1`, [userId]);
      await this.writeAudit({ userId, action: "auth.password_changed", entityType: "user", entityId: userId });
      return;
    }

    const row = [...this.memoryUsers.values()].find((entry) => entry.id === userId);
    if (!row) throw new AuthError(404, "User not found");
    if (!verifyPassword(currentPassword, row.password_hash)) {
      throw new AuthError(401, "Current password is incorrect");
    }
    row.password_hash = passwordHash(nextPassword);
  }

  async requestPasswordReset(emailInput: string): Promise<PasswordResetRequestResult> {
    const email = normalizeEmail(emailInput);

    if (this.pool) {
      const result = await this.pool.query<AuthUserRecord>(
        `SELECT id, email, password_hash, name, role, email_verified_at FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );
      const row = result.rows[0];
      if (!row) {
        return { email, resetEmailSent: false };
      }

      const resetToken = randomBytes(32).toString("hex");
      await this.pool.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${PASSWORD_RESET_TTL_HOURS} hours')`,
        [uuid(), row.id, tokenHash(resetToken)]
      );

      const resetUrl = this.buildPasswordResetUrl(resetToken);
      const sent = await this.sendPasswordResetEmail(row.email, row.name, resetUrl);
      await this.writeAudit({ userId: row.id, action: "auth.password_reset_requested", entityType: "user", entityId: row.id });

      return {
        email,
        resetEmailSent: sent,
        resetUrl: process.env.NODE_ENV === "production" ? undefined : resetUrl
      };
    }

    const row = this.memoryUsers.get(email);
    if (!row) {
      return { email, resetEmailSent: false };
    }

    const resetToken = randomBytes(32).toString("hex");
    this.memoryPasswordResetTokens.set(tokenHash(resetToken), {
      userId: row.id,
      expiresAt: Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000,
      used: false
    });
    return {
      email,
      resetEmailSent: false,
      resetUrl: this.buildPasswordResetUrl(resetToken)
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new AuthError(400, "Password must be at least 8 characters");
    }

    const hashed = tokenHash(token);

    if (this.pool) {
      const result = await this.pool.query<{
        token_id: string;
        user_id: string;
        expires_at: string;
        used_at: string | null;
      }>(
        `SELECT id AS token_id, user_id, expires_at, used_at
         FROM password_reset_tokens
         WHERE token_hash = $1
         LIMIT 1`,
        [hashed]
      );
      const row = result.rows[0];
      if (!row) throw new AuthError(400, "Invalid reset token");
      if (row.used_at) throw new AuthError(400, "Reset token already used");
      if (new Date(row.expires_at).getTime() < Date.now()) throw new AuthError(400, "Reset token expired");

      await this.pool.query("BEGIN");
      try {
        await this.pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.token_id]);
        await this.pool.query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [row.user_id, passwordHash(newPassword)]);
        await this.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1`, [row.user_id]);
        await this.pool.query("COMMIT");
      } catch (error) {
        await this.pool.query("ROLLBACK");
        throw error;
      }

      await this.writeAudit({ userId: row.user_id, action: "auth.password_reset_completed", entityType: "user", entityId: row.user_id });
      return;
    }

    const memoryToken = this.memoryPasswordResetTokens.get(hashed);
    if (!memoryToken) throw new AuthError(400, "Invalid reset token");
    if (memoryToken.used) throw new AuthError(400, "Reset token already used");
    if (memoryToken.expiresAt < Date.now()) throw new AuthError(400, "Reset token expired");

    const user = [...this.memoryUsers.values()].find((entry) => entry.id === memoryToken.userId);
    if (!user) throw new AuthError(404, "User not found");
    user.password_hash = passwordHash(newPassword);
    memoryToken.used = true;
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
    const base = this.cleanEnv(process.env.APP_BASE_URL) || "http://localhost:5173";
    return `${base.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private buildPasswordResetUrl(token: string): string {
    const base = this.cleanEnv(process.env.APP_BASE_URL) || "http://localhost:5173";
    return `${base.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private composeFromAddress(): string | null {
    const rawFrom = this.cleanEnv(process.env.EMAIL_FROM);
    if (!rawFrom) return null;

    if (rawFrom.includes("<") && rawFrom.includes(">")) {
      return rawFrom;
    }

    const fromName = this.cleanEnv(process.env.EMAIL_FROM_NAME) || this.cleanEnv(process.env.EMAIL_BRAND_NAME) || "VCReach";
    if (!fromName) return rawFrom;
    return `${fromName} <${rawFrom}>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  private buildVerificationEmailHtml(name: string, verificationUrl: string): string {
    const safeName = this.escapeHtml(name);
    const safeLink = this.escapeHtml(verificationUrl);
    const brandName = this.escapeHtml(this.cleanEnv(process.env.EMAIL_BRAND_NAME) || "VCReach");
    const appBase = this.cleanEnv(process.env.APP_BASE_URL).replace(/\/$/, "");
    const defaultLogoUrl = appBase ? `${appBase}/branding/vcreach-logo.png` : "";
    const logoUrl = this.cleanEnv(process.env.EMAIL_LOGO_URL) || defaultLogoUrl;
    const logoBlock = logoUrl
      ? `<img src="${this.escapeHtml(logoUrl)}" alt="${brandName}" width="120" style="display:block;margin:0 auto 16px auto;border:0;outline:none;text-decoration:none;">`
      : `<div style="display:inline-block;border-radius:10px;padding:8px 12px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.4px;margin-bottom:16px;">${brandName}</div>`;

    return `
<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;">
      <tr>
        <td style="padding:0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 24px 20px 24px;text-align:center;background:linear-gradient(180deg,#f8fafc 0%,#ffffff 100%);">
                ${logoBlock}
                <div style="font-size:24px;font-weight:700;line-height:1.2;color:#0f172a;">Verify Your ${brandName} Account</div>
                <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#475569;">Secure your workspace to start running VC outreach workflows.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 20px 24px;">
                <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#0f172a;">Hi ${safeName},</p>
                <p style="margin:0 0 18px 0;font-size:14px;line-height:1.7;color:#334155;">
                  Please confirm your email address to activate your ${brandName} account.
                  This verification link is valid for 24 hours.
                </p>
                <div style="text-align:center;padding:6px 0 18px 0;">
                  <a href="${safeLink}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;border-radius:10px;padding:12px 22px;font-size:14px;">Verify Email Address</a>
                </div>
                <p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:#64748b;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;word-break:break-all;font-size:12px;line-height:1.6;color:#334155;">${safeLink}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px 24px 24px;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">If you did not create this account, you can safely ignore this email.</p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">© ${new Date().getUTCFullYear()} ${brandName}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `.trim();
  }

  private buildVerificationEmailText(name: string, verificationUrl: string): string {
    const brandName = this.cleanEnv(process.env.EMAIL_BRAND_NAME) || "VCReach";
    return [
      `Hi ${name},`,
      "",
      `Please verify your email address to activate your ${brandName} account.`,
      "This verification link is valid for 24 hours:",
      verificationUrl,
      "",
      "If you did not create this account, you can ignore this email."
    ].join("\n");
  }

  private buildPasswordResetEmailHtml(name: string, resetUrl: string): string {
    const safeName = this.escapeHtml(name);
    const safeLink = this.escapeHtml(resetUrl);
    const brandName = this.escapeHtml(this.cleanEnv(process.env.EMAIL_BRAND_NAME) || "VCReach");
    return `
<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;">
      <tr>
        <td style="padding:0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 24px 20px 24px;">
                <div style="font-size:22px;font-weight:700;color:#0f172a;">Reset your ${brandName} password</div>
                <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#475569;">Hi ${safeName}, we received a password reset request for your account.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 20px 24px;">
                <div style="text-align:center;padding:6px 0 18px 0;">
                  <a href="${safeLink}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;border-radius:10px;padding:12px 22px;font-size:14px;">Reset Password</a>
                </div>
                <p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:#64748b;">This link expires in ${PASSWORD_RESET_TTL_HOURS} hours.</p>
                <p style="margin:0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;word-break:break-all;font-size:12px;line-height:1.6;color:#334155;">${safeLink}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `.trim();
  }

  private buildPasswordResetEmailText(name: string, resetUrl: string): string {
    const brandName = this.cleanEnv(process.env.EMAIL_BRAND_NAME) || "VCReach";
    return [
      `Hi ${name},`,
      "",
      `Use this link to reset your ${brandName} password (expires in ${PASSWORD_RESET_TTL_HOURS} hours):`,
      resetUrl
    ].join("\n");
  }

  private async sendVerificationEmail(email: string, name: string, verificationUrl: string): Promise<boolean> {
    const resendKey = this.cleanEnv(process.env.RESEND_API_KEY);
    const from = this.composeFromAddress();

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
          subject: "Action required: verify your VCReach account",
          html: this.buildVerificationEmailHtml(name, verificationUrl),
          text: this.buildVerificationEmailText(name, verificationUrl)
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

  private async sendPasswordResetEmail(email: string, name: string, resetUrl: string): Promise<boolean> {
    const resendKey = this.cleanEnv(process.env.RESEND_API_KEY);
    const from = this.composeFromAddress();

    if (!resendKey || !from) {
      console.log(`Password reset link for ${email}: ${resetUrl}`);
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
          subject: "Reset your VCReach password",
          html: this.buildPasswordResetEmailHtml(name, resetUrl),
          text: this.buildPasswordResetEmailText(name, resetUrl)
        })
      });

      if (!response.ok) {
        const payload = await response.text();
        console.error("Resend password reset email failed:", payload);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Password reset email send error:", error);
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
