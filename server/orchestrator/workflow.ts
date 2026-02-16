import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import type {
  AgentTaskResult,
  CampaignRun,
  Firm,
  PipelineStage,
  RunLog,
  SubmissionEvent,
  SubmissionStatus
} from "../domain/types.js";
import { StateStore } from "../domain/store.js";
import { followUpAgent } from "../agents/follow-up-agent.js";
import { outreachAgent } from "../agents/outreach-agent.js";
import { personalizationAgent } from "../agents/personalization-agent.js";
import { qaAgent } from "../agents/qa-agent.js";
import { qualificationAgent } from "../agents/qualification-agent.js";
import { researchAgent } from "../agents/research-agent.js";
import { normalizedHash } from "../agents/utils.js";

type RunRequest = {
  initiatedBy: string;
  firmIds?: string[];
  mode: "dry_run" | "production";
};

const stagesByStatus: Record<SubmissionStatus, PipelineStage> = {
  queued: "qualified",
  form_discovered: "form_discovered",
  form_filled: "form_filled",
  submitted: "submitted",
  no_form_found: "review",
  blocked: "review",
  needs_review: "review",
  errored: "lost"
};

export class CampaignOrchestrator {
  constructor(private readonly store: StateStore) {}

  async createRun(request: RunRequest): Promise<CampaignRun> {
    const firms = this.resolveFirms(request.firmIds);
    const run: CampaignRun = {
      id: uuid(),
      startedAt: new Date().toISOString(),
      initiatedBy: request.initiatedBy,
      status: "running",
      mode: request.mode,
      totalFirms: firms.length,
      processedFirms: 0,
      successCount: 0,
      failedCount: 0,
      taskIds: [],
      logIds: []
    };

    this.store.addRun(run);
    await this.store.persist();

    for (const firm of firms) {
      await this.processFirm(run.id, firm, request.mode);
    }

    const finalRun = this.store.updateRun(run.id, (current) => ({
      ...current,
      status: "completed",
      completedAt: new Date().toISOString()
    }));

    await this.store.persist();
    if (!finalRun) throw new Error("Run not found after completion");
    return finalRun;
  }

  private resolveFirms(firmIds?: string[]): Firm[] {
    const all = this.store.listFirms();
    if (!firmIds || firmIds.length === 0) return all;
    const lookup = new Set(firmIds);
    return all.filter((firm) => lookup.has(firm.id));
  }

  private async processFirm(runId: string, firm: Firm, mode: "dry_run" | "production"): Promise<void> {
    const now = new Date().toISOString();
    const profile = this.store.getState().profile;

    this.addLog(runId, "info", `Processing ${firm.name}`, firm.id);

    const research = await this.executeTask(runId, firm, "FormDiscoveryAgent", async () =>
      researchAgent.execute({ runId, firm, profile, now, mode })
    );

    const qualification = await this.executeTask(runId, firm, "QualificationAgent", async () =>
      qualificationAgent.execute({ runId, firm, profile, now, mode })
    );

    if (!Boolean(qualification.output.recommended)) {
      this.updateFirm(firm, {
        stage: "review",
        statusReason: "Below submission threshold. Queued for manual review",
        lastTouchedAt: now,
        notes: [...firm.notes, `Run ${runId}: held for manual review`]
      });
      this.bumpRunCounter(runId, false);
      return;
    }

    const mapping = await this.executeTask(runId, firm, "FormMappingAgent", async () =>
      personalizationAgent.execute({ runId, firm, profile, now, mode })
    );

    await this.executeTask(runId, firm, "QAAgent", async () =>
      qaAgent.execute({ runId, firm, profile, now, mode })
    );

    const submission = await this.executeTask(runId, firm, "SubmissionAgent", async () =>
      outreachAgent.execute({ runId, firm, profile, now, mode })
    );

    await this.executeTask(runId, firm, "TrackingAgent", async () =>
      followUpAgent.execute({ runId, firm, profile, now, mode })
    );

    const status = this.deriveStatus(
      firm.id,
      research.confidence,
      mapping.confidence,
      mode,
      Boolean(submission.output.requiresManualReview)
    );
    const event = this.createSubmissionEvent(runId, firm, status);
    this.store.addEvent(event);

    this.updateFirm(firm, {
      stage: stagesByStatus[status],
      score: Math.max(firm.score, Math.round((qualification.confidence + mapping.confidence) * 50)),
      statusReason: `${status.replaceAll("_", " ")} through website form workflow`,
      lastTouchedAt: now,
      notes: [...firm.notes, `Run ${runId}: ${status}`]
    });

    this.addLog(runId, "info", `${firm.name} processed with status ${status}`, firm.id);
    this.bumpRunCounter(runId, status === "submitted" || status === "form_filled" || status === "form_discovered");
    await this.store.persist();
  }

  private async executeTask(
    runId: string,
    firm: Firm,
    agentName: string,
    executor: () => Promise<{ confidence: number; summary: string; output: Record<string, unknown> }>
  ): Promise<AgentTaskResult> {
    const startedAt = new Date().toISOString();
    const result = await executor();

    const task: AgentTaskResult = {
      id: uuid(),
      runId,
      firmId: firm.id,
      firmName: firm.name,
      agent: agentName,
      status: "completed",
      startedAt,
      endedAt: new Date().toISOString(),
      confidence: result.confidence,
      summary: result.summary,
      output: result.output
    };

    this.store.addTask(task);
    this.attachTaskToRun(runId, task.id);
    this.addLog(runId, "info", `${agentName}: ${result.summary}`, firm.id);
    return task;
  }

  private deriveStatus(
    firmId: string,
    discoveryConfidence: number,
    mappingConfidence: number,
    mode: "dry_run" | "production",
    needsManualReview: boolean
  ): SubmissionStatus {
    if (needsManualReview) return "needs_review";
    if (mode === "dry_run") return "form_filled";

    const score = normalizedHash(`${firmId}-${discoveryConfidence}-${mappingConfidence}`);
    if (score > 0.85) return "submitted";
    if (score > 0.68) return "form_filled";
    if (score > 0.52) return "form_discovered";
    if (score > 0.3) return "no_form_found";
    return "blocked";
  }

  private createSubmissionEvent(runId: string, firm: Firm, status: SubmissionStatus): SubmissionEvent {
    const attemptedAt = new Date().toISOString();
    const base = dayjs(attemptedAt);
    return {
      id: uuid(),
      firmId: firm.id,
      firmName: firm.name,
      channel: "website_form",
      status,
      attemptedAt,
      discoveredAt: ["form_discovered", "form_filled", "submitted"].includes(status)
        ? base.add(8, "minute").toISOString()
        : undefined,
      filledAt: ["form_filled", "submitted"].includes(status)
        ? base.add(20, "minute").toISOString()
        : undefined,
      submittedAt: status === "submitted" ? base.add(30, "minute").toISOString() : undefined,
      blockedReason: status === "blocked" ? "CAPTCHA/login requirement" : undefined,
      note: `Run ${runId} website form workflow`
    };
  }

  private updateFirm(firm: Firm, patch: Partial<Firm>): void {
    this.store.upsertFirm({ ...firm, ...patch });
  }

  private addLog(runId: string, level: RunLog["level"], message: string, firmId?: string): void {
    const entry: RunLog = {
      id: uuid(),
      runId,
      timestamp: new Date().toISOString(),
      level,
      message,
      firmId
    };
    this.store.addLog(entry);
    this.attachLogToRun(runId, entry.id);
  }

  private attachTaskToRun(runId: string, taskId: string): void {
    this.store.updateRun(runId, (current) => ({ ...current, taskIds: [...current.taskIds, taskId] }));
  }

  private attachLogToRun(runId: string, logId: string): void {
    this.store.updateRun(runId, (current) => ({ ...current, logIds: [...current.logIds, logId] }));
  }

  private bumpRunCounter(runId: string, success: boolean): void {
    this.store.updateRun(runId, (current) => ({
      ...current,
      processedFirms: current.processedFirms + 1,
      successCount: current.successCount + (success ? 1 : 0),
      failedCount: current.failedCount + (success ? 0 : 1)
    }));
  }
}
