export type PipelineStage =
  | "lead"
  | "researching"
  | "qualified"
  | "form_discovered"
  | "form_filled"
  | "submitted"
  | "review"
  | "won"
  | "lost";

export type AgentTaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type SubmissionChannel = "website_form";

export type SubmissionStatus =
  | "queued"
  | "form_discovered"
  | "form_filled"
  | "submitted"
  | "no_form_found"
  | "blocked"
  | "needs_review"
  | "errored";

export type RunStatus = "running" | "completed" | "failed";

export interface FirmContact {
  id: string;
  name: string;
  title: string;
  email?: string;
  linkedin?: string;
}

export interface SubmissionEvent {
  id: string;
  firmId: string;
  firmName: string;
  channel: SubmissionChannel;
  status: SubmissionStatus;
  attemptedAt: string;
  discoveredAt?: string;
  filledAt?: string;
  submittedAt?: string;
  blockedReason?: string;
  note?: string;
}

export interface Firm {
  id: string;
  name: string;
  website: string;
  geography: string;
  investorType: "VC" | "Angel Network" | "Syndicate" | "Other";
  checkSizeRange: string;
  focusSectors: string[];
  stageFocus: string[];
  stage: PipelineStage;
  score: number;
  statusReason: string;
  lastTouchedAt?: string;
  contacts: FirmContact[];
  notes: string[];
}

export interface AgentTaskResult {
  id: string;
  runId: string;
  firmId: string;
  firmName: string;
  agent: string;
  status: AgentTaskStatus;
  startedAt: string;
  endedAt?: string;
  confidence: number;
  summary: string;
  output: Record<string, unknown>;
}

export interface RunLog {
  id: string;
  runId: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  firmId?: string;
}

export interface CampaignRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  initiatedBy: string;
  status: RunStatus;
  mode: "dry_run" | "production";
  totalFirms: number;
  processedFirms: number;
  successCount: number;
  failedCount: number;
  taskIds: string[];
  logIds: string[];
}

export interface WaskCompanyProfile {
  company: string;
  website: string;
  oneLiner: string;
  longDescription: string;
  senderName: string;
  senderTitle: string;
  senderEmail: string;
  senderPhone: string;
  linkedin: string;
  calendly: string;
  metrics: {
    arr: string;
    mrr: string;
    subscribers: string;
    countries: string;
    ltvCac: string;
    churn: string;
    cumulativeRevenue: string;
  };
  fundraising: {
    round: string;
    amount: string;
    valuation: string;
    secured: string;
    instrument: string;
    deckUrl: string;
    dataRoomUrl: string;
  };
}

export interface AppState {
  profile: WaskCompanyProfile;
  firms: Firm[];
  submissionEvents: SubmissionEvent[];
  tasks: AgentTaskResult[];
  runs: CampaignRun[];
  logs: RunLog[];
}

export interface OverviewResponse {
  kpis: {
    targetsTotal: number;
    attempts: number;
    formsDiscovered: number;
    formsFilled: number;
    submitted: number;
    blocked: number;
    noFormFound: number;
    completionRate: number;
  };
  stageBreakdown: Array<{ stage: PipelineStage; count: number }>;
  weeklyTrend: Array<{
    weekLabel: string;
    attempts: number;
    discovered: number;
    filled: number;
    submitted: number;
    blocked: number;
    noFormFound: number;
  }>;
  recentActivities: SubmissionEvent[];
  activeRuns: CampaignRun[];
}
