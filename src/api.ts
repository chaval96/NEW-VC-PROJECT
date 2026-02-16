import type {
  CampaignRun,
  Firm,
  ImportBatch,
  OverviewResponse,
  Playbook,
  Profile,
  RunDetail,
  SubmissionRequest,
  Workspace,
  WorkspacesResponse
} from "./types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
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

export function getImportBatches(): Promise<ImportBatch[]> {
  return api<ImportBatch[]>("/api/imports");
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

export function getOverview(): Promise<OverviewResponse> {
  return api<OverviewResponse>("/api/dashboard/overview");
}

export function getFirms(): Promise<Firm[]> {
  return api<Firm[]>("/api/firms");
}

export function getProfile(): Promise<Profile> {
  return api<Profile>("/api/profile");
}

export function getPlaybook(): Promise<Playbook> {
  return api<Playbook>("/api/playbook");
}

export function getRuns(): Promise<CampaignRun[]> {
  return api<CampaignRun[]>("/api/runs");
}

export function getRunDetail(id: string): Promise<RunDetail> {
  return api<RunDetail>(`/api/runs/${id}`);
}

export function createRun(payload: {
  mode: "dry_run" | "production";
  initiatedBy: string;
  firmIds?: string[];
  workspaceId?: string;
}): Promise<CampaignRun> {
  return api<CampaignRun>("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
