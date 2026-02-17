import dayjs from "dayjs";
import type {
  AgentTaskResult,
  CampaignRun,
  Firm,
  OpsAlert,
  OverviewResponse,
  PipelineStage,
  RunLog,
  SubmissionEvent,
  SubmissionRequest,
  Workspace
} from "../domain/types.js";

// ── Analytics Cache ─────────────────────────────────────────────────
// Cache overview results for 15 seconds to avoid recalculating on every request.
const CACHE_TTL_MS = 15_000;
const overviewCache = new Map<string, { data: Omit<OverviewResponse, "creditBalance">; expiresAt: number }>();

export function getCachedOverview(workspaceId: string): Omit<OverviewResponse, "creditBalance"> | undefined {
  const entry = overviewCache.get(workspaceId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    overviewCache.delete(workspaceId);
    return undefined;
  }
  return entry.data;
}

export function invalidateOverviewCache(workspaceId: string): void {
  overviewCache.delete(workspaceId);
}

function cacheOverview(workspaceId: string, data: Omit<OverviewResponse, "creditBalance">): void {
  overviewCache.set(workspaceId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

const stageOrder: PipelineStage[] = [
  "lead",
  "researching",
  "qualified",
  "form_discovered",
  "form_filled",
  "submitted",
  "review",
  "won",
  "lost"
];

function countByPredicate(events: SubmissionEvent[], predicate: (event: SubmissionEvent) => boolean): number {
  return events.filter(predicate).length;
}

export function buildOverview(
  workspace: Workspace,
  firms: Firm[],
  events: SubmissionEvent[],
  runs: CampaignRun[],
  requests: SubmissionRequest[],
  tasks: AgentTaskResult[],
  logs: RunLog[]
): Omit<OverviewResponse, "creditBalance"> {
  const staleRunMinutes = Math.max(5, Number(process.env.OPS_STALE_RUN_MINUTES ?? 20));
  const staleExecutionMinutes = Math.max(2, Number(process.env.OPS_STALE_EXECUTION_MINUTES ?? 10));
  const alertWindowHours = Math.max(1, Number(process.env.OPS_ALERT_WINDOW_HOURS ?? 24));
  const now = dayjs();

  const attempts = events.length;
  const formsDiscovered = countByPredicate(events, (event) => ["form_discovered", "form_filled", "submitted"].includes(event.status));
  const formsFilled = countByPredicate(events, (event) => ["form_filled", "submitted"].includes(event.status));
  const submitted = countByPredicate(events, (event) => event.status === "submitted");
  const blocked = countByPredicate(events, (event) => event.status === "blocked");
  const noFormFound = countByPredicate(events, (event) => event.status === "no_form_found");

  const stageCounts = new Map<PipelineStage, number>();
  for (const stage of stageOrder) stageCounts.set(stage, 0);
  for (const firm of firms) stageCounts.set(firm.stage, (stageCounts.get(firm.stage) ?? 0) + 1);

  const weeklyMap = new Map<
    string,
    { attempts: number; discovered: number; filled: number; submitted: number; blocked: number; noFormFound: number }
  >();

  for (let weekOffset = 5; weekOffset >= 0; weekOffset -= 1) {
    const key = dayjs().subtract(weekOffset, "week").startOf("week").format("YYYY-MM-DD");
    weeklyMap.set(key, { attempts: 0, discovered: 0, filled: 0, submitted: 0, blocked: 0, noFormFound: 0 });
  }

  for (const event of events) {
    const weekKey = dayjs(event.attemptedAt).startOf("week").format("YYYY-MM-DD");
    const bucket = weeklyMap.get(weekKey);
    if (!bucket) continue;

    bucket.attempts += 1;
    if (["form_discovered", "form_filled", "submitted"].includes(event.status)) bucket.discovered += 1;
    if (["form_filled", "submitted"].includes(event.status)) bucket.filled += 1;
    if (event.status === "submitted") bucket.submitted += 1;
    if (event.status === "blocked") bucket.blocked += 1;
    if (event.status === "no_form_found") bucket.noFormFound += 1;
  }

  const weeklyTrend = [...weeklyMap.entries()].map(([week, data]) => {
    const start = dayjs(week);
    const end = start.add(6, "day");
    return {
      weekLabel: `${start.format("MMM D")} - ${end.format("MMM D")}`,
      ...data
    };
  });

  const activeRuns = runs.filter((run) => run.status === "running");
  const pendingApprovals = requests.filter((request) => request.status === "pending_approval").length;

  const staleRuns = runs.filter((run) => run.status === "running" && now.diff(dayjs(run.startedAt), "minute") >= staleRunMinutes);
  const staleExecutions = requests.filter((request) => {
    if (request.status !== "executing") return false;
    const startedAt = request.lastExecutionStartedAt ?? request.approvedAt ?? request.preparedAt;
    return now.diff(dayjs(startedAt), "minute") >= staleExecutionMinutes;
  });
  const pendingRetries = requests.filter((request) => request.status === "pending_retry");

  const failedExecutions24h = requests.filter(
    (request) => request.status === "failed" && request.executedAt && now.diff(dayjs(request.executedAt), "hour") <= alertWindowHours
  );
  const failedTasks24h = tasks.filter(
    (task) => task.status === "failed" && now.diff(dayjs(task.endedAt ?? task.startedAt), "hour") <= alertWindowHours
  );
  const errorLogs24h = logs.filter((log) => log.level === "error" && now.diff(dayjs(log.timestamp), "hour") <= alertWindowHours);

  const alerts: OpsAlert[] = [
    ...staleRuns.map((run) => ({
      id: `stale-run-${run.id}`,
      severity: "critical" as const,
      source: "run" as const,
      createdAt: run.startedAt,
      message: `Run ${run.id.slice(0, 8)} has been running for over ${staleRunMinutes} minutes.`,
      entityId: run.id
    })),
    ...staleExecutions.map((request) => ({
      id: `stale-execution-${request.id}`,
      severity: "critical" as const,
      source: "submission" as const,
      createdAt: request.lastExecutionStartedAt ?? request.approvedAt ?? request.preparedAt,
      message: `${request.firmName} execution is stuck for over ${staleExecutionMinutes} minutes.`,
      entityId: request.id
    })),
    ...failedExecutions24h.slice(0, 6).map((request) => ({
      id: `failed-submission-${request.id}`,
      severity: "warning" as const,
      source: "submission" as const,
      createdAt: request.executedAt ?? request.preparedAt,
      message: `${request.firmName} submission failed: ${request.resultNote ?? "No reason provided"}`,
      entityId: request.id
    })),
    ...failedTasks24h.slice(0, 6).map((task) => ({
      id: `failed-task-${task.id}`,
      severity: "warning" as const,
      source: "run" as const,
      createdAt: task.endedAt ?? task.startedAt,
      message: `${task.agent} failed for ${task.firmName}: ${task.summary}`,
      entityId: task.id
    }))
  ]
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, 12);

  const result = {
    workspace: {
      id: workspace.id,
      name: workspace.name
    },
    kpis: {
      targetsTotal: firms.length,
      attempts,
      formsDiscovered,
      formsFilled,
      submitted,
      blocked,
      noFormFound,
      completionRate: attempts === 0 ? 0 : Number(((submitted / attempts) * 100).toFixed(1))
    },
    stageBreakdown: stageOrder.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
    weeklyTrend,
    recentActivities: events.slice(0, 20),
    activeRuns,
    pendingApprovals,
    ops: {
      staleRuns: staleRuns.length,
      staleExecutions: staleExecutions.length,
      pendingRetries: pendingRetries.length,
      failedExecutions24h: failedExecutions24h.length,
      failedTasks24h: failedTasks24h.length + errorLogs24h.length,
      alerts
    }
  };

  // Cache the result
  cacheOverview(workspace.id, result);
  return result;
}
