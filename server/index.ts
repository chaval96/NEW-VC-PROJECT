import cors from "cors";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { StateStore } from "./domain/store.js";
import { buildOverview } from "./services/analytics.js";
import { CampaignOrchestrator } from "./orchestrator/workflow.js";
import { batchOne, systemPrompt } from "./domain/playbook.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const store = new StateStore();
const orchestrator = new CampaignOrchestrator(store);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((value) => value.trim()) : true
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "wask-vc-formops" });
});

app.get("/api/profile", (_req, res) => {
  res.json(store.getState().profile);
});

app.get("/api/playbook", (_req, res) => {
  res.json({ systemPrompt, batchOne });
});

app.get("/api/dashboard/overview", (_req, res) => {
  res.json(buildOverview(store.getState()));
});

app.get("/api/firms", (_req, res) => {
  res.json(store.listFirms());
});

app.get("/api/firms/:id", (req, res) => {
  const firm = store.getFirm(req.params.id);
  if (!firm) {
    res.status(404).json({ message: "Firm not found" });
    return;
  }

  const events = store.listEvents().filter((event) => event.firmId === firm.id).slice(0, 20);
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

  const firm = store.getFirm(req.params.id);
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

app.get("/api/runs", (_req, res) => {
  res.json(store.listRuns());
});

app.get("/api/runs/:id", (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ message: "Run not found" });
    return;
  }

  res.json({
    run,
    tasks: store.listTasksByRun(run.id),
    logs: store.listLogsByRun(run.id)
  });
});

const runSchema = z.object({
  initiatedBy: z.string().default("Utku Bozkurt"),
  mode: z.enum(["dry_run", "production"]).default("dry_run"),
  firmIds: z.array(z.string()).optional()
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
    firmIds: parsed.data.firmIds
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
    console.log(`WASK VC backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
