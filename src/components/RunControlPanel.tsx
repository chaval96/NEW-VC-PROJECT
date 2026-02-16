import dayjs from "dayjs";
import { useMemo, useState } from "react";
import type { CampaignRun, Firm, Playbook, Profile, RunDetail } from "../types";

interface RunControlPanelProps {
  profile?: Profile;
  playbook?: Playbook;
  firms: Firm[];
  runs: CampaignRun[];
  runDetail?: RunDetail;
  creatingRun: boolean;
  onCreateRun: (payload: { mode: "dry_run" | "production"; initiatedBy: string; firmIds?: string[] }) => Promise<void>;
  onOpenRun: (runId: string) => Promise<void>;
}

export function RunControlPanel({
  profile,
  playbook,
  firms,
  runs,
  runDetail,
  creatingRun,
  onCreateRun,
  onOpenRun
}: RunControlPanelProps): JSX.Element {
  const [mode, setMode] = useState<"dry_run" | "production">("dry_run");
  const [scope, setScope] = useState<"all" | "qualified">("qualified");
  const [operator, setOperator] = useState("Utku Bozkurt");

  const qualifiedIds = useMemo(
    () => firms.filter((firm) => firm.stage === "qualified" || firm.score >= 62).map((firm) => firm.id),
    [firms]
  );

  const submitRun = async (): Promise<void> => {
    await onCreateRun({
      mode,
      initiatedBy: operator,
      firmIds: scope === "qualified" ? qualifiedIds : undefined
    });
  };

  const latestRuns = runs.slice(0, 4);

  return (
    <div className="panel-list">
      <div className="card card-pad">
        <h3 className="card-title">Agent Orchestrator</h3>
        <div className="form-row">
          <label style={{ minWidth: 74, color: "#5f7288", fontSize: 13 }}>Operator</label>
          <input className="input" value={operator} onChange={(event) => setOperator(event.target.value)} />
        </div>
        <div className="form-row">
          <label style={{ minWidth: 74, color: "#5f7288", fontSize: 13 }}>Mode</label>
          <select className="select" value={mode} onChange={(event) => setMode(event.target.value as "dry_run" | "production")}>
            <option value="dry_run">Dry Run (recommended)</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div className="form-row">
          <label style={{ minWidth: 74, color: "#5f7288", fontSize: 13 }}>Scope</label>
          <select className="select" value={scope} onChange={(event) => setScope(event.target.value as "all" | "qualified") }>
            <option value="qualified">Qualified / High-score firms</option>
            <option value="all">All firms</option>
          </select>
        </div>
        <button className="button" disabled={creatingRun || operator.trim().length === 0} onClick={submitRun}>
          {creatingRun ? "Running agents..." : "Start Orchestration Run"}
        </button>
        <div style={{ marginTop: 12, color: "#5f7288", fontSize: 12 }}>
          Workflow: FormDiscovery -&gt; Qualification -&gt; FormMapping -&gt; QA -&gt; Submission -&gt; Tracking
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="card-title">Prompt Playbook</h3>
        {playbook ? (
          <>
            <div style={{ fontSize: 12, color: "#5f7288", marginBottom: 8 }}>
              Internal prompts synced from your VC outreach control panel.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="button secondary" onClick={() => void navigator.clipboard.writeText(playbook.systemPrompt)}>
                Copy System Prompt
              </button>
              <button className="button secondary" onClick={() => void navigator.clipboard.writeText(playbook.batchOne)}>
                Copy Batch 1
              </button>
            </div>
            <textarea className="input" rows={7} readOnly value={playbook.systemPrompt} style={{ resize: "vertical", marginBottom: 8 }} />
            <textarea className="input" rows={6} readOnly value={playbook.batchOne} style={{ resize: "vertical" }} />
          </>
        ) : (
          <div style={{ color: "#5f7288", fontSize: 13 }}>Loading playbook...</div>
        )}
      </div>

      <div className="card card-pad">
        <h3 className="card-title">Active Company Snapshot</h3>
        {profile ? (
          <div className="meta-grid">
            <div className="meta-item"><div className="k">Company</div><div className="v">{profile.company}</div></div>
            <div className="meta-item"><div className="k">Round</div><div className="v">{profile.fundraising.round}</div></div>
            <div className="meta-item"><div className="k">Raise</div><div className="v">{profile.fundraising.amount}</div></div>
            <div className="meta-item"><div className="k">ARR</div><div className="v">{profile.metrics.arr}</div></div>
            <div className="meta-item"><div className="k">Deck</div><div className="v" style={{ fontSize: 11, wordBreak: "break-all" }}>{profile.fundraising.deckUrl}</div></div>
            <div className="meta-item"><div className="k">Sender</div><div className="v">{profile.senderName}</div></div>
          </div>
        ) : (
          <div style={{ color: "#5f7288", fontSize: 13 }}>Loading profile...</div>
        )}
      </div>

      <div className="card card-pad">
        <h3 className="card-title">Recent Runs</h3>
        <div className="panel-list">
          {latestRuns.length === 0 ? <div style={{ color: "#5f7288", fontSize: 13 }}>No runs yet</div> : null}
          {latestRuns.map((run) => (
            <div key={run.id} className="run-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#5f7288" }}>{dayjs(run.startedAt).format("MMM D, YYYY HH:mm")}</div>
                  <div className={`run-status ${run.status}`}>{run.status}</div>
                </div>
                <button className="button secondary" onClick={() => onOpenRun(run.id)}>Inspect</button>
              </div>
              <div style={{ fontSize: 12, color: "#5f7288", marginTop: 8 }}>
                {run.mode} | processed {run.processedFirms}/{run.totalFirms} | success {run.successCount}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="card-title">Run Log Preview</h3>
        {!runDetail ? (
          <div style={{ color: "#5f7288", fontSize: 13 }}>Select a run to inspect task logs.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 280 }}>
            <table>
              <thead>
                <tr><th>Time</th><th>Level</th><th>Message</th></tr>
              </thead>
              <tbody>
                {runDetail.logs.slice(0, 20).map((log) => (
                  <tr key={log.id}><td>{dayjs(log.timestamp).format("HH:mm:ss")}</td><td>{log.level}</td><td>{log.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
