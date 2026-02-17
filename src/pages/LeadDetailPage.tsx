import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { activateWorkspace, getFirmDetail } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import type { FirmDetail } from "../types";

export function LeadDetailPage(): JSX.Element {
  const { workspaceId, firmId } = useParams<{ workspaceId: string; firmId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<FirmDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!workspaceId || !firmId) {
      navigate("/projects");
      return;
    }

    const load = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        const result = await getFirmDetail(workspaceId, firmId);
        setDetail(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load lead detail.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [workspaceId, firmId, navigate]);

  if (loading) {
    return <div className="mx-auto max-w-6xl px-6 py-8" />;
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-slate-500">{error ?? "Lead not found."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{detail.firm.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{detail.firm.website}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/operations`)}>
            Back to Operations
          </Button>
          <StatusPill status={detail.firm.stage} />
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardBody><div className="text-xs text-slate-500">Geography</div><div className="mt-1 font-semibold text-slate-800">{detail.firm.geography}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Investor Type</div><div className="mt-1 font-semibold text-slate-800">{detail.firm.investorType}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Check Size</div><div className="mt-1 font-semibold text-slate-800">{detail.firm.checkSizeRange}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500">Source List</div><div className="mt-1 font-semibold text-slate-800">{detail.firm.sourceListName ?? "-"}</div></CardBody></Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-sm font-semibold">Submission Requests ({detail.submissionRequests.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Result</th>
                </tr>
              </thead>
              <tbody>
                {detail.submissionRequests.map((request) => (
                  <tr key={request.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2"><StatusPill status={request.status} /></td>
                    <td className="px-4 py-2 text-slate-600">{request.mode}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{dayjs(request.preparedAt).format("MMM D, YYYY HH:mm")}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{request.resultNote ?? "-"}</td>
                  </tr>
                ))}
                {detail.submissionRequests.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No submission requests yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Event Timeline ({detail.events.length})</h2>
          </CardHeader>
          <CardBody className="space-y-2">
            {detail.events.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <StatusPill status={event.status} />
                  <span className="text-xs text-slate-500">{dayjs(event.attemptedAt).format("MMM D, YYYY HH:mm:ss")}</span>
                </div>
                <p className="mt-1 text-slate-600">{event.note ?? "-"}</p>
                {event.blockedReason ? <p className="mt-1 text-xs text-red-600">Blocked: {event.blockedReason}</p> : null}
              </div>
            ))}
            {detail.events.length === 0 ? <p className="text-sm text-slate-400">No timeline events yet.</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Execution Logs ({detail.logs.length})</h2>
          </CardHeader>
          <CardBody className="space-y-2">
            {detail.logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{log.level.toUpperCase()}</span>
                  <span className="text-xs text-slate-500">{dayjs(log.timestamp).format("MMM D, YYYY HH:mm:ss")}</span>
                </div>
                <p className="mt-1 text-slate-600">{log.message}</p>
              </div>
            ))}
            {detail.logs.length === 0 ? <p className="text-sm text-slate-400">No execution logs for this lead yet.</p> : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
