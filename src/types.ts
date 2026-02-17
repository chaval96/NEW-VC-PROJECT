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
}

export interface AuthLoginResponse {
  token: string;
  user: AuthUser;
}
