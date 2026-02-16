import cors from "cors";
import express from "express";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { StateStore } from "./domain/store.js";
import { buildOverview } from "./services/analytics.js";
import { CampaignOrchestrator } from "./orchestrator/workflow.js";
import { batchOne, systemPrompt } from "./domain/playbook.js";
import { buildTemplateProfile } from "./domain/seed.js";
import { parseFirmsCsv } from "./services/csv-import.js";
import { executeSubmissionRequest } from "./services/submission-executor.js";
import type { CompanyProfile, PipelineStage, SubmissionStatus } from "./domain/types.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const store = new StateStore();
const orchestrator = new CampaignOrchestrator(store);

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

app.get("/api/workspaces", (_req, res) => {
  res.json({
    activeWorkspaceId: store.getActiveWorkspaceId(),
    workspaces: store.listWorkspaces()
  });
});

const createWorkspaceSchema = z.object({
  name: z.string().min(2),
  company: z.string().optional()
});

app.post("/api/workspaces", async (req, res) => {
  const parsed = createWorkspaceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const profile = buildTemplateProfile(parsed.data.company ?? parsed.data.name);
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

app.get("/api/playbook", (_req, res) => {
  res.json({ systemPrompt, batchOne });
});

app.get("/api/dashboard/overview", (_req, res) => {
  const workspace = store.getActiveWorkspace();
  res.json(
    buildOverview(
      workspace,
      store.listFirms(workspace.id),
      store.listEvents(workspace.id),
      store.listRuns(workspace.id),
      store.listSubmissionRequests(workspace.id)
    )
  );
});

app.get("/api/firms", (_req, res) => {
  res.json(store.listFirms());
});

const importCsvSchema = z.object({
  csv: z.string().min(1),
  mode: z.enum(["append", "replace"]).default("append")
});

app.post("/api/firms/import-csv", async (req, res) => {
  const parsed = importCsvSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const workspace = store.getActiveWorkspace();
  const imported = parseFirmsCsv(parsed.data.csv, workspace.id);

  if (parsed.data.mode === "replace") {
    store.replaceWorkspaceFirms(workspace.id, imported);
  } else {
    for (const firm of imported) {
      store.upsertFirm(firm);
    }
  }

  await store.persist();
  res.json({ imported: imported.length, mode: parsed.data.mode });
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

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

async function start(): Promise<void> {
  await store.init();
  app.listen(port, () => {
    console.log(`Fundraising FormOps backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
