import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { activateWorkspace, getFirmDetail, runLeadResearch } from "../api";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import type { FirmDetail } from "../types";

function displayValue(value?: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === "unknown" || normalized === "-") {
    return "Not specified";
  }
  return normalized;
}

function looksLegacySummary(summary: string): boolean {
  const lower = summary.toLowerCase();
  return lower.includes("|") && (lower.includes("geo:") || lower.includes("sectors:") || lower.includes("stages:") || lower.includes("focus:"));
}

function parseLegacyToken(summary: string, token: string): string | undefined {
  const regex = new RegExp(`${token}\\s*:\\s*([^|]+)`, "i");
  const match = summary.match(regex);
  return match?.[1]?.trim();
}

function formatList(value?: string, fallback = "not clearly specified"): string {
  if (!value) return fallback;
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function generateBrief(detail: FirmDetail): string {
  const summary = detail.firm.researchSummary?.trim();
  if (summary && !looksLegacySummary(summary) && summary.length > 40) {
    return summary;
  }

  const geo = parseLegacyToken(summary ?? "", "geo") ?? displayValue(detail.firm.geography);
  const sectors = parseLegacyToken(summary ?? "", "sectors") ?? (detail.firm.focusSectors ?? []).filter((item) => item.toLowerCase() !== "general").join(", ");
  const stages = parseLegacyToken(summary ?? "", "stages") ?? (detail.firm.stageFocus ?? []).join(", ");
  const focus = parseLegacyToken(summary ?? "", "focus") ?? (detail.firm.investmentFocus ?? []).join(", ");
  const form = parseLegacyToken(summary ?? "", "form");

  const line1 = `${detail.firm.name} is profiled as ${displayValue(detail.firm.investorType)}${geo !== "Not specified" ? ` based in ${geo}` : ""}.`;
  const line2 = sectors
    ? `The firm appears active in ${formatList(sectors)} and is mainly aligned with ${formatList(stages)} rounds.`
    : `Sector and stage preferences are not fully disclosed, but current data suggests alignment with ${formatList(stages)} rounds.`;
  const line3 =
    focus && focus.toLowerCase() !== "not specified"
      ? `Its geographic or thesis focus points to ${formatList(focus)}.`
      : "Its geographic investment focus is still being validated.";
  const line4 =
    form?.toLowerCase() === "discovered"
      ? "A startup application/contact route is discoverable on the website."
      : form?.toLowerCase() === "not found"
        ? "A clear startup form route has not been found on the current site."
        : "Form availability is currently not confirmed and remains under validation.";

  return [line1, line2, line3, line4].join(" ");
}

export function LeadDetailPage(): JSX.Element {
  const { workspaceId, firmId } = useParams<{ workspaceId: string; firmId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<FirmDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [researching, setResearching] = useState(false);

  useEffect(() => {
    if (!workspaceId || !firmId) {
      navigate("/projects");
      return;
    }

    const load = async (): Promise<void> => {
      try {
        await activateWorkspace(workspaceId);
        const result = await getFirmDetail(workspaceId, firmId);
        setDetail(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load lead detail.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [workspaceId, firmId, navigate]);

  if (loading) {
    return <div className="mx-auto max-w-6xl px-6 py-8" />;
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-slate-500">{error ?? "Lead not found."}</p>
      </div>
    );
  }

  const investorBrief = generateBrief(detail);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-in">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{detail.firm.name}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{detail.firm.website}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (!workspaceId || !firmId) return;
              setResearching(true);
              setError(undefined);
              try {
                await runLeadResearch(workspaceId, firmId);
                const result = await getFirmDetail(workspaceId, firmId);
                setDetail(result);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Research refresh failed.");
              } finally {
                setResearching(false);
              }
            }}
            disabled={researching}
          >
            {researching ? "Refreshing..." : "Refresh Research"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${workspaceId}/operations`)}>
            Back to Operations
          </Button>
          <StatusPill status={detail.firm.stage} />
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card><CardBody><div className="text-xs text-slate-500 dark:text-slate-400">Geography</div><div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{displayValue(detail.firm.geography)}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500 dark:text-slate-400">Investor Type</div><div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{displayValue(detail.firm.investorType)}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-slate-500 dark:text-slate-400">Source List</div><div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{displayValue(detail.firm.sourceListName)}</div></CardBody></Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500 dark:text-slate-400">Focus Areas</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(detail.firm.focusSectors ?? []).filter((item) => item && item.toLowerCase() !== "general").length === 0 ? (
                <span className="text-xs text-slate-400 dark:text-slate-500">Not specified</span>
              ) : (
                (detail.firm.focusSectors ?? [])
                  .filter((item) => item && item.toLowerCase() !== "general")
                  .map((sector) => (
                    <span key={sector} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-200">
                      {sector}
                    </span>
                  ))
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500 dark:text-slate-400">Round Focus</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(detail.firm.stageFocus ?? []).length === 0 ? (
                <span className="text-xs text-slate-400 dark:text-slate-500">Not specified</span>
              ) : (
                detail.firm.stageFocus.map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-200">
                    {item}
                  </span>
                ))
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-xs text-slate-500 dark:text-slate-400">Research Score</div>
            <div className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-100">
              {detail.firm.qualificationScore != null ? `${Math.round(detail.firm.qualificationScore * 100)}%` : "Not specified"}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Confidence: {detail.firm.researchConfidence != null ? `${Math.round(detail.firm.researchConfidence * 100)}%` : "Not specified"}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Last research: {detail.firm.researchedAt ? dayjs(detail.firm.researchedAt).format("MMM D, YYYY HH:mm") : "Not specified"}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-sm font-semibold">Investor Brief</h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {investorBrief || "No research summary yet. Run “Refresh Research” to enrich this lead."}
          </p>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-sm font-semibold">Submission Requests ({detail.submissionRequests.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-800">
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mode</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Prepared</th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Result</th>
                </tr>
              </thead>
              <tbody>
                {detail.submissionRequests.map((request) => (
                  <tr key={request.id} className="border-b border-slate-50 hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2"><StatusPill status={request.status} /></td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{request.mode}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{dayjs(request.preparedAt).format("MMM D, YYYY HH:mm")}</td>
                    <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{request.resultNote ?? "-"}</td>
                  </tr>
                ))}
                {detail.submissionRequests.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">No submission requests yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

    </div>
  );
}
