import { v4 as uuid } from "uuid";
import * as XLSX from "xlsx";
import type { Firm } from "../domain/types.js";
import { normalizeFirmIdentity } from "./firm-normalization.js";

export interface ParsedImportResult {
  firms: Firm[];
  sourceType: "csv" | "excel";
}

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
  return value.replace(/^\ufeff/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toInvestorType(value: string): Firm["investorType"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("angel")) return "Angel Network";
  if (normalized.includes("syndicate")) return "Syndicate";
  if (normalized.includes("vc") || normalized.includes("venture")) return "VC";
  return "Other";
}

function firstDefined(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function firstByHeaderPattern(row: Record<string, string>, patterns: RegExp[]): string {
  for (const [key, value] of Object.entries(row)) {
    if (!value || value.trim().length === 0) continue;
    if (patterns.some((pattern) => pattern.test(key))) {
      return value.trim();
    }
  }
  return "";
}

function pickValue(row: Record<string, string>, keys: string[], patterns: RegExp[]): string {
  return firstDefined(row, keys) || firstByHeaderPattern(row, patterns);
}

function normalizeWebsite(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return "";
}

function mapRowsToFirms(rows: Record<string, string>[], workspaceId: string): Firm[] {
  const firms: Firm[] = [];
  const seen = new Set<string>();

  for (const data of rows) {
    const name = pickValue(
      data,
      ["company", "company_name", "firm", "firm_name", "investor", "investor_name", "name", "fund_name"],
      [/company/, /^firm/, /investor/, /^name$/, /fund/]
    );
    const websiteRaw = pickValue(
      data,
      ["website", "company_website", "domain", "primary_domain", "url", "site", "homepage"],
      [/website/, /domain/, /url/, /site/, /homepage/]
    );
    const website = normalizeWebsite(websiteRaw);

    if (!name || !website) {
      continue;
    }

    const dedupeKey = normalizeFirmIdentity(name, website);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const geography =
      pickValue(
        data,
        ["location", "country", "geography", "hq", "hq_location", "region"],
        [/location/, /country/, /geo/, /region/, /^hq/]
      ) || "Unknown";
    const typeInput =
      pickValue(data, ["investor_type", "type", "firm_type", "category"], [/type/, /category/, /investor/]) || "VC";
    const checkSizeRange =
      pickValue(
        data,
        ["check_size", "check_size_range", "ticket_size", "investment_size", "check", "ticket", "typical_check"],
        [/check/, /ticket/, /investment/, /size/]
      ) || "Unknown";
    const focusInput = pickValue(
      data,
      ["focus", "focus_sectors", "sectors", "sector", "verticals", "industry_focus", "thesis"],
      [/focus/, /sector/, /vertical/, /industry/, /thesis/]
    );
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
      statusReason: "Imported from list",
      contacts: [],
      notes: [],
      lastTouchedAt: new Date().toISOString()
    });
  }

  return firms;
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
  const dataRows: Record<string, string>[] = [];

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const entry: Record<string, string> = {};
    headers.forEach((header, index) => {
      entry[header] = row[index] ?? "";
    });
    dataRows.push(entry);
  }

  return mapRowsToFirms(dataRows, workspaceId);
}

function parseXlsx(buffer: Buffer, workspaceId: string): Firm[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    return [];
  }

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  const normalizedRows = jsonRows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = String(value ?? "").trim();
    }
    return normalized;
  });

  return mapRowsToFirms(normalizedRows, workspaceId);
}

export function parseFirmsFromUpload(
  base64Data: string,
  fileName: string,
  mimeType: string,
  workspaceId: string
): ParsedImportResult {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedName = fileName.toLowerCase();

  const buffer = Buffer.from(base64Data, "base64");

  const isExcel =
    normalizedMime.includes("spreadsheet") ||
    normalizedMime.includes("excel") ||
    normalizedName.endsWith(".xlsx") ||
    normalizedName.endsWith(".xls");

  if (isExcel) {
    return {
      firms: parseXlsx(buffer, workspaceId),
      sourceType: "excel"
    };
  }

  const csvText = buffer.toString("utf8");
  return {
    firms: parseFirmsCsv(csvText, workspaceId),
    sourceType: "csv"
  };
}

function extractDriveFileId(url: string): string | undefined {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

export async function parseFirmsFromGoogleDriveLink(link: string, workspaceId: string): Promise<ParsedImportResult> {
  const fileId = extractDriveFileId(link);
  const sheetIdMatch = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const sheetId = sheetIdMatch?.[1];

  const candidates: Array<{ url: string; sourceType: "csv" | "excel" }> = [];
  if (sheetId) {
    candidates.push({ url: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, sourceType: "excel" });
    candidates.push({ url: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`, sourceType: "csv" });
  }
  if (fileId) {
    candidates.push({ url: `https://drive.google.com/uc?export=download&id=${fileId}`, sourceType: "excel" });
    candidates.push({ url: `https://drive.usercontent.google.com/download?id=${fileId}&export=download`, sourceType: "excel" });
    candidates.push({ url: `https://drive.google.com/uc?export=download&id=${fileId}`, sourceType: "csv" });
  }

  if (candidates.length === 0) {
    throw new Error("Could not extract Google Drive file id from link.");
  }

  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url);
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const looksLikeExcel =
        candidate.sourceType === "excel" ||
        contentType.includes("spreadsheet") ||
        contentType.includes("excel") ||
        contentType.includes("octet-stream");

      if (looksLikeExcel) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const firms = parseXlsx(buffer, workspaceId);
        if (firms.length > 0) {
          return { firms, sourceType: "excel" };
        }
      } else {
        const text = await response.text();
        const firms = parseFirmsCsv(text, workspaceId);
        if (firms.length > 0) {
          return { firms, sourceType: "csv" };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown download failure";
    }
  }

  if (lastStatus) {
    throw new Error(`Google Drive file download failed with status ${lastStatus}`);
  }

  throw new Error(lastError ?? "Could not parse investors from this Google Drive file. Ensure it is publicly accessible.");
}
