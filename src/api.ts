import type {
  AuthLoginResponse,
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // ignore json parse failures
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
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
  return api<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify(payload) });
}

export function activateWorkspace(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/workspaces/${id}/activate`, { method: "POST" });
}

export function updateWorkspaceProfile(id: string, payload: Partial<Profile>): Promise<Workspace> {
  return api<Workspace>(`/api/workspaces/${id}/profile`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function getOverview(): Promise<OverviewResponse> {
  return api<OverviewResponse>("/api/dashboard/overview");
}

export async function getFirms(): Promise<Firm[]> {
  const result = await api<Firm[] | { firms: Firm[]; total: number }>("/api/firms?limit=200");
  return Array.isArray(result) ? result : result.firms;
}

export function getProfile(): Promise<Profile> {
  return api<Profile>("/api/profile");
}

export function getImportBatches(): Promise<ImportBatch[]> {
  return api<ImportBatch[]>("/api/imports");
}

export function importFirmsFile(payload: {
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<{ imported: number; sourceType: string; runId?: string }> {
  return api<{ imported: number; sourceType: string; runId?: string }>("/api/firms/import-file", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function importFirmsFromDrive(link: string): Promise<{ imported: number; sourceType: string; runId?: string }> {
  return api<{ imported: number; sourceType: string; runId?: string }>("/api/firms/import-drive", {
    method: "POST",
    body: JSON.stringify({ link })
  });
}

export function getSubmissionQueue(): Promise<SubmissionRequest[]> {
  return api<SubmissionRequest[]>("/api/submissions/queue");
}

export function approveSubmission(requestId: string, approvedBy: string): Promise<{ request: SubmissionRequest }> {
  return api<{ request: SubmissionRequest }>(`/api/submissions/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approvedBy })
  });
}

export function rejectSubmission(requestId: string, rejectedBy: string, reason: string): Promise<SubmissionRequest> {
  return api<SubmissionRequest>(`/api/submissions/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ rejectedBy, reason })
  });
}

export function createRun(payload: {
  mode: "dry_run" | "production";
  initiatedBy: string;
  firmIds?: string[];
  workspaceId?: string;
}): Promise<CampaignRun> {
  return api<CampaignRun>("/api/runs", { method: "POST", body: JSON.stringify(payload) });
}
