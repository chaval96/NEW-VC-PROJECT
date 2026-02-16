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

export type SubmissionRequestStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

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
  workspaceId: string;
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

export interface SubmissionRequest {
  id: string;
  workspaceId: string;
  firmId: string;
  firmName: string;
  website: string;
  preparedAt: string;
  preparedPayload: {
    contactName: string;
    contactTitle: string;
    contactEmail: string;
    contactPhone: string;
    linkedin: string;
    calendly: string;
    companyName: string;
    companyWebsite: string;
    companySummary: string;
    raiseSummary: string;
    deckUrl: string;
    dataRoomUrl: string;
  };
  formUrlCandidate?: string;
  status: SubmissionRequestStatus;
  mode: "dry_run" | "production";
  approvedBy?: string;
  approvedAt?: string;
  executedAt?: string;
  resultNote?: string;
}

export interface Firm {
  id: string;
  workspaceId: string;
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
  workspaceId: string;
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
  workspaceId: string;
  runId: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  firmId?: string;
}

export interface CampaignRun {
  id: string;
  workspaceId: string;
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

export interface CompanyProfile {
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

export interface Workspace {
  id: string;
  name: string;
  profile: CompanyProfile;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  firms: Firm[];
  submissionEvents: SubmissionEvent[];
  submissionRequests: SubmissionRequest[];
  tasks: AgentTaskResult[];
  runs: CampaignRun[];
  logs: RunLog[];
}

export interface OverviewResponse {
  workspace: {
    id: string;
    name: string;
  };
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
  pendingApprovals: number;
}
