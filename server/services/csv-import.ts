import { v4 as uuid } from "uuid";
import type { Firm } from "../domain/types.js";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toInvestorType(value: string): Firm["investorType"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("angel")) return "Angel Network";
  if (normalized.includes("syndicate")) return "Syndicate";
  if (normalized.includes("vc") || normalized.includes("venture")) return "VC";
  return "Other";
}

export function parseFirmsCsv(csvContent: string, workspaceId: string): Firm[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  const firms: Firm[] = [];

  for (const row of rows) {
    const data: Record<string, string> = {};
    headers.forEach((header, index) => {
      data[header] = row[index] ?? "";
    });

    const name = data.company || data.firm || data.investor || data.name;
    const website = data.website || data.domain || data.url;

    if (!name || !website) {
      continue;
    }

    const geography = data.location || data.country || data.geography || "Unknown";
    const typeInput = data.investor_type || data.type || "VC";
    const checkSizeRange = data.check_size || data.check_size_range || data.ticket_size || "Unknown";
    const focusInput = data.focus || data.focus_sectors || data.sectors || "";
    const focusSectors = focusInput
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    firms.push({
      id: uuid(),
      workspaceId,
      name,
      website,
      geography,
      investorType: toInvestorType(typeInput),
      checkSizeRange,
      focusSectors: focusSectors.length > 0 ? focusSectors : ["General"],
      stageFocus: ["Seed", "Series A", "Growth"],
      stage: "lead",
      score: 50,
      statusReason: "Imported from CSV",
      contacts: [],
      notes: [],
      lastTouchedAt: new Date().toISOString()
    });
  }

  return firms;
}
