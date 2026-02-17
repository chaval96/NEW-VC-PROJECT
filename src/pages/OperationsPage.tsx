import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  activateWorkspace,
  approveSubmission,
  bulkApproveSubmissions,
  bulkRejectSubmissions,
  createRun,
  exportFirmsCsv,
  exportSubmissionsCsv,
  getFirms,
  getImportBatches,
  getRuns,
  getSubmissionQueue,
  importFirmsFile,
  importFirmsFromDrive
} from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { StatusPill } from "../components/ui/StatusPill";
import type { AuthUser } from "../types";
import type { CampaignRun, Firm, ImportBatch, SubmissionRequest } from "@shared/types";

interface OperationsPageProps {
  user: AuthUser;
}

const DRIVE_HOST_PATTERN = /^https:\/\/(docs|drive)\.google\.com\//i;
const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file."));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function isAllowedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function OperationsPage({ user }: OperationsPageProps): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  const [firms, setFirms] = useState<Firm[]>([]);
  const [queue, setQueue] = useState<SubmissionRequest[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [runs, setRuns] = useState<CampaignRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [importingDrive, setImportingDrive] = useState(false);
  const [running, setRunning] = useState(false);
  const [exportingFirms, setExportingFirms] = useState(false);
  const [exportingSubmissions, setExportingSubmissions] = useState(false);

  const [driveLink, setDriveLink] = useState("");
  const [runMode, setRunMode] = useState<"dry_run" | "production">("dry_run");
  const [runScope, setRunScope] = useState<"all" | "filtered">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionRequest["status"]>("pending_approval");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string>();

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(undefined);
    const [allFirms, submissions, importBatches, runItems] = await Promise.all([
      getFirms(workspaceId),
      getSubmissionQueue(workspaceId),
      getImportBatches(workspaceId),
      getRuns(workspaceId)
    ]);
    setFirms(allFirms);
    setQueue(submissions);
    setImports(importBatches);
    setRuns(runItems);
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
        setError(err instanceof Error ? err.message : "Could not load operations.");
      } finally {
        setLoading(false);
      }
    };

    void boot();
  }, [workspaceId, navigate, refresh]);

  const filteredQueue = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return queue.filter((item) => {
      const statusOk = statusFilter === "all" || item.status === statusFilter;
      const queryOk = normalizedQuery.length === 0 || item.firmName.toLowerCase().includes(normalizedQuery);
      return statusOk && queryOk;
    });
  }, [queue, statusFilter, query]);

  const preview = useMemo(() => queue.find((item) => item.id === previewId), [queue, previewId]);
  const completedImports = useMemo(() => imports.filter((entry) => entry.status === "completed"), [imports]);
  const failedImports = useMemo(() => imports.filter((entry) => entry.status === "failed"), [imports]);
  const runningRuns = useMemo(() => runs.filter((run) => run.status === "running").sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1)), [runs]);
  const queueSummary = useMemo(
    () => ({
      pendingApproval: queue.filter((item) => item.status === "pending_approval").length,
      pendingRetry: queue.filter((item) => item.status === "pending_retry").length,
      failed: queue.filter((item) => item.status === "failed").length,
      completed: queue.filter((item) => item.status === "completed").length
    }),
    [queue]
  );

  useEffect(() => {
    if (!previewId && filteredQueue.length > 0) {
      setPreviewId(filteredQueue[0].id);
      return;
    }
    if (previewId && filteredQueue.every((item) => item.id !== previewId)) {
      setPreviewId(filteredQueue[0]?.id);
    }
  }, [filteredQueue, previewId]);

  const onUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!workspaceId) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setError(undefined);
    setNotice(undefined);

    if (!isAllowedFile(file.name)) {
      setError("Only CSV, XLSX or XLS files are supported.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const base64Data = await fileToBase64(file);
      const result = await importFirmsFile({
        workspaceId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64Data
      });
      setNotice(`Imported ${result.imported} investors from ${file.name}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const onDriveImport = async (): Promise<void> => {
    if (!workspaceId) return;
    setError(undefined);
    setNotice(undefined);

    if (!DRIVE_HOST_PATTERN.test(driveLink.trim())) {
      setError("Please provide a valid Google Drive or Google Docs share link.");
      return;
    }

    setImportingDrive(true);
    try {
      const result = await importFirmsFromDrive(workspaceId, driveLink.trim());
      setNotice(`Imported ${result.imported} investors from Google Drive.`);
      setDriveLink("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Drive import failed.");
    } finally {
      setImportingDrive(false);
    }
  };

  const onStartRun = async (): Promise<void> => {
    if (!workspaceId) return;
    setError(undefined);
    setNotice(undefined);

    if (firms.length === 0) {
      setError("Import at least one investor before starting a run.");
      return;
    }

    setRunning(true);
    try {
      let firmIds: string[] | undefined;
      if (runScope === "filtered") {
        const candidateIds = filteredQueue
          .map((request) => request.firmId)
          .filter((firmId, index, all) => all.indexOf(firmId) === index);
        firmIds = candidateIds.length > 0 ? candidateIds : undefined;
      }

      const run = await createRun({
        workspaceId,
        initiatedBy: user.name,
        mode: runMode,
        firmIds
      });
      setNotice(`Run started (${run.mode}) for ${run.totalFirms} investor targets.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start run.");
    } finally {
      setRunning(false);
    }
  };

  const onApprove = async (requestId: string): Promise<void> => {
    if (!workspaceId) return;
    setBusyId(requestId);
    setError(undefined);
    setNotice(undefined);
    try {
      await approveSubmission(workspaceId, requestId, user.name);
      setNotice("Submission approved and executed.");
      await refresh();
      setSelectedIds((prev) => prev.filter((id) => id !== requestId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  const onReject = async (requestId: string): Promise<void> => {
    if (!workspaceId) return;
    setBusyId(requestId);
    setError(undefined);
    setNotice(undefined);
    try {
      await bulkRejectSubmissions(workspaceId, [requestId], user.name, "Rejected by operator");
      setNotice("Submission rejected.");
      await refresh();
      setSelectedIds((prev) => prev.filter((id) => id !== requestId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  const toggleSelection = (requestId: string): void => {
    setSelectedIds((prev) => (prev.includes(requestId) ? prev.filter((id) => id !== requestId) : [...prev, requestId]));
  };

  const selectVisible = (): void => {
    setSelectedIds(filteredQueue.map((item) => item.id));
  };

  const clearSelection = (): void => {
    setSelectedIds([]);
  };

  const onBulkApprove = async (): Promise<void> => {
    if (!workspaceId || selectedIds.length === 0) return;
    setError(undefined);
    setNotice(undefined);
    setBusyId("bulk-approve");
    try {
      const result = await bulkApproveSubmissions(workspaceId, selectedIds, user.name);
      const failSuffix = result.failed.length > 0 ? ` (${result.failed.length} failed)` : "";
      setNotice(`Bulk approve completed: ${result.approved}/${result.processed} approved${failSuffix}.`);
      await refresh();
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk approve failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  const onBulkReject = async (): Promise<void> => {
    if (!workspaceId || selectedIds.length === 0) return;
    setError(undefined);
    setNotice(undefined);
    setBusyId("bulk-reject");
    try {
      const result = await bulkRejectSubmissions(workspaceId, selectedIds, user.name, "Rejected by operator");
      const failSuffix = result.failed.length > 0 ? ` (${result.failed.length} failed)` : "";
      setNotice(`Bulk reject completed: ${result.rejected}/${result.processed} rejected${failSuffix}.`);
      await refresh();
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk reject failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  const onExportFirms = async (): Promise<void> => {
    if (!workspaceId) return;
    setExportingFirms(true);
    setError(undefined);
    try {
      await exportFirmsCsv(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportingFirms(false);
    }
  };

  const onExportSubmissions = async (): Promise<void> => {
    if (!workspaceId) return;
    setExportingSubmissions(true);
    setError(undefined);
    try {
      await exportSubmissionsCsv(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportingSubmissions(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-7xl px-6 py-8" />;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operations</h1>
          <p className="mt-1 text-slate-500">Run submissions, manage approvals, and monitor execution progress.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={() => void onExportFirms()} disabled={exportingFirms}>
            {exportingFirms ? "Exporting..." : "Export Investors"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void onExportSubmissions()} disabled={exportingSubmissions}>
            {exportingSubmissions ? "Exporting..." : "Export Submissions"}
          </Button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Pending approvals</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.pendingApproval}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Retry queue</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.pendingRetry}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Failed</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.failed}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Completed</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.completed}</div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Import Investor Lists</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Upload CSV or Excel</div>
                <div className="text-xs text-slate-500">Accepted: .csv, .xlsx, .xls</div>
              </div>
              <Button size="sm" variant="secondary" type="button" className="pointer-events-none">
                {uploading ? "Uploading..." : "Choose file"}
              </Button>
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => void onUpload(event)} />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <Input
                placeholder="Google Drive share link"
                value={driveLink}
                onChange={(event) => setDriveLink(event.target.value)}
              />
              <Button variant="secondary" onClick={() => void onDriveImport()} disabled={importingDrive}>
                {importingDrive ? "Importing..." : "Import from Drive"}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed Imports</p>
              <div className="flex max-h-24 flex-wrap gap-2 overflow-auto">
                {completedImports.slice(0, 20).map((entry) => (
                  <span key={entry.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                    {entry.sourceName.length > 34 ? `${entry.sourceName.slice(0, 34)}...` : entry.sourceName} ({entry.importedCount})
                  </span>
                ))}
                {completedImports.length === 0 ? <span className="text-xs text-slate-400">No completed imports yet.</span> : null}
              </div>
              {failedImports.length > 0 ? (
                <p className="text-xs text-red-600">
                  Failed imports: {failedImports.slice(0, 3).map((entry) => entry.sourceName).join(" | ")}
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Run Control</h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select value={runMode} onChange={(event) => setRunMode(event.target.value as "dry_run" | "production")} label="Mode">
                <option value="dry_run">Simulation</option>
                <option value="production">Live execution</option>
              </Select>
              <Select value={runScope} onChange={(event) => setRunScope(event.target.value as "all" | "filtered")} label="Scope">
                <option value="all">All investors</option>
                <option value="filtered">Filtered queue firms</option>
              </Select>
              <div className="flex items-end">
                <Button onClick={() => void onStartRun()} disabled={running}>
                  {running ? "Starting..." : "Start Run"}
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Runs</p>
              {runningRuns.length === 0 ? (
                <p className="text-sm text-slate-400">No active runs.</p>
              ) : (
                <div className="space-y-2">
                  {runningRuns.slice(0, 6).map((run) => (
                    <Link
                      key={run.id}
                      to={`/projects/${workspaceId}/runs/${run.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <div>
                        <div className="font-medium text-slate-800">Run {run.id.slice(0, 8)}</div>
                        <div className="text-xs text-slate-500">{run.mode} · {run.processedFirms}/{run.totalFirms} processed</div>
                      </div>
                      <StatusPill status={run.status} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Submission Approval Queue ({filteredQueue.length})</h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={selectVisible}>Select visible</Button>
                <Button size="sm" variant="secondary" onClick={clearSelection}>Clear</Button>
                <Button size="sm" onClick={() => void onBulkApprove()} disabled={selectedIds.length === 0 || busyId === "bulk-approve"}>
                  {busyId === "bulk-approve" ? "Approving..." : `Bulk approve (${selectedIds.length})`}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void onBulkReject()} disabled={selectedIds.length === 0 || busyId === "bulk-reject"}>
                  {busyId === "bulk-reject" ? "Rejecting..." : `Bulk reject (${selectedIds.length})`}
                </Button>
              </div>
            </div>
            {selectedIds.length > 0 ? (
              <div className="mt-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">
                {selectedIds.length} selected. You can bulk approve/reject from the action buttons.
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input placeholder="Search investor" value={query} onChange={(event) => setQuery(event.target.value)} />
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">All statuses</option>
                <option value="pending_approval">Pending approval</option>
                <option value="pending_retry">Pending retry</option>
                <option value="failed">Failed</option>
                <option value="executing">Executing</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: "pending_approval", label: "Pending approval" },
                { key: "pending_retry", label: "Retry queue" },
                { key: "failed", label: "Failed" },
                { key: "completed", label: "Completed" }
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key as typeof statusFilter)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    statusFilter === item.key
                      ? "border-primary-300 bg-primary-50 text-primary-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
              {statusFilter !== "all" ? (
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Clear filter
                </button>
              ) : null}
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left">
                    <th className="px-4 py-2" />
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Investor</th>
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared</th>
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.slice(0, 120).map((item) => {
                    const selected = selectedIds.includes(item.id);
                    return (
                      <tr
                        key={item.id}
                        className={`border-b transition-colors ${selected ? "border-primary-100 bg-primary-50/40" : "border-slate-50 hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={selected} onChange={() => toggleSelection(item.id)} />
                        </td>
                        <td className="px-4 py-2">
                          <button type="button" className="text-left" onClick={() => setPreviewId(item.id)}>
                            <div className="font-medium text-slate-800">{item.firmName}</div>
                            <div className="text-xs text-slate-500">{item.website}</div>
                          </button>
                        </td>
                        <td className="px-4 py-2">
                          <StatusPill status={item.status} />
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">{dayjs(item.preparedAt).format("MMM D, YYYY HH:mm")}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void onApprove(item.id)} disabled={busyId === item.id || busyId === "bulk-approve"}>
                              Approve
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => void onReject(item.id)} disabled={busyId === item.id || busyId === "bulk-reject"}>
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/projects/${workspaceId}/submissions/${item.id}`)}
                            >
                              Detail
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        No submissions for selected filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card className="xl:sticky xl:top-20 xl:self-start">
          <CardHeader>
            <h2 className="text-sm font-semibold">Approval Preview</h2>
          </CardHeader>
          <CardBody>
            {!preview ? (
              <p className="text-sm text-slate-400">Select a queue item to preview submission payload.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Investor</div>
                  <div className="font-medium text-slate-800">{preview.firmName}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Mode</div>
                  <div>{preview.mode}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Founder</div>
                  <div>{preview.preparedPayload.contactName}</div>
                  <div className="text-xs text-slate-500">{preview.preparedPayload.contactEmail}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Company Summary</div>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                    {preview.preparedPayload.companySummary}
                  </p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Raise Summary</div>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                    {preview.preparedPayload.raiseSummary}
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  Prepared {dayjs(preview.preparedAt).format("MMM D, YYYY HH:mm")}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
