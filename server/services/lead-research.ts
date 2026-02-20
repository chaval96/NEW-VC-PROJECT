import { URL } from "node:url";
import type { CompanyProfile, Firm, PipelineStage } from "../domain/types.js";
import { normalizeWebsiteHost } from "./firm-normalization.js";

export interface LeadResearchResult {
  geography: string;
  investorType: Firm["investorType"];
  checkSizeRange: string;
  focusSectors: string[];
  stageFocus: string[];
  investmentFocus: string[];
  qualificationScore: number;
  researchConfidence: number;
  formDiscovery: "discovered" | "not_found" | "unknown";
  formRouteHint?: string;
  nextStage: PipelineStage;
  statusReason: string;
  researchSources: string[];
  researchSummary: string;
}

type CrawlPage = {
  url: string;
  text: string;
  hasForm: boolean;
  formScore: number;
  links: string[];
};

type ExternalHints = {
  geography?: string;
  investorType?: Firm["investorType"];
  checkSizeRange?: string;
  focusSectors: string[];
  stageFocus: string[];
  investmentFocus: string[];
  formDiscovery?: "discovered" | "not_found" | "unknown";
  formRouteHint?: string;
  sources: string[];
  summary: string[];
  confidenceBoost: number;
};

const MAX_PAGES_PER_FIRM = Math.max(2, Number(process.env.RESEARCH_MAX_PAGES_PER_FIRM ?? 6));
const FETCH_TIMEOUT_MS = Math.max(2000, Number(process.env.RESEARCH_FETCH_TIMEOUT_MS ?? 5500));
const MAX_HTML_CHARS = Math.max(40_000, Number(process.env.RESEARCH_MAX_HTML_CHARS ?? 180_000));
const MAX_TEXT_CHARS = 60_000;
const EXTERNAL_TIMEOUT_MS = Math.max(1500, Number(process.env.RESEARCH_EXTERNAL_TIMEOUT_MS ?? 4500));

const openVcEnabled = process.env.OPENVC_ENRICH_ENABLED?.trim().toLowerCase() !== "false";
const wikidataEnabled = process.env.WIKIDATA_ENRICH_ENABLED?.trim().toLowerCase() !== "false";
const opencorporatesEnabled = envFlag("OPENCORPORATES_ENRICH_ENABLED");
const wikipediaEnabled = process.env.WIKIPEDIA_ENRICH_ENABLED?.trim().toLowerCase() !== "false";
const openAiResearchEnabled = envFlag("OPENAI_RESEARCH_ENABLED");
const openAiResearchModel = process.env.OPENAI_RESEARCH_MODEL?.trim() || "gpt-4.1-mini";
const openAiResearchMaxTokens = Math.max(300, Number(process.env.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS ?? 700));
const openAiWorkflowId = process.env.OPENAI_WORKFLOW_ID?.trim() ?? "";
const openAiWorkflowVersion = process.env.OPENAI_WORKFLOW_VERSION?.trim() ?? "";

const importantPathHints = [
  "contact",
  "apply",
  "founder",
  "pitch",
  "submission",
  "submit",
  "invest",
  "portfolio",
  "thesis",
  "about",
  "team",
  "companies",
  "focus"
];

const seedPaths = [
  "",
  "/about",
  "/team",
  "/contact",
  "/founders",
  "/portfolio",
  "/companies",
  "/apply",
  "/submit"
];

const countryPatterns: Array<{ label: string; regexes: RegExp[] }> = [
  { label: "USA", regexes: [/\bunited states\b/i, /\bu\.?s\.?a\b/i, /\bu\.?s\b/i, /\bnew york\b/i, /\bsan francisco\b/i] },
  { label: "Canada", regexes: [/\bcanada\b/i, /\btoronto\b/i, /\bvancouver\b/i, /\bmontreal\b/i] },
  { label: "United Kingdom", regexes: [/\bunited kingdom\b/i, /\buk\b/i, /\blondon\b/i, /\bengland\b/i] },
  { label: "Germany", regexes: [/\bgermany\b/i, /\bberlin\b/i, /\bmunich\b/i] },
  { label: "France", regexes: [/\bfrance\b/i, /\bparis\b/i] },
  { label: "Spain", regexes: [/\bspain\b/i, /\bmadrid\b/i, /\bbarcelona\b/i] },
  { label: "Italy", regexes: [/\bitaly\b/i, /\bmilan\b/i, /\brome\b/i] },
  { label: "Netherlands", regexes: [/\bnetherlands\b/i, /\bamsterdam\b/i] },
  { label: "Switzerland", regexes: [/\bswitzerland\b/i, /\bzurich\b/i, /\bgeneva\b/i] },
  { label: "Nordics", regexes: [/\bnordic\b/i, /\bsweden\b/i, /\bnorway\b/i, /\bdenmark\b/i, /\bfinland\b/i] },
  { label: "UAE", regexes: [/\buae\b/i, /\bdubai\b/i, /\babudhabi\b/i] },
  { label: "Singapore", regexes: [/\bsingapore\b/i] },
  { label: "India", regexes: [/\bindia\b/i, /\bbangalore\b/i, /\bmumbai\b/i] },
  { label: "Australia", regexes: [/\baustralia\b/i, /\bsydney\b/i, /\bmelbourne\b/i] },
  { label: "Japan", regexes: [/\bjapan\b/i, /\btokyo\b/i] }
];

const sectorKeywords: Array<{ label: string; terms: string[] }> = [
  { label: "AI", terms: ["ai", "artificial intelligence", "machine learning", "ml", "agentic"] },
  { label: "MarTech", terms: ["martech", "marketing tech", "marketing", "advertising", "adtech", "growth marketing"] },
  { label: "HealthTech", terms: ["healthtech", "health", "medical", "biotech", "pharma", "clinical"] },
  { label: "FinTech", terms: ["fintech", "payments", "finance", "banking", "insurance", "insurtech"] },
  { label: "SaaS", terms: ["saas", "software", "enterprise software", "b2b software"] },
  { label: "E-commerce", terms: ["ecommerce", "e-commerce", "retail", "marketplace", "consumer commerce"] },
  { label: "Climate", terms: ["climate", "carbon", "energy", "decarbonization", "sustainability"] },
  { label: "Cybersecurity", terms: ["cybersecurity", "security", "identity", "infosec"] },
  { label: "EdTech", terms: ["edtech", "education", "learning", "upskilling"] },
  { label: "Mobility", terms: ["mobility", "transportation", "automotive", "logistics"] }
];

const stagePatterns: Array<{ stage: string; regexes: RegExp[] }> = [
  { stage: "Pre-Seed", regexes: [/\bpre[-\s]?seed\b/i] },
  { stage: "Seed", regexes: [/\bseed\b/i, /\bearly stage\b/i] },
  { stage: "Series A", regexes: [/\bseries\s*a\b/i] },
  { stage: "Series B", regexes: [/\bseries\s*b\b/i] },
  { stage: "Series C+", regexes: [/\bseries\s*c\b/i, /\blate stage\b/i] },
  { stage: "Growth", regexes: [/\bgrowth\b/i, /\bscale[-\s]?up\b/i] }
];

function bounded(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const unquoted =
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const normalized = unquoted.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function uniqueTop(values: string[], limit = 3): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function toLowerTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(/[|,/;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function containsAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function inferCountryFromText(text: string): string | undefined {
  for (const entry of countryPatterns) {
    if (entry.regexes.some((regex) => regex.test(text))) {
      return entry.label;
    }
  }
  return undefined;
}

function toAbsoluteUrl(base: string, href: string): string | undefined {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return `${u.origin}${u.pathname}${u.search}`.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(baseUrl: string, html: string): string[] {
  const links: string[] = [];
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    if (raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("#")) continue;
    const url = toAbsoluteUrl(baseUrl, raw);
    if (!url) continue;
    links.push(url);
  }
  return links;
}

function relevantLink(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./, "") !== host) return false;
    const normalizedPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
    return importantPathHints.some((hint) => normalizedPath.includes(hint));
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "VCReachBot/1.0 (+research)"
      }
    });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) return undefined;
    const html = await response.text();
    return html.slice(0, MAX_HTML_CHARS);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "VCReachBot/1.0 (+research)"
      }
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

function toStringArray(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueTop(
    value
      .map((item) => (typeof item === "string" ? item : ""))
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    limit
  );
}

function normalizeFormDiscovery(value: unknown): "discovered" | "not_found" | "unknown" | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "discovered") return "discovered";
  if (lower === "not_found") return "not_found";
  if (lower === "unknown") return "unknown";
  return undefined;
}

function extractOpenAiOutputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  const chunks: string[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim().length > 0) {
        chunks.push(part.text.trim());
      } else if (typeof part?.value === "string" && part.value.trim().length > 0) {
        chunks.push(part.value.trim());
      }
    }
  }
  return chunks.join("\n").trim();
}

function buildOpenAiResearchInput(firm: Firm, profile: CompanyProfile): Array<{ role: string; content: string }> {
  return [
    {
      role: "system",
      content:
        "You are a VC investor research analyst. Return strictly valid JSON for investor profiling used by a fundraising platform."
    },
    {
      role: "user",
      content: [
        `Investor name: ${firm.name}`,
        `Investor website: ${firm.website}`,
        `Startup context: ${profile.company}, round ${profile.fundraising.round}, description: ${profile.oneLiner}`,
        "Return JSON object with keys:",
        "geography (string), investorType (VC|Angel Network|Syndicate|Other), checkSizeRange (string),",
        "focusSectors (string[] up to 3), stageFocus (string[] up to 3), investmentFocus (string[] up to 3),",
        "formDiscovery (discovered|not_found|unknown), formRouteHint (string optional),",
        "brief (2-4 sentence summary), sources (string[] up to 5), confidence (0..1)."
      ].join("\n")
    }
  ];
}

function buildOpenAiResearchFormat(): Record<string, unknown> {
  return {
    format: {
      type: "json_schema",
      name: "investor_research",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          geography: { type: "string" },
          investorType: { type: "string" },
          checkSizeRange: { type: "string" },
          focusSectors: {
            type: "array",
            items: { type: "string" },
            maxItems: 3
          },
          stageFocus: {
            type: "array",
            items: { type: "string" },
            maxItems: 3
          },
          investmentFocus: {
            type: "array",
            items: { type: "string" },
            maxItems: 3
          },
          formDiscovery: { type: "string" },
          formRouteHint: { type: "string" },
          brief: { type: "string" },
          sources: {
            type: "array",
            items: { type: "string" },
            maxItems: 5
          },
          confidence: { type: "number" }
        },
        required: ["geography", "investorType", "focusSectors", "stageFocus", "investmentFocus", "formDiscovery"]
      }
    }
  };
}

function parseOpenAiResearchObject(payload: any): Record<string, unknown> | undefined {
  const raw = extractOpenAiOutputText(payload);
  if (!raw) return undefined;
  try {
    return JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function callOpenAiResponses(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<Record<string, unknown> | undefined> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) return undefined;
  const payload = (await response.json()) as any;
  return parseOpenAiResearchObject(payload);
}

async function fetchOpenAiResearchHints(firm: Firm, profile: CompanyProfile): Promise<ExternalHints | undefined> {
  if (!openAiResearchEnabled) return undefined;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);

  try {
    const input = buildOpenAiResearchInput(firm, profile);
    const text = buildOpenAiResearchFormat();

    let parsed: Record<string, unknown> | undefined;

    if (openAiWorkflowId) {
      const workflowCandidates: Array<Record<string, unknown>> = [
        {
          workflow: openAiWorkflowVersion
            ? { id: openAiWorkflowId, version: openAiWorkflowVersion }
            : { id: openAiWorkflowId },
          input,
          text,
          max_output_tokens: openAiResearchMaxTokens
        },
        {
          workflow_id: openAiWorkflowId,
          ...(openAiWorkflowVersion ? { workflow_version: openAiWorkflowVersion } : {}),
          input,
          text,
          max_output_tokens: openAiResearchMaxTokens
        },
        {
          model: openAiWorkflowId,
          input,
          text,
          max_output_tokens: openAiResearchMaxTokens
        }
      ];

      for (const body of workflowCandidates) {
        parsed = await callOpenAiResponses(apiKey, body, controller.signal);
        if (parsed) break;
      }
    }

    if (!parsed) {
      parsed = await callOpenAiResponses(
        apiKey,
        {
          model: openAiResearchModel,
          tools: [{ type: "web_search_preview" }],
          max_output_tokens: openAiResearchMaxTokens,
          input,
          text
        },
        controller.signal
      );
    }

    if (!parsed) return undefined;

    const geography = typeof parsed.geography === "string" ? parsed.geography.trim() : undefined;
    const investorType =
      typeof parsed.investorType === "string"
        ? toInvestorTypeFromText(parsed.investorType) ?? undefined
        : undefined;
    const checkSizeRange = typeof parsed.checkSizeRange === "string" ? parsed.checkSizeRange.trim() : undefined;
    const focusSectors = toStringArray(parsed.focusSectors, 3);
    const stageFocus = toStringArray(parsed.stageFocus, 3);
    const investmentFocus = toStringArray(parsed.investmentFocus, 3);
    const formDiscovery = normalizeFormDiscovery(parsed.formDiscovery);
    const formRouteHint = typeof parsed.formRouteHint === "string" ? parsed.formRouteHint.trim() : undefined;
    const brief = typeof parsed.brief === "string" ? parsed.brief.trim() : "";
    const sources = toStringArray(parsed.sources, 5);
    const confidence = typeof parsed.confidence === "number" ? bounded(parsed.confidence, 0, 1) : 0.6;

    return {
      geography: geography || undefined,
      investorType,
      checkSizeRange: checkSizeRange || undefined,
      focusSectors,
      stageFocus,
      investmentFocus,
      formDiscovery,
      formRouteHint: formDiscovery === "discovered" ? formRouteHint : undefined,
      sources,
      summary: brief ? [brief] : [],
      confidenceBoost: bounded(0.08 + confidence * 0.18, 0.08, 0.26)
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function openVcSlugCandidates(name: string): string[] {
  const trimmed = name.trim();
  const normalized = trimmed.replace(/\s+/g, " ").trim();
  const slugSimple = normalized.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return uniqueTop(
    [
      encodeURIComponent(normalized),
      encodeURIComponent(normalized.toLowerCase()),
      encodeURIComponent(slugSimple),
      encodeURIComponent(slugSimple.toLowerCase())
    ],
    4
  );
}

function extractOpenVcField(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*\\|\\s*([^|]{1,220})`, "i");
  const match = text.match(regex);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function toInvestorTypeFromText(value: string): Firm["investorType"] | undefined {
  const lower = value.toLowerCase();
  if (lower.includes("angel")) return "Angel Network";
  if (lower.includes("syndicate")) return "Syndicate";
  if (lower.includes("vc") || lower.includes("venture")) return "VC";
  return undefined;
}

function mapOpenVcFocusFromText(value: string): string[] {
  const tokens = toLowerTokens(value);
  const labels: string[] = [];
  for (const item of sectorKeywords) {
    if (item.terms.some((term) => tokens.join(" ").includes(term))) {
      labels.push(item.label);
    }
  }
  return uniqueTop(labels, 3);
}

async function fetchOpenVcHints(firm: Firm): Promise<ExternalHints | undefined> {
  if (!openVcEnabled) return undefined;

  const candidates = openVcSlugCandidates(firm.name).map((slug) => `https://www.openvc.app/fund/${slug}`);
  for (const url of candidates) {
    const html = await fetchHtml(url);
    if (!html) continue;
    const text = stripHtml(html);
    const lower = text.toLowerCase();

    if (!lower.includes("openvc") || (!lower.includes("funding stages") && !lower.includes("how to get in touch"))) {
      continue;
    }

    const hq = extractOpenVcField(text, "Global HQ");
    const type = extractOpenVcField(text, "Firm type");
    const fundingStages = extractOpenVcField(text, "Funding stages");
    const targetCountries = extractOpenVcField(text, "Target countries");
    const ticket = extractOpenVcField(text, "Investment ticket") ?? extractOpenVcField(text, "Check size");
    const touch = extractOpenVcField(text, "How to get in touch");
    const tags = extractOpenVcField(text, "Tags") ?? extractOpenVcField(text, "Business models");

    const sourceSummary: string[] = [];
    if (hq) sourceSummary.push(`OpenVC HQ ${hq}`);
    if (type) sourceSummary.push(`OpenVC type ${type}`);
    if (fundingStages) sourceSummary.push(`OpenVC stages ${fundingStages}`);
    if (targetCountries) sourceSummary.push(`OpenVC countries ${targetCountries}`);
    if (ticket) sourceSummary.push(`OpenVC check ${ticket}`);

    const country = hq ? inferCountryFromText(hq) : targetCountries ? inferCountryFromText(targetCountries) : undefined;
    const investorType = type ? toInvestorTypeFromText(type) : undefined;
    const stageFocus = fundingStages ? uniqueTop(parseCommaSeparated(fundingStages), 3) : [];
    const investmentFocus = targetCountries ? uniqueTop(parseCommaSeparated(targetCountries), 3) : [];
    const focusFromTags = tags ? mapOpenVcFocusFromText(tags) : [];

    let formDiscovery: "discovered" | "not_found" | "unknown" | undefined;
    if (touch) {
      const touchLower = touch.toLowerCase();
      if (touchLower.includes("form") || touchLower.includes("apply") || touchLower.includes("submit")) {
        formDiscovery = "discovered";
      }
    }

    return {
      geography: country,
      investorType,
      checkSizeRange: ticket,
      focusSectors: focusFromTags,
      stageFocus,
      investmentFocus,
      formDiscovery,
      formRouteHint: formDiscovery === "discovered" ? url : undefined,
      sources: [url],
      summary: sourceSummary,
      confidenceBoost: 0.22
    };
  }

  return undefined;
}

type WikidataSearchResponse = {
  search?: Array<{
    id: string;
    label?: string;
    description?: string;
    title?: string;
  }>;
};

async function fetchWikidataHints(firm: Firm): Promise<ExternalHints | undefined> {
  if (!wikidataEnabled) return undefined;

  const params = new URLSearchParams({
    action: "wbsearchentities",
    format: "json",
    language: "en",
    type: "item",
    limit: "5",
    origin: "*",
    search: firm.name
  });
  const url = `https://www.wikidata.org/w/api.php?${params.toString()}`;
  const payload = await fetchJson<WikidataSearchResponse>(url);
  if (!payload?.search || payload.search.length === 0) return undefined;

  const best = payload.search.find((item) =>
    /(venture|capital|investor|investment|fund|private equity|angel)/i.test(`${item.label ?? ""} ${item.description ?? ""}`)
  ) ?? payload.search[0];
  if (!best) return undefined;

  const text = `${best.label ?? ""} ${best.description ?? ""}`;
  const geography = inferCountryFromText(text);
  const investorType = toInvestorTypeFromText(text);
  const focus = mapOpenVcFocusFromText(text);
  const stageFocus = inferStageFocus(text, []);
  const investmentFocus = inferInvestmentFocus(geography ?? "Unknown", text);

  return {
    geography,
    investorType,
    focusSectors: focus,
    stageFocus,
    investmentFocus,
    sources: [`https://www.wikidata.org/wiki/${best.id}`],
    summary: [`Wikidata: ${best.label ?? firm.name}${best.description ? ` (${best.description})` : ""}`],
    confidenceBoost: 0.1
  };
}

type WikipediaSearchResponse = {
  query?: {
    search?: Array<{
      title: string;
      snippet?: string;
    }>;
  };
};

type WikipediaSummaryResponse = {
  extract?: string;
  description?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

async function fetchWikipediaHints(firm: Firm): Promise<ExternalHints | undefined> {
  if (!wikipediaEnabled) return undefined;

  const params = new URLSearchParams({
    action: "query",
    list: "search",
    format: "json",
    utf8: "1",
    srlimit: "5",
    srsearch: firm.name,
    origin: "*"
  });

  const searchUrl = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
  const searchPayload = await fetchJson<WikipediaSearchResponse>(searchUrl);
  const candidates = searchPayload?.query?.search ?? [];
  if (candidates.length === 0) return undefined;

  const preferred =
    candidates.find((item) =>
      /(venture|capital|invest|investor|private equity|angel|syndicate)/i.test(
        `${item.title} ${item.snippet ?? ""}`
      )
    ) ?? candidates[0];
  if (!preferred?.title) return undefined;

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(preferred.title)}`;
  const summaryPayload = await fetchJson<WikipediaSummaryResponse>(summaryUrl);
  const extract = summaryPayload?.extract?.trim();
  const description = summaryPayload?.description?.trim();
  const combined = `${description ?? ""} ${extract ?? ""}`.trim();
  if (!combined) return undefined;

  const geography = inferCountryFromText(combined);
  const investorType = toInvestorTypeFromText(combined);
  const focusSectors = mapOpenVcFocusFromText(combined);
  const stageFocus = inferStageFocus(combined, []);
  const investmentFocus = inferInvestmentFocus(geography ?? "Unknown", combined);
  const pageUrl = summaryPayload?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(preferred.title.replace(/\s+/g, "_"))}`;

  return {
    geography,
    investorType,
    focusSectors,
    stageFocus,
    investmentFocus,
    sources: [pageUrl],
    summary: [`Wikipedia: ${preferred.title}${description ? ` (${description})` : ""}`],
    confidenceBoost: 0.12
  };
}

type OpenCorporatesCompany = {
  company?: {
    jurisdiction_code?: string;
    current_status?: string;
    opencorporates_url?: string;
  };
};

type OpenCorporatesSearchResponse = {
  results?: {
    companies?: OpenCorporatesCompany[];
  };
};

function jurisdictionToCountry(code?: string): string | undefined {
  if (!code) return undefined;
  const normalized = code.toLowerCase();
  const map: Record<string, string> = {
    us: "USA",
    gb: "United Kingdom",
    uk: "United Kingdom",
    de: "Germany",
    fr: "France",
    es: "Spain",
    it: "Italy",
    nl: "Netherlands",
    ch: "Switzerland",
    sg: "Singapore",
    in: "India",
    jp: "Japan",
    au: "Australia",
    ca: "Canada"
  };
  return map[normalized.slice(0, 2)];
}

async function fetchOpenCorporatesHints(firm: Firm): Promise<ExternalHints | undefined> {
  if (!opencorporatesEnabled) return undefined;
  const params = new URLSearchParams({ q: firm.name });
  if (process.env.OPENCORPORATES_API_TOKEN) {
    params.set("api_token", process.env.OPENCORPORATES_API_TOKEN);
  }
  const url = `https://api.opencorporates.com/v0.4/companies/search?${params.toString()}`;
  const payload = await fetchJson<OpenCorporatesSearchResponse>(url);
  const company = payload?.results?.companies?.[0]?.company;
  if (!company) return undefined;

  const geography = jurisdictionToCountry(company.jurisdiction_code);
  return {
    geography,
    focusSectors: [],
    stageFocus: [],
    investmentFocus: [],
    sources: company.opencorporates_url ? [company.opencorporates_url] : [url],
    summary: [`OpenCorporates status ${company.current_status ?? "unknown"}`],
    confidenceBoost: 0.08
  };
}

function scoreFormSignal(url: string, html: string, text: string): number {
  let score = 0;
  const lowerHtml = html.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerHtml.includes("<form")) score += 3;
  if (/(apply|submission|pitch|founder|startup|contact us|get in touch)/i.test(lowerText)) score += 2;
  if (/(name=|type=\"email\"|textarea)/i.test(lowerHtml)) score += 1;
  if (/\/(contact|apply|submit|founders?)/i.test(url)) score += 1;
  return score;
}

async function crawlWebsite(baseWebsite: string): Promise<CrawlPage[]> {
  const normalizedBase = baseWebsite.startsWith("http") ? baseWebsite : `https://${baseWebsite}`;
  const base = new URL(normalizedBase);
  const host = base.hostname.replace(/^www\./, "");

  const queue = new Set<string>();
  for (const seed of seedPaths) {
    queue.add(`${base.origin}${seed}`.replace(/\/+$/, ""));
  }

  const visited = new Set<string>();
  const pages: CrawlPage[] = [];

  while (queue.size > 0 && pages.length < MAX_PAGES_PER_FIRM) {
    const next = [...queue][0];
    queue.delete(next);
    if (visited.has(next)) continue;
    visited.add(next);

    const html = await fetchHtml(next);
    if (!html) continue;

    const text = stripHtml(html).slice(0, MAX_TEXT_CHARS);
    const links = extractLinks(next, html).filter((link) => relevantLink(link, host));
    const formScore = scoreFormSignal(next, html, text);
    pages.push({
      url: next,
      text,
      hasForm: formScore >= 4,
      formScore,
      links
    });

    for (const link of links) {
      if (pages.length + queue.size >= MAX_PAGES_PER_FIRM * 2) break;
      if (!visited.has(link)) {
        queue.add(link);
      }
    }
  }

  return pages;
}

function inferGeography(text: string, website: string, current: string): string {
  if (current && current.trim() && current.toLowerCase() !== "unknown") return current.trim();

  const matches: Array<{ label: string; count: number }> = [];
  for (const item of countryPatterns) {
    let count = 0;
    for (const regex of item.regexes) {
      if (regex.test(text)) count += 1;
    }
    if (count > 0) matches.push({ label: item.label, count });
  }
  if (matches.length > 0) {
    matches.sort((a, b) => b.count - a.count);
    return matches[0].label;
  }

  const host = normalizeWebsiteHost(website);
  const tld = host.split(".").pop() ?? "";
  const byTld: Record<string, string> = {
    us: "USA",
    ca: "Canada",
    uk: "United Kingdom",
    de: "Germany",
    fr: "France",
    es: "Spain",
    it: "Italy",
    nl: "Netherlands",
    ch: "Switzerland",
    se: "Nordics",
    no: "Nordics",
    dk: "Nordics",
    fi: "Nordics",
    in: "India",
    sg: "Singapore",
    au: "Australia",
    jp: "Japan"
  };
  return byTld[tld] ?? "Unknown";
}

function inferInvestorType(text: string, current: Firm["investorType"]): Firm["investorType"] {
  if (/\bangel network\b/i.test(text) || /\bangel investor/i.test(text)) return "Angel Network";
  if (/\bsyndicate\b/i.test(text)) return "Syndicate";
  if (/\bventure capital\b/i.test(text) || /\bvc fund\b/i.test(text) || /\bventure fund\b/i.test(text)) return "VC";
  return current === "Other" ? "VC" : current;
}

function inferFocusSectors(text: string, current: string[]): string[] {
  const scored: Array<{ label: string; score: number }> = [];
  for (const item of sectorKeywords) {
    let score = 0;
    for (const term of item.terms) {
      const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      const found = text.match(regex);
      score += found?.length ?? 0;
    }
    if (score > 0) scored.push({ label: item.label, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const fromText = scored.map((item) => item.label);
  return uniqueTop([...(fromText.length > 0 ? fromText : []), ...current, "Generalist"], 3);
}

function inferStageFocus(text: string, current: string[]): string[] {
  const fromText: string[] = [];
  for (const item of stagePatterns) {
    if (item.regexes.some((regex) => regex.test(text))) {
      fromText.push(item.stage);
    }
  }
  return uniqueTop([...(fromText.length > 0 ? fromText : ["Seed", "Series A"]), ...current], 3);
}

function inferInvestmentFocus(geography: string, text: string): string[] {
  const labels: string[] = [];
  if (/\bglobal\b/i.test(text) || /\bworldwide\b/i.test(text)) labels.push("Global");
  if (/\beurope\b/i.test(text) || /\beu\b/i.test(text)) labels.push("European Businesses");
  if (/\bunited states\b/i.test(text) || /\bu\.?s\.?/i.test(text) || /\bnorth america\b/i.test(text)) labels.push("U.S. Businesses");
  if (/\bmiddle east\b/i.test(text)) labels.push("Middle East");
  if (/\basia\b/i.test(text) || /\bapac\b/i.test(text)) labels.push("Asia-Pacific");

  const geo = geography.toLowerCase();
  if (geo.includes("usa")) labels.push("U.S. Businesses");
  else if (
    ["united kingdom", "germany", "france", "spain", "italy", "netherlands", "switzerland", "nordics"].includes(geo)
  ) {
    labels.push("European Businesses");
  } else if (geo.includes("unknown")) {
    labels.push("Global");
  }

  return uniqueTop(labels.length > 0 ? labels : ["Global"], 3);
}

function inferCheckSizeRange(text: string, current: string): string {
  if (current && current.toLowerCase() !== "unknown") return current;
  const explicitRange = text.match(/(\$|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(k|m|b)?\s?[-–to]+\s?(\$|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(k|m|b)?/i);
  if (explicitRange?.[0]) {
    return explicitRange[0].replace(/\s+/g, " ").trim();
  }
  if (/\bpre[-\s]?seed\b/i.test(text)) return "$50K-$500K";
  if (/\bseed\b/i.test(text)) return "$100K-$2M";
  if (/\bseries\s*a\b/i.test(text)) return "$1M-$8M";
  if (/\bseries\s*b\b/i.test(text) || /\bgrowth\b/i.test(text)) return "$5M-$20M";
  return "Unknown";
}

function mergeExternalHints(base: {
  geography: string;
  investorType: Firm["investorType"];
  checkSizeRange: string;
  focusSectors: string[];
  stageFocus: string[];
  investmentFocus: string[];
  formSignal: { status: "discovered" | "not_found" | "unknown"; hint?: string };
}, hints: ExternalHints[]): {
  geography: string;
  investorType: Firm["investorType"];
  checkSizeRange: string;
  focusSectors: string[];
  stageFocus: string[];
  investmentFocus: string[];
  formSignal: { status: "discovered" | "not_found" | "unknown"; hint?: string };
  confidenceBoost: number;
  sources: string[];
  summary: string[];
} {
  let geography = base.geography;
  let investorType = base.investorType;
  let checkSizeRange = base.checkSizeRange;
  let formSignal = base.formSignal;
  let confidenceBoost = 0;

  const focusSectors = [...base.focusSectors];
  const stageFocus = [...base.stageFocus];
  const investmentFocus = [...base.investmentFocus];
  const sources: string[] = [];
  const summary: string[] = [];

  for (const hint of hints) {
    if (hint.geography && geography.toLowerCase() === "unknown") geography = hint.geography;
    if (hint.investorType && investorType === "Other") investorType = hint.investorType;
    if (hint.checkSizeRange && checkSizeRange.toLowerCase() === "unknown") checkSizeRange = hint.checkSizeRange;

    if (hint.formDiscovery === "discovered" && formSignal.status !== "discovered") {
      formSignal = { status: "discovered", hint: hint.formRouteHint };
    }

    focusSectors.push(...hint.focusSectors);
    stageFocus.push(...hint.stageFocus);
    investmentFocus.push(...hint.investmentFocus);
    sources.push(...hint.sources);
    summary.push(...hint.summary);
    confidenceBoost += hint.confidenceBoost;
  }

  return {
    geography,
    investorType,
    checkSizeRange,
    focusSectors: uniqueTop(focusSectors, 3),
    stageFocus: uniqueTop(stageFocus, 3),
    investmentFocus: uniqueTop(investmentFocus, 3),
    formSignal,
    confidenceBoost: bounded(confidenceBoost, 0, 0.35),
    sources: uniqueTop(sources, 10),
    summary: uniqueTop(summary, 6)
  };
}

function shouldFetchExternalHints(base: {
  geography: string;
  focusSectors: string[];
  stageFocus: string[];
  formSignal: { status: "discovered" | "not_found" | "unknown" };
}): boolean {
  const geoUnknown = base.geography.toLowerCase() === "unknown";
  const focusUnknown =
    base.focusSectors.length === 0 ||
    base.focusSectors.every((item) => ["general", "generalist"].includes(item.toLowerCase()));
  const stageUnknown = base.stageFocus.length === 0;
  const formUnknown = base.formSignal.status !== "discovered";
  return geoUnknown || focusUnknown || stageUnknown || formUnknown;
}

function computeQualificationScore(profile: CompanyProfile, sectors: string[], stageFocus: string[], investmentFocus: string[]): number {
  const profileText = `${profile.oneLiner} ${profile.longDescription} ${profile.fundraising.round}`.toLowerCase();
  const sectorHits = sectors.filter((sector) => profileText.includes(sector.toLowerCase().replace(/\s+/g, ""))).length;
  const sectorScore = bounded(sectorHits * 0.12, 0, 0.36);

  const round = profile.fundraising.round.toLowerCase();
  const stageScore = stageFocus.some((stage) => stage.toLowerCase().includes(round.replace(/\s+/g, ""))) ? 0.28 : 0.16;

  const locationScore = investmentFocus.some((focus) => focus === "Global" || focus === "U.S. Businesses") ? 0.18 : 0.1;
  const baseline = 0.24;
  return Number(bounded(baseline + sectorScore + stageScore + locationScore, 0, 1).toFixed(3));
}

function selectFormRoute(pages: CrawlPage[]): { status: "discovered" | "not_found" | "unknown"; hint?: string } {
  if (pages.length === 0) {
    return { status: "unknown" };
  }

  const best = [...pages].sort((a, b) => b.formScore - a.formScore)[0];
  if (best.formScore >= 4) {
    return { status: "discovered", hint: best.url };
  }

  if (best.formScore <= 1) {
    return { status: "not_found" };
  }

  return { status: "unknown", hint: best.url };
}

function withArticle(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return "an investor";
  const article = /^[aeiou]/.test(lower) ? "an" : "a";
  return `${article} ${value}`;
}

function inferWebsiteSignals(text: string): string[] {
  const signals: string[] = [];
  if (containsAny(text, ["early stage", "pre-seed", "seed investor"])) signals.push("early-stage investing");
  if (containsAny(text, ["women-owned", "women led", "female founders", "women entrepreneurs"])) {
    signals.push("support for women-led businesses");
  }
  if (containsAny(text, ["b2b", "enterprise"])) signals.push("B2B and enterprise companies");
  if (containsAny(text, ["global", "worldwide"])) signals.push("global coverage");
  if (containsAny(text, ["north america", "united states", "u.s."])) signals.push("North American opportunities");
  if (containsAny(text, ["europe", "eu"])) signals.push("European opportunities");
  return uniqueTop(signals, 3);
}

function formatList(values: string[], fallback = "not clearly specified"): string {
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (cleaned.length === 0) return fallback;
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function buildInvestorBrief(
  firm: Firm,
  geography: string,
  investorType: Firm["investorType"],
  checkSizeRange: string,
  sectors: string[],
  stageFocus: string[],
  investmentFocus: string[],
  formStatus: "discovered" | "not_found" | "unknown",
  text: string,
  externalSummary: string[]
): string {
  const geoLabel = geography.toLowerCase() === "unknown" ? "location not clearly disclosed" : geography;
  const focusAreas = sectors.filter((item) => item.toLowerCase() !== "general" && item.toLowerCase() !== "generalist");
  const stageAreas = stageFocus.filter((item) => item.trim().length > 0);
  const investmentAreas = investmentFocus.filter((item) => item.trim().length > 0);
  const signals = inferWebsiteSignals(text);

  const checkKnown = checkSizeRange.trim().length > 0 && checkSizeRange.toLowerCase() !== "unknown";
  const sentences: string[] = [
    `${firm.name} appears to be ${withArticle(investorType)} ${geoLabel === "location not clearly disclosed" ? `with ${geoLabel}` : `based in ${geoLabel}`}.`,
    focusAreas.length > 0
      ? `Its published focus areas include ${formatList(focusAreas)}.`
      : "Its public materials do not clearly specify sector preferences yet.",
    stageAreas.length > 0
      ? `It is most aligned with ${formatList(stageAreas)} stage opportunities${investmentAreas.length > 0 ? ` and typically targets ${formatList(investmentAreas)}` : ""}${checkKnown ? `, with a disclosed check profile around ${checkSizeRange}` : ""}.`
      : `Stage preferences are not clearly disclosed${investmentAreas.length > 0 ? `, while geographic scope suggests ${formatList(investmentAreas)}` : ""}${checkKnown ? ` and check profile appears around ${checkSizeRange}` : ""}.`
  ];

  if (signals.length > 0) {
    sentences.push(`Website signals suggest ${formatList(signals)}.`);
  } else if (externalSummary.length > 0) {
    const hint = externalSummary[0]
      .replace(/^Wikipedia:\s*/i, "")
      .replace(/^Wikidata:\s*/i, "")
      .replace(/^OpenVC\s*/i, "")
      .trim();
    if (hint.length > 0) {
      sentences.push(`Additional public-source context: ${hint}.`);
    }
  }

  if (formStatus === "discovered") {
    sentences.push("A startup application/contact form is discoverable on the website.");
  } else if (formStatus === "not_found") {
    sentences.push("No clear startup submission form is exposed on the current website structure.");
  } else {
    sentences.push("Form availability is still being validated from public sources.");
  }

  return sentences.slice(0, 4).join(" ");
}

export async function researchLead(firm: Firm, profile: CompanyProfile): Promise<LeadResearchResult> {
  const pages = await crawlWebsite(firm.website);
  const mergedText = pages.map((page) => page.text).join(" ").slice(0, 220_000);

  const baseGeography = inferGeography(mergedText, firm.website, firm.geography);
  const baseInvestorType = inferInvestorType(mergedText, firm.investorType);
  const baseFocusSectors = inferFocusSectors(mergedText, firm.focusSectors ?? []);
  const baseStageFocus = inferStageFocus(mergedText, firm.stageFocus ?? []);
  const baseInvestmentFocus = inferInvestmentFocus(baseGeography, mergedText);
  const baseCheckSizeRange = inferCheckSizeRange(mergedText, firm.checkSizeRange);
  const baseFormSignal = selectFormRoute(pages);

  const shouldFetchExternal = shouldFetchExternalHints({
    geography: baseGeography,
    focusSectors: baseFocusSectors,
    stageFocus: baseStageFocus,
    formSignal: baseFormSignal
  });
  const externalHints = shouldFetchExternal
    ? (
        await Promise.all([
          fetchOpenAiResearchHints(firm, profile),
          fetchOpenVcHints(firm),
          fetchWikidataHints(firm),
          fetchWikipediaHints(firm),
          fetchOpenCorporatesHints(firm)
        ])
      ).filter((item): item is ExternalHints => Boolean(item))
    : [];

  const merged = mergeExternalHints(
    {
      geography: baseGeography,
      investorType: baseInvestorType,
      checkSizeRange: baseCheckSizeRange,
      focusSectors: baseFocusSectors,
      stageFocus: baseStageFocus,
      investmentFocus: baseInvestmentFocus,
      formSignal: baseFormSignal
    },
    externalHints
  );

  const qualificationScore = computeQualificationScore(profile, merged.focusSectors, merged.stageFocus, merged.investmentFocus);
  const qualifiedByFit = qualificationScore >= 0.55;
  const hasFormRoute = merged.formSignal.status === "discovered";
  const qualified = qualifiedByFit && hasFormRoute;
  let nextStage: PipelineStage = qualified ? "qualified" : "lead";

  const confidence = bounded(
    0.42 +
      Math.min(0.35, pages.length * 0.07) +
      (merged.formSignal.status === "discovered" ? 0.08 : 0) +
      merged.confidenceBoost
  );
  const statusReason = qualified
    ? "Qualified fit with discoverable form route."
    : qualifiedByFit
      ? "Potential fit found, but form route is not verified yet."
      : "Researched, but currently below qualification threshold.";

  const sourceLinks = uniqueTop(
    [...pages.map((page) => page.url), ...merged.sources],
    10
  );
  const brief = buildInvestorBrief(
    firm,
    merged.geography,
    merged.investorType,
    merged.checkSizeRange,
    merged.focusSectors,
    merged.stageFocus,
    merged.investmentFocus,
    merged.formSignal.status,
    mergedText,
    merged.summary
  );

  return {
    geography: merged.geography,
    investorType: merged.investorType,
    checkSizeRange: merged.checkSizeRange,
    focusSectors: merged.focusSectors,
    stageFocus: merged.stageFocus,
    investmentFocus: merged.investmentFocus,
    qualificationScore,
    researchConfidence: Number(confidence.toFixed(3)),
    formDiscovery: merged.formSignal.status,
    formRouteHint: merged.formSignal.hint,
    nextStage,
    statusReason,
    researchSources: sourceLinks,
    researchSummary: brief
  };
}
