import cors from "cors";
import express from "express";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { StateStore } from "./domain/store.js";
import { buildOverview } from "./services/analytics.js";
import { CampaignOrchestrator } from "./orchestrator/workflow.js";
import { buildTemplateProfile } from "./domain/seed.js";
import { parseFirmsFromGoogleDriveLink, parseFirmsFromUpload } from "./services/import-parser.js";
import { executeSubmissionRequest } from "./services/submission-executor.js";
import { CreditService } from "./services/credit-service.js";
import { assessInvestors } from "./services/ai-assessor.js";
import type { AssessmentResult, CompanyProfile, PipelineStage, SubmissionStatus } from "./domain/types.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const store = new StateStore();
const orchestrator = new CampaignOrchestrator(store);
const creditService = new CreditService(store);

type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "owner";
};

const defaultAuthUser: AuthUser = {
  id: "user_default_owner",
  email: process.env.AUTH_EMAIL ?? "founder@vcops.local",
  name: process.env.AUTH_NAME ?? "Founder",
  role: "owner"
};
const defaultAuthPassword = process.env.AUTH_PASSWORD ?? "ChangeMe123!";
const activeSessions = new Map<string, AuthUser>();

function parseBearerToken(authHeader?: string): string | undefined {
  if (!authHeader) return undefined;
  const [scheme, value] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value.trim();
}

type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => { fn(req, res, next).catch(next); };
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

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((value) => value.trim()) : true
  })
);
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fundraising-formops-hub" });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

app.post("/api/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  if (email !== defaultAuthUser.email.toLowerCase() || parsed.data.password !== defaultAuthPassword) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const token = uuid();
  activeSessions.set(token, defaultAuthUser);
  res.json({ token, user: defaultAuthUser });
});

app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  if (req.path === "/health" || req.path === "/auth/login") {
    next();
    return;
  }

  const token = parseBearerToken(req.header("authorization"));
  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const user = activeSessions.get(token);
  if (!user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  res.locals.authUser = user;
  res.locals.authToken = token;
  next();
});

app.get("/api/auth/me", (_req, res) => {
  res.json({ user: res.locals.authUser as AuthUser });
});

app.post("/api/auth/logout", (_req, res) => {
  const token = res.locals.authToken as string | undefined;
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ ok: true });
});

app.get("/api/workspaces", (_req, res) => {
  res.json({
    activeWorkspaceId: store.getActiveWorkspaceId(),
    workspaces: store.listWorkspaces()
  });
});

const createWorkspaceSchema = z.object({
  name: z.string().min(2),
  company: z.string().optional(),
  website: z.string().optional()
});

app.post("/api/workspaces", async (req, res) => {
  const parsed = createWorkspaceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const profile = buildTemplateProfile(parsed.data.company ?? parsed.data.name);
  if (parsed.data.website) {
    profile.website = parsed.data.website;
  }
  const workspace = store.createWorkspaceEntry(parsed.data.name, profile);
  await store.persist();
  res.status(201).json(workspace);
});

app.post("/api/workspaces/:id/activate", async (req, res) => {
  const ok = store.setActiveWorkspace(req.params.id);
  if (!ok) {
    res.status(404).json({ message: "Workspace not found" });
    return;
  }

  await store.persist();
  res.json({ ok: true });
});

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

app.patch("/api/workspaces/:id/profile", async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const updated = store.updateWorkspaceProfile(req.params.id, parsed.data as Partial<CompanyProfile>);
  if (!updated) {
    res.status(404).json({ message: "Workspace not found" });
    return;
  }

  await store.persist();
  res.json(updated);
});

app.get("/api/profile", (_req, res) => {
  res.json(store.getActiveWorkspace().profile);
});

app.get("/api/dashboard/overview", (_req, res) => {
  const workspace = store.getActiveWorkspace();
  const overview = buildOverview(
    workspace,
    store.listFirms(workspace.id),
    store.listEvents(workspace.id),
    store.listRuns(workspace.id),
    store.listSubmissionRequests(workspace.id)
  );
  res.json({ ...overview, creditBalance: creditService.getBalance(workspace.id) });
});

app.get("/api/firms", (_req, res) => {
  const page = Math.max(1, Number(_req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(_req.query.limit) || 50));
  const all = store.listFirms();
  const start = (page - 1) * limit;
  res.json({ firms: all.slice(start, start + limit), total: all.length });
});

app.get("/api/imports", (_req, res) => {
  res.json(
    store
      .listImportBatches()
      .sort((a, b) => (a.importedAt > b.importedAt ? -1 : 1))
  );
});

const importFileSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  base64Data: z.string().min(1)
});

app.post("/api/firms/import-file", async (req, res) => {
  const parsed = importFileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const workspace = store.getActiveWorkspace();
  const parsedImport = parseFirmsFromUpload(
    parsed.data.base64Data,
    parsed.data.fileName,
    parsed.data.mimeType,
    workspace.id
  );

  for (const firm of parsedImport.firms) {
    store.upsertFirm(firm);
  }

  let runId: string | undefined;
  if (parsedImport.firms.length > 0) {
    const run = await orchestrator.createRun({
      initiatedBy: "Background Agent",
      mode: "production",
      workspaceId: workspace.id,
      firmIds: parsedImport.firms.map((firm) => firm.id)
    });
    runId = run.id;
  }

  store.addImportBatch({
    id: uuid(),
    workspaceId: workspace.id,
    sourceName: parsed.data.fileName,
    sourceType: parsedImport.sourceType,
    importedCount: parsedImport.firms.length,
    importedAt: new Date().toISOString(),
    status: "completed",
    runId
  });

  await store.persist();
  res.json({ imported: parsedImport.firms.length, sourceType: parsedImport.sourceType, runId });
});

const importDriveSchema = z.object({
  link: z.string().url()
});

app.post("/api/firms/import-drive", async (req, res) => {
  const parsed = importDriveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const workspace = store.getActiveWorkspace();

  try {
    const parsedImport = await parseFirmsFromGoogleDriveLink(parsed.data.link, workspace.id);
    for (const firm of parsedImport.firms) {
      store.upsertFirm(firm);
    }

    let runId: string | undefined;
    if (parsedImport.firms.length > 0) {
      const run = await orchestrator.createRun({
        initiatedBy: "Background Agent",
        mode: "production",
        workspaceId: workspace.id,
        firmIds: parsedImport.firms.map((firm) => firm.id)
      });
      runId = run.id;
    }

    store.addImportBatch({
      id: uuid(),
      workspaceId: workspace.id,
      sourceName: parsed.data.link,
      sourceType: "google_drive",
      importedCount: parsedImport.firms.length,
      importedAt: new Date().toISOString(),
      status: "completed",
      runId
    });

    await store.persist();
    res.json({ imported: parsedImport.firms.length, sourceType: "google_drive", runId });
  } catch (error) {
    store.addImportBatch({
      id: uuid(),
      workspaceId: workspace.id,
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
});

app.get("/api/firms/:id", (req, res) => {
  const workspaceId = store.getActiveWorkspaceId();
  const firm = store.getFirm(req.params.id, workspaceId);
  if (!firm) {
    res.status(404).json({ message: "Firm not found" });
    return;
  }

  const events = store.listEvents(workspaceId).filter((event) => event.firmId === firm.id).slice(0, 20);
  res.json({ firm, events });
});

const updateStageSchema = z.object({
  stage: z.enum(["lead", "researching", "qualified", "form_discovered", "form_filled", "submitted", "review", "won", "lost"]),
  statusReason: z.string().min(1)
});

app.patch("/api/firms/:id/stage", async (req, res) => {
  const parsed = updateStageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const workspaceId = store.getActiveWorkspaceId();
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
});

app.get("/api/submissions/queue", (_req, res) => {
  const workspaceId = store.getActiveWorkspaceId();
  res.json(
    store
      .listSubmissionRequests(workspaceId)
      .sort((a, b) => (a.preparedAt > b.preparedAt ? -1 : 1))
  );
});

const approveSubmissionSchema = z.object({
  approvedBy: z.string().default("Operator")
});

app.post("/api/submissions/:id/approve", async (req, res) => {
  const parsed = approveSubmissionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const workspaceId = store.getActiveWorkspaceId();
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

  const executing = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({
    ...current,
    status: "executing"
  }));

  if (!executing) {
    res.status(404).json({ message: "Submission request not found" });
    return;
  }

  const result = await executeSubmissionRequest(executing);

  const finalStatus = result.status === "submitted" ? "completed" : result.status === "form_filled" ? "completed" : "failed";
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
});

const rejectSubmissionSchema = z.object({
  rejectedBy: z.string().default("Operator"),
  reason: z.string().default("Rejected by operator")
});

app.post("/api/submissions/:id/reject", async (req, res) => {
  const parsed = rejectSubmissionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const workspaceId = store.getActiveWorkspaceId();
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
});

app.get("/api/runs", (_req, res) => {
  res.json(store.listRuns());
});

app.get("/api/runs/:id", (req, res) => {
  const workspaceId = store.getActiveWorkspaceId();
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
});

const runSchema = z.object({
  initiatedBy: z.string().default("Operator"),
  mode: z.enum(["dry_run", "production"]).default("dry_run"),
  firmIds: z.array(z.string()).optional(),
  workspaceId: z.string().optional()
});

app.post("/api/runs", async (req, res) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const run = await orchestrator.createRun({
    initiatedBy: parsed.data.initiatedBy,
    mode: parsed.data.mode,
    firmIds: parsed.data.firmIds,
    workspaceId: parsed.data.workspaceId
  });

  res.status(201).json(run);
});

// ── Credit Routes ──────────────────────────────────────────────────
app.get("/api/credits/balance", (_req, res) => {
  const workspace = store.getActiveWorkspace();
  res.json(creditService.getBalance(workspace.id));
});

app.get("/api/credits/transactions", (_req, res) => {
  const workspace = store.getActiveWorkspace();
  res.json(creditService.listTransactions(workspace.id));
});

app.post("/api/credits/purchase", asyncHandler(async (req, res) => {
  const packs = Math.max(1, Number(req.body?.packs) || 1);
  const workspace = store.getActiveWorkspace();
  const txn = await creditService.recordPurchase(workspace.id, packs);
  res.status(201).json({ transaction: txn, balance: creditService.getBalance(workspace.id) });
}));

// ── Assessment Routes ──────────────────────────────────────────────
app.post("/api/assess", asyncHandler(async (_req, res) => {
  const workspace = store.getActiveWorkspace();
  const firms = store.listFirms(workspace.id);
  const assessment: AssessmentResult = {
    id: uuid(),
    workspaceId: workspace.id,
    status: "running",
    startedAt: new Date().toISOString(),
    matches: [],
    totalFirmsAnalyzed: firms.length,
  };
  store.addAssessment(assessment);
  await store.persist();

  // Run assessment async
  assessInvestors(workspace.profile, firms)
    .then(async (matches) => {
      for (const match of matches) {
        const firm = store.getFirm(match.firmId, workspace.id);
        if (firm) {
          store.upsertFirm({ ...firm, matchScore: match.score, matchReasoning: match.reasoning });
        }
      }
      store.updateAssessment(assessment.id, (a) => ({
        ...a, status: "completed", completedAt: new Date().toISOString(), matches,
      }));
      await store.persist();
    })
    .catch(async (err) => {
      store.updateAssessment(assessment.id, (a) => ({
        ...a, status: "failed", completedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Assessment failed",
      }));
      await store.persist();
    });

  res.status(202).json(assessment);
}));

app.get("/api/assess/latest", (_req, res) => {
  const workspace = store.getActiveWorkspace();
  const latest = store.getLatestAssessment(workspace.id);
  if (!latest) { res.status(404).json({ message: "No assessment found" }); return; }
  res.json(latest);
});

app.get("/api/assess/:id", (req, res) => {
  const assessment = store.getAssessment(req.params.id);
  if (!assessment) { res.status(404).json({ message: "Assessment not found" }); return; }
  res.json(assessment);
});

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ message: err.message || "Internal server error" });
});

async function start(): Promise<void> {
  await store.init();
  app.listen(port, () => {
    console.log(`VCReach backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
