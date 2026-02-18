import cors from "cors";
import dayjs from "dayjs";
import express from "express";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { StateStore } from "./domain/store.js";
import { buildTemplateProfile } from "./domain/seed.js";
import type { AssessmentResult, CompanyProfile, Firm, PipelineStage, SubmissionStatus, Workspace } from "./domain/types.js";
import { CampaignOrchestrator } from "./orchestrator/workflow.js";
import { buildOverview, getCachedOverview } from "./services/analytics.js";
import { AuthService, type AuthUser } from "./services/auth-service.js";
import { CreditService } from "./services/credit-service.js";
import { normalizeFirmIdentity, normalizeListKey, normalizeListName } from "./services/firm-normalization.js";
import { parseFirmsFromGoogleDriveLink, parseFirmsFromUpload } from "./services/import-parser.js";
import { researchLead } from "./services/lead-research.js";
import { executeSubmissionRequest, type SubmissionExecutionResult } from "./services/submission-executor.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

const store = new StateStore();
const orchestrator = new CampaignOrchestrator(store);
const creditService = new CreditService(store);
const authService = new AuthService();
const featureCreditsEnabled = process.env.FEATURE_CREDITS === "true";
const featureAssessmentEnabled = process.env.FEATURE_ASSESSMENT === "true";

type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>;
function asyncHandler(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function statusToStage(status: SubmissionStatus): PipelineStage {
  switch (status) {
    case "submitted":
      return "submitted";
    case "form_filled":
      return "form_filled";
    case "form_discovered":
      return "form_discovered";
    case "blocked":
    case "no_form_found":
    case "needs_review":
      return "review";
    case "errored":
      return "lost";
    case "queued":
    default:
      return "qualified";
  }
}

function parseBearerToken(authHeader?: string): string | undefined {
  if (!authHeader) return undefined;
  const [scheme, value] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return undefined;
  return value.trim();
}

function extractWorkspaceId(req: express.Request): string | undefined {
  const fromParam = typeof req.params.workspaceId === "string" ? req.params.workspaceId : undefined;
  const fromQuery = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const fromBody = typeof (req.body as { workspaceId?: unknown } | undefined)?.workspaceId === "string"
    ? ((req.body as { workspaceId: string }).workspaceId)
    : undefined;
  return fromParam ?? fromQuery ?? fromBody;
}

function getAuthUser(res: express.Response): AuthUser {
  return res.locals.authUser as AuthUser;
}

async function resolveWorkspaceContext(req: express.Request, res: express.Response): Promise<{ workspaceId: string; workspace: Workspace; user: AuthUser }> {
  const user = getAuthUser(res);
  const workspaceId = extractWorkspaceId(req);

  if (!workspaceId) {
    throw new Error("workspaceId is required");
  }

  const hasAccess = await authService.userHasWorkspaceAccess(user.id, workspaceId);
  if (!hasAccess) {
    const error = new Error("Forbidden workspace access");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) {
    const error = new Error("Workspace not found");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  return { workspaceId, workspace, user };
}

function validateProfileReadiness(profile: CompanyProfile): string[] {
  const missing: string[] = [];

  if (!profile.company.trim()) missing.push("company name");
  if (!profile.website.trim()) missing.push("company website");
  if (!profile.senderName.trim()) missing.push("founder name");
  if (!profile.senderEmail.trim()) missing.push("founder email");
  if (!profile.oneLiner.trim()) missing.push("company one-liner");
  if (!profile.longDescription.trim()) missing.push("company description");
  if (!profile.fundraising.round.trim()) missing.push("funding round");
  if (!profile.fundraising.amount.trim()) missing.push("target amount");

  return missing;
}

const blockedEmailDomains = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "invalid",
  "mailinator.com",
  "yopmail.com",
  "tempmail.com",
  "temp-mail.org",
  "guerrillamail.com",
  "10minutemail.com"
]);

const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function isAllowedAuthEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!strictEmailPattern.test(email)) return false;

  const domain = email.split("@")[1];
  if (!domain) return false;
  if (blockedEmailDomains.has(domain)) return false;
  return true;
}

const authEmailSchema = z.string().email().refine(isAllowedAuthEmail, {
  message: "Please enter a valid email address."
});

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value);
  if (/["\n,]/.test(raw)) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return [header, ...lines].join("\n");
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

function baseNameFromFile(fileName: string): string {
  const trimmed = fileName.trim();
  const withoutPath = trimmed.split("/").pop() ?? trimmed;
  const withoutQuery = withoutPath.split("?")[0] ?? withoutPath;
  const parts = withoutQuery.split(".");
  if (parts.length <= 1) return withoutQuery || "Imported List";
  return parts.slice(0, -1).join(".") || withoutQuery || "Imported List";
}

function summarizeLeadLists(
  firms: ReturnType<StateStore["listFirms"]>,
  batches: ReturnType<StateStore["listImportBatches"]>
): Array<{
  name: string;
  leadCount: number;
  createdAt: string;
  updatedAt: string;
  importBatchCount: number;
}> {
  const now = new Date().toISOString();
  const batchGrouped = new Map<string, { name: string; createdAt: string; updatedAt: string; importBatchCount: number }>();
  const displayNames = new Map<string, string>();

  for (const batch of batches) {
    const normalized = normalizeListName(batch.sourceName);
    const key = normalizeListKey(normalized);
    if (!displayNames.has(key)) {
      displayNames.set(key, normalized ?? "Unassigned");
    }

    const existing = batchGrouped.get(key);
    if (!existing) {
      batchGrouped.set(key, {
        name: normalized ?? "Unassigned",
        createdAt: batch.importedAt,
        updatedAt: batch.importedAt,
        importBatchCount: 1
      });
      continue;
    }
    if (normalized) {
      existing.name = normalized;
    }
    existing.importBatchCount += 1;
    if (batch.importedAt < existing.createdAt) existing.createdAt = batch.importedAt;
    if (batch.importedAt > existing.updatedAt) existing.updatedAt = batch.importedAt;
  }

  const leadCounts = new Map<string, number>();
  const leadTimestamps = new Map<string, string>();
  for (const firm of firms) {
    const normalized = normalizeListName(firm.sourceListName);
    const key = normalizeListKey(normalized);
    if (!displayNames.has(key)) {
      displayNames.set(key, normalized ?? "Unassigned");
    }
    leadCounts.set(key, (leadCounts.get(key) ?? 0) + 1);
    const touchedAt = firm.lastTouchedAt ?? now;
    const prev = leadTimestamps.get(key);
    if (!prev || touchedAt > prev) {
      leadTimestamps.set(key, touchedAt);
    }
  }

  const keys = new Set<string>([...leadCounts.keys(), ...batchGrouped.keys()]);
  return [...keys]
    .map((key) => {
      const count = leadCounts.get(key) ?? 0;
      if (count <= 0) return null;
      const batchInfo = batchGrouped.get(key);
      const createdAt = batchInfo?.createdAt ?? now;
      const updatedAt = leadTimestamps.get(key) ?? batchInfo?.updatedAt ?? now;
      return {
        name: displayNames.get(key) ?? "Unassigned",
        leadCount: count,
        createdAt,
        updatedAt,
        importBatchCount: batchInfo?.importBatchCount ?? 0
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
}

const pipelineRank: PipelineStage[] = [
  "lead",
  "researching",
  "qualified",
  "form_discovered",
  "form_filled",
  "submitted",
  "review",
  "won",
  "lost"
];

function stageRank(stage: PipelineStage): number {
  const rank = pipelineRank.indexOf(stage);
  return rank === -1 ? 0 : rank;
}

function mergeUniqueText(values: string[], limit = 6): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of values) {
    const value = item.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
}

function choosePreferredFirm(a: Firm, b: Firm): Firm {
  const score = (firm: Firm): number => {
    const hasList = normalizeListName(firm.sourceListName) ? 1 : 0;
    const hasKnownGeo = firm.geography && firm.geography.toLowerCase() !== "unknown" ? 1 : 0;
    const hasKnownCheck = firm.checkSizeRange && firm.checkSizeRange.toLowerCase() !== "unknown" ? 1 : 0;
    const sectorWeight = Math.min(1, Math.max(0, firm.focusSectors.filter((v) => v.toLowerCase() !== "general").length / 3));
    const stageWeight = stageRank(firm.stage) / pipelineRank.length;
    const recency = Number.isFinite(Date.parse(firm.lastTouchedAt ?? "")) ? Date.parse(firm.lastTouchedAt ?? "") / 10e12 : 0;
    return hasList + hasKnownGeo + hasKnownCheck + sectorWeight + stageWeight + recency;
  };

  return score(a) >= score(b) ? a : b;
}

function mergeFirmRecords(primary: Firm, secondary: Firm): Firm {
  const primaryList = normalizeListName(primary.sourceListName);
  const secondaryList = normalizeListName(secondary.sourceListName);
  const primaryTouched = Date.parse(primary.lastTouchedAt ?? "");
  const secondaryTouched = Date.parse(secondary.lastTouchedAt ?? "");

  const notes = mergeUniqueText([...(primary.notes ?? []), ...(secondary.notes ?? [])], 20);
  const focusSectors = mergeUniqueText([...(primary.focusSectors ?? []), ...(secondary.focusSectors ?? [])], 3);
  const stageFocus = mergeUniqueText([...(primary.stageFocus ?? []), ...(secondary.stageFocus ?? [])], 3);
  const investmentFocus = mergeUniqueText(
    [...(primary.investmentFocus ?? []), ...(secondary.investmentFocus ?? [])],
    3
  );

  const mergedContacts = [...(primary.contacts ?? []), ...(secondary.contacts ?? [])];
  const contactsByKey = new Map<string, Firm["contacts"][number]>();
  for (const contact of mergedContacts) {
    const key = `${contact.email?.toLowerCase() ?? ""}::${contact.name.toLowerCase().trim()}`;
    if (!contactsByKey.has(key)) {
      contactsByKey.set(key, contact);
    }
  }

  const newer =
    Number.isFinite(primaryTouched) && Number.isFinite(secondaryTouched)
      ? primaryTouched >= secondaryTouched
        ? primary
        : secondary
      : primary;
  const highestStage = stageRank(primary.stage) >= stageRank(secondary.stage) ? primary.stage : secondary.stage;

  return {
    ...primary,
    importBatchId: primary.importBatchId ?? secondary.importBatchId,
    sourceListName: primaryList ?? secondaryList,
    geography:
      primary.geography && primary.geography.toLowerCase() !== "unknown" ? primary.geography : secondary.geography,
    investorType: primary.investorType !== "Other" ? primary.investorType : secondary.investorType,
    checkSizeRange:
      primary.checkSizeRange && primary.checkSizeRange.toLowerCase() !== "unknown"
        ? primary.checkSizeRange
        : secondary.checkSizeRange,
    focusSectors: focusSectors.length > 0 ? focusSectors : ["General"],
    stageFocus: stageFocus.length > 0 ? stageFocus : ["Seed", "Series A", "Growth"],
    stage: highestStage,
    score: Math.max(primary.score ?? 0, secondary.score ?? 0),
    statusReason: newer.statusReason || primary.statusReason || secondary.statusReason,
    lastTouchedAt:
      Number.isFinite(primaryTouched) && Number.isFinite(secondaryTouched)
        ? new Date(Math.max(primaryTouched, secondaryTouched)).toISOString()
        : primary.lastTouchedAt ?? secondary.lastTouchedAt,
    contacts: [...contactsByKey.values()].slice(0, 12),
    notes,
    matchScore: Math.max(primary.matchScore ?? 0, secondary.matchScore ?? 0) || undefined,
    matchReasoning: primary.matchReasoning ?? secondary.matchReasoning,
    investmentFocus: investmentFocus.length > 0 ? investmentFocus : undefined,
    researchConfidence: Math.max(primary.researchConfidence ?? 0, secondary.researchConfidence ?? 0) || undefined,
    researchedAt:
      Number.isFinite(primaryTouched) && Number.isFinite(secondaryTouched)
        ? new Date(Math.max(primaryTouched, secondaryTouched)).toISOString()
        : primary.researchedAt ?? secondary.researchedAt,
    formDiscovery: primary.formDiscovery ?? secondary.formDiscovery,
    qualificationScore: Math.max(primary.qualificationScore ?? 0, secondary.qualificationScore ?? 0) || undefined
  };
}

function normalizeWorkspaceListNames(workspaceId: string): number {
  const firms = store.listFirms(workspaceId);
  let changed = 0;

  for (const firm of firms) {
    const raw = firm.sourceListName ?? "";
    const normalized = normalizeListName(firm.sourceListName);
    const next = normalized ?? undefined;
    if (raw.trim() === (next ?? "")) continue;
    store.upsertFirm({ ...firm, sourceListName: next });
    changed += 1;
  }

  const batches = store.listImportBatches(workspaceId);
  const normalizedBatches = batches.map((batch) => ({
    ...batch,
    sourceName: normalizeListName(batch.sourceName) ?? "Unassigned"
  }));
  store.replaceWorkspaceImportBatches(workspaceId, normalizedBatches);

  return changed;
}

function dedupeWorkspaceFirms(workspaceId: string): { removed: number; remappedReferences: number } {
  const firms = store.listFirms(workspaceId);
  const byIdentity = new Map<string, Firm>();
  const remap: Record<string, string> = {};

  for (const firm of firms) {
    const key = normalizeFirmIdentity(firm.name, firm.website);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, firm);
      continue;
    }

    const preferred = choosePreferredFirm(existing, firm);
    const other = preferred.id === existing.id ? firm : existing;
    const merged = mergeFirmRecords(preferred, other);
    byIdentity.set(key, merged);
    remap[other.id] = preferred.id;
  }

  const deduped = [...byIdentity.values()];
  if (Object.keys(remap).length === 0) {
    return { removed: 0, remappedReferences: 0 };
  }

  const resolveFinalId = (id: string): string => {
    let cursor = id;
    const seen = new Set<string>();
    while (remap[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = remap[cursor];
    }
    return cursor;
  };

  for (const [from, to] of Object.entries(remap)) {
    remap[from] = resolveFinalId(to);
  }

  const remappedReferences = store.remapWorkspaceFirmReferences(workspaceId, remap);
  store.replaceWorkspaceFirms(workspaceId, deduped);
  return { removed: firms.length - deduped.length, remappedReferences };
}

function cleanupWorkspaceImports(workspaceId: string): number {
  const validNames = new Set(
    store
      .listFirms(workspaceId)
      .map((firm) => normalizeListName(firm.sourceListName) ?? "Unassigned")
      .map((name) => normalizeListKey(name))
  );

  const batches = store.listImportBatches(workspaceId);
  const filtered = batches.filter((batch) => validNames.has(normalizeListKey(batch.sourceName)));
  const removed = batches.length - filtered.length;
  if (removed > 0) {
    store.replaceWorkspaceImportBatches(workspaceId, filtered);
  }
  return removed;
}

async function runWorkspaceMaintenance(workspaceId: string): Promise<{ removedDuplicates: number; removedEmptyBatches: number }> {
  normalizeWorkspaceListNames(workspaceId);
  const dedupe = dedupeWorkspaceFirms(workspaceId);
  const removedEmptyBatches = cleanupWorkspaceImports(workspaceId);
  await store.persist();
  return {
    removedDuplicates: dedupe.removed,
    removedEmptyBatches
  };
}

const researchBatchSize = Math.max(3, Number(process.env.RESEARCH_BATCH_SIZE ?? 8));
const researchIntervalMs = Math.max(15_000, Number(process.env.RESEARCH_INTERVAL_SECONDS ?? 20) * 1000);
const researchMaxLeadAgeMs = Math.max(6, Number(process.env.RESEARCH_REFRESH_HOURS ?? 72)) * 60 * 60 * 1000;
const researchInFlight = new Set<string>();
let researchWatchdogActive = false;

function needsResearchBackfill(firm: Firm): boolean {
  const geoUnknown = !firm.geography || firm.geography.trim().toLowerCase() === "unknown";
  const checkUnknown = !firm.checkSizeRange || firm.checkSizeRange.trim().toLowerCase() === "unknown";
  const sectorsGeneric =
    !Array.isArray(firm.focusSectors) ||
    firm.focusSectors.length === 0 ||
    firm.focusSectors.every((sector) => ["general", "generalist"].includes(sector.trim().toLowerCase()));
  const missingInvestmentFocus = !firm.investmentFocus || firm.investmentFocus.length === 0;
  const missingResearch = !firm.qualificationScore || !firm.researchConfidence;
  return geoUnknown || checkUnknown || sectorsGeneric || missingInvestmentFocus || missingResearch;
}

function eligibleForResearch(firm: Firm): boolean {
  if (["form_filled", "submitted", "won", "lost"].includes(firm.stage)) return false;
  if (needsResearchBackfill(firm)) return true;
  if (!firm.researchedAt) return true;
  const researchedAt = Date.parse(firm.researchedAt);
  if (!Number.isFinite(researchedAt)) return true;
  return Date.now() - researchedAt >= researchMaxLeadAgeMs;
}

async function runWorkspaceResearch(workspace: Workspace): Promise<number> {
  const runId = `system-research-${workspace.id}`;
  const candidates = store
    .listFirms(workspace.id)
    .filter(eligibleForResearch)
    .sort((a, b) => {
      const aTouched = Date.parse(a.lastTouchedAt ?? a.researchedAt ?? "") || 0;
      const bTouched = Date.parse(b.lastTouchedAt ?? b.researchedAt ?? "") || 0;
      return aTouched - bTouched;
    })
    .slice(0, researchBatchSize);

  if (candidates.length === 0) return 0;

  let processed = 0;
  for (const candidate of candidates) {
    const ok = await runFirmResearch(workspace, candidate.id, runId, "Background research started.");
    if (ok) processed += 1;
  }

  if (processed > 0) {
    await store.persist();
  }

  return processed;
}

async function runFirmResearch(
  workspace: Workspace,
  firmId: string,
  runId: string,
  startupReason: string
): Promise<boolean> {
  const current = store.getFirm(firmId, workspace.id);
  if (!current) return false;
  const now = new Date().toISOString();

  if (current.stage === "lead") {
    store.upsertFirm({
      ...current,
      stage: "researching",
      statusReason: startupReason,
      lastTouchedAt: now
    });
  }

  try {
    const result = await researchLead(current, workspace.profile);
    const refreshed = store.getFirm(firmId, workspace.id) ?? current;
    const notes = mergeUniqueText(
      [
        ...(refreshed.notes ?? []),
        `Research score ${Math.round(result.qualificationScore * 100)}% · ${result.statusReason}`
      ],
      24
    );

    store.upsertFirm({
      ...refreshed,
      geography: result.geography,
      investorType: result.investorType,
      checkSizeRange: result.checkSizeRange,
      focusSectors: result.focusSectors,
      stageFocus: result.stageFocus,
      investmentFocus: result.investmentFocus,
      qualificationScore: result.qualificationScore,
      researchConfidence: result.researchConfidence,
      researchedAt: now,
      formDiscovery: result.formDiscovery,
      researchSources: result.researchSources,
      researchSummary: result.researchSummary,
      stage: result.nextStage,
      statusReason: result.formRouteHint ? `${result.statusReason} (${result.formRouteHint})` : result.statusReason,
      lastTouchedAt: now,
      notes
    });

    store.addLog({
      id: uuid(),
      workspaceId: workspace.id,
      runId,
      timestamp: now,
      level: "info",
      message: `Research update for ${refreshed.name}: ${result.statusReason}`,
      firmId: refreshed.id
    });
    return true;
  } catch (error) {
    store.addLog({
      id: uuid(),
      workspaceId: workspace.id,
      runId,
      timestamp: now,
      level: "warn",
      message: `Research failed for ${current.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
      firmId: current.id
    });
    return false;
  }
}

async function runResearchWatchdog(): Promise<void> {
  if (researchWatchdogActive) return;
  researchWatchdogActive = true;

  try {
    const workspaces = store.listWorkspaces();
    for (const workspace of workspaces) {
      if (researchInFlight.has(workspace.id)) continue;
      researchInFlight.add(workspace.id);
      try {
        await runWorkspaceResearch(workspace);
      } finally {
        researchInFlight.delete(workspace.id);
      }
    }
  } finally {
    researchWatchdogActive = false;
  }
}

const submissionMaxAttemptsDefault = Math.max(1, Number(process.env.SUBMISSION_MAX_ATTEMPTS ?? 2));
const submissionRetryDelayMs = Math.max(300, Number(process.env.SUBMISSION_RETRY_DELAY_MS ?? 1500));
const submissionStaleExecutionMs = Math.max(60_000, Number(process.env.SUBMISSION_EXECUTION_STALE_MINUTES ?? 10) * 60_000);
const submissionWatchdogIntervalMs = Math.max(15_000, Number(process.env.SUBMISSION_WATCHDOG_INTERVAL_SECONDS ?? 45) * 1000);
const submissionInFlight = new Set<string>();
let submissionWatchdogActive = false;

function submissionFlightKey(workspaceId: string, requestId: string): string {
  return `${workspaceId}:${requestId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSubmissionSuccess(status: SubmissionStatus): boolean {
  return status === "submitted" || status === "form_filled";
}

function canApproveFromStatus(status: string): boolean {
  return ["pending_approval", "pending_retry", "failed"].includes(status);
}

function updateFirmFromExecution(
  workspaceId: string,
  requestId: string,
  request: { firmId: string; firmName: string },
  result: SubmissionExecutionResult
): void {
  const firm = store.getFirm(request.firmId, workspaceId);
  if (!firm) return;
  store.upsertFirm({
    ...firm,
    stage: statusToStage(result.status),
    statusReason: result.note,
    lastTouchedAt: new Date().toISOString(),
    notes: [...firm.notes, `Execution ${requestId}: ${result.status}`]
  });
}

async function executeSubmissionWithRetries(
  workspaceId: string,
  requestId: string
): Promise<{ request?: ReturnType<StateStore["getSubmissionRequest"]>; result: SubmissionExecutionResult }> {
  const initial = store.getSubmissionRequest(requestId, workspaceId);
  if (!initial) {
    throw new Error("Submission request not found");
  }

  const maxAttempts = Math.max(1, initial.maxExecutionAttempts ?? submissionMaxAttemptsDefault);
  let attempts = Math.max(0, initial.executionAttempts ?? 0);
  let lastResult: SubmissionExecutionResult | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    const startedAt = new Date().toISOString();

    const executing = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
      ...current,
      status: "executing",
      executionAttempts: attempts,
      maxExecutionAttempts: maxAttempts,
      lastExecutionStartedAt: startedAt,
      nextRetryAt: undefined
    }));

    if (!executing) {
      throw new Error("Submission request not found");
    }

    await store.persist();

    const result = await executeSubmissionRequest(executing);
    lastResult = result;
    const endedAt = new Date().toISOString();

    store.addEvent({
      id: uuid(),
      workspaceId,
      firmId: executing.firmId,
      firmName: executing.firmName,
      channel: "website_form",
      status: result.status,
      attemptedAt: endedAt,
      discoveredAt: result.discoveredAt,
      filledAt: result.filledAt,
      submittedAt: result.submittedAt,
      blockedReason: result.blockedReason,
      note: `Attempt ${attempts}/${maxAttempts}: ${result.note}`
    });

    if (isSubmissionSuccess(result.status)) {
      const completed = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "completed",
        executedAt: endedAt,
        executionAttempts: attempts,
        maxExecutionAttempts: maxAttempts,
        lastExecutionEndedAt: endedAt,
        lastExecutionStatus: result.status,
        resultNote: result.note,
        nextRetryAt: undefined
      }));
      if (completed) {
        updateFirmFromExecution(workspaceId, requestId, completed, result);
      }
      await store.persist();
      return { request: completed, result };
    }

    const shouldRetry = result.status === "errored" && attempts < maxAttempts;
    if (shouldRetry) {
      const nextRetryAt = new Date(Date.now() + submissionRetryDelayMs).toISOString();
      store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "pending_retry",
        executionAttempts: attempts,
        maxExecutionAttempts: maxAttempts,
        lastExecutionEndedAt: endedAt,
        lastExecutionStatus: result.status,
        resultNote: `${result.note} Auto-retrying soon (${attempts}/${maxAttempts}).`,
        nextRetryAt
      }));
      await store.persist();
      await sleep(submissionRetryDelayMs);
      continue;
    }

    const failed = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
      ...current,
      status: "failed",
      executedAt: endedAt,
      executionAttempts: attempts,
      maxExecutionAttempts: maxAttempts,
      lastExecutionEndedAt: endedAt,
      lastExecutionStatus: result.status,
      resultNote: result.note,
      nextRetryAt: undefined
    }));
    if (failed) {
      updateFirmFromExecution(workspaceId, requestId, failed, result);
    }
    await store.persist();
    return { request: failed, result };
  }

  const fallbackResult: SubmissionExecutionResult = lastResult ?? {
    status: "errored",
    note: "Submission exhausted retry budget without a successful result."
  };
  return { request: store.getSubmissionRequest(requestId, workspaceId), result: fallbackResult };
}

async function runSubmissionExecution(workspaceId: string, requestId: string): Promise<{
  request?: ReturnType<StateStore["getSubmissionRequest"]>;
  result: SubmissionExecutionResult;
}> {
  const key = submissionFlightKey(workspaceId, requestId);
  if (submissionInFlight.has(key)) {
    throw new Error("Submission is already being executed");
  }

  submissionInFlight.add(key);
  try {
    return await executeSubmissionWithRetries(workspaceId, requestId);
  } finally {
    submissionInFlight.delete(key);
  }
}

async function runSubmissionWatchdog(): Promise<void> {
  if (submissionWatchdogActive) return;
  submissionWatchdogActive = true;

  try {
    const now = Date.now();
    const workspaces = store.listWorkspaces();

    for (const workspace of workspaces) {
      const requests = store.listSubmissionRequests(workspace.id);

      for (const request of requests) {
        const key = submissionFlightKey(workspace.id, request.id);
        if (submissionInFlight.has(key)) continue;

        if (request.status === "executing") {
          const startedAt = Date.parse(request.lastExecutionStartedAt ?? request.approvedAt ?? request.preparedAt);
          if (Number.isFinite(startedAt) && now - startedAt >= submissionStaleExecutionMs) {
            const attempts = request.executionAttempts ?? 0;
            const maxAttempts = Math.max(1, request.maxExecutionAttempts ?? submissionMaxAttemptsDefault);
            const canRetry = attempts < maxAttempts;
            store.updateSubmissionRequest(workspace.id, request.id, (current) => ({
              ...current,
              status: canRetry ? "pending_retry" : "failed",
              lastExecutionEndedAt: new Date().toISOString(),
              resultNote: canRetry
                ? `Execution timed out. Watchdog scheduled auto-retry (${attempts}/${maxAttempts}).`
                : "Execution timed out and retry budget is exhausted.",
              nextRetryAt: canRetry ? new Date().toISOString() : undefined,
              executedAt: canRetry ? current.executedAt : new Date().toISOString()
            }));
          }
        }
      }

      await store.persist();

      const dueRetries = store
        .listSubmissionRequests(workspace.id)
        .filter(
          (request) =>
            request.status === "pending_retry" &&
            (!request.nextRetryAt || Date.parse(request.nextRetryAt) <= Date.now())
        )
        .slice(0, 6);

      for (const request of dueRetries) {
        const key = submissionFlightKey(workspace.id, request.id);
        if (submissionInFlight.has(key)) continue;
        try {
          await runSubmissionExecution(workspace.id, request.id);
        } catch (error) {
          console.error(`Watchdog submission execution failed for ${request.id}:`, error instanceof Error ? error.message : error);
        }
      }
    }
  } finally {
    submissionWatchdogActive = false;
  }
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((value) => value.trim()) : true
  })
);
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fundraising-formops-hub" });
});

const signupSchema = z.object({
  name: z.string().min(2),
  email: authEmailSchema,
  password: z.string().min(8)
});

app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.signup(parsed.data);
    res.status(201).json({
      message: "Signup successful. Please verify your email before login.",
      verificationEmailSent: result.verificationEmailSent,
      verificationUrl: result.verificationUrl
    });
  })
);

const verifySchema = z.object({ token: z.string().min(12) });
app.post(
  "/api/auth/verify-email",
  asyncHandler(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = await authService.verifyEmail(parsed.data.token);
    res.json({ ok: true, user });
  })
);

const resendVerificationSchema = z.object({ email: authEmailSchema });
app.post(
  "/api/auth/resend-verification",
  asyncHandler(async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.resendVerificationEmail(parsed.data.email);
    const message = result.alreadyVerified
      ? "This email is already verified. Please sign in."
      : result.verificationEmailSent
        ? "If your account exists and is not verified, a new verification email has been sent."
        : "If your account exists and is not verified, we could not deliver the verification email right now. Please try again later.";

    res.json({
      ok: true,
      message,
      verificationEmailSent: result.verificationEmailSent,
      verificationUrl: result.verificationUrl
    });
  })
);

const forgotPasswordSchema = z.object({ email: authEmailSchema });
app.post(
  "/api/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.requestPasswordReset(parsed.data.email);
    const message = result.resetEmailSent
      ? "If this email exists, a password reset link has been sent."
      : "If this email exists, we could not deliver the reset email right now. Please try again later.";

    res.json({
      ok: true,
      message,
      resetEmailSent: result.resetEmailSent,
      resetUrl: result.resetUrl
    });
  })
);

const resetPasswordSchema = z.object({
  token: z.string().min(12),
  password: z.string().min(8)
});

app.post(
  "/api/auth/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    await authService.resetPassword(parsed.data.token, parsed.data.password);
    res.json({ ok: true, message: "Password reset successful. You can now sign in." });
  })
);

const loginSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(8)
});

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const result = await authService.login(parsed.data.email, parsed.data.password);
    res.json(result);
  })
);

app.use(
  "/api",
  asyncHandler(async (req, res, next) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    if (
      req.path === "/health" ||
      req.path === "/auth/signup" ||
      req.path === "/auth/verify-email" ||
      req.path === "/auth/resend-verification" ||
      req.path === "/auth/forgot-password" ||
      req.path === "/auth/reset-password" ||
      req.path === "/auth/login"
    ) {
      next();
      return;
    }

    const token = parseBearerToken(req.header("authorization"));
    if (!token) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await authService.getUserByToken(token);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    res.locals.authUser = user;
    res.locals.authToken = token;
    next();
  })
);

app.get("/api/auth/me", (_req, res) => {
  res.json({ user: getAuthUser(res) });
});

const authProfilePatchSchema = z.object({
  name: z.string().min(2)
});

app.patch(
  "/api/auth/profile",
  asyncHandler(async (req, res) => {
    const parsed = authProfilePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    const updated = await authService.updateProfile(user.id, parsed.data);
    res.json({ user: updated });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8)
});

app.post(
  "/api/auth/change-password",
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    await authService.changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    res.json({ ok: true, message: "Password updated successfully." });
  })
);

app.post(
  "/api/auth/logout",
  asyncHandler(async (_req, res) => {
    const token = res.locals.authToken as string | undefined;
    if (token) {
      await authService.logout(token);
    }
    res.json({ ok: true });
  })
);

app.get(
  "/api/workspaces",
  asyncHandler(async (_req, res) => {
    const user = getAuthUser(res);
    const membershipIds = await authService.listWorkspaceIds(user.id);
    const membershipSet = new Set(membershipIds);
    const scoped = store.listWorkspaces().filter((workspace) => membershipSet.has(workspace.id));

    const globalActiveId = store.getActiveWorkspaceId();
    const activeWorkspaceId = membershipSet.has(globalActiveId) ? globalActiveId : scoped[0]?.id;

    res.json({ activeWorkspaceId, workspaces: scoped });
  })
);

const createWorkspaceSchema = z.object({
  name: z.string().min(2),
  company: z.string().optional(),
  website: z.string().optional()
});

app.post(
  "/api/workspaces",
  asyncHandler(async (req, res) => {
    const parsed = createWorkspaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    const profile = buildTemplateProfile(parsed.data.company ?? parsed.data.name);
    if (parsed.data.website) {
      profile.website = parsed.data.website;
    }

    const workspace = store.createWorkspaceEntry(parsed.data.name, profile);
    await authService.addWorkspaceMembership(user.id, workspace.id, "owner");
    await store.persist();

    res.status(201).json(workspace);
  })
);

app.post(
  "/api/workspaces/:id/activate",
  asyncHandler(async (req, res) => {
    const user = getAuthUser(res);
    const hasAccess = await authService.userHasWorkspaceAccess(user.id, req.params.id);
    if (!hasAccess) {
      res.status(403).json({ message: "Forbidden workspace access" });
      return;
    }

    const ok = store.setActiveWorkspace(req.params.id);
    if (!ok) {
      res.status(404).json({ message: "Workspace not found" });
      return;
    }

    await store.persist();
    res.json({ ok: true });
  })
);

const profilePatchSchema = z.object({
  company: z.string().optional(),
  website: z.string().optional(),
  oneLiner: z.string().optional(),
  longDescription: z.string().optional(),
  senderName: z.string().optional(),
  senderTitle: z.string().optional(),
  senderEmail: z.string().optional(),
  senderPhone: z.string().optional(),
  linkedin: z.string().optional(),
  calendly: z.string().optional(),
  metrics: z
    .object({
      arr: z.string().optional(),
      mrr: z.string().optional(),
      subscribers: z.string().optional(),
      countries: z.string().optional(),
      ltvCac: z.string().optional(),
      churn: z.string().optional(),
      cumulativeRevenue: z.string().optional()
    })
    .optional(),
  fundraising: z
    .object({
      round: z.string().optional(),
      amount: z.string().optional(),
      valuation: z.string().optional(),
      secured: z.string().optional(),
      instrument: z.string().optional(),
      deckUrl: z.string().optional(),
      dataRoomUrl: z.string().optional()
    })
    .optional()
});

app.patch(
  "/api/workspaces/:id/profile",
  asyncHandler(async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const user = getAuthUser(res);
    const hasAccess = await authService.userHasWorkspaceAccess(user.id, req.params.id);
    if (!hasAccess) {
      res.status(403).json({ message: "Forbidden workspace access" });
      return;
    }

    const updated = store.updateWorkspaceProfile(req.params.id, parsed.data as Partial<CompanyProfile>);
    if (!updated) {
      res.status(404).json({ message: "Workspace not found" });
      return;
    }

    await store.persist();
    res.json(updated);
  })
);

app.get(
  "/api/workspaces/:id/readiness",
  asyncHandler(async (req, res) => {
    const user = getAuthUser(res);
    const hasAccess = await authService.userHasWorkspaceAccess(user.id, req.params.id);
    if (!hasAccess) {
      res.status(403).json({ message: "Forbidden workspace access" });
      return;
    }

    const workspace = store.getWorkspace(req.params.id);
    if (!workspace) {
      res.status(404).json({ message: "Workspace not found" });
      return;
    }

    const missing = validateProfileReadiness(workspace.profile);
    const investorCount = store.listFirms(req.params.id).length;
    const ready = missing.length === 0 && investorCount > 0;

    res.json({
      workspaceId: workspace.id,
      ready,
      missingFields: missing,
      investorCount
    });
  })
);

app.get(
  "/api/profile",
  asyncHandler(async (req, res) => {
    const { workspace } = await resolveWorkspaceContext(req, res);
    res.json(workspace.profile);
  })
);

app.get(
  "/api/dashboard/overview",
  asyncHandler(async (req, res) => {
    const { workspace, workspaceId } = await resolveWorkspaceContext(req, res);

    // Use cached analytics if available (15s TTL) unless ?fresh=true
    const skipCache = req.query.fresh === "true";
    let overview = skipCache ? undefined : getCachedOverview(workspaceId);

    if (!overview) {
      overview = buildOverview(
        workspace,
        store.listFirms(workspaceId),
        store.listEvents(workspaceId),
        store.listRuns(workspaceId),
        store.listSubmissionRequests(workspaceId),
        store.listTasks(workspaceId),
        store.listLogs(workspaceId)
      );
    }

    res.json({ ...overview, creditBalance: creditService.getBalance(workspaceId) });
  })
);

app.get(
  "/api/firms",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const all = store.listFirms(workspaceId);
    const start = (page - 1) * limit;
    res.json({ firms: all.slice(start, start + limit), total: all.length });
  })
);

app.get(
  "/api/export/firms.csv",
  asyncHandler(async (req, res) => {
    const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
    const firms = store.listFirms(workspaceId);

    const csv = toCsv(
      [
        "id",
        "name",
        "website",
        "geography",
        "investor_type",
        "check_size_range",
        "focus_sectors",
        "stage_focus",
        "stage",
        "status_reason",
        "last_touched_at"
      ],
      firms.map((firm) => ({
        id: firm.id,
        name: firm.name,
        website: firm.website,
        geography: firm.geography,
        investor_type: firm.investorType,
        check_size_range: firm.checkSizeRange,
        focus_sectors: firm.focusSectors.join("|"),
        stage_focus: firm.stageFocus.join("|"),
        stage: firm.stage,
        status_reason: firm.statusReason,
        last_touched_at: firm.lastTouchedAt ?? ""
      }))
    );

    const fileName = `${safeFilePart(workspace.name)}-firms-${dayjs().format("YYYYMMDD-HHmm")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  })
);

app.get(
  "/api/imports",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    res.json(store.listImportBatches(workspaceId).sort((a, b) => (a.importedAt > b.importedAt ? -1 : 1)));
  })
);

app.get(
  "/api/lists",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const firms = store.listFirms(workspaceId);
    const batches = store.listImportBatches(workspaceId);
    res.json(summarizeLeadLists(firms, batches));
  })
);

const renameListSchema = z.object({
  currentName: z.string().trim().min(1),
  nextName: z.string().trim().min(1).max(120)
});

app.post(
  "/api/lists/rename",
  asyncHandler(async (req, res) => {
    const parsed = renameListSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const currentName = normalizeListName(parsed.data.currentName);
    const nextName = normalizeListName(parsed.data.nextName);

    if (!currentName || !nextName) {
      res.status(400).json({ message: "Invalid list name." });
      return;
    }

    const currentKey = normalizeListKey(currentName);
    const nextKey = normalizeListKey(nextName);
    if (currentKey === nextKey) {
      res.json({ ok: true, updatedLeads: 0, updatedBatches: 0, lists: summarizeLeadLists(store.listFirms(workspaceId), store.listImportBatches(workspaceId)) });
      return;
    }

    const firms = store.listFirms(workspaceId);
    let updatedLeads = 0;
    for (const firm of firms) {
      if (normalizeListKey(firm.sourceListName) !== currentKey) continue;
      store.upsertFirm({
        ...firm,
        sourceListName: nextName,
        lastTouchedAt: new Date().toISOString()
      });
      updatedLeads += 1;
    }

    const batches = store.listImportBatches(workspaceId);
    let updatedBatches = 0;
    store.replaceWorkspaceImportBatches(
      workspaceId,
      batches.map((batch) => {
        if (normalizeListKey(batch.sourceName) !== currentKey) return batch;
        updatedBatches += 1;
        return { ...batch, sourceName: nextName };
      })
    );

    if (updatedLeads === 0 && updatedBatches === 0) {
      res.status(404).json({ message: "List not found." });
      return;
    }

    await runWorkspaceMaintenance(workspaceId);
    void runResearchWatchdog();
    res.json({
      ok: true,
      updatedLeads,
      updatedBatches,
      lists: summarizeLeadLists(store.listFirms(workspaceId), store.listImportBatches(workspaceId))
    });
  })
);

const deleteListSchema = z.object({
  name: z.string().trim().min(1),
  deleteLeads: z.boolean().optional().default(false)
});

app.post(
  "/api/lists/delete",
  asyncHandler(async (req, res) => {
    const parsed = deleteListSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const listName = normalizeListName(parsed.data.name);
    if (!listName) {
      res.status(400).json({ message: "Unassigned list cannot be deleted." });
      return;
    }

    const listKey = normalizeListKey(listName);
    const firms = store.listFirms(workspaceId);
    const matched = firms.filter((firm) => normalizeListKey(firm.sourceListName) === listKey);

    if (matched.length === 0) {
      res.status(404).json({ message: "List not found." });
      return;
    }

    let removedLeads = 0;
    let unassignedLeads = 0;
    if (parsed.data.deleteLeads) {
      const removed = store.removeWorkspaceFirms(workspaceId, new Set(matched.map((firm) => firm.id)));
      removedLeads = removed.removedFirms;
    } else {
      for (const firm of matched) {
        store.upsertFirm({
          ...firm,
          sourceListName: undefined,
          lastTouchedAt: new Date().toISOString(),
          notes: mergeUniqueText([...(firm.notes ?? []), `List '${listName}' removed. Lead moved to Unassigned.`], 24)
        });
        unassignedLeads += 1;
      }
    }

    const batches = store.listImportBatches(workspaceId);
    const filteredBatches = batches.filter((batch) => normalizeListKey(batch.sourceName) !== listKey);
    const removedBatches = batches.length - filteredBatches.length;
    if (removedBatches > 0) {
      store.replaceWorkspaceImportBatches(workspaceId, filteredBatches);
    }

    await runWorkspaceMaintenance(workspaceId);
    void runResearchWatchdog();
    res.json({
      ok: true,
      removedLeads,
      unassignedLeads,
      removedBatches,
      lists: summarizeLeadLists(store.listFirms(workspaceId), store.listImportBatches(workspaceId))
    });
  })
);

const importFileSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  base64Data: z.string().min(1),
  listName: z.string().trim().min(1).max(120).optional()
});

app.post(
  "/api/firms/import-file",
  asyncHandler(async (req, res) => {
    const parsed = importFileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const parsedImport = parseFirmsFromUpload(parsed.data.base64Data, parsed.data.fileName, parsed.data.mimeType, workspaceId);
    const batchId = uuid();
    const listName =
      normalizeListName(parsed.data.listName) ??
      normalizeListName(baseNameFromFile(parsed.data.fileName)) ??
      "Imported List";
    const existing = store.listFirms(workspaceId);
    const existingKeys = new Set(existing.map((firm) => normalizeFirmIdentity(firm.name, firm.website)));

    let skippedDuplicates = 0;
    const uniqueInBatch = new Set<string>();
    const newFirms: typeof parsedImport.firms = [];
    for (const firm of parsedImport.firms) {
      const key = normalizeFirmIdentity(firm.name, firm.website);
      if (existingKeys.has(key) || uniqueInBatch.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      uniqueInBatch.add(key);
      existingKeys.add(key);
      newFirms.push({
        ...firm,
        importBatchId: batchId,
        sourceListName: listName
      });
    }

    if (parsedImport.firms.length === 0) {
      store.addImportBatch({
        id: batchId,
        workspaceId,
        sourceName: listName,
        sourceType: parsedImport.sourceType,
        importedCount: 0,
        importedAt: new Date().toISOString(),
        status: "failed",
        note: "No valid investors found. Include at least company/fund name and website/domain columns."
      });
      await store.persist();
      res.status(400).json({
        message: "No valid investors found in file. Required columns include company/fund name and website/domain."
      });
      return;
    }
    if (newFirms.length === 0) {
      store.addImportBatch({
        id: batchId,
        workspaceId,
        sourceName: listName,
        sourceType: parsedImport.sourceType,
        importedCount: 0,
        importedAt: new Date().toISOString(),
        status: "completed",
        note: `All ${parsedImport.firms.length} leads already exist and were skipped.`
      });
      await runWorkspaceMaintenance(workspaceId);
      void runResearchWatchdog();
      res.json({
        imported: 0,
        sourceType: parsedImport.sourceType,
        listName,
        batchId,
        skippedDuplicates,
        totalParsed: parsedImport.firms.length
      });
      return;
    }

    for (const firm of newFirms) {
      store.upsertFirm(firm);
    }

    store.addImportBatch({
      id: batchId,
      workspaceId,
      sourceName: listName,
      sourceType: parsedImport.sourceType,
      importedCount: newFirms.length,
      importedAt: new Date().toISOString(),
      status: "completed",
      note: skippedDuplicates > 0 ? `${skippedDuplicates} duplicates skipped.` : undefined
    });

    await runWorkspaceMaintenance(workspaceId);
    void runResearchWatchdog();
    res.json({
      imported: newFirms.length,
      sourceType: parsedImport.sourceType,
      listName,
      batchId,
      skippedDuplicates,
      totalParsed: parsedImport.firms.length
    });
  })
);

const importDriveSchema = z.object({
  link: z.string().url(),
  listName: z.string().trim().min(1).max(120).optional()
});

app.post(
  "/api/firms/import-drive",
  asyncHandler(async (req, res) => {
    const parsed = importDriveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const batchId = uuid();
    const listName =
      normalizeListName(parsed.data.listName) ??
      `Drive List ${dayjs().format("YYYY-MM-DD HH:mm")}`;
    const existing = store.listFirms(workspaceId);
    const existingKeys = new Set(existing.map((firm) => normalizeFirmIdentity(firm.name, firm.website)));

    try {
      const parsedImport = await parseFirmsFromGoogleDriveLink(parsed.data.link, workspaceId);
      if (parsedImport.firms.length === 0) {
        store.addImportBatch({
          id: batchId,
          workspaceId,
          sourceName: listName,
          sourceType: "google_drive",
          importedCount: 0,
          importedAt: new Date().toISOString(),
          status: "failed",
          note: "No valid investors found. Include at least company/fund name and website/domain columns."
        });
        await store.persist();
        res.status(400).json({
          message: "No valid investors found in Google Drive file. Required columns include company/fund name and website/domain."
        });
        return;
      }
      let skippedDuplicates = 0;
      const uniqueInBatch = new Set<string>();
      const newFirms: typeof parsedImport.firms = [];
      for (const firm of parsedImport.firms) {
        const key = normalizeFirmIdentity(firm.name, firm.website);
        if (existingKeys.has(key) || uniqueInBatch.has(key)) {
          skippedDuplicates += 1;
          continue;
        }
        uniqueInBatch.add(key);
        existingKeys.add(key);
        newFirms.push({
          ...firm,
          importBatchId: batchId,
          sourceListName: listName
        });
      }

      if (newFirms.length === 0) {
        store.addImportBatch({
          id: batchId,
          workspaceId,
          sourceName: listName,
          sourceType: "google_drive",
          importedCount: 0,
          importedAt: new Date().toISOString(),
          status: "completed",
          note: `All ${parsedImport.firms.length} leads already exist and were skipped.`
        });
        await runWorkspaceMaintenance(workspaceId);
        void runResearchWatchdog();
        res.json({
          imported: 0,
          sourceType: "google_drive",
          listName,
          batchId,
          skippedDuplicates,
          totalParsed: parsedImport.firms.length
        });
        return;
      }

      for (const firm of newFirms) {
        store.upsertFirm(firm);
      }

      store.addImportBatch({
        id: batchId,
        workspaceId,
        sourceName: listName,
        sourceType: "google_drive",
        importedCount: newFirms.length,
        importedAt: new Date().toISOString(),
        status: "completed",
        note: skippedDuplicates > 0 ? `${skippedDuplicates} duplicates skipped.` : undefined
      });

      await runWorkspaceMaintenance(workspaceId);
      void runResearchWatchdog();
      res.json({
        imported: newFirms.length,
        sourceType: "google_drive",
        listName,
        batchId,
        skippedDuplicates,
        totalParsed: parsedImport.firms.length
      });
    } catch (error) {
      store.addImportBatch({
        id: batchId,
        workspaceId,
        sourceName: listName,
        sourceType: "google_drive",
        importedCount: 0,
        importedAt: new Date().toISOString(),
        status: "failed",
        note: error instanceof Error ? error.message : "Google Drive import failed"
      });
      await store.persist();
      res.status(400).json({ message: error instanceof Error ? error.message : "Google Drive import failed" });
    }
  })
);

app.get(
  "/api/firms/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const firm = store.getFirm(req.params.id, workspaceId);
    if (!firm) {
      res.status(404).json({ message: "Firm not found" });
      return;
    }

    const events = store
      .listEvents(workspaceId)
      .filter((event) => event.firmId === firm.id)
      .sort((a, b) => (a.attemptedAt > b.attemptedAt ? -1 : 1))
      .slice(0, 80);
    const submissionRequests = store
      .listSubmissionRequests(workspaceId)
      .filter((request) => request.firmId === firm.id)
      .sort((a, b) => (a.preparedAt > b.preparedAt ? -1 : 1))
      .slice(0, 50);
    const logs = store
      .listLogs(workspaceId)
      .filter((log) => log.firmId === firm.id)
      .sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))
      .slice(0, 80);

    res.json({ firm, events, submissionRequests, logs });
  })
);

app.post(
  "/api/firms/:id/research",
  asyncHandler(async (req, res) => {
    const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
    const firm = store.getFirm(req.params.id, workspaceId);
    if (!firm) {
      res.status(404).json({ message: "Firm not found" });
      return;
    }

    const runId = `manual-research-${workspaceId}`;
    const ok = await runFirmResearch(workspace, firm.id, runId, "Manual research refresh started.");
    await store.persist();

    if (!ok) {
      res.status(500).json({ message: "Research failed. Check logs and try again." });
      return;
    }

    const updated = store.getFirm(firm.id, workspaceId) ?? firm;
    res.json({ ok: true, firm: updated });
  })
);

const queueResearchSchema = z.object({
  firmIds: z.array(z.string().min(1)).max(800).optional(),
  listNames: z.array(z.string().min(1)).max(200).optional(),
  limit: z.number().int().min(1).max(1200).optional()
});

app.post(
  "/api/research/run",
  asyncHandler(async (req, res) => {
    const parsed = queueResearchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const now = new Date().toISOString();
    const limit = parsed.data.limit ?? 300;
    const idFilter = parsed.data.firmIds ? new Set(parsed.data.firmIds) : undefined;
    const listFilter = parsed.data.listNames
      ? new Set(parsed.data.listNames.map((name) => normalizeListKey(name)))
      : undefined;

    let queued = 0;
    for (const firm of store.listFirms(workspaceId)) {
      if (queued >= limit) break;
      if (idFilter && !idFilter.has(firm.id)) continue;
      if (listFilter && !listFilter.has(normalizeListKey(firm.sourceListName))) continue;

      store.upsertFirm({
        ...firm,
        researchedAt: undefined,
        statusReason: "Queued for research refresh.",
        stage: ["lead", "researching", "qualified", "form_discovered"].includes(firm.stage) ? "lead" : firm.stage,
        lastTouchedAt: now
      });
      queued += 1;
    }

    if (queued > 0) {
      await store.persist();
      void runResearchWatchdog();
    }

    res.json({ ok: true, queued });
  })
);

const updateStageSchema = z.object({
  stage: z.enum(["lead", "researching", "qualified", "form_discovered", "form_filled", "submitted", "review", "won", "lost"]),
  statusReason: z.string().min(1)
});

app.patch(
  "/api/firms/:id/stage",
  asyncHandler(async (req, res) => {
    const parsed = updateStageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const firm = store.getFirm(req.params.id, workspaceId);
    if (!firm) {
      res.status(404).json({ message: "Firm not found" });
      return;
    }

    store.upsertFirm({
      ...firm,
      stage: parsed.data.stage,
      statusReason: parsed.data.statusReason,
      lastTouchedAt: new Date().toISOString()
    });

    await store.persist();
    res.json({ ok: true });
  })
);

app.get(
  "/api/submissions/queue",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    res.json(store.listSubmissionRequests(workspaceId).sort((a, b) => (a.preparedAt > b.preparedAt ? -1 : 1)));
  })
);

app.get(
  "/api/submissions/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const request = store.getSubmissionRequest(req.params.id, workspaceId);
    if (!request) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    const firm = store.getFirm(request.firmId, workspaceId);
    const events = store
      .listEvents(workspaceId)
      .filter((event) => event.firmId === request.firmId)
      .sort((a, b) => (a.attemptedAt > b.attemptedAt ? -1 : 1))
      .slice(0, 40);

    res.json({
      request,
      firm,
      events
    });
  })
);

app.get(
  "/api/export/submissions.csv",
  asyncHandler(async (req, res) => {
    const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
    const queue = store.listSubmissionRequests(workspaceId);

    const csv = toCsv(
      [
        "id",
        "firm_name",
        "website",
        "status",
        "mode",
        "prepared_at",
        "approved_by",
        "approved_at",
        "executed_at",
        "execution_attempts",
        "max_execution_attempts",
        "last_execution_status",
        "next_retry_at",
        "result_note"
      ],
      queue.map((request) => ({
        id: request.id,
        firm_name: request.firmName,
        website: request.website,
        status: request.status,
        mode: request.mode,
        prepared_at: request.preparedAt,
        approved_by: request.approvedBy ?? "",
        approved_at: request.approvedAt ?? "",
        executed_at: request.executedAt ?? "",
        execution_attempts: request.executionAttempts ?? 0,
        max_execution_attempts: request.maxExecutionAttempts ?? 0,
        last_execution_status: request.lastExecutionStatus ?? "",
        next_retry_at: request.nextRetryAt ?? "",
        result_note: request.resultNote ?? ""
      }))
    );

    const fileName = `${safeFilePart(workspace.name)}-submissions-${dayjs().format("YYYYMMDD-HHmm")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  })
);

const bulkApproveSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  approvedBy: z.string().default("Operator")
});

app.post(
  "/api/submissions/actions/bulk-approve",
  asyncHandler(async (req, res) => {
    const parsed = bulkApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const uniqueIds = [...new Set(parsed.data.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    const succeeded: string[] = [];

    for (const requestId of uniqueIds) {
      const existing = store.getSubmissionRequest(requestId, workspaceId);
      if (!existing) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }
      if (!canApproveFromStatus(existing.status)) {
        failed.push({ id: requestId, message: `Cannot approve from status '${existing.status}'` });
        continue;
      }

      const approved = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "approved",
        approvedBy: parsed.data.approvedBy,
        approvedAt: new Date().toISOString()
      }));

      if (!approved) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }

      try {
        await runSubmissionExecution(workspaceId, requestId);
        succeeded.push(requestId);
      } catch (error) {
        failed.push({
          id: requestId,
          message: error instanceof Error ? error.message : "Execution failed"
        });
      }
    }

    await store.persist();
    res.json({
      processed: uniqueIds.length,
      approved: succeeded.length,
      failed
    });
  })
);

const bulkRejectSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  rejectedBy: z.string().default("Operator"),
  reason: z.string().default("Rejected by operator")
});

app.post(
  "/api/submissions/actions/bulk-reject",
  asyncHandler(async (req, res) => {
    const parsed = bulkRejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const uniqueIds = [...new Set(parsed.data.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let rejected = 0;

    for (const requestId of uniqueIds) {
      const existing = store.getSubmissionRequest(requestId, workspaceId);
      if (!existing) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }

      const updated = store.updateSubmissionRequest(workspaceId, requestId, (current) => ({
        ...current,
        status: "rejected",
        approvedBy: parsed.data.rejectedBy,
        approvedAt: new Date().toISOString(),
        resultNote: parsed.data.reason
      }));

      if (!updated) {
        failed.push({ id: requestId, message: "Submission request not found" });
        continue;
      }
      rejected += 1;
    }

    await store.persist();
    res.json({
      processed: uniqueIds.length,
      rejected,
      failed
    });
  })
);

const approveSubmissionSchema = z.object({ approvedBy: z.string().default("Operator") });

app.post(
  "/api/submissions/:id/approve",
  asyncHandler(async (req, res) => {
    const parsed = approveSubmissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const existing = store.getSubmissionRequest(req.params.id, workspaceId);
    if (!existing) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }
    if (!canApproveFromStatus(existing.status)) {
      res.status(409).json({ message: `Submission cannot be approved from status '${existing.status}'` });
      return;
    }

    const approved = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({
      ...current,
      status: "approved",
      approvedBy: parsed.data.approvedBy,
      approvedAt: new Date().toISOString()
    }));

    if (!approved) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    const execution = await runSubmissionExecution(workspaceId, req.params.id);
    res.json(execution);
  })
);

const rejectSubmissionSchema = z.object({
  rejectedBy: z.string().default("Operator"),
  reason: z.string().default("Rejected by operator")
});

app.post(
  "/api/submissions/:id/reject",
  asyncHandler(async (req, res) => {
    const parsed = rejectSubmissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const updated = store.updateSubmissionRequest(workspaceId, req.params.id, (current) => ({
      ...current,
      status: "rejected",
      approvedBy: parsed.data.rejectedBy,
      approvedAt: new Date().toISOString(),
      resultNote: parsed.data.reason
    }));

    if (!updated) {
      res.status(404).json({ message: "Submission request not found" });
      return;
    }

    await store.persist();
    res.json(updated);
  })
);

app.get(
  "/api/runs",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    res.json(store.listRuns(workspaceId));
  })
);

app.get(
  "/api/runs/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = await resolveWorkspaceContext(req, res);
    const run = store.getRun(req.params.id, workspaceId);
    if (!run) {
      res.status(404).json({ message: "Run not found" });
      return;
    }

    res.json({
      run,
      tasks: store.listTasksByRun(run.id, workspaceId),
      logs: store.listLogsByRun(run.id, workspaceId)
    });
  })
);

const runSchema = z.object({
  initiatedBy: z.string().optional(),
  mode: z.enum(["dry_run", "production"]).default("dry_run"),
  firmIds: z.array(z.string()).optional(),
  workspaceId: z.string().optional()
});

app.post(
  "/api/runs",
  asyncHandler(async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.flatten() });
      return;
    }

    const { workspaceId, workspace, user } = await resolveWorkspaceContext(req, res);
    const missing = validateProfileReadiness(workspace.profile);
    if (missing.length > 0) {
      res.status(400).json({ message: `Project knowledge base is incomplete. Missing: ${missing.join(", ")}` });
      return;
    }

    const run = await orchestrator.createRun({
      initiatedBy: parsed.data.initiatedBy ?? user.name,
      mode: parsed.data.mode,
      firmIds: parsed.data.firmIds,
      workspaceId
    });

    res.status(201).json(run);
  })
);

if (featureCreditsEnabled) {
  app.get(
    "/api/credits/balance",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      res.json(creditService.getBalance(workspaceId));
    })
  );

  app.get(
    "/api/credits/transactions",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      res.json(creditService.listTransactions(workspaceId));
    })
  );

  app.post(
    "/api/credits/purchase",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      const packs = Math.max(1, Number(req.body?.packs) || 1);
      const transaction = await creditService.recordPurchase(workspaceId, packs);
      res.status(201).json({ transaction, balance: creditService.getBalance(workspaceId) });
    })
  );
}

if (featureAssessmentEnabled) {
  app.post(
    "/api/assess",
    asyncHandler(async (req, res) => {
      const { workspaceId, workspace } = await resolveWorkspaceContext(req, res);
      const firms = store.listFirms(workspaceId);

      const assessment: AssessmentResult = {
        id: uuid(),
        workspaceId,
        status: "running",
        startedAt: new Date().toISOString(),
        matches: [],
        totalFirmsAnalyzed: firms.length
      };

      store.addAssessment(assessment);
      await store.persist();

      const { assessInvestors } = await import("./services/ai-assessor.js");
      assessInvestors(workspace.profile, firms)
        .then(async (matches) => {
          for (const match of matches) {
            const firm = store.getFirm(match.firmId, workspaceId);
            if (firm) {
              store.upsertFirm({ ...firm, matchScore: match.score, matchReasoning: match.reasoning });
            }
          }

          store.updateAssessment(assessment.id, (current) => ({
            ...current,
            status: "completed",
            completedAt: new Date().toISOString(),
            matches
          }));

          await store.persist();
        })
        .catch(async (error) => {
          store.updateAssessment(assessment.id, (current) => ({
            ...current,
            status: "failed",
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Assessment failed"
          }));

          await store.persist();
        });

      res.status(202).json(assessment);
    })
  );

  app.get(
    "/api/assess/latest",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      const latest = store.getLatestAssessment(workspaceId);
      if (!latest) {
        res.status(404).json({ message: "No assessment found" });
        return;
      }

      res.json(latest);
    })
  );

  app.get(
    "/api/assess/:id",
    asyncHandler(async (req, res) => {
      const { workspaceId } = await resolveWorkspaceContext(req, res);
      const assessment = store.getAssessment(req.params.id);
      if (!assessment) {
        res.status(404).json({ message: "Assessment not found" });
        return;
      }
      if (assessment.workspaceId !== workspaceId) {
        res.status(404).json({ message: "Assessment not found" });
        return;
      }

      res.json(assessment);
    })
  );
}

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", error.message);
  res.status(error.status ?? 500).json({ message: error.message || "Internal server error" });
});

async function start(): Promise<void> {
  await store.init();
  await authService.init();

  await authService.ensureMembershipsForUser(process.env.AUTH_EMAIL ?? "founder@vcops.local", store.listWorkspaces().map((w) => w.id));

  const workspaces = store.listWorkspaces();
  for (const workspace of workspaces) {
    await runWorkspaceMaintenance(workspace.id);
  }

  setInterval(() => {
    void runSubmissionWatchdog();
  }, submissionWatchdogIntervalMs);
  void runSubmissionWatchdog();

  setInterval(() => {
    void runResearchWatchdog();
  }, researchIntervalMs);
  void runResearchWatchdog();

  app.listen(port, () => {
    console.log(`VCReach backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
