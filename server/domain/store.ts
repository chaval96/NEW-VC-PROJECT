import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { v4 as uuid } from "uuid";
import { buildTemplateProfile, createSeedState, createWorkspace } from "./seed.js";
import type { AppState, AgentTaskResult, AssessmentResult, CampaignRun, CompanyProfile, CreditTransaction, Firm, ImportBatch, RunLog, SubmissionEvent, SubmissionRequest, Workspace } from "./types.js";

const dataDir = path.resolve("server/data");
const dataPath = path.join(dataDir, "state.json");
const stateRowId = 1;

export interface TableStorageStat {
  tableName: string;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  toastBytes: number;
  liveTuples: number;
  deadTuples: number;
}

export interface StorageSnapshot {
  usingPostgres: boolean;
  databaseName?: string;
  databaseSizeBytes?: number;
  appStateTableTotalBytes?: number;
  appStatePayloadBytes?: number;
  appStateDeadTuples?: number;
  tableStats: TableStorageStat[];
  localStateFileBytes?: number;
}

export interface HistoryPruneOptions {
  maxLogsPerWorkspace?: number;
  maxTasksPerWorkspace?: number;
  maxRunsPerWorkspace?: number;
  maxAssessmentsPerWorkspace?: number;
  maxEventsPerWorkspace?: number;
  maxRequestsPerWorkspace?: number;
  logRetentionDays?: number;
  taskRetentionDays?: number;
  runRetentionDays?: number;
  assessmentRetentionDays?: number;
  eventRetentionDays?: number;
  requestRetentionDays?: number;
  zeroImportBatchRetentionDays?: number;
}

export interface HistoryPruneResult {
  removedLogs: number;
  removedTasks: number;
  removedRuns: number;
  removedAssessments: number;
  removedEvents: number;
  removedRequests: number;
  removedImportBatches: number;
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

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

  isUsingPostgres(): boolean {
    return Boolean(this.pool);
  }

  async getStorageSnapshot(): Promise<StorageSnapshot> {
    if (!this.pool) {
      let localStateFileBytes = 0;
      try {
        const raw = await readFile(dataPath, "utf8");
        localStateFileBytes = Buffer.byteLength(raw, "utf8");
      } catch {
        localStateFileBytes = byteLength(this.state);
      }

      return {
        usingPostgres: false,
        localStateFileBytes,
        tableStats: []
      };
    }

    const dbResult = await this.pool.query<{ database_name: string; database_size_bytes: string }>(
      `SELECT current_database() AS database_name, pg_database_size(current_database())::bigint::text AS database_size_bytes`
    );
    const dbRow = dbResult.rows[0];

    const appStateResult = await this.pool.query<{
      total_bytes: string;
      payload_bytes: string;
      dead_tuples: string;
    }>(
      `
        SELECT
          pg_total_relation_size('app_state')::bigint::text AS total_bytes,
          COALESCE((SELECT octet_length(payload::text)::bigint::text FROM app_state WHERE id = $1), '0') AS payload_bytes,
          COALESCE((SELECT n_dead_tup::bigint::text FROM pg_stat_user_tables WHERE relname = 'app_state'), '0') AS dead_tuples
      `,
      [stateRowId]
    );

    const tableResult = await this.pool.query<{
      table_name: string;
      total_bytes: string;
      table_bytes: string;
      index_bytes: string;
      toast_bytes: string;
      live_tuples: string;
      dead_tuples: string;
    }>(
      `
        SELECT
          c.relname AS table_name,
          pg_total_relation_size(c.oid)::bigint::text AS total_bytes,
          pg_relation_size(c.oid)::bigint::text AS table_bytes,
          pg_indexes_size(c.oid)::bigint::text AS index_bytes,
          CASE
            WHEN c.reltoastrelid = 0 THEN '0'
            ELSE pg_total_relation_size(c.reltoastrelid)::bigint::text
          END AS toast_bytes,
          COALESCE(s.n_live_tup, 0)::bigint::text AS live_tuples,
          COALESCE(s.n_dead_tup, 0)::bigint::text AS dead_tuples
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY pg_total_relation_size(c.oid) DESC
      `
    );

    const appStateRow = appStateResult.rows[0];

    return {
      usingPostgres: true,
      databaseName: dbRow?.database_name,
      databaseSizeBytes: Number(dbRow?.database_size_bytes ?? 0),
      appStateTableTotalBytes: Number(appStateRow?.total_bytes ?? 0),
      appStatePayloadBytes: Number(appStateRow?.payload_bytes ?? 0),
      appStateDeadTuples: Number(appStateRow?.dead_tuples ?? 0),
      tableStats: tableResult.rows.map((row) => ({
        tableName: row.table_name,
        totalBytes: Number(row.total_bytes),
        tableBytes: Number(row.table_bytes),
        indexBytes: Number(row.index_bytes),
        toastBytes: Number(row.toast_bytes),
        liveTuples: Number(row.live_tuples),
        deadTuples: Number(row.dead_tuples)
      }))
    };
  }

  pruneWorkspaceHistory(workspaceId: string, options: HistoryPruneOptions = {}): HistoryPruneResult {
    const now = Date.now();
    const maxLogs = Math.max(100, options.maxLogsPerWorkspace ?? 3000);
    const maxTasks = Math.max(100, options.maxTasksPerWorkspace ?? 3000);
    const maxRuns = Math.max(50, options.maxRunsPerWorkspace ?? 1200);
    const maxAssessments = Math.max(20, options.maxAssessmentsPerWorkspace ?? 500);
    const maxEvents = Math.max(200, options.maxEventsPerWorkspace ?? 12000);
    const maxRequests = Math.max(100, options.maxRequestsPerWorkspace ?? 8000);

    const logsCutoff = now - Math.max(1, options.logRetentionDays ?? 45) * 24 * 60 * 60 * 1000;
    const tasksCutoff = now - Math.max(1, options.taskRetentionDays ?? 45) * 24 * 60 * 60 * 1000;
    const runsCutoff = now - Math.max(1, options.runRetentionDays ?? 180) * 24 * 60 * 60 * 1000;
    const assessmentCutoff = now - Math.max(1, options.assessmentRetentionDays ?? 180) * 24 * 60 * 60 * 1000;
    const eventsCutoff = now - Math.max(1, options.eventRetentionDays ?? 180) * 24 * 60 * 60 * 1000;
    const requestsCutoff = now - Math.max(1, options.requestRetentionDays ?? 180) * 24 * 60 * 60 * 1000;
    const zeroBatchCutoff = now - Math.max(1, options.zeroImportBatchRetentionDays ?? 21) * 24 * 60 * 60 * 1000;

    const currentLogs = this.state.logs.filter((log) => log.workspaceId === workspaceId);
    const keepLogs = currentLogs
      .filter((log) => toTimestamp(log.timestamp) >= logsCutoff)
      .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))
      .slice(0, maxLogs);
    const keepLogIds = new Set(keepLogs.map((log) => log.id));
    this.state.logs = this.state.logs.filter((log) => log.workspaceId !== workspaceId || keepLogIds.has(log.id));

    const currentTasks = this.state.tasks.filter((task) => task.workspaceId === workspaceId);
    const keepTasks = currentTasks
      .filter((task) => toTimestamp(task.startedAt) >= tasksCutoff)
      .sort((a, b) => toTimestamp(b.startedAt) - toTimestamp(a.startedAt))
      .slice(0, maxTasks);
    const keepTaskIds = new Set(keepTasks.map((task) => task.id));
    this.state.tasks = this.state.tasks.filter((task) => task.workspaceId !== workspaceId || keepTaskIds.has(task.id));

    const currentRuns = this.state.runs.filter((run) => run.workspaceId === workspaceId);
    const keepRuns = currentRuns
      .filter((run) => run.status === "running" || toTimestamp(run.startedAt) >= runsCutoff)
      .sort((a, b) => toTimestamp(b.startedAt) - toTimestamp(a.startedAt))
      .slice(0, maxRuns);
    const keepRunIds = new Set(keepRuns.map((run) => run.id));
    this.state.runs = this.state.runs.filter((run) => run.workspaceId !== workspaceId || keepRunIds.has(run.id));

    const currentAssessments = this.state.assessments.filter((assessment) => assessment.workspaceId === workspaceId);
    const keepAssessments = currentAssessments
      .filter((assessment) => toTimestamp(assessment.startedAt) >= assessmentCutoff)
      .sort((a, b) => toTimestamp(b.startedAt) - toTimestamp(a.startedAt))
      .slice(0, maxAssessments);
    const keepAssessmentIds = new Set(keepAssessments.map((assessment) => assessment.id));
    this.state.assessments = this.state.assessments.filter(
      (assessment) => assessment.workspaceId !== workspaceId || keepAssessmentIds.has(assessment.id)
    );

    const currentEvents = this.state.submissionEvents.filter((event) => event.workspaceId === workspaceId);
    const keepEvents = currentEvents
      .filter((event) => toTimestamp(event.attemptedAt) >= eventsCutoff)
      .sort((a, b) => toTimestamp(b.attemptedAt) - toTimestamp(a.attemptedAt))
      .slice(0, maxEvents);
    const keepEventIds = new Set(keepEvents.map((event) => event.id));
    this.state.submissionEvents = this.state.submissionEvents.filter(
      (event) => event.workspaceId !== workspaceId || keepEventIds.has(event.id)
    );

    const currentRequests = this.state.submissionRequests.filter((request) => request.workspaceId === workspaceId);
    const keepRequests = currentRequests
      .filter((request) => {
        if (!["completed", "failed", "rejected"].includes(request.status)) return true;
        return toTimestamp(request.preparedAt) >= requestsCutoff;
      })
      .sort((a, b) => toTimestamp(b.preparedAt) - toTimestamp(a.preparedAt))
      .slice(0, maxRequests);
    const keepRequestIds = new Set(keepRequests.map((request) => request.id));
    this.state.submissionRequests = this.state.submissionRequests.filter(
      (request) => request.workspaceId !== workspaceId || keepRequestIds.has(request.id)
    );

    const currentBatches = this.state.importBatches.filter((batch) => batch.workspaceId === workspaceId);
    const seenImportKeys = new Set<string>();
    const keepBatches: ImportBatch[] = [];
    for (const batch of currentBatches.sort((a, b) => toTimestamp(b.importedAt) - toTimestamp(a.importedAt))) {
      const staleZeroBatch = batch.importedCount === 0 && toTimestamp(batch.importedAt) < zeroBatchCutoff;
      if (staleZeroBatch) continue;

      const dedupeKey = `${batch.sourceName.trim().toLowerCase()}|${batch.sourceType}|${batch.status}|${batch.importedCount}|${batch.note ?? ""}`;
      if (seenImportKeys.has(dedupeKey)) continue;
      seenImportKeys.add(dedupeKey);
      keepBatches.push(batch);
    }
    const keepBatchIds = new Set(keepBatches.map((batch) => batch.id));
    this.state.importBatches = this.state.importBatches.filter(
      (batch) => batch.workspaceId !== workspaceId || keepBatchIds.has(batch.id)
    );

    return {
      removedLogs: currentLogs.length - keepLogs.length,
      removedTasks: currentTasks.length - keepTasks.length,
      removedRuns: currentRuns.length - keepRuns.length,
      removedAssessments: currentAssessments.length - keepAssessments.length,
      removedEvents: currentEvents.length - keepEvents.length,
      removedRequests: currentRequests.length - keepRequests.length,
      removedImportBatches: currentBatches.length - keepBatches.length
    };
  }

  getWorkspaceStateFootprint(workspaceId: string): {
    firmsCount: number;
    eventsCount: number;
    requestsCount: number;
    tasksCount: number;
    logsCount: number;
    runsCount: number;
    batchesCount: number;
    assessmentsCount: number;
    firmsBytes: number;
    eventsBytes: number;
    requestsBytes: number;
    tasksBytes: number;
    logsBytes: number;
    runsBytes: number;
    batchesBytes: number;
    assessmentsBytes: number;
  } {
    const firms = this.state.firms.filter((item) => item.workspaceId === workspaceId);
    const events = this.state.submissionEvents.filter((item) => item.workspaceId === workspaceId);
    const requests = this.state.submissionRequests.filter((item) => item.workspaceId === workspaceId);
    const tasks = this.state.tasks.filter((item) => item.workspaceId === workspaceId);
    const logs = this.state.logs.filter((item) => item.workspaceId === workspaceId);
    const runs = this.state.runs.filter((item) => item.workspaceId === workspaceId);
    const batches = this.state.importBatches.filter((item) => item.workspaceId === workspaceId);
    const assessments = this.state.assessments.filter((item) => item.workspaceId === workspaceId);

    return {
      firmsCount: firms.length,
      eventsCount: events.length,
      requestsCount: requests.length,
      tasksCount: tasks.length,
      logsCount: logs.length,
      runsCount: runs.length,
      batchesCount: batches.length,
      assessmentsCount: assessments.length,
      firmsBytes: byteLength(firms),
      eventsBytes: byteLength(events),
      requestsBytes: byteLength(requests),
      tasksBytes: byteLength(tasks),
      logsBytes: byteLength(logs),
      runsBytes: byteLength(runs),
      batchesBytes: byteLength(batches),
      assessmentsBytes: byteLength(assessments)
    };
  }

  async compactPostgresStorage(options: { full?: boolean } = {}): Promise<void> {
    if (!this.pool) return;

    const full = options.full ?? false;
    const analyzeTables = [
      "app_state",
      "users",
      "auth_sessions",
      "email_verification_tokens",
      "password_reset_tokens",
      "workspace_memberships",
      "audit_logs"
    ] as const;

    if (full) {
      await this.pool.query("VACUUM (FULL, ANALYZE) app_state");
    }

    for (const table of analyzeTables) {
      if (full && table === "app_state") continue;
      await this.pool.query(`VACUUM (ANALYZE) ${table}`);
    }
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

  replaceWorkspaceEvents(workspaceId: string, events: SubmissionEvent[]): void {
    this.state.submissionEvents = this.state.submissionEvents
      .filter((event) => event.workspaceId !== workspaceId)
      .concat(events);
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
