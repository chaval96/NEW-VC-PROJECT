export type {
  CampaignRun,
  CompanyProfile,
  Firm,
  ImportBatch,
  OverviewResponse,
  PipelineStage,
  Profile,
  SubmissionEvent,
  SubmissionRequest,
  SubmissionRequestStatus,
  Workspace,
  WorkspacesResponse
} from "@shared/types";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "owner";
  emailVerified: boolean;
}

export interface AuthLoginResponse {
  token: string;
  user: AuthUser;
}

export interface AuthSignupResponse {
  message: string;
  verificationEmailSent: boolean;
  verificationUrl?: string;
}

export interface AuthResendVerificationResponse {
  ok: true;
  message: string;
  verificationEmailSent: boolean;
  verificationUrl?: string;
}
