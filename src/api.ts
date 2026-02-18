import type {
  AuthForgotPasswordResponse,
  AuthLoginResponse,
  AuthResendVerificationResponse,
  AuthSignupResponse,
  AuthUser,
  CampaignRun,
  Firm,
  FirmDetail,
  ImportBatch,
  LeadListSummary,
  OverviewResponse,
  Profile,
  RunDetail,
  SubmissionDetail,
  SubmissionRequest,
  WorkspaceReadiness,
  Workspace,
  WorkspacesResponse
} from "./types";

const AUTH_TOKEN_KEY = "vcops_auth_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function withWorkspace(path: string, workspaceId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function apiBlob(path: string, init?: RequestInit): Promise<{ blob: Blob; fileName: string }> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const fileMatch = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = fileMatch?.[1] ?? "export.csv";
  return { blob: await response.blob(), fileName };
}

export function triggerCsvDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function signup(payload: { name: string; email: string; password: string }): Promise<AuthSignupResponse> {
  return api<AuthSignupResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function verifyEmail(token: string): Promise<{ ok: true; user: AuthUser }> {
  return api<{ ok: true; user: AuthUser }>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export function resendVerification(email: string): Promise<AuthResendVerificationResponse> {
  return api<AuthResendVerificationResponse>("/api/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function forgotPassword(email: string): Promise<AuthForgotPasswordResponse> {
  return api<AuthForgotPasswordResponse>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function resetPassword(token: string, password: string): Promise<{ ok: true; message: string }> {
  return api<{ ok: true; message: string }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}

export function login(email: string, password: string): Promise<AuthLoginResponse> {
  return api<AuthLoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function getMe(): Promise<{ user: AuthUser }> {
  return api<{ user: AuthUser }>("/api/auth/me");
}

export function updateMyProfile(payload: { name: string }): Promise<{ user: AuthUser }> {
  return api<{ user: AuthUser }>("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function changeMyPassword(payload: { currentPassword: string; newPassword: string }): Promise<{ ok: true; message: string }> {
  return api<{ ok: true; message: string }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logout(): Promise<{ ok: true }> {
  return api<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function getWorkspaces(): Promise<WorkspacesResponse> {
  return api<WorkspacesResponse>("/api/workspaces");
}

export function createWorkspace(payload: { name: string; company?: string; website?: string }): Promise<Workspace> {
  return api<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function activateWorkspace(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/workspaces/${id}/activate`, { method: "POST" });
}

export function updateWorkspaceProfile(id: string, payload: Partial<Profile>): Promise<Workspace> {
  return api<Workspace>(`/api/workspaces/${id}/profile`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function getWorkspaceReadiness(workspaceId: string): Promise<WorkspaceReadiness> {
  return api<WorkspaceReadiness>(`/api/workspaces/${workspaceId}/readiness`);
}

export function getOverview(workspaceId: string): Promise<OverviewResponse> {
  return api<OverviewResponse>(withWorkspace("/api/dashboard/overview", workspaceId));
}

export async function getFirms(workspaceId: string): Promise<Firm[]> {
  const pageSize = 200;
  let page = 1;
  let total = 0;
  const firms: Firm[] = [];

  do {
    const result = await api<Firm[] | { firms: Firm[]; total: number }>(
      withWorkspace(`/api/firms?page=${page}&limit=${pageSize}`, workspaceId)
    );
    if (Array.isArray(result)) {
      return result;
    }
    firms.push(...result.firms);
    total = result.total;
    page += 1;
  } while (firms.length < total);

  return firms;
}

export function getProfile(workspaceId: string): Promise<Profile> {
  return api<Profile>(withWorkspace("/api/profile", workspaceId));
}

export function getImportBatches(workspaceId: string): Promise<ImportBatch[]> {
  return api<ImportBatch[]>(withWorkspace("/api/imports", workspaceId));
}

export function getLeadLists(workspaceId: string): Promise<LeadListSummary[]> {
  return api<LeadListSummary[]>(withWorkspace("/api/lists", workspaceId));
}

export function renameLeadList(
  workspaceId: string,
  currentName: string,
  nextName: string
): Promise<{ ok: true; updatedLeads: number; updatedBatches: number; lists: LeadListSummary[] }> {
  return api<{ ok: true; updatedLeads: number; updatedBatches: number; lists: LeadListSummary[] }>(
    withWorkspace("/api/lists/rename", workspaceId),
    {
      method: "POST",
      body: JSON.stringify({ currentName, nextName })
    }
  );
}

export function deleteLeadList(
  workspaceId: string,
  name: string,
  deleteLeads = false
): Promise<{ ok: true; removedLeads: number; unassignedLeads: number; removedBatches: number; lists: LeadListSummary[] }> {
  return api<{ ok: true; removedLeads: number; unassignedLeads: number; removedBatches: number; lists: LeadListSummary[] }>(
    withWorkspace("/api/lists/delete", workspaceId),
    {
      method: "POST",
      body: JSON.stringify({ name, deleteLeads })
    }
  );
}

export function importFirmsFile(payload: {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
  listName?: string;
}): Promise<{
  imported: number;
  sourceType: string;
  runId?: string;
  listName?: string;
  batchId?: string;
  skippedDuplicates?: number;
  totalParsed?: number;
}> {
  const { workspaceId, ...rest } = payload;
  return api<{
    imported: number;
    sourceType: string;
    runId?: string;
    listName?: string;
    batchId?: string;
    skippedDuplicates?: number;
    totalParsed?: number;
  }>(
    withWorkspace("/api/firms/import-file", workspaceId),
    {
      method: "POST",
      body: JSON.stringify(rest)
    }
  );
}

export function importFirmsFromDrive(
  workspaceId: string,
  link: string,
  listName?: string
): Promise<{
  imported: number;
  sourceType: string;
  runId?: string;
  listName?: string;
  batchId?: string;
  skippedDuplicates?: number;
  totalParsed?: number;
}> {
  return api<{
    imported: number;
    sourceType: string;
    runId?: string;
    listName?: string;
    batchId?: string;
    skippedDuplicates?: number;
    totalParsed?: number;
  }>(
    withWorkspace("/api/firms/import-drive", workspaceId),
    {
      method: "POST",
      body: JSON.stringify({ link, listName })
    }
  );
}

export function getSubmissionQueue(workspaceId: string): Promise<SubmissionRequest[]> {
  return api<SubmissionRequest[]>(withWorkspace("/api/submissions/queue", workspaceId));
}

export function getFirmDetail(workspaceId: string, firmId: string): Promise<FirmDetail> {
  return api<FirmDetail>(withWorkspace(`/api/firms/${firmId}`, workspaceId));
}

export function runLeadResearch(workspaceId: string, firmId: string): Promise<{ ok: true; firm: Firm }> {
  return api<{ ok: true; firm: Firm }>(withWorkspace(`/api/firms/${firmId}/research`, workspaceId), {
    method: "POST"
  });
}

export function queueResearchRun(
  workspaceId: string,
  payload: {
    firmIds?: string[];
    listNames?: string[];
    limit?: number;
  }
): Promise<{ ok: true; queued: number }> {
  return api<{ ok: true; queued: number }>(withWorkspace("/api/research/run", workspaceId), {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getSubmissionDetail(workspaceId: string, requestId: string): Promise<SubmissionDetail> {
  return api<SubmissionDetail>(withWorkspace(`/api/submissions/${requestId}`, workspaceId));
}

export function approveSubmission(workspaceId: string, requestId: string, approvedBy: string): Promise<{ request: SubmissionRequest }> {
  return api<{ request: SubmissionRequest }>(withWorkspace(`/api/submissions/${requestId}/approve`, workspaceId), {
    method: "POST",
    body: JSON.stringify({ approvedBy })
  });
}

export function rejectSubmission(workspaceId: string, requestId: string, rejectedBy: string, reason: string): Promise<SubmissionRequest> {
  return api<SubmissionRequest>(withWorkspace(`/api/submissions/${requestId}/reject`, workspaceId), {
    method: "POST",
    body: JSON.stringify({ rejectedBy, reason })
  });
}

export function bulkApproveSubmissions(
  workspaceId: string,
  requestIds: string[],
  approvedBy: string
): Promise<{ processed: number; approved: number; failed: Array<{ id: string; message: string }> }> {
  return api<{ processed: number; approved: number; failed: Array<{ id: string; message: string }> }>(
    withWorkspace("/api/submissions/actions/bulk-approve", workspaceId),
    {
      method: "POST",
      body: JSON.stringify({ ids: requestIds, approvedBy })
    }
  );
}

export function bulkRejectSubmissions(
  workspaceId: string,
  requestIds: string[],
  rejectedBy: string,
  reason: string
): Promise<{ processed: number; rejected: number; failed: Array<{ id: string; message: string }> }> {
  return api<{ processed: number; rejected: number; failed: Array<{ id: string; message: string }> }>(
    withWorkspace("/api/submissions/actions/bulk-reject", workspaceId),
    {
      method: "POST",
      body: JSON.stringify({ ids: requestIds, rejectedBy, reason })
    }
  );
}

export function getRuns(workspaceId: string): Promise<CampaignRun[]> {
  return api<CampaignRun[]>(withWorkspace("/api/runs", workspaceId));
}

export function getRunDetail(workspaceId: string, runId: string): Promise<RunDetail> {
  return api<RunDetail>(withWorkspace(`/api/runs/${runId}`, workspaceId));
}

export function createRun(payload: {
  mode: "dry_run" | "production";
  initiatedBy: string;
  workspaceId: string;
  firmIds?: string[];
}): Promise<CampaignRun> {
  return api<CampaignRun>("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function exportFirmsCsv(workspaceId: string): Promise<void> {
  const result = await apiBlob(withWorkspace("/api/export/firms.csv", workspaceId));
  triggerCsvDownload(result.blob, result.fileName);
}

export async function exportSubmissionsCsv(workspaceId: string): Promise<void> {
  const result = await apiBlob(withWorkspace("/api/export/submissions.csv", workspaceId));
  triggerCsvDownload(result.blob, result.fileName);
}
