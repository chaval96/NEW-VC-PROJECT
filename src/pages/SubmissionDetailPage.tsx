import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { activateWorkspace, approveSubmission, getSubmissionDetail, rejectSubmission } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import type { AuthUser, SubmissionDetail } from "../types";

interface SubmissionDetailPageProps {
  user: AuthUser;
}

function canApprove(status: string): boolean {
  return ["pending_approval", "pending_retry", "failed"].includes(status);
}

export function SubmissionDetailPage({ user }: SubmissionDetailPageProps): JSX.Element {
  const { workspaceId, submissionId } = useParams<{ workspaceId: string; submissionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    if (!workspaceId || !submissionId) return;
    const result = await getSubmissionDetail(workspaceId, submissionId);
    setDetail(result);
  };

  useEffect(() => {
    if (!workspaceId || !submissionId) {
      navigate("/projects");
      return;
    }

    const load = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load submission detail.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [workspaceId, submissionId, navigate]);

  const onApprove = async (): Promise<void> => {
    if (!workspaceId || !submissionId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await approveSubmission(workspaceId, submissionId, user.name);
      setNotice("Submission approved and executed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setBusy(false);
    }
  };

  const onReject = async (): Promise<void> => {
    if (!workspaceId || !submissionId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await rejectSubmission(workspaceId, submissionId, user.name, "Rejected by operator");
      setNotice("Submission rejected.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-8" />;
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-slate-500">{error ?? "Submission not found."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 animate-fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{detail.request.firmName}</h1>
          <p className="mt-1 text-sm text-slate-500">Submission ID: {detail.request.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/operations`)}>
            Back to Operations
          </Button>
          <StatusPill status={detail.request.status} />
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Submission Overview</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <div><span className="text-slate-500">Website:</span> {detail.request.website}</div>
            <div><span className="text-slate-500">Mode:</span> {detail.request.mode}</div>
            <div><span className="text-slate-500">Prepared:</span> {dayjs(detail.request.preparedAt).format("MMM D, YYYY HH:mm")}</div>
            <div><span className="text-slate-500">Approved By:</span> {detail.request.approvedBy ?? "-"}</div>
            <div><span className="text-slate-500">Approved At:</span> {detail.request.approvedAt ? dayjs(detail.request.approvedAt).format("MMM D, YYYY HH:mm") : "-"}</div>
            <div><span className="text-slate-500">Executed At:</span> {detail.request.executedAt ? dayjs(detail.request.executedAt).format("MMM D, YYYY HH:mm") : "-"}</div>
            <div><span className="text-slate-500">Attempts:</span> {detail.request.executionAttempts ?? 0} / {detail.request.maxExecutionAttempts ?? "-"}</div>
            <div><span className="text-slate-500">Result:</span> {detail.request.resultNote ?? "-"}</div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Approval Actions</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {canApprove(detail.request.status) ? (
              <div className="flex gap-2">
                <Button onClick={() => void onApprove()} disabled={busy}>
                  {busy ? "Processing..." : "Approve & Execute"}
                </Button>
                <Button variant="secondary" onClick={() => void onReject()} disabled={busy}>
                  Reject
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No manual approval action is available for current status.</p>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Use this page to review payload quality before approval when needed.
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-sm font-semibold">Prepared Payload Preview</h2>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><span className="text-slate-500">Contact Name:</span> {detail.request.preparedPayload.contactName}</div>
            <div><span className="text-slate-500">Contact Email:</span> {detail.request.preparedPayload.contactEmail}</div>
            <div><span className="text-slate-500">Title:</span> {detail.request.preparedPayload.contactTitle}</div>
            <div><span className="text-slate-500">Phone:</span> {detail.request.preparedPayload.contactPhone || "-"}</div>
            <div><span className="text-slate-500">Deck URL:</span> {detail.request.preparedPayload.deckUrl || "-"}</div>
            <div><span className="text-slate-500">Data Room URL:</span> {detail.request.preparedPayload.dataRoomUrl || "-"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <div className="mb-1 font-semibold text-slate-600">Company Summary</div>
            {detail.request.preparedPayload.companySummary}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <div className="mb-1 font-semibold text-slate-600">Raise Summary</div>
            {detail.request.preparedPayload.raiseSummary}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Event Timeline ({detail.events.length})</h2>
        </CardHeader>
        <CardBody className="space-y-2">
          {detail.events.map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <StatusPill status={event.status} />
                <span className="text-xs text-slate-500">{dayjs(event.attemptedAt).format("MMM D, YYYY HH:mm:ss")}</span>
              </div>
              <div className="mt-1 text-slate-600">{event.note ?? "-"}</div>
              {event.blockedReason ? <div className="mt-1 text-xs text-red-600">Blocked: {event.blockedReason}</div> : null}
            </div>
          ))}
          {detail.events.length === 0 ? <p className="text-sm text-slate-400">No events yet.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
