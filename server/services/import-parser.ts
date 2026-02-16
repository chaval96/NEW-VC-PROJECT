import { v4 as uuid } from "uuid";
import * as XLSX from "xlsx";
import type { Firm } from "../domain/types.js";

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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toInvestorType(value: string): Firm["investorType"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("angel")) return "Angel Network";
  if (normalized.includes("syndicate")) return "Syndicate";
  if (normalized.includes("vc") || normalized.includes("venture")) return "VC";
  return "Other";
}

function mapRowsToFirms(rows: Record<string, string>[], workspaceId: string): Firm[] {
  const firms: Firm[] = [];

  for (const data of rows) {
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
  if (!fileId) {
    throw new Error("Could not extract Google Drive file id from link.");
  }

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Google Drive file download failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("spreadsheet") || contentType.includes("excel") || contentType.includes("octet-stream")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      firms: parseXlsx(buffer, workspaceId),
      sourceType: "excel"
    };
  }

  const text = await response.text();
  return {
    firms: parseFirmsCsv(text, workspaceId),
    sourceType: "csv"
  };
}
