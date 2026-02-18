import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  activateWorkspace,
  approveSubmission,
  bulkApproveSubmissions,
  bulkRejectSubmissions,
  createManualLead,
  createRun,
  deleteLead,
  deleteLeadList,
  exportFirmsCsv,
  exportSubmissionsCsv,
  getFirms,
  getLeadLists,
  getRuns,
  getSubmissionQueue,
  importFirmsFile,
  importFirmsFromDrive,
  queueResearchRun,
  renameLeadList,
  updateLeadList
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

type StageBucket = "all" | "leads" | "qualified" | "submission_attempt" | "submitted";
const BUCKET_STAGE_MAP: Record<Exclude<StageBucket, "all">, string[]> = {
  leads: ["lead", "researching"],
  qualified: ["qualified", "form_discovered"],
  submission_attempt: ["form_filled", "review", "lost"],
  submitted: ["submitted", "won"]
};

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
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [queueingResearch, setQueueingResearch] = useState(false);
  const [manualAdding, setManualAdding] = useState(false);
  const [leadActionBusyId, setLeadActionBusyId] = useState<string>();

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
  const [stageBucket, setStageBucket] = useState<StageBucket>("all");
  const [listSearch, setListSearch] = useState("");
  const [selectedListNames, setSelectedListNames] = useState<string[]>([]);
  const [editingListName, setEditingListName] = useState<string>();
  const [editingListValue, setEditingListValue] = useState("");
  const [listActionBusy, setListActionBusy] = useState<string>();
  const [manualLeadName, setManualLeadName] = useState("");
  const [manualLeadWebsite, setManualLeadWebsite] = useState("");
  const [manualLeadListName, setManualLeadListName] = useState("");

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

  useEffect(() => {
    const bucketParam = searchParams.get("bucket");
    const nextBucket: StageBucket =
      bucketParam === "leads" || bucketParam === "qualified" || bucketParam === "submission_attempt" || bucketParam === "submitted"
        ? bucketParam
        : "all";
    setStageBucket(nextBucket);

    const listParam = searchParams.get("list");
    if (listParam) {
      setSelectedListNames([listParam]);
    }
  }, [searchParams]);

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
    const allowedStages = stageBucket === "all" ? undefined : BUCKET_STAGE_MAP[stageBucket];
    return firms
      .filter((firm) => {
        const qOk = q.length === 0 || firm.name.toLowerCase().includes(q) || firm.website.toLowerCase().includes(q);
        const bucketOk = !allowedStages || allowedStages.includes(firm.stage);
        const stageOk = leadStageFilter === "all" || firm.stage === leadStageFilter;
        const listOk = selectedListNames.length === 0 || selectedListNames.includes(firm.sourceListName ?? "Unassigned");
        return qOk && bucketOk && stageOk && listOk;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [firms, leadQuery, leadStageFilter, selectedListNames, stageBucket]);

  const queueSummary = useMemo(
    () => ({
      pendingApproval: queue.filter((item) => item.status === "pending_approval").length,
      pendingRetry: queue.filter((item) => item.status === "pending_retry").length,
      failed: queue.filter((item) => item.status === "failed").length,
      completed: queue.filter((item) => item.status === "completed").length
    }),
    [queue]
  );

  const bucketCards = useMemo(() => {
    const total = Math.max(1, firms.length);
    const defs: Array<{ key: Exclude<StageBucket, "all">; label: string }> = [
      { key: "leads", label: "Leads" },
      { key: "qualified", label: "Qualified Leads" },
      { key: "submission_attempt", label: "Submission Attempt" },
      { key: "submitted", label: "Submitted" }
    ];
    return defs.map((def) => {
      const count = firms.filter((firm) => BUCKET_STAGE_MAP[def.key].includes(firm.stage)).length;
      return {
        ...def,
        count,
        percentage: Math.round((count / total) * 100)
      };
    });
  }, [firms]);

  const listOptions = useMemo(() => {
    const names = lists
      .map((list) => list.name)
      .filter((name) => name.trim().length > 0)
      .sort((a, b) => a.localeCompare(b));
    return names;
  }, [lists]);

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

  const onQueueResearch = async (): Promise<void> => {
    if (!workspaceId) return;
    setQueueingResearch(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const payload =
        selectedListNames.length > 0
          ? { listNames: selectedListNames, limit: 1200 }
          : { limit: Math.max(300, firms.length) };
      const result = await queueResearchRun(workspaceId, payload);
      setNotice(
        result.queued > 0
          ? `${result.queued} leads queued for deep enrichment. Refresh in 1-3 minutes to see updates.`
          : "No leads were queued. Try selecting a list first."
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue research.");
    } finally {
      setQueueingResearch(false);
    }
  };

  const toggleListSelection = (name: string): void => {
    setSelectedListNames((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]));
  };

  const startRenameList = (name: string): void => {
    setEditingListName(name);
    setEditingListValue(name);
  };

  const cancelRenameList = (): void => {
    setEditingListName(undefined);
    setEditingListValue("");
  };

  const saveRenameList = async (currentName: string): Promise<void> => {
    if (!workspaceId) return;
    const nextName = editingListValue.trim();
    if (!nextName) {
      setError("List name cannot be empty.");
      return;
    }

    setListActionBusy(`rename:${currentName}`);
    setError(undefined);
    setNotice(undefined);
    try {
      await renameLeadList(workspaceId, currentName, nextName);
      setSelectedListNames((prev) => prev.map((name) => (name === currentName ? nextName : name)));
      setNotice(`List '${currentName}' renamed to '${nextName}'.`);
      cancelRenameList();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename list.");
    } finally {
      setListActionBusy(undefined);
    }
  };

  const onDeleteList = async (name: string): Promise<void> => {
    if (!workspaceId) return;
    const shouldContinue = window.confirm(`Delete list '${name}'? Leads will stay in workspace under 'Unassigned'.`);
    if (!shouldContinue) return;

    setListActionBusy(`delete:${name}`);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await deleteLeadList(workspaceId, name, false);
      setSelectedListNames((prev) => prev.filter((item) => item !== name));
      setNotice(
        `List '${name}' deleted. ${result.unassignedLeads} leads moved to Unassigned.`
      );
      if (editingListName === name) {
        cancelRenameList();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete list.");
    } finally {
      setListActionBusy(undefined);
    }
  };

  const focusList = (name: string): void => {
    setSelectedListNames([name]);
    const next = new URLSearchParams(searchParams);
    next.set("list", name);
    setSearchParams(next, { replace: true });
  };

  const clearListFilter = (): void => {
    setSelectedListNames([]);
    const next = new URLSearchParams(searchParams);
    next.delete("list");
    setSearchParams(next, { replace: true });
  };

  const setBucketFilter = (value: StageBucket): void => {
    setStageBucket(value);
    const next = new URLSearchParams(searchParams);
    if (value === "all") {
      next.delete("bucket");
    } else {
      next.set("bucket", value);
    }
    setSearchParams(next, { replace: true });
  };

  const onManualAddLead = async (): Promise<void> => {
    if (!workspaceId) return;
    const name = manualLeadName.trim();
    const website = manualLeadWebsite.trim();
    if (!name || !website) {
      setError("Manual lead requires both company name and website.");
      return;
    }

    setManualAdding(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await createManualLead(workspaceId, {
        name,
        website,
        listName: manualLeadListName.trim() || undefined
      });
      setManualLeadName("");
      setManualLeadWebsite("");
      setManualLeadListName("");
      setNotice(`Lead '${name}' added successfully.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add lead manually.");
    } finally {
      setManualAdding(false);
    }
  };

  const onLeadListChange = async (firm: Firm, rawValue: string): Promise<void> => {
    if (!workspaceId) return;
    let nextList: string | undefined;

    if (rawValue === "__new__") {
      const entered = window.prompt("New list name", firm.sourceListName ?? "");
      if (!entered) return;
      nextList = entered.trim();
      if (!nextList) return;
    } else if (rawValue === "__unassigned__") {
      nextList = undefined;
    } else {
      nextList = rawValue;
    }

    setLeadActionBusyId(`list:${firm.id}`);
    setError(undefined);
    setNotice(undefined);
    try {
      await updateLeadList(workspaceId, firm.id, nextList);
      setNotice(nextList ? `'${firm.name}' moved to '${nextList}'.` : `'${firm.name}' moved to Unassigned.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update lead list.");
    } finally {
      setLeadActionBusyId(undefined);
    }
  };

  const onDeleteLead = async (firm: Firm): Promise<void> => {
    if (!workspaceId) return;
    const confirmed = window.confirm(`Delete lead '${firm.name}'? This removes related queue/events/logs for this lead.`);
    if (!confirmed) return;

    setLeadActionBusyId(`delete:${firm.id}`);
    setError(undefined);
    setNotice(undefined);
    try {
      await deleteLead(workspaceId, firm.id);
      setNotice(`Lead '${firm.name}' deleted.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete lead.");
    } finally {
      setLeadActionBusyId(undefined);
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
          <p className="mt-1 text-slate-500">Run submissions, manage approvals, and track every imported lead.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={() => void onQueueResearch()} disabled={queueingResearch}>
            {queueingResearch ? "Queueing..." : "Run Enrichment"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void onExportFirms()} disabled={exportingFirms}>
            {exportingFirms ? "Exporting..." : "Export Leads"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void onExportSubmissions()} disabled={exportingSubmissions}>
            {exportingSubmissions ? "Exporting..." : "Export Submissions"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">Leads</div><div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{firms.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">Lists</div><div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{lists.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">Pending approvals</div><div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{queueSummary.pendingApproval}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">Retry queue</div><div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{queueSummary.pendingRetry}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="text-xs text-slate-500 dark:text-slate-400">Failed</div><div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{queueSummary.failed}</div></div>
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

            <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/40">
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upload CSV or Excel</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Accepted: .csv, .xlsx, .xls</div>
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

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/30">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Add Lead Manually
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input
                  placeholder="Company name"
                  value={manualLeadName}
                  onChange={(event) => setManualLeadName(event.target.value)}
                />
                <Input
                  placeholder="Website (domain or URL)"
                  value={manualLeadWebsite}
                  onChange={(event) => setManualLeadWebsite(event.target.value)}
                />
                <Input
                  placeholder="List name (optional)"
                  value={manualLeadListName}
                  onChange={(event) => setManualLeadListName(event.target.value)}
                />
              </div>
              <div className="mt-3">
                <Button size="sm" onClick={() => void onManualAddLead()} disabled={manualAdding}>
                  {manualAdding ? "Adding..." : "Add Lead"}
                </Button>
              </div>
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
                <p className="text-sm text-slate-400 dark:text-slate-500">No active runs.</p>
              ) : (
                <div className="space-y-2">
                  {runningRuns.slice(0, 6).map((run) => (
                    <Link
                      key={run.id}
                      to={`/projects/${workspaceId}/runs/${run.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40"
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
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">My Lists</h2>
            <div className="flex items-center gap-2">
              {selectedListNames.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={clearListFilter}>Clear list filter</Button>
              ) : null}
              <Input className="max-w-xs" placeholder="Search lists" value={listSearch} onChange={(event) => setListSearch(event.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-800">
                  <th className="px-4 py-2" />
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">List Name</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"># of Leads</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last Modified</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLists.map((list) => {
                  const selected = selectedListNames.includes(list.name);
                  const isUnassigned = list.name.toLowerCase() === "unassigned";
                  const isEditing = editingListName === list.name;
                  return (
                    <tr
                      key={list.name}
                      className={
                        selected
                          ? "border-b border-primary-100 bg-primary-50/40 dark:border-primary-900/50 dark:bg-primary-900/20"
                          : "border-b border-slate-50 hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50"
                      }
                    >
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selected} onChange={() => toggleListSelection(list.name)} />
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                        {isEditing ? (
                          <Input
                            value={editingListValue}
                            onChange={(event) => setEditingListValue(event.target.value)}
                            className="max-w-xs"
                          />
                        ) : (
                          <button
                            type="button"
                            className="text-left hover:text-primary-700 hover:underline dark:hover:text-primary-400"
                            onClick={() => focusList(list.name)}
                          >
                            {list.name}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{list.leadCount}</td>
                      <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{dayjs(list.updatedAt).format("MMM D, YYYY HH:mm")}</td>
                      <td className="px-4 py-2">
                        {isUnassigned ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">System list</span>
                        ) : isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void saveRenameList(list.name)}
                              disabled={listActionBusy === `rename:${list.name}`}
                            >
                              {listActionBusy === `rename:${list.name}` ? "Saving..." : "Save"}
                            </Button>
                            <Button size="sm" variant="secondary" onClick={cancelRenameList}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => startRenameList(list.name)}>
                              Rename
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => void onDeleteList(list.name)}
                              disabled={listActionBusy === `delete:${list.name}`}
                            >
                              {listActionBusy === `delete:${list.name}` ? "Deleting..." : "Delete"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredLists.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">No lists found.</td>
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
                  <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-800">
                    <th className="px-4 py-2" />
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Investor</th>
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Prepared</th>
                    <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.slice(0, 140).map((item) => {
                    const selected = selectedIds.includes(item.id);
                    return (
                      <tr
                        key={item.id}
                        className={`border-b transition-colors ${
                          selected
                            ? "border-primary-100 bg-primary-50/40 dark:border-primary-900/50 dark:bg-primary-900/20"
                            : "border-slate-50 hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={selected} onChange={() => toggleSelection(item.id)} />
                        </td>
                        <td className="px-4 py-2">
                          <button type="button" className="text-left" onClick={() => setPreviewId(item.id)}>
                            <div className="font-medium text-slate-800 dark:text-slate-100">{item.firmName}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{item.website}</div>
                          </button>
                        </td>
                        <td className="px-4 py-2">
                          <StatusPill status={item.status} />
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{dayjs(item.preparedAt).format("MMM D, YYYY HH:mm")}</td>
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
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
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
              <p className="text-sm text-slate-400 dark:text-slate-500">Select a queue item to preview submission payload.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Investor</div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">{preview.firmName}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Mode</div>
                  <div className="text-slate-700 dark:text-slate-200">{preview.mode}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Founder</div>
                  <div className="text-slate-700 dark:text-slate-200">{preview.preparedPayload.contactName}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{preview.preparedPayload.contactEmail}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Company Summary</div>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {preview.preparedPayload.companySummary}
                  </p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Raise Summary</div>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {preview.preparedPayload.raiseSummary}
                  </p>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
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
            <div className="text-xs text-slate-500 dark:text-slate-400">Search any imported company and open timeline/log details</div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => setBucketFilter("all")}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                stageBucket === "all"
                  ? "border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/40"
              }`}
            >
              <div className="font-semibold">All</div>
              <div>{firms.length} leads</div>
            </button>
            {bucketCards.map((bucket) => (
              <button
                key={bucket.key}
                type="button"
                onClick={() => setBucketFilter(bucket.key)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  stageBucket === bucket.key
                    ? "border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/40"
                }`}
              >
                <div className="font-semibold">{bucket.label}</div>
                <div>{bucket.count} leads ({bucket.percentage}%)</div>
              </button>
            ))}
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
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Filtering by lists:</span>
              {selectedListNames.map((name) => (
                <span key={name} className="rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-600">
                  {name}
                </span>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardBody className="p-0">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-800">
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Company</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">List</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Geo</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Focus</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Stage</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status Reason</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last Updated</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leadResults.slice(0, 350).map((firm) => (
                  <tr key={firm.id} className="border-b border-slate-50 hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2">
                      <Link
                        to={`/projects/${workspaceId}/leads/${firm.id}`}
                        className="font-medium text-slate-800 hover:text-primary-700 hover:underline dark:text-slate-100 dark:hover:text-primary-400"
                      >
                        {firm.name}
                      </Link>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{firm.website}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
                      <select
                        value={firm.sourceListName ?? "__unassigned__"}
                        onChange={(event) => void onLeadListChange(firm, event.target.value)}
                        disabled={leadActionBusyId === `list:${firm.id}`}
                        className="min-w-[170px] rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="__unassigned__">Unassigned</option>
                        {listOptions.filter((name) => name.toLowerCase() !== "unassigned").map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                        <option value="__new__">+ Create new list</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{firm.geography ?? "Unknown"}</td>
                    <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{(firm.focusSectors ?? []).slice(0, 2).join(", ") || "-"}</td>
                    <td className="px-4 py-2"><StatusPill status={firm.stage} /></td>
                    <td className="max-w-[320px] px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{firm.statusReason}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{firm.lastTouchedAt ? dayjs(firm.lastTouchedAt).format("MMM D, YYYY") : "-"}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/leads/${firm.id}`)}>
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={leadActionBusyId === `delete:${firm.id}`}
                          onClick={() => void onDeleteLead(firm)}
                        >
                          {leadActionBusyId === `delete:${firm.id}` ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {leadResults.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">No leads found for current filters.</td>
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
