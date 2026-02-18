import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { v4 as uuid } from "uuid";
import { buildTemplateProfile, createSeedState, createWorkspace } from "./seed.js";
import type { AppState, AgentTaskResult, AssessmentResult, CampaignRun, CompanyProfile, CreditTransaction, Firm, ImportBatch, RunLog, SubmissionEvent, SubmissionRequest, Workspace } from "./types.js";

const dataDir = path.resolve("server/data");
const dataPath = path.join(dataDir, "state.json");
const stateRowId = 1;

function migrateLegacyState(raw: any): AppState {
  if (raw && Array.isArray(raw.workspaces)) {
    return raw as AppState;
  }

  const template = buildTemplateProfile(raw?.profile?.company ?? "Default Company");
  const profile = {
    ...template,
    ...(raw?.profile ?? {}),
    metrics: {
      ...template.metrics,
      ...(raw?.profile?.metrics ?? {})
    },
    fundraising: {
      ...template.fundraising,
      ...(raw?.profile?.fundraising ?? {})
    }
  };
  const workspace = createWorkspace(
    raw?.profile?.company ? `${raw.profile.company} Fundraising` : "Default Workspace",
    profile
  );
  const workspaceId = workspace.id;

  return {
    workspaces: [workspace],
    activeWorkspaceId: workspaceId,
    firms: Array.isArray(raw?.firms)
      ? raw.firms.map((firm: any) => ({ ...firm, workspaceId, id: firm.id ?? uuid() }))
      : [],
    submissionEvents: Array.isArray(raw?.submissionEvents)
      ? raw.submissionEvents.map((event: any) => ({ ...event, workspaceId, id: event.id ?? uuid() }))
      : Array.isArray(raw?.outreachEvents)
        ? raw.outreachEvents.map((event: any) => ({ ...event, workspaceId, id: event.id ?? uuid() }))
        : [],
    submissionRequests: [],
    importBatches: [],
    tasks: Array.isArray(raw?.tasks)
      ? raw.tasks.map((task: any) => ({ ...task, workspaceId, id: task.id ?? uuid() }))
      : [],
    runs: Array.isArray(raw?.runs)
      ? raw.runs.map((run: any) => ({ ...run, workspaceId, id: run.id ?? uuid() }))
      : [],
    logs: Array.isArray(raw?.logs)
      ? raw.logs.map((log: any) => ({ ...log, workspaceId, id: log.id ?? uuid() }))
      : [],
    creditTransactions: [],
    assessments: []
  };
}

export class StateStore {
  private state: AppState = createSeedState();
  private readonly databaseUrl = process.env.DATABASE_URL;
  private pool: Pool | null = null;

  async init(): Promise<void> {
    if (this.databaseUrl) {
      await this.initPostgres();
      return;
    }

    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(dataPath, "utf8");
      this.state = migrateLegacyState(JSON.parse(raw));
      if (!Array.isArray((this.state as any).importBatches)) {
        (this.state as any).importBatches = [];
      }
      if (!Array.isArray((this.state as any).creditTransactions)) {
        (this.state as any).creditTransactions = [];
      }
      if (!Array.isArray((this.state as any).assessments)) {
        (this.state as any).assessments = [];
      }
      if (this.state.workspaces.length === 0) {
        this.state = createSeedState();
      }
      await this.persist();
    } catch {
      await this.persist();
    }
  }

  private async initPostgres(): Promise<void> {
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false }
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await this.pool.query<{ payload: any }>("SELECT payload FROM app_state WHERE id = $1", [stateRowId]);

    if (result.rows.length === 0) {
      await this.persist();
      return;
    }

    this.state = migrateLegacyState(result.rows[0].payload);
    if (this.state.workspaces.length === 0) {
      this.state = createSeedState();
    }
    await this.persist();
  }

  getState(): AppState {
    return this.state;
  }

  listWorkspaces(): Workspace[] {
    return [...this.state.workspaces];
  }

  getActiveWorkspaceId(): string {
    return this.state.activeWorkspaceId;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.state.workspaces.find((workspace) => workspace.id === id);
  }

  getActiveWorkspace(): Workspace {
    const workspace = this.getWorkspace(this.state.activeWorkspaceId);
    if (!workspace) {
      const fallback = createSeedState();
      this.state = fallback;
      return fallback.workspaces[0];
    }
    return workspace;
  }

  createWorkspaceEntry(name: string, profile: CompanyProfile): Workspace {
    const workspace = createWorkspace(name, profile);
    this.state.workspaces.unshift(workspace);
    this.state.activeWorkspaceId = workspace.id;
    return workspace;
  }

  setActiveWorkspace(id: string): boolean {
    if (!this.state.workspaces.some((workspace) => workspace.id === id)) {
      return false;
    }
    this.state.activeWorkspaceId = id;
    return true;
  }

  updateWorkspaceProfile(id: string, patch: Partial<CompanyProfile>): Workspace | undefined {
    const index = this.state.workspaces.findIndex((workspace) => workspace.id === id);
    if (index === -1) {
      return undefined;
    }

    const current = this.state.workspaces[index];
    const updated: Workspace = {
      ...current,
      profile: {
        ...current.profile,
        ...patch,
        metrics: {
          ...current.profile.metrics,
          ...(patch.metrics ?? {})
        },
        fundraising: {
          ...current.profile.fundraising,
          ...(patch.fundraising ?? {})
        }
      },
      updatedAt: new Date().toISOString()
    };

    this.state.workspaces[index] = updated;
    return updated;
  }

  listFirms(workspaceId = this.state.activeWorkspaceId): Firm[] {
    return this.state.firms.filter((firm) => firm.workspaceId === workspaceId);
  }

  getFirm(id: string, workspaceId = this.state.activeWorkspaceId): Firm | undefined {
    return this.state.firms.find((firm) => firm.workspaceId === workspaceId && firm.id === id);
  }

  upsertFirm(nextFirm: Firm): void {
    const index = this.state.firms.findIndex((firm) => firm.id === nextFirm.id && firm.workspaceId === nextFirm.workspaceId);
    if (index === -1) {
      this.state.firms.push(nextFirm);
      return;
    }

    this.state.firms[index] = nextFirm;
  }

  replaceWorkspaceFirms(workspaceId: string, firms: Firm[]): void {
    this.state.firms = this.state.firms.filter((firm) => firm.workspaceId !== workspaceId).concat(firms);
  }

  removeWorkspaceFirms(workspaceId: string, firmIds: Set<string>): {
    removedFirms: number;
    removedEvents: number;
    removedRequests: number;
    removedTasks: number;
    removedLogs: number;
  } {
    const beforeFirms = this.state.firms.length;
    const beforeEvents = this.state.submissionEvents.length;
    const beforeRequests = this.state.submissionRequests.length;
    const beforeTasks = this.state.tasks.length;
    const beforeLogs = this.state.logs.length;

    this.state.firms = this.state.firms.filter((firm) => !(firm.workspaceId === workspaceId && firmIds.has(firm.id)));
    this.state.submissionEvents = this.state.submissionEvents.filter(
      (event) => !(event.workspaceId === workspaceId && firmIds.has(event.firmId))
    );
    this.state.submissionRequests = this.state.submissionRequests.filter(
      (request) => !(request.workspaceId === workspaceId && firmIds.has(request.firmId))
    );
    this.state.tasks = this.state.tasks.filter((task) => !(task.workspaceId === workspaceId && firmIds.has(task.firmId)));
    this.state.logs = this.state.logs.filter(
      (log) => !(log.workspaceId === workspaceId && log.firmId && firmIds.has(log.firmId))
    );

    return {
      removedFirms: beforeFirms - this.state.firms.length,
      removedEvents: beforeEvents - this.state.submissionEvents.length,
      removedRequests: beforeRequests - this.state.submissionRequests.length,
      removedTasks: beforeTasks - this.state.tasks.length,
      removedLogs: beforeLogs - this.state.logs.length
    };
  }

  remapWorkspaceFirmReferences(workspaceId: string, idMap: Record<string, string>): number {
    const entries = Object.entries(idMap).filter(([from, to]) => from !== to);
    if (entries.length === 0) return 0;
    const map = new Map(entries);
    let touched = 0;

    this.state.submissionEvents = this.state.submissionEvents.map((event) => {
      if (event.workspaceId !== workspaceId) return event;
      const nextFirmId = map.get(event.firmId);
      if (!nextFirmId) return event;
      touched += 1;
      return { ...event, firmId: nextFirmId };
    });

    this.state.submissionRequests = this.state.submissionRequests.map((request) => {
      if (request.workspaceId !== workspaceId) return request;
      const nextFirmId = map.get(request.firmId);
      if (!nextFirmId) return request;
      touched += 1;
      return { ...request, firmId: nextFirmId };
    });

    this.state.tasks = this.state.tasks.map((task) => {
      if (task.workspaceId !== workspaceId) return task;
      const nextFirmId = map.get(task.firmId);
      if (!nextFirmId) return task;
      touched += 1;
      return { ...task, firmId: nextFirmId };
    });

    this.state.logs = this.state.logs.map((log) => {
      if (log.workspaceId !== workspaceId || !log.firmId) return log;
      const nextFirmId = map.get(log.firmId);
      if (!nextFirmId) return log;
      touched += 1;
      return { ...log, firmId: nextFirmId };
    });

    return touched;
  }

  addEvent(event: SubmissionEvent): void {
    this.state.submissionEvents.unshift(event);
  }

  listEvents(workspaceId = this.state.activeWorkspaceId): SubmissionEvent[] {
    return this.state.submissionEvents.filter((event) => event.workspaceId === workspaceId);
  }

  addSubmissionRequest(request: SubmissionRequest): void {
    this.state.submissionRequests.unshift(request);
  }

  listSubmissionRequests(workspaceId = this.state.activeWorkspaceId): SubmissionRequest[] {
    return this.state.submissionRequests.filter((request) => request.workspaceId === workspaceId);
  }

  getSubmissionRequest(requestId: string, workspaceId = this.state.activeWorkspaceId): SubmissionRequest | undefined {
    return this.state.submissionRequests.find((request) => request.workspaceId === workspaceId && request.id === requestId);
  }

  updateSubmissionRequest(
    workspaceId: string,
    requestId: string,
    updater: (request: SubmissionRequest) => SubmissionRequest
  ): SubmissionRequest | undefined {
    const index = this.state.submissionRequests.findIndex(
      (request) => request.workspaceId === workspaceId && request.id === requestId
    );

    if (index === -1) {
      return undefined;
    }

    const updated = updater(this.state.submissionRequests[index]);
    this.state.submissionRequests[index] = updated;
    return updated;
  }

  addImportBatch(batch: ImportBatch): void {
    this.state.importBatches.unshift(batch);
  }

  listImportBatches(workspaceId = this.state.activeWorkspaceId): ImportBatch[] {
    return (this.state.importBatches ?? []).filter((batch) => batch.workspaceId === workspaceId);
  }

  replaceWorkspaceImportBatches(workspaceId: string, batches: ImportBatch[]): void {
    this.state.importBatches = (this.state.importBatches ?? [])
      .filter((batch) => batch.workspaceId !== workspaceId)
      .concat(batches);
  }

  addRun(run: CampaignRun): void {
    this.state.runs.unshift(run);
  }

  updateRun(runId: string, workspaceId: string, updater: (run: CampaignRun) => CampaignRun): CampaignRun | undefined {
    const index = this.state.runs.findIndex((run) => run.id === runId && run.workspaceId === workspaceId);
    if (index === -1) {
      return undefined;
    }

    const updated = updater(this.state.runs[index]);
    this.state.runs[index] = updated;
    return updated;
  }

  listRuns(workspaceId = this.state.activeWorkspaceId): CampaignRun[] {
    return this.state.runs.filter((run) => run.workspaceId === workspaceId);
  }

  getRun(id: string, workspaceId = this.state.activeWorkspaceId): CampaignRun | undefined {
    return this.state.runs.find((run) => run.workspaceId === workspaceId && run.id === id);
  }

  addTask(task: AgentTaskResult): void {
    this.state.tasks.push(task);
  }

  listTasksByRun(runId: string, workspaceId = this.state.activeWorkspaceId): AgentTaskResult[] {
    return this.state.tasks.filter((task) => task.workspaceId === workspaceId && task.runId === runId);
  }

  listTasks(workspaceId = this.state.activeWorkspaceId): AgentTaskResult[] {
    return this.state.tasks.filter((task) => task.workspaceId === workspaceId);
  }

  addLog(log: RunLog): void {
    this.state.logs.push(log);
  }

  listLogsByRun(runId: string, workspaceId = this.state.activeWorkspaceId): RunLog[] {
    return this.state.logs.filter((log) => log.workspaceId === workspaceId && log.runId === runId);
  }

  listLogs(workspaceId = this.state.activeWorkspaceId): RunLog[] {
    return this.state.logs.filter((log) => log.workspaceId === workspaceId);
  }

  addCreditTransaction(txn: CreditTransaction): void {
    this.state.creditTransactions.unshift(txn);
  }

  listCreditTransactions(workspaceId: string): CreditTransaction[] {
    return this.state.creditTransactions.filter((t) => t.workspaceId === workspaceId);
  }

  addAssessment(assessment: AssessmentResult): void {
    this.state.assessments.unshift(assessment);
  }

  getAssessment(id: string): AssessmentResult | undefined {
    return this.state.assessments.find((a) => a.id === id);
  }

  getLatestAssessment(workspaceId: string): AssessmentResult | undefined {
    return this.state.assessments.find((a) => a.workspaceId === workspaceId);
  }

  updateAssessment(id: string, updater: (a: AssessmentResult) => AssessmentResult): AssessmentResult | undefined {
    const idx = this.state.assessments.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const updated = updater(this.state.assessments[idx]);
    this.state.assessments[idx] = updated;
    return updated;
  }

  async persist(): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `
          INSERT INTO app_state (id, payload, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
        `,
        [stateRowId, JSON.stringify(this.state)]
      );
      return;
    }

    await writeFile(dataPath, JSON.stringify(this.state, null, 2), "utf8");
  }
}
