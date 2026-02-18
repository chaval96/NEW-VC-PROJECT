import type { PipelineStage, SubmissionRequestStatus, SubmissionStatus } from "@shared/types";

type StatusValue = PipelineStage | SubmissionStatus | SubmissionRequestStatus | string;

const pillMap: Record<string, string> = {
  lead: "pill-slate",
  researching: "pill-blue",
  qualified: "pill-blue",
  form_discovered: "pill-blue",
  form_filled: "pill-blue",
  submitted: "pill-green",
  review: "pill-amber",
  won: "pill-green",
  lost: "pill-red",
  queued: "pill-blue",
  no_form_found: "pill-amber",
  needs_review: "pill-amber",
  blocked: "pill-red",
  errored: "pill-red",
  pending_approval: "pill-blue",
  pending_retry: "pill-amber",
  approved: "pill-green",
  rejected: "pill-amber",
  executing: "pill-blue",
  completed: "pill-green",
  failed: "pill-red",
  running: "pill-blue",
};

const labelMap: Record<string, string> = {
  researching: "lead",
  form_discovered: "qualified"
};

export function StatusPill({ status }: { status: StatusValue }): JSX.Element {
  const cls = pillMap[status] ?? "pill-slate";
  const normalizedLabel = labelMap[String(status)] ?? String(status).replaceAll("_", " ");
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide font-mono ${cls}`}>
      {normalizedLabel}
    </span>
  );
}
