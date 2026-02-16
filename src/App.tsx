import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  activateWorkspace,
  approveSubmission,
  createRun,
  createWorkspace,
  getFirms,
  getOverview,
  getPlaybook,
  getProfile,
  getRunDetail,
  getRuns,
  getSubmissionQueue,
  getWorkspaces,
  importFirmsCsv,
  rejectSubmission,
  updateWorkspaceProfile
} from "./api";
import { ActivityTable } from "./components/ActivityTable";
import { FirmPipelineTable } from "./components/FirmPipelineTable";
import { PerformanceFunnel } from "./components/PerformanceFunnel";
import { RunControlPanel } from "./components/RunControlPanel";
import { WeeklyTrend } from "./components/WeeklyTrend";
import type { Firm, OverviewResponse, Playbook, Profile, RunDetail, SubmissionRequest, Workspace } from "./types";

function App(): JSX.Element {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [playbook, setPlaybook] = useState<Playbook>();
  const [runs, setRuns] = useState<RunDetail["run"][]>([]);
  const [selectedRun, setSelectedRun] = useState<RunDetail>();
  const [selectedFirmId, setSelectedFirmId] = useState<string>();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>();
  const [queue, setQueue] = useState<SubmissionRequest[]>([]);

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceCompany, setNewWorkspaceCompany] = useState("");
  const [csvText, setCsvText] = useState("");
  const [creatingRun, setCreatingRun] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyActionId, setBusyActionId] = useState<string>();
  const [error, setError] = useState<string>();

  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [focusFilter, setFocusFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const [workspaceResponse, nextOverview, nextFirms, nextProfile, nextRuns, nextPlaybook, nextQueue] = await Promise.all([
        getWorkspaces(),
        getOverview(),
        getFirms(),
        getProfile(),
        getRuns(),
        getPlaybook(),
        getSubmissionQueue()
      ]);
      setWorkspaces(workspaceResponse.workspaces);
      setActiveWorkspaceId(workspaceResponse.activeWorkspaceId);
      setOverview(nextOverview);
      setFirms(nextFirms);
      setProfile(nextProfile);
      setRuns(nextRuns);
      setPlaybook(nextPlaybook);
      setQueue(nextQueue);
      if (!selectedFirmId && nextFirms.length > 0) setSelectedFirmId(nextFirms[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [selectedFirmId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreateRun = useCallback(
    async (payload: { mode: "dry_run" | "production"; initiatedBy: string; firmIds?: string[] }) => {
      if (!activeWorkspaceId) return;
      setCreatingRun(true);
      setError(undefined);
      try {
        const run = await createRun({ ...payload, workspaceId: activeWorkspaceId });
        await refresh();
        setSelectedRun(await getRunDetail(run.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create run");
      } finally {
        setCreatingRun(false);
      }
    },
    [activeWorkspaceId, refresh]
  );

  const onOpenRun = useCallback(async (runId: string) => {
    setError(undefined);
    try {
      setSelectedRun(await getRunDetail(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run details");
    }
  }, []);

  const onActivateWorkspace = useCallback(
    async (workspaceId: string) => {
      setError(undefined);
      try {
        await activateWorkspace(workspaceId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to activate workspace");
      }
    },
    [refresh]
  );

  const onCreateWorkspace = useCallback(async () => {
    if (newWorkspaceName.trim().length < 2) return;
    setError(undefined);
    try {
      await createWorkspace({
        name: newWorkspaceName.trim(),
        company: newWorkspaceCompany.trim() || undefined
      });
      setNewWorkspaceName("");
      setNewWorkspaceCompany("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    }
  }, [newWorkspaceName, newWorkspaceCompany, refresh]);

  const onImportCsv = useCallback(
    async (mode: "append" | "replace") => {
      if (csvText.trim().length === 0) return;
      setError(undefined);
      try {
        await importFirmsCsv({ csv: csvText, mode });
        setCsvText("");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import CSV");
      }
    },
    [csvText, refresh]
  );

  const onCsvFileSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file);
  }, []);

  const onApproveRequest = useCallback(
    async (requestId: string) => {
      setBusyActionId(requestId);
      setError(undefined);
      try {
        await approveSubmission(requestId, "Utku Bozkurt");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to approve submission");
      } finally {
        setBusyActionId(undefined);
      }
    },
    [refresh]
  );

  const onRejectRequest = useCallback(
    async (requestId: string) => {
      setBusyActionId(requestId);
      setError(undefined);
      try {
        await rejectSubmission(requestId, "Utku Bozkurt", "Rejected by operator");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reject submission");
      } finally {
        setBusyActionId(undefined);
      }
    },
    [refresh]
  );

  const onSaveProfileBasics = useCallback(async () => {
    if (!activeWorkspaceId || !profile) return;
    setSavingProfile(true);
    setError(undefined);
    try {
      await updateWorkspaceProfile(activeWorkspaceId, {
        company: profile.company,
        website: profile.website,
        senderName: profile.senderName,
        senderEmail: profile.senderEmail,
        oneLiner: profile.oneLiner,
        fundraising: {
          round: profile.fundraising.round,
          amount: profile.fundraising.amount,
          deckUrl: profile.fundraising.deckUrl
        }
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  }, [activeWorkspaceId, profile, refresh]);

  const selectedFirm = useMemo(() => firms.find((firm) => firm.id === selectedFirmId), [firms, selectedFirmId]);
  const availableRegions = useMemo(() => [...new Set(firms.map((firm) => firm.geography))], [firms]);
  const availableTypes = useMemo(() => [...new Set(firms.map((firm) => firm.investorType))], [firms]);
  const availableFocuses = useMemo(
    () => [...new Set(firms.flatMap((firm) => firm.focusSectors))].sort((a, b) => a.localeCompare(b)),
    [firms]
  );

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

  if (loading && !overview) return <div className="app-shell">Loading dashboard...</div>;
  if (!overview || !profile) return <div className="app-shell">Dashboard unavailable: {error ?? "unknown error"}</div>;

  return (
    <div className="app-shell">
      <header className="header">
        <div>
          <h1 className="title">Fundraising Operations Hub</h1>
          <div className="subtitle">Multi-company VC website form orchestration and approval control panel</div>
        </div>
        <div className="badges">
          <div className="badge">Active Project: {overview.workspace.name}</div>
          <button className="button secondary" onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {error ? (
        <div className="card card-pad" style={{ marginBottom: 12, borderColor: "#ffd3d3", background: "#fff2f2", color: "#8d2929" }}>
          {error}
        </div>
      ) : null}

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Projects</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8 }}>
          <select className="select" value={activeWorkspaceId ?? ""} onChange={(event) => void onActivateWorkspace(event.target.value)}>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
          <input className="input" placeholder="New project name" value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} />
          <input className="input" placeholder="Company name (optional)" value={newWorkspaceCompany} onChange={(event) => setNewWorkspaceCompany(event.target.value)} />
          <button className="button" onClick={() => void onCreateWorkspace()}>Create</button>
        </div>
      </section>

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Active Company Profile</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: 8, marginBottom: 8 }}>
          <input className="input" value={profile.company} onChange={(event) => setProfile({ ...profile, company: event.target.value })} placeholder="Company" />
          <input className="input" value={profile.website} onChange={(event) => setProfile({ ...profile, website: event.target.value })} placeholder="Website" />
          <input className="input" value={profile.senderName} onChange={(event) => setProfile({ ...profile, senderName: event.target.value })} placeholder="Sender Name" />
          <input className="input" value={profile.senderEmail} onChange={(event) => setProfile({ ...profile, senderEmail: event.target.value })} placeholder="Sender Email" />
          <input className="input" value={profile.fundraising.round} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, round: event.target.value } })} placeholder="Round" />
          <input className="input" value={profile.fundraising.amount} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, amount: event.target.value } })} placeholder="Amount" />
        </div>
        <textarea className="input" rows={3} value={profile.oneLiner} onChange={(event) => setProfile({ ...profile, oneLiner: event.target.value })} />
        <div style={{ marginTop: 8 }}>
          <button className="button" disabled={savingProfile} onClick={() => void onSaveProfileBasics()}>
            {savingProfile ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </section>

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Import Investor List (CSV)</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input className="input" type="file" accept=".csv,text/csv" onChange={onCsvFileSelected} />
          <button className="button secondary" onClick={() => void onImportCsv("append")}>Import Append</button>
          <button className="button secondary" onClick={() => void onImportCsv("replace")}>Import Replace</button>
        </div>
        <textarea
          className="input"
          rows={5}
          placeholder="Or paste CSV here. Minimum columns: name/company and website/domain"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
        />
      </section>

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Submission Approval Queue ({overview.pendingApprovals} pending)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Prepared</th>
                <th>Mode</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.slice(0, 25).map((item) => (
                <tr key={item.id}>
                  <td>{item.firmName}</td>
                  <td><span className={`status-pill ${item.status}`}>{item.status.replaceAll("_", " ")}</span></td>
                  <td>{dayjs(item.preparedAt).format("MMM D, YYYY HH:mm")}</td>
                  <td>{item.mode}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button
                      className="button secondary"
                      disabled={busyActionId === item.id || item.status !== "pending_approval"}
                      onClick={() => void onApproveRequest(item.id)}
                    >Approve</button>
                    <button
                      className="button secondary"
                      disabled={busyActionId === item.id || item.status !== "pending_approval"}
                      onClick={() => void onRejectRequest(item.id)}
                    >Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Form Operations KPIs</h3>
        <div className="kpis">
          <div className="kpi"><div className="kpi-label">Target Firms</div><div className="kpi-value">{overview.kpis.targetsTotal}</div><div className="kpi-sub">Active investor targets</div></div>
          <div className="kpi"><div className="kpi-label">Attempts</div><div className="kpi-value">{overview.kpis.attempts}</div><div className="kpi-sub">Website form attempts</div></div>
          <div className="kpi"><div className="kpi-label">Forms Discovered</div><div className="kpi-value">{overview.kpis.formsDiscovered}</div><div className="kpi-sub">Form routes located</div></div>
          <div className="kpi"><div className="kpi-label">Submitted</div><div className="kpi-value">{overview.kpis.submitted}</div><div className="kpi-sub">Completed submissions</div></div>
          <div className="kpi"><div className="kpi-label">Completion Rate</div><div className="kpi-value">{overview.kpis.completionRate}%</div><div className="kpi-sub">Submitted / attempts</div></div>
        </div>
      </section>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="panel-list">
          <PerformanceFunnel
            attempts={overview.kpis.attempts}
            discovered={overview.kpis.formsDiscovered}
            filled={overview.kpis.formsFilled}
            submitted={overview.kpis.submitted}
            blocked={overview.kpis.blocked}
            noFormFound={overview.kpis.noFormFound}
          />
          <WeeklyTrend data={overview.weeklyTrend} />
          <ActivityTable events={overview.recentActivities} />

          <section className="card card-pad">
            <h3 className="card-title">Investor Filters</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px,1fr))", gap: 8 }}>
              <select className="select" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
                <option value="all">All regions</option>
                {availableRegions.map((region) => <option key={region} value={region}>{region}</option>)}
              </select>
              <select className="select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">All investor types</option>
                {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select className="select" value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
                <option value="all">All focus sectors</option>
                {availableFocuses.map((focus) => <option key={focus} value={focus}>{focus}</option>)}
              </select>
            </div>
          </section>

          <FirmPipelineTable firms={filteredFirms} selectedFirmId={selectedFirmId} onSelectFirm={setSelectedFirmId} />
        </div>

        <RunControlPanel
          profile={profile}
          playbook={playbook}
          firms={firms}
          runs={runs}
          runDetail={selectedRun}
          creatingRun={creatingRun}
          onCreateRun={onCreateRun}
          onOpenRun={onOpenRun}
        />
      </div>

      <section className="card card-pad">
        <h3 className="card-title">Selected Investor Detail</h3>
        {!selectedFirm ? (
          <div style={{ color: "#5f7288" }}>Select a firm from the pipeline table.</div>
        ) : (
          <div className="meta-grid">
            <div className="meta-item"><div className="k">Firm</div><div className="v">{selectedFirm.name}</div></div>
            <div className="meta-item"><div className="k">Website</div><div className="v" style={{ fontSize: 12 }}>{selectedFirm.website}</div></div>
            <div className="meta-item"><div className="k">Investor Type</div><div className="v">{selectedFirm.investorType}</div></div>
            <div className="meta-item"><div className="k">Check Size</div><div className="v">{selectedFirm.checkSizeRange}</div></div>
            <div className="meta-item"><div className="k">Focus</div><div className="v" style={{ fontSize: 12 }}>{selectedFirm.focusSectors.join(", ")}</div></div>
            <div className="meta-item"><div className="k">Current Stage</div><div className="v">{selectedFirm.stage}</div></div>
            <div className="meta-item"><div className="k">Reason</div><div className="v" style={{ fontSize: 12 }}>{selectedFirm.statusReason}</div></div>
            <div className="meta-item"><div className="k">Last Touched</div><div className="v">{selectedFirm.lastTouchedAt ? dayjs(selectedFirm.lastTouchedAt).format("MMM D, YYYY HH:mm") : "-"}</div></div>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
