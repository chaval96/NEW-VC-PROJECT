import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import type {
  AgentTaskResult,
  CampaignRun,
  Firm,
  RunLog,
  SubmissionEvent,
  SubmissionRequest,
  Workspace
} from "../domain/types.js";
import { StateStore } from "../domain/store.js";
import { followUpAgent } from "../agents/follow-up-agent.js";
import { outreachAgent } from "../agents/outreach-agent.js";
import { personalizationAgent } from "../agents/personalization-agent.js";
import { qaAgent } from "../agents/qa-agent.js";
import { qualificationAgent } from "../agents/qualification-agent.js";
import { researchAgent } from "../agents/research-agent.js";

type RunRequest = {
  initiatedBy: string;
  workspaceId?: string;
  firmIds?: string[];
  mode: "dry_run" | "production";
};

export class CampaignOrchestrator {
  constructor(private readonly store: StateStore) {}

  private readonly taskMaxAttempts = Math.max(1, Number(process.env.AGENT_TASK_MAX_ATTEMPTS ?? 2));

  async createRun(request: RunRequest): Promise<CampaignRun> {
    const workspace = this.resolveWorkspace(request.workspaceId);
    const firms = this.resolveFirms(workspace.id, request.firmIds);
    const run: CampaignRun = {
      id: uuid(),
      workspaceId: workspace.id,
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
      try {
        await this.processFirm(workspace, run.id, firm, request.mode);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown task execution error";
        this.addLog(workspace.id, run.id, "error", `Firm ${firm.name} failed: ${message}`, firm.id);
        this.updateFirm(firm, {
          stage: "review",
          statusReason: `Execution failed: ${message}`,
          lastTouchedAt: new Date().toISOString(),
          notes: [...firm.notes, `Run ${run.id}: execution error ${message}`]
        });
        this.bumpRunCounter(workspace.id, run.id, false);
        await this.store.persist();
      }
    }

    const finalRun = this.store.updateRun(run.id, workspace.id, (current) => ({
      ...current,
      status: "completed",
      completedAt: new Date().toISOString()
    }));

    await this.store.persist();
    if (!finalRun) throw new Error("Run not found after completion");
    return finalRun;
  }

  private resolveWorkspace(workspaceId?: string): Workspace {
    if (!workspaceId) {
      return this.store.getActiveWorkspace();
    }

    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    return workspace;
  }

  private resolveFirms(workspaceId: string, firmIds?: string[]): Firm[] {
    const all = this.store.listFirms(workspaceId);
    if (!firmIds || firmIds.length === 0) return all;
    const lookup = new Set(firmIds);
    return all.filter((firm) => lookup.has(firm.id));
  }

  private async processFirm(workspace: Workspace, runId: string, firm: Firm, mode: "dry_run" | "production"): Promise<void> {
    const now = new Date().toISOString();
    const profile = workspace.profile;

    this.addLog(workspace.id, runId, "info", `Processing ${firm.name}`, firm.id);

    const research = await this.executeTask(workspace.id, runId, firm, "FormDiscoveryAgent", async () =>
      researchAgent.execute({ runId, firm, profile, now, mode })
    );

    const qualification = await this.executeTask(workspace.id, runId, firm, "QualificationAgent", async () =>
      qualificationAgent.execute({ runId, firm, profile, now, mode })
    );

    if (!Boolean(qualification.output.recommended)) {
      this.updateFirm(firm, {
        stage: "review",
        statusReason: "Below submission threshold. Queued for manual review",
        lastTouchedAt: now,
        notes: [...firm.notes, `Run ${runId}: held for manual review`]
      });
      this.bumpRunCounter(workspace.id, runId, false);
      return;
    }

    const mapping = await this.executeTask(workspace.id, runId, firm, "FormMappingAgent", async () =>
      personalizationAgent.execute({ runId, firm, profile, now, mode })
    );

    const qa = await this.executeTask(workspace.id, runId, firm, "QAAgent", async () =>
      qaAgent.execute({ runId, firm, profile, now, mode })
    );

    if (!Boolean(qa.output.canProceed)) {
      this.updateFirm(firm, {
        stage: "review",
        statusReason: "QA blocked due to missing fields",
        lastTouchedAt: now,
        notes: [...firm.notes, `Run ${runId}: QA blocked`]
      });
      this.bumpRunCounter(workspace.id, runId, false);
      return;
    }

    const submission = await this.executeTask(workspace.id, runId, firm, "SubmissionAgent", async () =>
      outreachAgent.execute({ runId, firm, profile, now, mode })
    );

    await this.executeTask(workspace.id, runId, firm, "TrackingAgent", async () =>
      followUpAgent.execute({ runId, firm, profile, now, mode })
    );

    const request = this.createSubmissionRequest(
      workspace.id,
      firm,
      mode,
      mapping.output,
      typeof research.output.probableEntry === "string" ? research.output.probableEntry : undefined
    );
    this.store.addSubmissionRequest(request);

    const event = this.createQueuedEvent(workspace.id, runId, firm, mode, request.id);
    this.store.addEvent(event);

    this.updateFirm(firm, {
      stage: "form_filled",
      statusReason: "Prepared and queued for human approval before submission",
      lastTouchedAt: now,
      notes: [...firm.notes, `Run ${runId}: queued request ${request.id}`]
    });

    this.addLog(
      workspace.id,
      runId,
      "info",
      `${firm.name} queued for approval (${submission.summary}) with request ${request.id}`,
      firm.id
    );

    this.bumpRunCounter(workspace.id, runId, true);
    await this.store.persist();
  }

  private createSubmissionRequest(
    workspaceId: string,
    firm: Firm,
    mode: "dry_run" | "production",
    mappedOutput: Record<string, unknown>,
    formUrlCandidate?: string
  ): SubmissionRequest {
    const contact = (mappedOutput.contact as Record<string, unknown> | undefined) ?? {};

    return {
      id: uuid(),
      workspaceId,
      firmId: firm.id,
      firmName: firm.name,
      website: firm.website,
      preparedAt: new Date().toISOString(),
      preparedPayload: {
        contactName: String(contact.name ?? ""),
        contactTitle: String(contact.title ?? ""),
        contactEmail: String(contact.email ?? ""),
        contactPhone: String(contact.phone ?? ""),
        linkedin: String(contact.linkedin ?? ""),
        calendly: String(contact.calendly ?? ""),
        companyName: String(mappedOutput.companyName ?? firm.name),
        companyWebsite: String(mappedOutput.companyWebsite ?? firm.website),
        companySummary: String(mappedOutput.companySummary ?? ""),
        raiseSummary: String(mappedOutput.raise ?? ""),
        deckUrl: String(mappedOutput.deckUrl ?? ""),
        dataRoomUrl: String(mappedOutput.dataRoomUrl ?? "")
      },
      formUrlCandidate,
      status: "pending_approval",
      mode,
      executionAttempts: 0,
      maxExecutionAttempts: Math.max(1, Number(process.env.SUBMISSION_MAX_ATTEMPTS ?? 2))
    };
  }

  private createQueuedEvent(
    workspaceId: string,
    runId: string,
    firm: Firm,
    mode: "dry_run" | "production",
    requestId?: string
  ): SubmissionEvent {
    const attemptedAt = new Date().toISOString();
    const base = dayjs(attemptedAt);

    return {
      id: uuid(),
      workspaceId,
      requestId,
      firmId: firm.id,
      firmName: firm.name,
      channel: "website_form",
      status: mode === "production" ? "form_filled" : "form_filled",
      attemptedAt,
      discoveredAt: base.add(8, "minute").toISOString(),
      filledAt: base.add(20, "minute").toISOString(),
      note: `Run ${runId}: prepared and waiting for approval`
    };
  }

  private async executeTask(
    workspaceId: string,
    runId: string,
    firm: Firm,
    agentName: string,
    executor: () => Promise<{ confidence: number; summary: string; output: Record<string, unknown> }>
  ): Promise<AgentTaskResult> {
    let attempt = 0;
    let lastError: string | undefined;

    while (attempt < this.taskMaxAttempts) {
      attempt += 1;
      const startedAt = new Date().toISOString();
      try {
        const result = await executor();

        const task: AgentTaskResult = {
          id: uuid(),
          workspaceId,
          runId,
          firmId: firm.id,
          firmName: firm.name,
          agent: agentName,
          status: "completed",
          startedAt,
          endedAt: new Date().toISOString(),
          confidence: result.confidence,
          summary: result.summary,
          output: {
            ...result.output,
            attempt
          }
        };

        this.store.addTask(task);
        this.attachTaskToRun(workspaceId, runId, task.id);
        this.addLog(workspaceId, runId, "info", `${agentName}: ${result.summary}`, firm.id);
        return task;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown task error";
        if (attempt < this.taskMaxAttempts) {
          this.addLog(
            workspaceId,
            runId,
            "warn",
            `${agentName} attempt ${attempt}/${this.taskMaxAttempts} failed for ${firm.name}: ${lastError}. Retrying...`,
            firm.id
          );
          await new Promise((resolve) => setTimeout(resolve, Math.min(1200, 300 * attempt)));
          continue;
        }
      }
    }

    const failedTask: AgentTaskResult = {
      id: uuid(),
      workspaceId,
      runId,
      firmId: firm.id,
      firmName: firm.name,
      agent: agentName,
      status: "failed",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      confidence: 0,
      summary: `${agentName} failed after ${this.taskMaxAttempts} attempts`,
      output: {
        error: lastError ?? "Unknown task error",
        attempts: this.taskMaxAttempts
      }
    };

    this.store.addTask(failedTask);
    this.attachTaskToRun(workspaceId, runId, failedTask.id);
    this.addLog(
      workspaceId,
      runId,
      "error",
      `${agentName} failed for ${firm.name} after ${this.taskMaxAttempts} attempts: ${lastError ?? "Unknown task error"}`,
      firm.id
    );
    throw new Error(`${agentName} failed after retries`);
  }

  private updateFirm(firm: Firm, patch: Partial<Firm>): void {
    this.store.upsertFirm({ ...firm, ...patch });
  }

  private addLog(
    workspaceId: string,
    runId: string,
    level: RunLog["level"],
    message: string,
    firmId?: string
  ): void {
    const entry: RunLog = {
      id: uuid(),
      workspaceId,
      runId,
      timestamp: new Date().toISOString(),
      level,
      message,
      firmId
    };
    this.store.addLog(entry);
    this.attachLogToRun(workspaceId, runId, entry.id);
  }

  private attachTaskToRun(workspaceId: string, runId: string, taskId: string): void {
    this.store.updateRun(runId, workspaceId, (current) => ({ ...current, taskIds: [...current.taskIds, taskId] }));
  }

  private attachLogToRun(workspaceId: string, runId: string, logId: string): void {
    this.store.updateRun(runId, workspaceId, (current) => ({ ...current, logIds: [...current.logIds, logId] }));
  }

  private bumpRunCounter(workspaceId: string, runId: string, success: boolean): void {
    this.store.updateRun(runId, workspaceId, (current) => ({
      ...current,
      processedFirms: current.processedFirms + 1,
      successCount: current.successCount + (success ? 1 : 0),
      failedCount: current.failedCount + (success ? 0 : 1)
    }));
  }
}
