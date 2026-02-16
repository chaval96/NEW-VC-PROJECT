import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRun, getFirms, getOverview, getPlaybook, getProfile, getRunDetail, getRuns } from "./api";
import { ActivityTable } from "./components/ActivityTable";
import { FirmPipelineTable } from "./components/FirmPipelineTable";
import { PerformanceFunnel } from "./components/PerformanceFunnel";
import { RunControlPanel } from "./components/RunControlPanel";
import { WeeklyTrend } from "./components/WeeklyTrend";
import type { Firm, OverviewResponse, Playbook, Profile, RunDetail } from "./types";

function App(): JSX.Element {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [playbook, setPlaybook] = useState<Playbook>();
  const [runs, setRuns] = useState<RunDetail["run"][]>([]);
  const [selectedRun, setSelectedRun] = useState<RunDetail>();
  const [selectedFirmId, setSelectedFirmId] = useState<string>();
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [focusFilter, setFocusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [creatingRun, setCreatingRun] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const [nextOverview, nextFirms, nextProfile, nextRuns, nextPlaybook] = await Promise.all([
        getOverview(),
        getFirms(),
        getProfile(),
        getRuns(),
        getPlaybook()
      ]);
      setOverview(nextOverview);
      setFirms(nextFirms);
      setProfile(nextProfile);
      setRuns(nextRuns);
      setPlaybook(nextPlaybook);
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
      setCreatingRun(true);
      setError(undefined);
      try {
        const run = await createRun(payload);
        await refresh();
        setSelectedRun(await getRunDetail(run.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create run");
      } finally {
        setCreatingRun(false);
      }
    },
    [refresh]
  );

  const onOpenRun = useCallback(async (runId: string) => {
    setError(undefined);
    try {
      setSelectedRun(await getRunDetail(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run details");
    }
  }, []);

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
  if (!overview) return <div className="app-shell">Dashboard unavailable: {error ?? "unknown error"}</div>;

  return (
    <div className="app-shell">
      <header className="header">
        <div>
          <h1 className="title">Welcome, Utku</h1>
          <div className="subtitle">WASK Internal VC Form Submission Control Panel</div>
        </div>
        <div className="badges">
          <div className="badge">Pipeline: VC-FormOps</div>
          <button className="button secondary" onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {error ? (
        <div className="card card-pad" style={{ marginBottom: 12, borderColor: "#ffd3d3", background: "#fff2f2", color: "#8d2929" }}>
          {error}
        </div>
      ) : null}

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
