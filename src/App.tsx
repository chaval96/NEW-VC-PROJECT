import dayjs from "dayjs";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  activateWorkspace,
  approveSubmission,
  createWorkspace,
  getFirms,
  getImportBatches,
  getOverview,
  getProfile,
  getSubmissionQueue,
  getWorkspaces,
  importFirmsFile,
  importFirmsFromDrive,
  rejectSubmission,
  updateWorkspaceProfile
} from "./api";
import { ActivityTable } from "./components/ActivityTable";
import { FirmPipelineTable } from "./components/FirmPipelineTable";
import { PerformanceFunnel } from "./components/PerformanceFunnel";
import { WeeklyTrend } from "./components/WeeklyTrend";
import type {
  Firm,
  ImportBatch,
  OverviewResponse,
  Profile,
  SubmissionRequest,
  Workspace
} from "./types";

type Route =
  | { page: "projects" }
  | { page: "dashboard"; workspaceId: string }
  | { page: "knowledge"; workspaceId: string };

function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "/projects") {
    return { page: "projects" };
  }

  const knowledgeMatch = pathname.match(/^\/projects\/([^/]+)\/knowledge-base$/);
  if (knowledgeMatch) {
    return { page: "knowledge", workspaceId: decodeURIComponent(knowledgeMatch[1]) };
  }

  const dashboardMatch = pathname.match(/^\/projects\/([^/]+)$/);
  if (dashboardMatch) {
    return { page: "dashboard", workspaceId: decodeURIComponent(dashboardMatch[1]) };
  }

  return { page: "projects" };
}

function navigateTo(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [queue, setQueue] = useState<SubmissionRequest[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceCompany, setNewWorkspaceCompany] = useState("");
  const [newWorkspaceWebsite, setNewWorkspaceWebsite] = useState("");
  const [driveLink, setDriveLink] = useState("");

  const [selectedFirmId, setSelectedFirmId] = useState<string>();
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [focusFilter, setFocusFilter] = useState<string>("all");

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const [workspaceResponse, nextOverview, nextFirms, nextProfile, nextQueue, nextImports] = await Promise.all([
        getWorkspaces(),
        getOverview(),
        getFirms(),
        getProfile(),
        getSubmissionQueue(),
        getImportBatches()
      ]);

      setWorkspaces(workspaceResponse.workspaces);
      setActiveWorkspaceId(workspaceResponse.activeWorkspaceId);
      setOverview(nextOverview);
      setFirms(nextFirms);
      setProfile(nextProfile);
      setQueue(nextQueue);
      setImportBatches(nextImports);
      if (!selectedFirmId && nextFirms.length > 0) {
        setSelectedFirmId(nextFirms[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app data");
    } finally {
      setLoading(false);
    }
  }, [selectedFirmId]);

  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    if (window.location.pathname === "/") {
      navigateTo("/projects");
    }
    void refresh();
    return () => window.removeEventListener("popstate", onPop);
  }, [refresh]);

  useEffect(() => {
    if (route.page === "dashboard" || route.page === "knowledge") {
      if (activeWorkspaceId && activeWorkspaceId !== route.workspaceId) {
        void (async () => {
          try {
            await activateWorkspace(route.workspaceId);
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to activate project");
          }
        })();
      }
    }
  }, [route, activeWorkspaceId, refresh]);

  const onCreateWorkspace = useCallback(async () => {
    if (newWorkspaceName.trim().length < 2) return;
    try {
      const created = await createWorkspace({
        name: newWorkspaceName.trim(),
        company: newWorkspaceCompany.trim() || undefined,
        website: newWorkspaceWebsite.trim() || undefined
      });
      setNewWorkspaceName("");
      setNewWorkspaceCompany("");
      setNewWorkspaceWebsite("");
      await refresh();
      navigateTo(`/projects/${created.id}/knowledge-base`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    }
  }, [newWorkspaceName, newWorkspaceCompany, newWorkspaceWebsite, refresh]);

  const onOpenProject = useCallback(
    async (workspaceId: string) => {
      try {
        await activateWorkspace(workspaceId);
        await refresh();
        navigateTo(`/projects/${workspaceId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open project");
      }
    },
    [refresh]
  );

  const onUploadFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const base64Data = await fileToBase64(file);
        await importFirmsFile({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64Data
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "File import failed");
      } finally {
        event.target.value = "";
      }
    },
    [refresh]
  );

  const onImportDrive = useCallback(async () => {
    if (!driveLink.trim()) return;
    try {
      await importFirmsFromDrive(driveLink.trim());
      setDriveLink("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Drive import failed");
    }
  }, [driveLink, refresh]);

  const onApproveRequest = useCallback(
    async (requestId: string) => {
      setBusyActionId(requestId);
      try {
        await approveSubmission(requestId, "Operator");
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
      try {
        await rejectSubmission(requestId, "Operator", "Rejected by operator");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reject submission");
      } finally {
        setBusyActionId(undefined);
      }
    },
    [refresh]
  );

  const onSaveKnowledgeBase = useCallback(async () => {
    if (!activeWorkspaceId || !profile) return;
    setSavingProfile(true);
    try {
      await updateWorkspaceProfile(activeWorkspaceId, profile);
      await refresh();
      navigateTo(`/projects/${activeWorkspaceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save knowledge base");
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
  const completedImports = useMemo(
    () => importBatches.filter((batch) => batch.status === "completed"),
    [importBatches]
  );
  const failedImports = useMemo(
    () => importBatches.filter((batch) => batch.status === "failed"),
    [importBatches]
  );

  if (loading && workspaces.length === 0) {
    return <div className="app-shell">Loading...</div>;
  }

  const renderProjectsPage = (): JSX.Element => (
    <div className="app-shell">
      <header className="header">
        <div>
          <h1 className="title">Projects</h1>
          <div className="subtitle">Select a fundraising project to open its dashboard.</div>
        </div>
      </header>

      {error ? (
        <div className="card card-pad" style={{ marginBottom: 12, borderColor: "#ffd3d3", background: "#fff2f2", color: "#8d2929" }}>
          {error}
        </div>
      ) : null}

      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Create Project</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <input className="input" placeholder="Project name" value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} />
          <input className="input" placeholder="Company name" value={newWorkspaceCompany} onChange={(event) => setNewWorkspaceCompany(event.target.value)} />
          <input className="input" placeholder="Company website" value={newWorkspaceWebsite} onChange={(event) => setNewWorkspaceWebsite(event.target.value)} />
          <button className="button" onClick={() => void onCreateWorkspace()}>Create</button>
        </div>
      </section>

      <section className="card card-pad">
        <h3 className="card-title">Existing Projects</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Company</th>
                <th>Updated</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td>{workspace.name}</td>
                  <td>{workspace.profile.company}</td>
                  <td>{dayjs(workspace.updatedAt).format("MMM D, YYYY HH:mm")}</td>
                  <td>
                    <button className="button secondary" onClick={() => void onOpenProject(workspace.id)}>
                      Open Dashboard
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderKnowledgeBasePage = (): JSX.Element => {
    if (!profile || !activeWorkspaceId) {
      return <div className="app-shell">Loading project knowledge base...</div>;
    }

    return (
      <div className="app-shell">
        <header className="header">
          <div>
            <h1 className="title">Company Knowledge Base</h1>
            <div className="subtitle">Fill core company and fundraising information used by background agents.</div>
          </div>
          <div className="badges">
            <button className="button secondary" onClick={() => navigateTo("/projects")}>Projects</button>
            <button className="button secondary" onClick={() => navigateTo(`/projects/${activeWorkspaceId}`)}>Back Dashboard</button>
          </div>
        </header>

        <section className="card card-pad">
          <h3 className="card-title">Company & Contact</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 8 }}>
            <input className="input" value={profile.company} onChange={(event) => setProfile({ ...profile, company: event.target.value })} placeholder="Company" />
            <input className="input" value={profile.website} onChange={(event) => setProfile({ ...profile, website: event.target.value })} placeholder="Website" />
            <input className="input" value={profile.senderName} onChange={(event) => setProfile({ ...profile, senderName: event.target.value })} placeholder="Contact Name" />
            <input className="input" value={profile.senderTitle} onChange={(event) => setProfile({ ...profile, senderTitle: event.target.value })} placeholder="Contact Title" />
            <input className="input" value={profile.senderEmail} onChange={(event) => setProfile({ ...profile, senderEmail: event.target.value })} placeholder="Contact Email" />
            <input className="input" value={profile.senderPhone} onChange={(event) => setProfile({ ...profile, senderPhone: event.target.value })} placeholder="Contact Phone" />
            <input className="input" value={profile.linkedin} onChange={(event) => setProfile({ ...profile, linkedin: event.target.value })} placeholder="LinkedIn" />
            <input className="input" value={profile.calendly} onChange={(event) => setProfile({ ...profile, calendly: event.target.value })} placeholder="Calendly" />
            <input className="input" value={profile.fundraising.deckUrl} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, deckUrl: event.target.value } })} placeholder="Deck URL" />
            <input className="input" value={profile.fundraising.dataRoomUrl} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, dataRoomUrl: event.target.value } })} placeholder="Data Room URL" />
          </div>

          <h3 className="card-title">Fundraising</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 8 }}>
            <input className="input" value={profile.fundraising.round} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, round: event.target.value } })} placeholder="Round" />
            <input className="input" value={profile.fundraising.amount} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, amount: event.target.value } })} placeholder="Amount" />
            <input className="input" value={profile.fundraising.valuation} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, valuation: event.target.value } })} placeholder="Valuation" />
            <input className="input" value={profile.fundraising.instrument} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, instrument: event.target.value } })} placeholder="Instrument" />
            <input className="input" value={profile.fundraising.secured} onChange={(event) => setProfile({ ...profile, fundraising: { ...profile.fundraising, secured: event.target.value } })} placeholder="Amount secured" />
          </div>

          <h3 className="card-title">Business Metrics</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 8 }}>
            <input className="input" value={profile.metrics.arr} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, arr: event.target.value } })} placeholder="ARR" />
            <input className="input" value={profile.metrics.mrr} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, mrr: event.target.value } })} placeholder="MRR" />
            <input className="input" value={profile.metrics.subscribers} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, subscribers: event.target.value } })} placeholder="Customers/Subscribers" />
            <input className="input" value={profile.metrics.countries} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, countries: event.target.value } })} placeholder="Countries" />
            <input className="input" value={profile.metrics.ltvCac} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, ltvCac: event.target.value } })} placeholder="LTV/CAC" />
            <input className="input" value={profile.metrics.churn} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, churn: event.target.value } })} placeholder="Churn" />
            <input className="input" value={profile.metrics.cumulativeRevenue} onChange={(event) => setProfile({ ...profile, metrics: { ...profile.metrics, cumulativeRevenue: event.target.value } })} placeholder="Cumulative Revenue" />
          </div>

          <textarea className="input" rows={3} value={profile.oneLiner} onChange={(event) => setProfile({ ...profile, oneLiner: event.target.value })} placeholder="One-liner" style={{ marginBottom: 8 }} />
          <textarea className="input" rows={5} value={profile.longDescription} onChange={(event) => setProfile({ ...profile, longDescription: event.target.value })} placeholder="Long description" />

          <div style={{ marginTop: 12 }}>
            <button className="button" disabled={savingProfile} onClick={() => void onSaveKnowledgeBase()}>
              {savingProfile ? "Saving..." : "Save Knowledge Base"}
            </button>
          </div>
        </section>
      </div>
    );
  };

  const renderDashboardPage = (): JSX.Element => {
    if (!overview || !profile || !activeWorkspaceId) {
      return <div className="app-shell">Loading dashboard...</div>;
    }

    return (
      <div className="app-shell">
        <header className="header">
          <div>
            <h1 className="title">{overview.workspace.name}</h1>
            <div className="subtitle">Investor form operations dashboard</div>
          </div>
          <div className="badges">
            <button className="button secondary" onClick={() => navigateTo("/projects")}>Projects</button>
            <button className="button secondary" onClick={() => navigateTo(`/projects/${activeWorkspaceId}/knowledge-base`)}>
              Company Knowledge Base
            </button>
            <button className="button secondary" onClick={() => void refresh()}>Refresh</button>
          </div>
        </header>

        {error ? (
          <div className="card card-pad" style={{ marginBottom: 12, borderColor: "#ffd3d3", background: "#fff2f2", color: "#8d2929" }}>
            {error}
          </div>
        ) : null}

        <section className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Import Investors</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <label className="button secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span>Upload CSV/XLSX</span>
              <span style={{ fontSize: 16 }}>⬆</span>
              <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={onUploadFile} />
            </label>
            <input className="input" placeholder="Google Drive share link" value={driveLink} onChange={(event) => setDriveLink(event.target.value)} />
            <button className="button secondary" onClick={() => void onImportDrive()}>Import Drive</button>
          </div>

          <div style={{ fontSize: 12, color: "#5f7288", marginBottom: 8 }}>Completed import lists</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {completedImports.slice(0, 12).map((batch) => (
              <button key={batch.id} className="button secondary" title={batch.sourceName} style={{ fontSize: 12 }}>
                {batch.sourceName.length > 32 ? `${batch.sourceName.slice(0, 32)}...` : batch.sourceName} ({batch.importedCount})
              </button>
            ))}
            {completedImports.length === 0 ? <div style={{ color: "#5f7288" }}>No completed imports yet.</div> : null}
          </div>

          {failedImports.length > 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "#8d2929" }}>
              Failed imports: {failedImports.slice(0, 3).map((batch) => batch.sourceName).join(" | ")}
            </div>
          ) : null}
        </section>

        <section className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Project Operations</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div className="meta-item">
              <div className="k">Investors</div>
              <div className="v">{overview.kpis.targetsTotal}</div>
            </div>
            <div className="meta-item">
              <div className="k">Pending Approvals</div>
              <div className="v">{overview.pendingApprovals}</div>
            </div>
            <div className="meta-item">
              <div className="k">Submitted</div>
              <div className="v">{overview.kpis.submitted}</div>
            </div>
          </div>
        </section>

        <section className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Submission Queue ({overview.pendingApprovals} pending approval)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Investor</th>
                  <th>Status</th>
                  <th>Prepared</th>
                  <th>Mode</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.slice(0, 30).map((item) => (
                  <tr key={item.id}>
                    <td>{item.firmName}</td>
                    <td><span className={`status-pill ${item.status}`}>{item.status.replaceAll("_", " ")}</span></td>
                    <td>{dayjs(item.preparedAt).format("MMM D, YYYY HH:mm")}</td>
                    <td>{item.mode}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="button secondary" disabled={busyActionId === item.id || item.status !== "pending_approval"} onClick={() => void onApproveRequest(item.id)}>
                        Approve
                      </button>
                      <button className="button secondary" disabled={busyActionId === item.id || item.status !== "pending_approval"} onClick={() => void onRejectRequest(item.id)}>
                        Reject
                      </button>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 8 }}>
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

          <section className="card card-pad">
            <h3 className="card-title">Selected Investor</h3>
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
      </div>
    );
  };

  if (route.page === "projects") {
    return renderProjectsPage();
  }

  if (route.page === "knowledge") {
    return renderKnowledgeBasePage();
  }

  return renderDashboardPage();
}

export default App;
