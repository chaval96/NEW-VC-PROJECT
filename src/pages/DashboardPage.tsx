import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  activateWorkspace,
  approveSubmission,
  createRun,
  getFirms,
  getImportBatches,
  getOverview,
  getProfile,
  getSubmissionQueue,
  importFirmsFile,
  importFirmsFromDrive,
  rejectSubmission
} from "../api";
import { ActivityTable } from "../components/ActivityTable";
import { FirmPipelineTable } from "../components/FirmPipelineTable";
import { PerformanceFunnel } from "../components/PerformanceFunnel";
import { WeeklyTrend } from "../components/WeeklyTrend";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { KpiCard } from "../components/ui/KpiCard";
import { StatusPill } from "../components/ui/StatusPill";
import type { AuthUser } from "../types";
import type { Firm, ImportBatch, OverviewResponse, Profile, SubmissionRequest } from "@shared/types";

interface DashboardPageProps {
  user: AuthUser;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed"));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export function DashboardPage({ user }: DashboardPageProps): JSX.Element {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [queue, setQueue] = useState<SubmissionRequest[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);

  const [selectedFirmId, setSelectedFirmId] = useState<string>();
  const [regionFilter, setRegionFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState("all");
  const [driveLink, setDriveLink] = useState("");
  const [runMode, setRunMode] = useState<"dry_run" | "production">("dry_run");
  const [runScope, setRunScope] = useState<"all" | "filtered">("filtered");

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError(undefined);
    try {
      const [ov, allFirms, p, q, im] = await Promise.all([
        getOverview(workspaceId),
        getFirms(workspaceId),
        getProfile(workspaceId),
        getSubmissionQueue(workspaceId),
        getImportBatches(workspaceId)
      ]);

      setOverview(ov);
      setFirms(allFirms);
      setProfile(p);
      setQueue(q);
      setImports(im);

      setSelectedFirmId((current) => current ?? allFirms[0]?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      navigate("/projects");
      return;
    }

    const boot = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open project");
      }
      await refresh();
    };

    void boot();
  }, [workspaceId, navigate, refresh]);

  const onUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!workspaceId) return;
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const b64 = await fileToBase64(file);
      const result = await importFirmsFile({
        workspaceId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64Data: b64
      });
      setNotice(`Imported ${result.imported} investors from ${file.name}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      event.target.value = "";
    }
  };

  const onDriveImport = async (): Promise<void> => {
    if (!workspaceId) return;
    if (!driveLink.trim()) return;
    try {
      const result = await importFirmsFromDrive(workspaceId, driveLink.trim());
      setNotice(`Imported ${result.imported} investors from Google Drive`);
      setDriveLink("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Drive import failed");
    }
  };

  const onApprove = async (id: string): Promise<void> => {
    if (!workspaceId) return;
    setBusyId(id);
    try {
      await approveSubmission(workspaceId, id, user.name);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusyId(undefined);
    }
  };

  const onReject = async (id: string): Promise<void> => {
    if (!workspaceId) return;
    setBusyId(id);
    try {
      await rejectSubmission(workspaceId, id, user.name, "Rejected by operator");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusyId(undefined);
    }
  };

  const selectedFirm = useMemo(() => firms.find((firm) => firm.id === selectedFirmId), [firms, selectedFirmId]);
  const regions = useMemo(() => [...new Set(firms.map((firm) => firm.geography))], [firms]);
  const types = useMemo(() => [...new Set(firms.map((firm) => firm.investorType))], [firms]);
  const focuses = useMemo(() => [...new Set(firms.flatMap((firm) => firm.focusSectors))].sort(), [firms]);

  const filteredFirms = useMemo(
    () =>
      firms.filter((firm) => {
        const regionOk = regionFilter === "all" || firm.geography === regionFilter;
        const typeOk = typeFilter === "all" || firm.investorType === typeFilter;
        const focusOk = focusFilter === "all" || firm.focusSectors.includes(focusFilter);
        return regionOk && typeOk && focusOk;
      }),
    [firms, regionFilter, typeFilter, focusFilter]
  );

  const completedImports = useMemo(() => imports.filter((entry) => entry.status === "completed"), [imports]);
  const failedImports = useMemo(() => imports.filter((entry) => entry.status === "failed"), [imports]);
  const pendingQueue = useMemo(() => queue.filter((item) => item.status === "pending_approval"), [queue]);

  const onStartProcessing = async (): Promise<void> => {
    if (!workspaceId) return;

    setRunning(true);
    setNotice(undefined);
    setError(undefined);

    try {
      const firmIds = runScope === "filtered" ? filteredFirms.map((firm) => firm.id) : undefined;
      const run = await createRun({
        mode: runMode,
        initiatedBy: user.name,
        firmIds,
        workspaceId
      });
      setNotice(`Processing run started (${run.mode}) for ${run.totalFirms} investor targets.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start processing");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  if (!overview || !profile) {
    return <div className="mx-auto max-w-7xl px-6 py-12 text-slate-500">No project data found.</div>;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-in">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{overview.workspace.name}</h1>
          <p className="mt-1 text-slate-500">VC website form operations dashboard</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/onboarding`)}>
            Knowledge Base
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard label="Investors" value={overview.kpis.targetsTotal} subtitle="Target firms" />
        <KpiCard label="Attempts" value={overview.kpis.attempts} subtitle="Form attempts" />
        <KpiCard label="Discovered" value={overview.kpis.formsDiscovered} subtitle="Forms found" />
        <KpiCard label="Submitted" value={overview.kpis.submitted} subtitle="Completed" />
        <KpiCard label="Success Rate" value={`${overview.kpis.completionRate}%`} subtitle="Submitted / attempts" />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <h3 className="text-sm font-semibold">Import Investors</h3>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="cursor-pointer">
              <Button size="sm" variant="secondary" className="pointer-events-none">
                Upload CSV/XLSX
              </Button>
              <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={(event) => void onUpload(event)} />
            </label>
            <Input
              placeholder="Google Drive share link"
              value={driveLink}
              onChange={(event) => setDriveLink(event.target.value)}
              className="sm:flex-1"
            />
            <Button size="sm" variant="secondary" onClick={() => void onDriveImport()}>
              Import
            </Button>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Completed lists</div>
            <div className="flex flex-wrap gap-2">
              {completedImports.slice(0, 12).map((entry) => (
                <span key={entry.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                  {entry.sourceName.length > 34 ? `${entry.sourceName.slice(0, 34)}...` : entry.sourceName} ({entry.importedCount})
                </span>
              ))}
              {completedImports.length === 0 ? <span className="text-xs text-slate-400">No completed imports yet.</span> : null}
            </div>

            {failedImports.length > 0 ? (
              <div className="mt-3 text-xs text-red-600">Failed imports: {failedImports.slice(0, 3).map((entry) => entry.sourceName).join(" | ")}</div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h3 className="text-sm font-semibold">Run Processing</h3>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select value={runMode} onChange={(event) => setRunMode(event.target.value as "dry_run" | "production")} label="Mode">
              <option value="dry_run">Simulation</option>
              <option value="production">Live execution</option>
            </Select>
            <Select value={runScope} onChange={(event) => setRunScope(event.target.value as "all" | "filtered")} label="Scope">
              <option value="filtered">Filtered firms</option>
              <option value="all">All firms</option>
            </Select>
            <div className="flex items-end">
              <Button onClick={() => void onStartProcessing()} disabled={running || firms.length === 0}>
                {running ? "Starting..." : "Start Processing"}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Agents discover and prepare investor form submissions in background. Pending items appear in approval queue below.
          </p>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h3 className="text-sm font-semibold">Pending Approvals ({pendingQueue.length})</h3>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500">Investor</th>
                  <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500">Status</th>
                  <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500">Prepared</th>
                  <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500">Mode</th>
                  <th className="px-5 py-2 text-xs font-medium uppercase text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingQueue.slice(0, 40).map((item) => (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="px-5 py-2">{item.firmName}</td>
                    <td className="px-5 py-2">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="px-5 py-2 text-slate-500">{dayjs(item.preparedAt).format("MMM D, YYYY HH:mm")}</td>
                    <td className="px-5 py-2 text-slate-500">{item.mode}</td>
                    <td className="px-5 py-2">
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void onApprove(item.id)} disabled={busyId === item.id}>
                          Approve
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => void onReject(item.id)} disabled={busyId === item.id}>
                          Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pendingQueue.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-5 text-center text-slate-400">
                      No pending approvals.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

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

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
                <option value="all">All regions</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </Select>
              <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">All investor types</option>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <Select value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
                <option value="all">All sectors</option>
                {focuses.map((focus) => (
                  <option key={focus} value={focus}>
                    {focus}
                  </option>
                ))}
              </Select>
            </div>
          </Card>

          <FirmPipelineTable firms={filteredFirms} selectedFirmId={selectedFirmId} onSelectFirm={setSelectedFirmId} />
        </div>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">Selected Investor</h3>
          </CardHeader>
          <CardBody>
            {!selectedFirm ? (
              <p className="text-sm text-slate-400">Select an investor from the pipeline table.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-slate-500">Firm:</span> <span className="font-medium">{selectedFirm.name}</span>
                </div>
                <div>
                  <span className="text-slate-500">Website:</span>{" "}
                  <span className="break-all text-xs">{selectedFirm.website}</span>
                </div>
                <div>
                  <span className="text-slate-500">Type:</span> {selectedFirm.investorType}
                </div>
                <div>
                  <span className="text-slate-500">Check Size:</span> {selectedFirm.checkSizeRange}
                </div>
                <div>
                  <span className="text-slate-500">Focus:</span> {selectedFirm.focusSectors.join(", ")}
                </div>
                <div>
                  <span className="text-slate-500">Stage:</span> <StatusPill status={selectedFirm.stage} />
                </div>
                <div>
                  <span className="text-slate-500">Reason:</span> <span className="text-xs">{selectedFirm.statusReason}</span>
                </div>
                <div>
                  <span className="text-slate-500">Last Updated:</span>{" "}
                  {selectedFirm.lastTouchedAt ? dayjs(selectedFirm.lastTouchedAt).format("MMM D, YYYY") : "-"}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <ActivityTable events={overview.recentActivities} />
    </div>
  );
}
