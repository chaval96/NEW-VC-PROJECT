import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getLeadLists,
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
import type { CampaignRun, Firm, LeadListSummary, SubmissionRequest } from "@shared/types";

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
  const [lists, setLists] = useState<LeadListSummary[]>([]);
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
  const [listName, setListName] = useState("");
  const [runMode, setRunMode] = useState<"dry_run" | "production">("dry_run");
  const [runScope, setRunScope] = useState<"all" | "filtered">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionRequest["status"]>("pending_approval");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string>();

  const [leadQuery, setLeadQuery] = useState("");
  const [leadStageFilter, setLeadStageFilter] = useState<string>("all");
  const [listSearch, setListSearch] = useState("");
  const [selectedListNames, setSelectedListNames] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(undefined);
    const [allFirms, submissions, leadLists, runItems] = await Promise.all([
      getFirms(workspaceId),
      getSubmissionQueue(workspaceId),
      getLeadLists(workspaceId),
      getRuns(workspaceId)
    ]);
    setFirms(allFirms);
    setQueue(submissions);
    setLists(leadLists);
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
  const runningRuns = useMemo(() => runs.filter((run) => run.status === "running").sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1)), [runs]);

  const filteredLists = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return lists.filter((list) => q.length === 0 || list.name.toLowerCase().includes(q));
  }, [lists, listSearch]);

  const leadResults = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    return firms
      .filter((firm) => {
        const qOk = q.length === 0 || firm.name.toLowerCase().includes(q) || firm.website.toLowerCase().includes(q);
        const stageOk = leadStageFilter === "all" || firm.stage === leadStageFilter;
        const listOk = selectedListNames.length === 0 || selectedListNames.includes(firm.sourceListName ?? "Unassigned");
        return qOk && stageOk && listOk;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [firms, leadQuery, leadStageFilter, selectedListNames]);

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

  const onChooseFile = (): void => {
    fileInputRef.current?.click();
  };

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
        base64Data,
        listName: listName.trim() || undefined
      });

      const skipped = result.skippedDuplicates ?? 0;
      const totalParsed = result.totalParsed ?? result.imported;
      setNotice(
        skipped > 0
          ? `Imported ${result.imported} leads to '${result.listName ?? (listName || file.name)}'. ${skipped} were already in your workspace (parsed: ${totalParsed}).`
          : `Imported ${result.imported} leads to '${result.listName ?? (listName || file.name)}'.`
      );
      setListName("");
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
      const result = await importFirmsFromDrive(workspaceId, driveLink.trim(), listName.trim() || undefined);
      const skipped = result.skippedDuplicates ?? 0;
      const totalParsed = result.totalParsed ?? result.imported;
      setNotice(
        skipped > 0
          ? `Imported ${result.imported} leads to '${result.listName ?? (listName || "Drive list")}'. ${skipped} were already in your workspace (parsed: ${totalParsed}).`
          : `Imported ${result.imported} leads to '${result.listName ?? (listName || "Drive list")}'.`
      );
      setDriveLink("");
      setListName("");
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

  const toggleListSelection = (name: string): void => {
    setSelectedListNames((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));
  };

  if (loading) {
    return <div className="mx-auto max-w-7xl px-6 py-8" />;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Operations</h1>
          <p className="mt-1 text-slate-500">Run submissions, manage approvals, and track every imported lead.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={() => void onExportFirms()} disabled={exportingFirms}>
            {exportingFirms ? "Exporting..." : "Export Leads"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void onExportSubmissions()} disabled={exportingSubmissions}>
            {exportingSubmissions ? "Exporting..." : "Export Submissions"}
          </Button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs text-slate-500">Leads</div><div className="mt-1 text-2xl font-bold text-slate-800">{firms.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs text-slate-500">Lists</div><div className="mt-1 text-2xl font-bold text-slate-800">{lists.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs text-slate-500">Pending approvals</div><div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.pendingApproval}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs text-slate-500">Retry queue</div><div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.pendingRetry}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs text-slate-500">Failed</div><div className="mt-1 text-2xl font-bold text-slate-800">{queueSummary.failed}</div></div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Import Investor Lists</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="List Name (optional but recommended)"
              placeholder="e.g. US Seed VCs - Feb 2026"
              value={listName}
              onChange={(event) => setListName(event.target.value)}
            />

            <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Upload CSV or Excel</div>
                <div className="text-xs text-slate-500">Accepted: .csv, .xlsx, .xls</div>
              </div>
              <Button size="sm" variant="secondary" onClick={onChooseFile} disabled={uploading}>
                {uploading ? "Uploading..." : "Choose file"}
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => void onUpload(event)} />
            </div>

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
                <option value="all">All leads</option>
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

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">My Lists</h2>
            <Input className="max-w-xs" placeholder="Search lists" value={listSearch} onChange={(event) => setListSearch(event.target.value)} />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left">
                  <th className="px-4 py-2" />
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">List Name</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"># of Leads</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Last Modified</th>
                </tr>
              </thead>
              <tbody>
                {filteredLists.map((list) => {
                  const selected = selectedListNames.includes(list.name);
                  return (
                    <tr key={list.name} className={selected ? "border-b border-primary-100 bg-primary-50/40" : "border-b border-slate-50 hover:bg-slate-50"}>
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selected} onChange={() => toggleListSelection(list.name)} />
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-800">{list.name}</td>
                      <td className="px-4 py-2 text-slate-700">{list.leadCount}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{dayjs(list.updatedAt).format("MMM D, YYYY HH:mm")}</td>
                    </tr>
                  );
                })}
                {filteredLists.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No lists found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
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
          </CardHeader>
          <CardBody className="p-0">
            <div className="max-h-[560px] overflow-auto">
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
                  {filteredQueue.slice(0, 140).map((item) => {
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Lead Explorer ({leadResults.length})</h2>
            <div className="text-xs text-slate-500">Search any imported company and open its timeline/logs</div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input placeholder="Search by company or website" value={leadQuery} onChange={(event) => setLeadQuery(event.target.value)} />
            <Select value={leadStageFilter} onChange={(event) => setLeadStageFilter(event.target.value)}>
              <option value="all">All stages</option>
              {[
                "lead",
                "researching",
                "qualified",
                "form_discovered",
                "form_filled",
                "submitted",
                "review",
                "won",
                "lost"
              ].map((stage) => (
                <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>
              ))}
            </Select>
          </div>
          {selectedListNames.length > 0 ? (
            <div className="mt-3 text-xs text-slate-500">Filtering by lists: {selectedListNames.join(" | ")}</div>
          ) : null}
        </CardHeader>
        <CardBody className="p-0">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Company</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Source List</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status Reason</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Last Updated</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {leadResults.slice(0, 300).map((firm) => (
                  <tr key={firm.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{firm.name}</div>
                      <div className="text-xs text-slate-500">{firm.website}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{firm.sourceListName ?? "Unassigned"}</td>
                    <td className="px-4 py-2"><StatusPill status={firm.stage} /></td>
                    <td className="px-4 py-2 text-xs text-slate-600 max-w-[320px] truncate">{firm.statusReason}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{firm.lastTouchedAt ? dayjs(firm.lastTouchedAt).format("MMM D, YYYY") : "-"}</td>
                    <td className="px-4 py-2">
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/leads/${firm.id}`)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
                {leadResults.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No leads found for current filters.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
