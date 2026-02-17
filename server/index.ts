import cors from "cors";
import dayjs from "dayjs";
import express from "express";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { StateStore } from "./domain/store.js";
import { buildTemplateProfile } from "./domain/seed.js";
import type { AssessmentResult, CompanyProfile, PipelineStage, SubmissionStatus, Workspace } from "./domain/types.js";
import { CampaignOrchestrator } from "./orchestrator/workflow.js";
import { buildOverview, getCachedOverview } from "./services/analytics.js";
import { AuthService, type AuthUser } from "./services/auth-service.js";
import { CreditService } from "./services/credit-service.js";
import { parseFirmsFromGoogleDriveLink, parseFirmsFromUpload } from "./services/import-parser.js";
import { executeSubmissionRequest, type SubmissionExecutionResult } from "./services/submission-executor.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const store = new StateStore();
const orchestrator = new CampaignOrchestrator(store);
const creditService = new CreditService(store);
const authService = new AuthService();
const featureCreditsEnabled = process.env.FEATURE_CREDITS === "true";
const featureAssessmentEnabled = process.env.FEATURE_ASSESSMENT === "true";

type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function statusToStage(status: SubmissionStatus): PipelineStage {
  switch (status) {
    case "submitted":
      return "submitted";
    case "form_filled":
      return "form_filled";
    case "form_discovered":
      return "form_discovered";
    case "blocked":
    case "no_form_found":
    case "needs_review":
      return "review";
    case "errored":
      return "lost";
    case "queued":
    default:
      return "qualified";
  }
}

function parseBearerToken(authHeader?: string): string | undefined {
  if (!authHeader) return undefined;
  const [scheme, value] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value.trim();
}

function extractWorkspaceId(req: express.Request): string | undefined {
  const fromParam = typeof req.params.workspaceId === "string" ? req.params.workspaceId : undefined;
  const fromQuery = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const fromBody = typeof (req.body as { workspaceId?: unknown } | undefined)?.workspaceId === "string"
    ? ((req.body as { workspaceId: string }).workspaceId)
    : undefined;
  return fromParam ?? fromQuery ?? fromBody;
}

function getAuthUser(res: express.Response): AuthUser {
  return res.locals.authUser as AuthUser;
}

async function resolveWorkspaceContext(req: express.Request, res: express.Response): Promise<{ workspaceId: string; workspace: Workspace; user: AuthUser }> {
  const user = getAuthUser(res);
  const workspaceId = extractWorkspaceId(req);

  if (!workspaceId) {
    throw new Error("workspaceId is required");
  }

  const hasAccess = await authService.userHasWorkspaceAccess(user.id, workspaceId);
  if (!hasAccess) {
    const error = new Error("Forbidden workspace access");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) {
    const error = new Error("Workspace not found");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  return { workspaceId, workspace, user };
}

function validateProfileReadiness(profile: CompanyProfile): string[] {
  const missing: string[] = [];

  if (!profile.company.trim()) missing.push("company name");
  if (!profile.website.trim()) missing.push("company website");
  if (!profile.senderName.trim()) missing.push("founder name");
  if (!profile.senderEmail.trim()) missing.push("founder email");
  if (!profile.oneLiner.trim()) missing.push("company one-liner");
  if (!profile.longDescription.trim()) missing.push("company description");
  if (!profile.fundraising.round.trim()) missing.push("funding round");
  if (!profile.fundraising.amount.trim()) missing.push("target amount");

  return missing;
}

const blockedEmailDomains = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "invalid",
  "mailinator.com",
  "yopmail.com",
  "tempmail.com",
  "temp-mail.org",
  "guerrillamail.com",
  "10minutemail.com"
]);

const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function isAllowedAuthEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!strictEmailPattern.test(email)) return false;

  const domain = email.split("@")[1];
  if (!domain) return false;
  if (blockedEmailDomains.has(domain)) return false;
  return true;
}

const authEmailSchema = z.string().email().refine(isAllowedAuthEmail, {
  message: "Please enter a valid email address."
});

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value);
  if (/["\n,]/.test(raw)) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return [header, ...lines].join("\n");
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

const submissionMaxAttemptsDefault = Math.max(1, Number(process.env.SUBMISSION_MAX_ATTEMPTS ?? 2));
const submissionRetryDelayMs = Math.max(300, Number(process.env.SUBMISSION_RETRY_DELAY_MS ?? 1500));
const submissionStaleExecutionMs = Math.max(60_000, Number(process.env.SUBMISSION_EXECUTION_STALE_MINUTES ?? 10) * 60_000);
const submissionWatchdogIntervalMs = Math.max(15_000, Number(process.env.SUBMISSION_WATCHDOG_INTERVAL_SECONDS ?? 45) * 1000);
const submissionInFlight = new Set<string>();
let submissionWatchdogActive = false;

function submissionFlightKey(workspaceId: string, requestId: string): string {
  return `${workspaceId}:${requestId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSubmissionSuccess(status: SubmissionStatus): boolean {
  return status === "submitted" || status === "form_filled";
}

function canApproveFromStatus(status: string): boolean {
  return ["pending_approval", "pending_retry", "failed"].includes(status);
}

function updateFirmFromExecution(
  workspaceId: string,
  requestId: string,
  request: { firmId: string; firmName: string },
  result: SubmissionExecutionResult
): void {
  const firm = store.getFirm(request.firmId, workspaceId);
  if (!firm) return;
  store.upsertFirm({
    ...firm,
    stage: statusToStage(result.status),
    statusReason: result.note,
    lastTouchedAt: new Date().toISOString(),
    notes: [...firm.notes, `Execution ${requestId}: ${result.status}`]
  });
}

async function executeSubmissionWithRetries(
  workspaceId: string,
  requestId: string
): Promise<{ request?: ReturnType<StateStore["getSubmissionRequest"]>; result: SubmissionExecutionResult }> {
  const initial = store.getSubmissionRequest(requestId, workspaceId);
  if (!initial) {
    throw new Error("Submission request not found");
  }

  const maxAttempts = Math.max(1, initial.maxExecutionAttempts ?? submissionMaxAttemptsDefault);
  let attempts = Math.max(0, initial.executionAttempts ?? 0);
  let lastResult: SubmissionExecutionResult | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    const startedAt = new Date().toISOString();

    const executing = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
      ...current,
      status: "executing",
      executionAttempts: attempts,
      maxExecutionAttempts: maxAttempts,
      lastExecutionStartedAt: startedAt,
      nextRetryAt: undefined
    }));

    if (!executing) {
      throw new Error("Submission request not found");
    }

    await store.persist();

    const result = await executeSubmissionRequest(executing);
    lastResult = result;
    const endedAt = new Date().toISOString();

    store.addEvent({
      id: uuid(),
      workspaceId,
      firmId: executing.firmId,
      firmName: executing.firmName,
      channel: "website_form",
      status: result.status,
      attemptedAt: endedAt,
      discoveredAt: result.discoveredAt,
      filledAt: result.filledAt,
      submittedAt: result.submittedAt,
      blockedReason: result.blockedReason,
      note: `Attempt ${attempts}/${maxAttempts}: ${result.note}`
    });

    if (isSubmissionSuccess(result.status)) {
      const completed = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "completed",
        executedAt: endedAt,
        executionAttempts: attempts,
        maxExecutionAttempts: maxAttempts,
        lastExecutionEndedAt: endedAt,
        lastExecutionStatus: result.status,
        resultNote: result.note,
        nextRetryAt: undefined
      }));
      if (completed) {
        updateFirmFromExecution(workspaceId, requestId, completed, result);
      }
      await store.persist();
      return { request: completed, result };
    }

    const shouldRetry = result.status === "errored" && attempts < maxAttempts;
    if (shouldRetry) {
      const nextRetryAt = new Date(Date.now() + submissionRetryDelayMs).toISOString();
      store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "pending_retry",
        executionAttempts: attempts,
        maxExecutionAttempts: maxAttempts,
        lastExecutionEndedAt: endedAt,
        lastExecutionStatus: result.status,
        resultNote: `${result.note} Auto-retrying soon (${attempts}/${maxAttempts}).`,
        nextRetryAt
      }));
      await store.persist();
      await sleep(submissionRetryDelayMs);
      continue;
    }

    const failed = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
      ...current,
      status: "failed",
      executedAt: endedAt,
      executionAttempts: attempts,
      maxExecutionAttempts: maxAttempts,
      lastExecutionEndedAt: endedAt,
      lastExecutionStatus: result.status,
      resultNote: result.note,
      nextRetryAt: undefined
    }));
    if (failed) {
      updateFirmFromExecution(workspaceId, requestId, failed, result);
    }
    await store.persist();
    return { request: failed, result };
  }

  const fallbackResult: SubmissionExecutionResult = lastResult ?? {
    status: "errored",
    note: "Submission exhausted retry budget without a successful result."
  };
  return { request: store.getSubmissionRequest(requestId, workspaceId), result: fallbackResult };
}

async function runSubmissionExecution(workspaceId: string, requestId: string): Promise<{
  request?: ReturnType<StateStore["getSubmissionRequest"]>;
  result: SubmissionExecutionResult;
}> {
  const key = submissionFlightKey(workspaceId, requestId);
  if (submissionInFlight.has(key)) {
    throw new Error("Submission is already being executed");
  }

  submissionInFlight.add(key);
  try {
    return await executeSubmissionWithRetries(workspaceId, requestId);
  } finally {
    submissionInFlight.delete(key);
  }
}

async function runSubmissionWatchdog(): Promise<void> {
  if (submissionWatchdogActive) return;
  submissionWatchdogActive = true;

  try {
    const now = Date.now();
    const workspaces = store.listWorkspaces();

    for (const workspace of workspaces) {
      const requests = store.listSubmissionRequests(workspace.id);

      for (const request of requests) {
        const key = submissionFlightKey(workspace.id, request.id);
        if (submissionInFlight.has(key)) continue;

        if (request.status === "executing") {
          const startedAt = Date.parse(request.lastExecutionStartedAt ?? request.approvedAt ?? request.preparedAt);
          if (Number.isFinite(startedAt) && now - startedAt >= submissionStaleExecutionMs) {
            const attempts = request.executionAttempts ?? 0;
            const maxAttempts = Math.max(1, request.maxExecutionAttempts ?? submissionMaxAttemptsDefault);
            const canRetry = attempts < maxAttempts;
            store.updateSubmissionRequest(workspace.id, request.id, (current) => ({
              ...current,
              status: canRetry ? "pending_retry" : "failed",
              lastExecutionEndedAt: new Date().toISOString(),
              resultNote: canRetry
                ? `Execution timed out. Watchdog scheduled auto-retry (${attempts}/${maxAttempts}).`
                : "Execution timed out and retry budget is exhausted.",
              nextRetryAt: canRetry ? new Date().toISOString() : undefined,
              executedAt: canRetry ? current.executedAt : new Date().toISOString()
            }));
          }
        }
      }

      await store.persist();

      const dueRetries = store
        .listSubmissionRequests(workspace.id)
        .filter(
          (request) =>
            request.status === "pending_retry" &&
            (!request.nextRetryAt || Date.parse(request.nextRetryAt) <= Date.now())
        )
        .slice(0, 6);

      for (const request of dueRetries) {
        const key = submissionFlightKey(workspace.id, request.id);
        if (submissionInFlight.has(key)) continue;
        try {
          await runSubmissionExecution(workspace.id, request.id);
        } catch (error) {
          console.error(`Watchdog submission execution failed for ${request.id}:`, error instanceof Error ? error.message : error);
        }
      }
    }
  } finally {
    submissionWatchdogActive = false;
  }
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((value) => value.trim()) : true
  })
);
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fundraising-formops-hub" });
});

const signupSchema = z.object({
  name: z.string().min(2),
  email: authEmailSchema,
  password: z.string().min(8)
});

app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.signup(parsed.data);
    res.status(201).json({
      message: "Signup successful. Please verify your email before login.",
      verificationEmailSent: result.verificationEmailSent,
      verificationUrl: result.verificationUrl
    });
  })
);

const verifySchema = z.object({ token: z.string().min(12) });
app.post(
  "/api/auth/verify-email",
  asyncHandler(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = await authService.verifyEmail(parsed.data.token);
    res.json({ ok: true, user });
  })
);

const resendVerificationSchema = z.object({ email: authEmailSchema });
app.post(
  "/api/auth/resend-verification",
  asyncHandler(async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.resendVerificationEmail(parsed.data.email);
    const message = result.alreadyVerified
      ? "This email is already verified. Please sign in."
      : result.verificationEmailSent
        ? "If your account exists and is not verified, a new verification email has been sent."
        : "If your account exists and is not verified, we could not deliver the verification email right now. Please try again later.";

    res.json({
      ok: true,
      message,
      verificationEmailSent: result.verificationEmailSent,
      verificationUrl: result.verificationUrl
    });
  })
);

const forgotPasswordSchema = z.object({ email: authEmailSchema });
app.post(
  "/api/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.requestPasswordReset(parsed.data.email);
    const message = result.resetEmailSent
      ? "If this email exists, a password reset link has been sent."
      : "If this email exists, we could not deliver the reset email right now. Please try again later.";

    res.json({
      ok: true,
      message,
      resetEmailSent: result.resetEmailSent,
      resetUrl: result.resetUrl
    });
  })
);

const resetPasswordSchema = z.object({
  token: z.string().min(12),
  password: z.string().min(8)
});

app.post(
  "/api/auth/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    await authService.resetPassword(parsed.data.token, parsed.data.password);
    res.json({ ok: true, message: "Password reset successful. You can now sign in." });
  })
);

const loginSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(8)
});

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.login(parsed.data.email, parsed.data.password);
    res.json(result);
  })
);

app.use(
  "/api",
  asyncHandler(async (req, res, next) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    if (
      req.path === "/health" ||
      req.path === "/auth/signup" ||
      req.path === "/auth/verify-email" ||
      req.path === "/auth/resend-verification" ||
      req.path === "/auth/forgot-password" ||
      req.path === "/auth/reset-password" ||
      req.path === "/auth/login"
    ) {
      next();
      return;
    }

    const token = parseBearerToken(req.header("authorization"));
    if (!token) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await authService.getUserByToken(token);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    res.locals.authUser = user;
    res.locals.authToken = token;
    next();
  })
);

app.get("/api/auth/me", (_req, res) => {
  res.json({ user: getAuthUser(res) });
});

const authProfilePatchSchema = z.object({
  name: z.string().min(2)
});

app.patch(
  "/api/auth/profile",
  asyncHandler(async (req, res) => {
    const parsed = authProfilePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    const updated = await authService.updateProfile(user.id, parsed.data);
    res.json({ user: updated });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8)
});

app.post(
  "/api/auth/change-password",
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    await authService.changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    res.json({ ok: true, message: "Password updated successfully." });
  })
);

app.post(
  "/api/auth/logout",
  asyncHandler(async (_req, res) => {
    const token = res.locals.authToken as string | undefined;
    if (token) {
      await authService.logout(token);
    }
    res.json({ ok: true });
  })
);

app.get(
  "/api/workspaces",
  asyncHandler(async (_req, res) => {
    const user = getAuthUser(res);
    const membershipIds = await authService.listWorkspaceIds(user.id);
    const membershipSet = new Set(membershipIds);
    const scoped = store.listWorkspaces().filter((workspace) => membershipSet.has(workspace.id));

    const globalActiveId = store.getActiveWorkspaceId();
    const activeWorkspaceId = membershipSet.has(globalActiveId) ? globalActiveId : scoped[0]?.id;

    res.json({ activeWorkspaceId, workspaces: scoped });
  })
);

const createWorkspaceSchema = z.object({
  name: z.string().min(2),
  company: z.string().optional(),
  website: z.string().optional()
});

app.post(
  "/api/workspaces",
  asyncHandler(async (req, res) => {
    const parsed = createWorkspaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    const profile = buildTemplateProfile(parsed.data.company ?? parsed.data.name);
    if (parsed.data.website) {
      profile.website = parsed.data.website;
    }

    const workspace = store.createWorkspaceEntry(parsed.data.name, profile);
    await authService.addWorkspaceMembership(user.id, workspace.id, "owner");
    await store.persist();

    res.status(201).json(workspace);
  })
);

app.post(
  "/api/workspaces/:id/activate",
  asyncHandler(async (req, res) => {
    const user = getAuthUser(res);
    const hasAccess = await authService.userHasWorkspaceAccess(user.id, req.params.id);
    if (!hasAccess) {
      res.status(403).json({ message: "Forbidden workspace access" });
      return;
    }

    const ok = store.setActiveWorkspace(req.params.id);
    if (!ok) {
      res.status(404).json({ message: "Workspace not found" });
      return;
    }

    await store.persist();
    res.json({ ok: true });
  })
);

const profilePatchSchema = z.object({
  company: z.string().optional(),
  website: z.string().optional(),
  oneLiner: z.string().optional(),
  longDescription: z.string().optional(),
  senderName: z.string().optional(),
  senderTitle: z.string().optional(),
  senderEmail: z.string().optional(),
  senderPhone: z.string().optional(),
  linkedin: z.string().optional(),
  calendly: z.string().optional(),
  metrics: z
    .object({
      arr: z.string().optional(),
      mrr: z.string().optional(),
      subscribers: z.string().optional(),
      countries: z.string().optional(),
      ltvCac: z.string().optional(),
      churn: z.string().optional(),
      cumulativeRevenue: z.string().optional()
    })
    .optional(),
  fundraising: z
    .object({
      round: z.string().optional(),
      amount: z.string().optional(),
      valuation: z.string().optional(),
      secured: z.string().optional(),
      instrument: z.string().optional(),
      deckUrl: z.string().optional(),
      dataRoomUrl: z.string().optional()
    })
    .optional()
});

app.patch(
  "/api/workspaces/:id/profile",
  asyncHandler(async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    const hasAccess = await authService.userHasWorkspaceAccess(user.id, req.params.id);
    if (!hasAccess) {
      res.status(403).json({ message: "Forbidden workspace access" });
      return;
    }

    const updated = store.updateWorkspaceProfile(req.params.id, parsed.data as Partial<CompanyProfile>);
    if (!updated) {
      res.status(404).json({ message: "Workspace not found" });
      return;
    }

    await store.persist();
    res.json(updated);
  })
);

app.get(
  "/api/workspaces/:id/readiness",
  asyncHandler(async (req, res) => {
    const user = getAuthUser(res);
    const hasAccess = await authService.userHasWorkspaceAccess(user.id, req.params.id);
    if (!hasAccess) {
      res.status(403).json({ message: "Forbidden workspace access" });
      return;
    }

    const workspace = store.getWorkspace(req.params.id);
    if (!workspace) {
      res.status(404).json({ message: "Workspace not found" });
      return;
    }

    const missing = validateProfileReadiness(workspace.profile);
    const investorCount = store.listFirms(req.params.id).length;
    const ready = missing.length === 0 && investorCount > 0;

    res.json({
      workspaceId: workspace.id,
      ready,
      missingFields: missing,
      investorCount
    });
  })
);

app.get(
  "/api/profile",
  asyncHandler(async (req, res) => {
    const { workspace } = await resolveWorkspaceContext(req, res);
    res.json(workspace.profile);
  })
);

app.get(
  "/api/dashboard/overview",
  asyncHandler(async (req, res) => {
    const { workspace, workspaceId } = await resolveWorkspaceContext(req, res);

    // Use cached analytics if available (15s TTL) unless ?fresh=true
    const skipCache = req.query.fresh === "true";
    let overview = skipCache ? undefined : getCachedOverview(workspaceId);

    if (!overview) {
      overview = buildOverview(
        workspace,
        store.listFirms(workspaceId),
        store.listEvents(workspaceId),
        store.listRuns(workspaceId),
        store.listSubmissionRequests(workspaceId),
        store.listTasks(workspaceId),
        store.listLogs(workspaceId)
      );
    }

    res.json({ ...overview, creditBalance: creditService.getBalance(workspaceId) });
  })
);

app.get(
  "/api/firms",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const all = store.listFirms(workspaceId);
    const start = (page - 1) * limit;
    res.json({ firms: all.slice(start, start + limit), total: all.length });
  })
);

app.get(
  "/api/export/firms.csv",
  asyncHandler(async (req, res) => {
    const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
    const firms = store.listFirms(workspaceId);

    const csv = toCsv(
      [
        "id",
        "name",
        "website",
        "geography",
        "investor_type",
        "check_size_range",
        "focus_sectors",
        "stage_focus",
        "stage",
        "status_reason",
        "last_touched_at"
      ],
      firms.map((firm) => ({
        id: firm.id,
        name: firm.name,
        website: firm.website,
        geography: firm.geography,
        investor_type: firm.investorType,
        check_size_range: firm.checkSizeRange,
        focus_sectors: firm.focusSectors.join("|"),
        stage_focus: firm.stageFocus.join("|"),
        stage: firm.stage,
        status_reason: firm.statusReason,
        last_touched_at: firm.lastTouchedAt ?? ""
      }))
    );

    const fileName = `${safeFilePart(workspace.name)}-firms-${dayjs().format("YYYYMMDD-HHmm")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  })
);

app.get(
  "/api/imports",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    res.json(store.listImportBatches(workspaceId).sort((a, b) => (a.importedAt > b.importedAt ? -1 : 1)));
  })
);

const importFileSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  base64Data: z.string().min(1)
});

app.post(
  "/api/firms/import-file",
  asyncHandler(async (req, res) => {
    const parsed = importFileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const parsedImport = parseFirmsFromUpload(parsed.data.base64Data, parsed.data.fileName, parsed.data.mimeType, workspaceId);
    if (parsedImport.firms.length === 0) {
      store.addImportBatch({
        id: uuid(),
        workspaceId,
        sourceName: parsed.data.fileName,
        sourceType: parsedImport.sourceType,
        importedCount: 0,
        importedAt: new Date().toISOString(),
        status: "failed",
        note: "No valid investors found. Include at least company/fund name and website/domain columns."
      });
      await store.persist();
      res.status(400).json({
        message: "No valid investors found in file. Required columns include company/fund name and website/domain."
      });
      return;
    }

    for (const firm of parsedImport.firms) {
      store.upsertFirm(firm);
    }

    store.addImportBatch({
      id: uuid(),
      workspaceId,
      sourceName: parsed.data.fileName,
      sourceType: parsedImport.sourceType,
      importedCount: parsedImport.firms.length,
      importedAt: new Date().toISOString(),
      status: "completed"
    });

    await store.persist();
    res.json({ imported: parsedImport.firms.length, sourceType: parsedImport.sourceType });
  })
);

const importDriveSchema = z.object({ link: z.string().url() });

app.post(
  "/api/firms/import-drive",
  asyncHandler(async (req, res) => {
    const parsed = importDriveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);

    try {
      const parsedImport = await parseFirmsFromGoogleDriveLink(parsed.data.link, workspaceId);
      if (parsedImport.firms.length === 0) {
        store.addImportBatch({
          id: uuid(),
          workspaceId,
          sourceName: parsed.data.link,
          sourceType: "google_drive",
          importedCount: 0,
          importedAt: new Date().toISOString(),
          status: "failed",
          note: "No valid investors found. Include at least company/fund name and website/domain columns."
        });
        await store.persist();
        res.status(400).json({
          message: "No valid investors found in Google Drive file. Required columns include company/fund name and website/domain."
        });
        return;
      }
      for (const firm of parsedImport.firms) {
        store.upsertFirm(firm);
      }

      store.addImportBatch({
        id: uuid(),
        workspaceId,
        sourceName: parsed.data.link,
        sourceType: "google_drive",
        importedCount: parsedImport.firms.length,
        importedAt: new Date().toISOString(),
        status: "completed"
      });

      await store.persist();
      res.json({ imported: parsedImport.firms.length, sourceType: "google_drive" });
    } catch (error) {
      store.addImportBatch({
        id: uuid(),
        workspaceId,
        sourceName: parsed.data.link,
        sourceType: "google_drive",
        importedCount: 0,
        importedAt: new Date().toISOString(),
        status: "failed",
        note: error instanceof Error ? error.message : "Google Drive import failed"
      });
      await store.persist();
      res.status(400).json({ message: error instanceof Error ? error.message : "Google Drive import failed" });
    }
  })
);

app.get(
  "/api/firms/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const firm = store.getFirm(req.params.id, workspaceId);
    if (!firm) {
      res.status(404).json({ message: "Firm not found" });
      return;
    }

    const events = store.listEvents(workspaceId).filter((event) => event.firmId === firm.id).slice(0, 20);
    res.json({ firm, events });
  })
);

const updateStageSchema = z.object({
  stage: z.enum(["lead", "researching", "qualified", "form_discovered", "form_filled", "submitted", "review", "won", "lost"]),
  statusReason: z.string().min(1)
});

app.patch(
  "/api/firms/:id/stage",
  asyncHandler(async (req, res) => {
    const parsed = updateStageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const firm = store.getFirm(req.params.id, workspaceId);
    if (!firm) {
      res.status(404).json({ message: "Firm not found" });
      return;
    }

    store.upsertFirm({
      ...firm,
      stage: parsed.data.stage,
      statusReason: parsed.data.statusReason,
      lastTouchedAt: new Date().toISOString()
    });

    await store.persist();
    res.json({ ok: true });
  })
);

app.get(
  "/api/submissions/queue",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    res.json(store.listSubmissionRequests(workspaceId).sort((a, b) => (a.preparedAt > b.preparedAt ? -1 : 1)));
  })
);

app.get(
  "/api/submissions/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const request = store.getSubmissionRequest(req.params.id, workspaceId);
    if (!request) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    const firm = store.getFirm(request.firmId, workspaceId);
    const events = store
      .listEvents(workspaceId)
      .filter((event) => event.firmId === request.firmId)
      .sort((a, b) => (a.attemptedAt > b.attemptedAt ? -1 : 1))
      .slice(0, 40);

    res.json({
      request,
      firm,
      events
    });
  })
);

app.get(
  "/api/export/submissions.csv",
  asyncHandler(async (req, res) => {
    const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
    const queue = store.listSubmissionRequests(workspaceId);

    const csv = toCsv(
      [
        "id",
        "firm_name",
        "website",
        "status",
        "mode",
        "prepared_at",
        "approved_by",
        "approved_at",
        "executed_at",
        "execution_attempts",
        "max_execution_attempts",
        "last_execution_status",
        "next_retry_at",
        "result_note"
      ],
      queue.map((request) => ({
        id: request.id,
        firm_name: request.firmName,
        website: request.website,
        status: request.status,
        mode: request.mode,
        prepared_at: request.preparedAt,
        approved_by: request.approvedBy ?? "",
        approved_at: request.approvedAt ?? "",
        executed_at: request.executedAt ?? "",
        execution_attempts: request.executionAttempts ?? 0,
        max_execution_attempts: request.maxExecutionAttempts ?? 0,
        last_execution_status: request.lastExecutionStatus ?? "",
        next_retry_at: request.nextRetryAt ?? "",
        result_note: request.resultNote ?? ""
      }))
    );

    const fileName = `${safeFilePart(workspace.name)}-submissions-${dayjs().format("YYYYMMDD-HHmm")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  })
);

const bulkApproveSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  approvedBy: z.string().default("Operator")
});

app.post(
  "/api/submissions/actions/bulk-approve",
  asyncHandler(async (req, res) => {
    const parsed = bulkApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const uniqueIds = [...new Set(parsed.data.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    const succeeded: string[] = [];

    for (const requestId of uniqueIds) {
      const existing = store.getSubmissionRequest(requestId, workspaceId);
      if (!existing) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }
      if (!canApproveFromStatus(existing.status)) {
        failed.push({ id: requestId, message: `Cannot approve from status '${existing.status}'` });
        continue;
      }

      const approved = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "approved",
        approvedBy: parsed.data.approvedBy,
        approvedAt: new Date().toISOString()
      }));

      if (!approved) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }

      try {
        await runSubmissionExecution(workspaceId, requestId);
        succeeded.push(requestId);
      } catch (error) {
        failed.push({
          id: requestId,
          message: error instanceof Error ? error.message : "Execution failed"
        });
      }
    }

    await store.persist();
    res.json({
      processed: uniqueIds.length,
      approved: succeeded.length,
      failed
    });
  })
);

const bulkRejectSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  rejectedBy: z.string().default("Operator"),
  reason: z.string().default("Rejected by operator")
});

app.post(
  "/api/submissions/actions/bulk-reject",
  asyncHandler(async (req, res) => {
    const parsed = bulkRejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const uniqueIds = [...new Set(parsed.data.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let rejected = 0;

    for (const requestId of uniqueIds) {
      const existing = store.getSubmissionRequest(requestId, workspaceId);
      if (!existing) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }

      const updated = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "rejected",
        approvedBy: parsed.data.rejectedBy,
        approvedAt: new Date().toISOString(),
        resultNote: parsed.data.reason
      }));

      if (!updated) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }
      rejected += 1;
    }

    await store.persist();
    res.json({
      processed: uniqueIds.length,
      rejected,
      failed
    });
  })
);

const approveSubmissionSchema = z.object({ approvedBy: z.string().default("Operator") });

app.post(
  "/api/submissions/:id/approve",
  asyncHandler(async (req, res) => {
    const parsed = approveSubmissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const existing = store.getSubmissionRequest(req.params.id, workspaceId);
    if (!existing) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }
    if (!canApproveFromStatus(existing.status)) {
      res.status(409).json({ message: `Submission cannot be approved from status '${existing.status}'` });
      return;
    }

    const approved = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({
      ...current,
      status: "approved",
      approvedBy: parsed.data.approvedBy,
      approvedAt: new Date().toISOString()
    }));

    if (!approved) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    const execution = await runSubmissionExecution(workspaceId, req.params.id);
    res.json(execution);
  })
);

const rejectSubmissionSchema = z.object({
  rejectedBy: z.string().default("Operator"),
  reason: z.string().default("Rejected by operator")
});

app.post(
  "/api/submissions/:id/reject",
  asyncHandler(async (req, res) => {
    const parsed = rejectSubmissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const updated = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({
      ...current,
      status: "rejected",
      approvedBy: parsed.data.rejectedBy,
      approvedAt: new Date().toISOString(),
      resultNote: parsed.data.reason
    }));

    if (!updated) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    await store.persist();
    res.json(updated);
  })
);

app.get(
  "/api/runs",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    res.json(store.listRuns(workspaceId));
  })
);

app.get(
  "/api/runs/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const run = store.getRun(req.params.id, workspaceId);
    if (!run) {
      res.status(404).json({ message: "Run not found" });
      return;
    }

    res.json({
      run,
      tasks: store.listTasksByRun(run.id, workspaceId),
      logs: store.listLogsByRun(run.id, workspaceId)
    });
  })
);

const runSchema = z.object({
  initiatedBy: z.string().optional(),
  mode: z.enum(["dry_run", "production"]).default("dry_run"),
  firmIds: z.array(z.string()).optional(),
  workspaceId: z.string().optional()
});

app.post(
  "/api/runs",
  asyncHandler(async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId, workspace, user } = await resolveWorkspaceContext(req, res);
    const missing = validateProfileReadiness(workspace.profile);
    if (missing.length > 0) {
      res.status(400).json({ message: `Project knowledge base is incomplete. Missing: ${missing.join(", ")}` });
      return;
    }

    const run = await orchestrator.createRun({
      initiatedBy: parsed.data.initiatedBy ?? user.name,
      mode: parsed.data.mode,
      firmIds: parsed.data.firmIds,
      workspaceId
    });

    res.status(201).json(run);
  })
);

if (featureCreditsEnabled) {
  app.get(
    "/api/credits/balance",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      res.json(creditService.getBalance(workspaceId));
    })
  );

  app.get(
    "/api/credits/transactions",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      res.json(creditService.listTransactions(workspaceId));
    })
  );

  app.post(
    "/api/credits/purchase",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      const packs = Math.max(1, Number(req.body?.packs) || 1);
      const transaction = await creditService.recordPurchase(workspaceId, packs);
      res.status(201).json({ transaction, balance: creditService.getBalance(workspaceId) });
    })
  );
}

if (featureAssessmentEnabled) {
  app.post(
    "/api/assess",
    asyncHandler(async (req, res) => {
      const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
      const firms = store.listFirms(workspaceId);

      const assessment: AssessmentResult = {
        id: uuid(),
        workspaceId,
        status: "running",
        startedAt: new Date().toISOString(),
        matches: [],
        totalFirmsAnalyzed: firms.length
      };

      store.addAssessment(assessment);
      await store.persist();

      const { assessInvestors } = await import("./services/ai-assessor.js");
      assessInvestors(workspace.profile, firms)
        .then(async (matches) => {
          for (const match of matches) {
            const firm = store.getFirm(match.firmId, workspaceId);
            if (firm) {
              store.upsertFirm({ ...firm, matchScore: match.score, matchReasoning: match.reasoning });
            }
          }

          store.updateAssessment(assessment.id, (current) => ({
            ...current,
            status: "completed",
            completedAt: new Date().toISOString(),
            matches
          }));

          await store.persist();
        })
        .catch(async (error) => {
          store.updateAssessment(assessment.id, (current) => ({
            ...current,
            status: "failed",
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Assessment failed"
          }));

          await store.persist();
        });

      res.status(202).json(assessment);
    })
  );

  app.get(
    "/api/assess/latest",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      const latest = store.getLatestAssessment(workspaceId);
      if (!latest) {
        res.status(404).json({ message: "No assessment found" });
        return;
      }

      res.json(latest);
    })
  );

  app.get(
    "/api/assess/:id",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      const assessment = store.getAssessment(req.params.id);
      if (!assessment) {
        res.status(404).json({ message: "Assessment not found" });
        return;
      }
      if (assessment.workspaceId !== workspaceId) {
        res.status(404).json({ message: "Assessment not found" });
        return;
      }

      res.json(assessment);
    })
  );
}

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", error.message);
  res.status(error.status ?? 500).json({ message: error.message || "Internal server error" });
});

async function start(): Promise<void> {
  await store.init();
  await authService.init();

  await authService.ensureMembershipsForUser(process.env.AUTH_EMAIL ?? "founder@vcops.local", store.listWorkspaces().map((w) => w.id));

  setInterval(() => {
    void runSubmissionWatchdog();
  }, submissionWatchdogIntervalMs);
  void runSubmissionWatchdog();

  app.listen(port, () => {
    console.log(`VCReach backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
