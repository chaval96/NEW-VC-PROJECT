import type {
  AuthLoginResponse,
  AuthSignupResponse,
  AuthUser,
  CampaignRun,
  Firm,
  ImportBatch,
  OverviewResponse,
  Profile,
  SubmissionRequest,
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

export function login(email: string, password: string): Promise<AuthLoginResponse> {
  return api<AuthLoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function getMe(): Promise<{ user: AuthUser }> {
  return api<{ user: AuthUser }>("/api/auth/me");
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

export function getOverview(workspaceId: string): Promise<OverviewResponse> {
  return api<OverviewResponse>(withWorkspace("/api/dashboard/overview", workspaceId));
}

export async function getFirms(workspaceId: string): Promise<Firm[]> {
  const result = await api<Firm[] | { firms: Firm[]; total: number }>(withWorkspace("/api/firms?limit=200", workspaceId));
  return Array.isArray(result) ? result : result.firms;
}

export function getProfile(workspaceId: string): Promise<Profile> {
  return api<Profile>(withWorkspace("/api/profile", workspaceId));
}

export function getImportBatches(workspaceId: string): Promise<ImportBatch[]> {
  return api<ImportBatch[]>(withWorkspace("/api/imports", workspaceId));
}

export function importFirmsFile(payload: {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<{ imported: number; sourceType: string; runId?: string }> {
  const { workspaceId, ...rest } = payload;
  return api<{ imported: number; sourceType: string; runId?: string }>(withWorkspace("/api/firms/import-file", workspaceId), {
    method: "POST",
    body: JSON.stringify(rest)
  });
}

export function importFirmsFromDrive(workspaceId: string, link: string): Promise<{ imported: number; sourceType: string; runId?: string }> {
  return api<{ imported: number; sourceType: string; runId?: string }>(withWorkspace("/api/firms/import-drive", workspaceId), {
    method: "POST",
    body: JSON.stringify({ link })
  });
}

export function getSubmissionQueue(workspaceId: string): Promise<SubmissionRequest[]> {
  return api<SubmissionRequest[]>(withWorkspace("/api/submissions/queue", workspaceId));
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

export function getRuns(workspaceId: string): Promise<CampaignRun[]> {
  return api<CampaignRun[]>(withWorkspace("/api/runs", workspaceId));
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
