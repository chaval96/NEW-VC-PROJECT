import dayjs from "dayjs";
import type { CampaignRun, OverviewResponse, PipelineStage, SubmissionEvent, SubmissionRequest, Workspace, Firm } from "../domain/types.js";

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
  requests: SubmissionRequest[]
): OverviewResponse {
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

  return {
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
    pendingApprovals
  };
}
