import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { createSeedState } from "./seed.js";
import type { AppState, AgentTaskResult, CampaignRun, Firm, RunLog, SubmissionEvent } from "./types.js";

const dataDir = path.resolve("server/data");
const dataPath = path.join(dataDir, "state.json");
const stateRowId = 1;

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
      this.state = JSON.parse(raw) as AppState;
      if (!("submissionEvents" in this.state)) {
        this.state = createSeedState();
        await this.persist();
      }
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

    const result = await this.pool.query<{ payload: AppState }>("SELECT payload FROM app_state WHERE id = $1", [stateRowId]);

    if (result.rows.length === 0) {
      await this.persist();
      return;
    }

    this.state = result.rows[0].payload;
    if (!("submissionEvents" in this.state)) {
      this.state = createSeedState();
      await this.persist();
    }
  }

  getState(): AppState {
    return this.state;
  }

  listFirms(): Firm[] {
    return [...this.state.firms];
  }

  getFirm(id: string): Firm | undefined {
    return this.state.firms.find((firm) => firm.id === id);
  }

  upsertFirm(nextFirm: Firm): void {
    const index = this.state.firms.findIndex((firm) => firm.id === nextFirm.id);
    if (index === -1) {
      this.state.firms.push(nextFirm);
      return;
    }

    this.state.firms[index] = nextFirm;
  }

  addEvent(event: SubmissionEvent): void {
    this.state.submissionEvents.unshift(event);
  }

  listEvents(): SubmissionEvent[] {
    return [...this.state.submissionEvents];
  }

  addRun(run: CampaignRun): void {
    this.state.runs.unshift(run);
  }

  updateRun(runId: string, updater: (run: CampaignRun) => CampaignRun): CampaignRun | undefined {
    const index = this.state.runs.findIndex((run) => run.id === runId);
    if (index === -1) {
      return undefined;
    }

    const updated = updater(this.state.runs[index]);
    this.state.runs[index] = updated;
    return updated;
  }

  listRuns(): CampaignRun[] {
    return [...this.state.runs];
  }

  getRun(id: string): CampaignRun | undefined {
    return this.state.runs.find((run) => run.id === id);
  }

  addTask(task: AgentTaskResult): void {
    this.state.tasks.push(task);
  }

  listTasksByRun(runId: string): AgentTaskResult[] {
    return this.state.tasks.filter((task) => task.runId === runId);
  }

  addLog(log: RunLog): void {
    this.state.logs.push(log);
  }

  listLogsByRun(runId: string): RunLog[] {
    return this.state.logs.filter((log) => log.runId === runId);
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
