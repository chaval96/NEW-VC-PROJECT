import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { activateWorkspace, getOverview } from "../api";
import { ActivityTable } from "../components/ActivityTable";
import { PerformanceFunnel } from "../components/PerformanceFunnel";
import { WeeklyTrend } from "../components/WeeklyTrend";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { KpiCard } from "../components/ui/KpiCard";
import { StatusPill } from "../components/ui/StatusPill";
import type { AuthUser } from "../types";
import type { OverviewResponse } from "@shared/types";

interface DashboardPageProps {
  user: AuthUser;
}

type PipelineBucketKey = "leads" | "qualified" | "submission_attempt" | "submitted";

function inBucket(stage: string, bucket: PipelineBucketKey): boolean {
  if (bucket === "leads") return ["lead", "researching"].includes(stage);
  if (bucket === "qualified") return ["qualified", "form_discovered"].includes(stage);
  if (bucket === "submission_attempt") return ["form_filled", "review", "lost"].includes(stage);
  return ["submitted", "won"].includes(stage);
}

export function DashboardPage({ user }: DashboardPageProps): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(undefined);
    const data = await getOverview(workspaceId);
    setOverview(data);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      navigate("/projects");
      return;
    }

    const boot = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard.");
      } finally {
        setLoading(false);
      }
    };

    void boot();
  }, [workspaceId, navigate, refresh]);

  const pipelineBuckets = useMemo(() => {
    if (!overview) return [];
    const defs: Array<{ key: PipelineBucketKey; label: string; subtitle: string }> = [
      { key: "leads", label: "Leads", subtitle: "Imported leads" },
      { key: "qualified", label: "Qualified Leads", subtitle: "Fit + form reachable" },
      { key: "submission_attempt", label: "Submission Attempt", subtitle: "Attempted/under review" },
      { key: "submitted", label: "Submitted", subtitle: "Successfully submitted" }
    ];
    const total = Math.max(1, overview.stageBreakdown.reduce((sum, item) => sum + item.count, 0));
    return defs.map((def) => {
      const count = overview.stageBreakdown
        .filter((item) => inBucket(item.stage, def.key))
        .reduce((sum, item) => sum + item.count, 0);
      return {
        ...def,
        count,
        percentage: Math.round((count / total) * 100)
      };
    });
  }, [overview]);

  if (loading) {
    return <div className="mx-auto max-w-7xl px-6 py-8" />;
  }

  if (!overview) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <p className="text-sm text-slate-500 dark:text-slate-400">{error ?? "No project data found."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{overview.workspace.name}</h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">Fundraising performance overview for {user.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/operations`)}>
            Open Operations
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/onboarding`)}>
            Edit Knowledge Base
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard label="Investors" value={overview.kpis.targetsTotal} subtitle="Active targets" />
        <KpiCard label="Attempts" value={overview.kpis.attempts} subtitle="Total form attempts" />
        <KpiCard label="Discovered" value={overview.kpis.formsDiscovered} subtitle="Forms discovered" />
        <KpiCard label="Submitted" value={overview.kpis.submitted} subtitle="Completed submissions" />
        <KpiCard label="Success Rate" value={`${overview.kpis.completionRate}%`} subtitle="Submitted / attempts" />
      </div>

      <Card className="mb-6">
        <CardBody>
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Pending approvals</div>
              <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{overview.pendingApprovals}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Retry queue</div>
              <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{overview.ops.pendingRetries}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Stuck executions</div>
              <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{overview.ops.staleExecutions}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-slate-500 dark:text-slate-400">Failed tasks (24h)</div>
              <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">{overview.ops.failedTasks24h}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Pipeline Distribution</h3>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {pipelineBuckets.map((bucket) => (
                <button
                  key={bucket.key}
                  type="button"
                  onClick={() => navigate(`/projects/${workspaceId}/operations?bucket=${bucket.key}`)}
                  className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-primary-300 hover:bg-primary-50/40 dark:border-slate-700 dark:hover:border-primary-500/70 dark:hover:bg-primary-900/20"
                >
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold">{bucket.label}</span>
                    <span>{bucket.count} ({bucket.percentage}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-2 rounded-full bg-primary-500" style={{ width: `${bucket.percentage}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{bucket.subtitle}</div>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Reliability Alerts</h3>
          </CardHeader>
          <CardBody>
            {overview.ops.alerts.length === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                No active alerts.
              </div>
            ) : (
              <div className="space-y-2">
                {overview.ops.alerts.slice(0, 8).map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-lg border px-3 py-2 text-xs ${alert.severity === "critical" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                  >
                    <div className="mb-1 font-semibold uppercase">{alert.severity}</div>
                    <div>{alert.message}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-slate-200 px-2 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">Stale runs: {overview.ops.staleRuns}</div>
              <div className="rounded border border-slate-200 px-2 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">Stuck execs: {overview.ops.staleExecutions}</div>
              <div className="rounded border border-slate-200 px-2 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">Pending retries: {overview.ops.pendingRetries}</div>
              <div className="rounded border border-slate-200 px-2 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">Pending approvals: {overview.pendingApprovals}</div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PerformanceFunnel
          attempts={overview.kpis.attempts}
          discovered={overview.kpis.formsDiscovered}
          filled={overview.kpis.formsFilled}
          submitted={overview.kpis.submitted}
          blocked={overview.kpis.blocked}
          noFormFound={overview.kpis.noFormFound}
        />
        <WeeklyTrend data={overview.weeklyTrend} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Active Runs</h3>
            <Link className="text-xs font-semibold text-primary-700 hover:underline" to={`/projects/${workspaceId}/operations`}>
              Open all in Operations
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          {overview.activeRuns.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No active runs right now.</p>
          ) : (
            <div className="space-y-2">
              {overview.activeRuns.map((run) => (
                <Link
                  key={run.id}
                  to={`/projects/${workspaceId}/runs/${run.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                >
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-100">Run {run.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{run.mode} · {run.processedFirms}/{run.totalFirms} processed</div>
                  </div>
                  <StatusPill status={run.status} />
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <ActivityTable events={overview.recentActivities} workspaceId={workspaceId} />
    </div>
  );
}
