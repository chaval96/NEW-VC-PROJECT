// ── Pipeline & Status Types ──────────────────────────────────────────
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
  | "pending_retry"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

export type RunStatus = "running" | "completed" | "failed";

// ── Core Domain Models ──────────────────────────────────────────────
export interface FirmContact {
  id: string;
  name: string;
  title: string;
  email?: string;
  linkedin?: string;
}

export interface Firm {
  id: string;
  workspaceId: string;
  importBatchId?: string;
  sourceListName?: string;
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
  matchScore?: number;
  matchReasoning?: string;
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
  executionAttempts?: number;
  maxExecutionAttempts?: number;
  lastExecutionStartedAt?: string;
  lastExecutionEndedAt?: string;
  lastExecutionStatus?: SubmissionStatus;
  nextRetryAt?: string;
  resultNote?: string;
}

export interface ImportBatch {
  id: string;
  workspaceId: string;
  sourceName: string;
  sourceType: "csv" | "excel" | "google_drive";
  importedCount: number;
  importedAt: string;
  status: "completed" | "failed";
  note?: string;
  runId?: string;
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

// ── Company Profile ─────────────────────────────────────────────────
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

/** Frontend-facing alias kept for backward compat */
export type Profile = CompanyProfile;

// ── Workspace ───────────────────────────────────────────────────────
export interface Workspace {
  id: string;
  name: string;
  profile: CompanyProfile;
  createdAt: string;
  updatedAt: string;
}

// ── Credit System ───────────────────────────────────────────────────
export interface CreditBalance {
  available: number;
  totalPurchased: number;
  totalUsed: number;
}

export interface CreditTransaction {
  id: string;
  workspaceId: string;
  type: "purchase" | "usage" | "refund";
  amount: number;
  description: string;
  createdAt: string;
}

export interface CreditPackage {
  credits: number;
  priceUsd: number;
}

export const CREDIT_PRICING: CreditPackage = {
  credits: 100,
  priceUsd: 19,
};

// ── AI Assessment ───────────────────────────────────────────────────
export interface InvestorMatch {
  firmId: string;
  firmName: string;
  score: number;
  reasoning: string;
  highlights: string[];
  concerns: string[];
}

export interface AssessmentResult {
  id: string;
  workspaceId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  matches: InvestorMatch[];
  totalFirmsAnalyzed: number;
  error?: string;
}

// ── App State ───────────────────────────────────────────────────────
export interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  firms: Firm[];
  submissionEvents: SubmissionEvent[];
  submissionRequests: SubmissionRequest[];
  importBatches: ImportBatch[];
  tasks: AgentTaskResult[];
  runs: CampaignRun[];
  logs: RunLog[];
  creditTransactions: CreditTransaction[];
  assessments: AssessmentResult[];
}

// ── Response Types ──────────────────────────────────────────────────
export interface WorkspacesResponse {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}

export interface OverviewResponse {
  workspace: { id: string; name: string };
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
  ops: OpsSnapshot;
  creditBalance: CreditBalance;
}

export interface RunDetail {
  run: CampaignRun;
  tasks: AgentTaskResult[];
  logs: RunLog[];
}

export interface FirmDetail {
  firm: Firm;
  events: SubmissionEvent[];
  submissionRequests: SubmissionRequest[];
  logs: RunLog[];
}

export interface SubmissionDetail {
  request: SubmissionRequest;
  firm?: Firm;
  events: SubmissionEvent[];
}

export interface WorkspaceReadiness {
  workspaceId: string;
  ready: boolean;
  missingFields: string[];
  investorCount: number;
}

export interface OpsAlert {
  id: string;
  severity: "warning" | "critical";
  source: "run" | "submission";
  createdAt: string;
  message: string;
  entityId: string;
}

export interface OpsSnapshot {
  staleRuns: number;
  staleExecutions: number;
  pendingRetries: number;
  failedExecutions24h: number;
  failedTasks24h: number;
  alerts: OpsAlert[];
}

export interface Playbook {
  systemPrompt: string;
  batchOne: string;
}
