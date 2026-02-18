import { URL } from "node:url";

function normalizeNamePart(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
}

export function normalizeListName(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "unassigned") return undefined;
  return trimmed;
}

export function normalizeListKey(value?: string): string {
  const normalized = normalizeListName(value) ?? "Unassigned";
  return normalized.toLowerCase();
}

export function normalizeWebsiteHost(website: string): string {
  const raw = website.trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .replace(/\.$/, "");
  }
}

export function normalizeFirmIdentity(name: string, website: string): string {
  const host = normalizeWebsiteHost(website);
  const namePart = normalizeNamePart(name);

  // Domain is the strongest stable key for investor firms.
  if (host) return host;
  if (namePart) return namePart;
  return website.toLowerCase().trim();
}
