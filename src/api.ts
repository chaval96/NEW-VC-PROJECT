import type { CampaignRun, Firm, OverviewResponse, Playbook, Profile, RunDetail } from "./types";

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

export function createRun(payload: { mode: "dry_run" | "production"; initiatedBy: string; firmIds?: string[] }): Promise<CampaignRun> {
  return api<CampaignRun>("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
