import cors from "cors";
import express from "express";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { StateStore } from "./domain/store.js";
import { buildTemplateProfile } from "./domain/seed.js";
import type { AssessmentResult, CompanyProfile, PipelineStage, SubmissionStatus, Workspace } from "./domain/types.js";
import { CampaignOrchestrator } from "./orchestrator/workflow.js";
import { buildOverview } from "./services/analytics.js";
import { assessInvestors } from "./services/ai-assessor.js";
import { AuthService, type AuthUser } from "./services/auth-service.js";
import { CreditService } from "./services/credit-service.js";
import { parseFirmsFromGoogleDriveLink, parseFirmsFromUpload } from "./services/import-parser.js";
import { executeSubmissionRequest } from "./services/submission-executor.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const store = new StateStore();
const orchestrator = new CampaignOrchestrator(store);
const creditService = new CreditService(store);
const authService = new AuthService();

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
  email: z.string().email(),
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

const loginSchema = z.object({
  email: z.string().email(),
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

    if (req.path === "/health" || req.path === "/auth/signup" || req.path === "/auth/verify-email" || req.path === "/auth/login") {
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
    const overview = buildOverview(
      workspace,
      store.listFirms(workspaceId),
      store.listEvents(workspaceId),
      store.listRuns(workspaceId),
      store.listSubmissionRequests(workspaceId)
    );

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

    const executing = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({ ...current, status: "executing" }));
    if (!executing) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    const result = await executeSubmissionRequest(executing);
    const finalStatus = result.status === "submitted" || result.status === "form_filled" ? "completed" : "failed";

    const updatedRequest = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({
      ...current,
      status: finalStatus,
      executedAt: new Date().toISOString(),
      resultNote: result.note
    }));

    const firm = store.getFirm(executing.firmId, workspaceId);
    if (firm) {
      store.upsertFirm({
        ...firm,
        stage: statusToStage(result.status),
        statusReason: result.note,
        lastTouchedAt: new Date().toISOString(),
        notes: [...firm.notes, `Approval execution ${req.params.id}: ${result.status}`]
      });
    }

    store.addEvent({
      id: uuid(),
      workspaceId,
      firmId: executing.firmId,
      firmName: executing.firmName,
      channel: "website_form",
      status: result.status,
      attemptedAt: new Date().toISOString(),
      discoveredAt: result.discoveredAt,
      filledAt: result.filledAt,
      submittedAt: result.submittedAt,
      blockedReason: result.blockedReason,
      note: result.note
    });

    await store.persist();
    res.json({ request: updatedRequest, result });
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

  app.listen(port, () => {
    console.log(`VCReach backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
