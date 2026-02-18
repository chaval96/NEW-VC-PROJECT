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

const MAX_PAGES_PER_FIRM = Math.max(2, Number(process.env.RESEARCH_MAX_PAGES_PER_FIRM ?? 6));
const FETCH_TIMEOUT_MS = Math.max(2000, Number(process.env.RESEARCH_FETCH_TIMEOUT_MS ?? 5500));
const MAX_HTML_CHARS = Math.max(40_000, Number(process.env.RESEARCH_MAX_HTML_CHARS ?? 180_000));
const MAX_TEXT_CHARS = 60_000;

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

function buildResearchSummary(
  geography: string,
  sectors: string[],
  stageFocus: string[],
  investmentFocus: string[],
  formStatus: "discovered" | "not_found" | "unknown"
): string {
  const parts = [
    `Geo: ${geography}`,
    `Sectors: ${sectors.join(", ")}`,
    `Stages: ${stageFocus.join(", ")}`,
    `Focus: ${investmentFocus.join(", ")}`
  ];
  if (formStatus === "discovered") parts.push("Form: discovered");
  if (formStatus === "not_found") parts.push("Form: not found");
  if (formStatus === "unknown") parts.push("Form: unknown");
  return parts.join(" | ");
}

export async function researchLead(firm: Firm, profile: CompanyProfile): Promise<LeadResearchResult> {
  const pages = await crawlWebsite(firm.website);
  const mergedText = pages.map((page) => page.text).join(" ").slice(0, 220_000);

  const geography = inferGeography(mergedText, firm.website, firm.geography);
  const investorType = inferInvestorType(mergedText, firm.investorType);
  const focusSectors = inferFocusSectors(mergedText, firm.focusSectors ?? []);
  const stageFocus = inferStageFocus(mergedText, firm.stageFocus ?? []);
  const investmentFocus = inferInvestmentFocus(geography, mergedText);
  const checkSizeRange = inferCheckSizeRange(mergedText, firm.checkSizeRange);
  const formSignal = selectFormRoute(pages);

  const qualificationScore = computeQualificationScore(profile, focusSectors, stageFocus, investmentFocus);
  const qualified = qualificationScore >= 0.55;
  let nextStage: PipelineStage = qualified ? "qualified" : "researching";
  if (qualified && formSignal.status === "discovered") {
    nextStage = "form_discovered";
  }

  const confidence = bounded(0.45 + Math.min(0.4, pages.length * 0.07) + (formSignal.status === "discovered" ? 0.08 : 0));
  const statusReason =
    nextStage === "form_discovered"
      ? "Qualified fit and form route discovered."
      : qualified
        ? "Researched and qualified by funding profile fit."
        : "Researched but below qualification threshold.";

  return {
    geography,
    investorType,
    checkSizeRange,
    focusSectors,
    stageFocus,
    investmentFocus,
    qualificationScore,
    researchConfidence: Number(confidence.toFixed(3)),
    formDiscovery: formSignal.status,
    formRouteHint: formSignal.hint,
    nextStage,
    statusReason,
    researchSources: uniqueTop(pages.map((page) => page.url), 8),
    researchSummary: buildResearchSummary(geography, focusSectors, stageFocus, investmentFocus, formSignal.status)
  };
}
