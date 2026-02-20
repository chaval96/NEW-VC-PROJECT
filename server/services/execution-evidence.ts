import path from "node:path";

const rawRoot = process.env.EXECUTION_EVIDENCE_DIR?.trim() || "server/data/evidence";
export const evidenceRootDir = path.resolve(process.cwd(), rawRoot);

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function buildPreSubmitScreenshotRelativePath(
  workspaceId: string,
  requestId: string,
  attempt: number
): string {
  const safeWorkspace = sanitizeSegment(workspaceId);
  const safeRequest = sanitizeSegment(requestId);
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return path.posix.join(safeWorkspace, safeRequest, `attempt-${safeAttempt}`, "pre-submit.png");
}

export function resolveEvidenceAbsolutePath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = path.resolve(evidenceRootDir, normalized);
  if (!absolute.startsWith(evidenceRootDir)) {
    throw new Error("Invalid evidence path");
  }
  return absolute;
}
