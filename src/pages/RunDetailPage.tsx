import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { activateWorkspace, getRunDetail } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import type { RunDetail } from "../types";

export function RunDetailPage(): JSX.Element {
  const { workspaceId, runId } = useParams<{ workspaceId: string; runId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!workspaceId || !runId) {
      navigate("/projects");
      return;
    }

    const load = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        const result = await getRunDetail(workspaceId, runId);
        setDetail(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run details.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [workspaceId, runId, navigate]);

  if (loading) {
    return <div className="mx-auto max-w-6xl px-6 py-8" />;
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-slate-500">{error ?? "Run not found."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Run Detail</h1>
          <p className="mt-1 text-sm text-slate-500">Run ID: {detail.run.id}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/operations`)}>
            Back to Operations
          </Button>
          <StatusPill status={detail.run.status} />
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card><CardBody><div className="text-xs text-slate-500">Mode</div><div className="text-lg font-semibold">{detail.run.mode}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Total Firms</div><div className="text-lg font-semibold">{detail.run.totalFirms}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Processed</div><div className="text-lg font-semibold">{detail.run.processedFirms}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Success</div><div className="text-lg font-semibold">{detail.run.successCount}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Failed</div><div className="text-lg font-semibold">{detail.run.failedCount}</div></CardBody></Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-sm font-semibold">Agent Tasks ({detail.tasks.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-4 py-2 text-xs uppercase text-slate-500">Investor</th>
                  <th className="px-4 py-2 text-xs uppercase text-slate-500">Agent</th>
                  <th className="px-4 py-2 text-xs uppercase text-slate-500">Status</th>
                  <th className="px-4 py-2 text-xs uppercase text-slate-500">Summary</th>
                  <th className="px-4 py-2 text-xs uppercase text-slate-500">Started</th>
                </tr>
              </thead>
              <tbody>
                {detail.tasks.map((task) => (
                  <tr key={task.id} className="border-b border-slate-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{task.firmName}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{task.agent}</td>
                    <td className="px-4 py-2"><StatusPill status={task.status} /></td>
                    <td className="px-4 py-2 text-slate-600">{task.summary}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{dayjs(task.startedAt).format("MMM D, YYYY HH:mm")}</td>
                  </tr>
                ))}
                {detail.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No tasks recorded yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Execution Logs ({detail.logs.length})</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          {detail.logs.slice().reverse().map((log) => (
            <div key={log.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">{log.level.toUpperCase()}</span>
                <span className="text-xs text-slate-500">{dayjs(log.timestamp).format("MMM D, YYYY HH:mm:ss")}</span>
              </div>
              <p className="mt-1 text-slate-600">{log.message}</p>
              {log.firmId ? <p className="mt-1 text-xs text-slate-500">Firm ID: {log.firmId}</p> : null}
            </div>
          ))}
          {detail.logs.length === 0 ? <p className="text-sm text-slate-400">No logs yet.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
