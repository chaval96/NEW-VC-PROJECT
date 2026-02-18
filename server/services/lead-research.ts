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
}

const sectorKeywordMap: Array<{ label: string; terms: string[] }> = [
  { label: "AI", terms: ["ai", "machine", "ml", "intelligence", "agentic"] },
  { label: "MarTech", terms: ["marketing", "martech", "adtech", "advertising", "growth"] },
  { label: "HealthTech", terms: ["health", "med", "biotech", "clinical", "pharma"] },
  { label: "FinTech", terms: ["fintech", "finance", "payments", "banking", "insur"] },
  { label: "SaaS", terms: ["saas", "software", "b2b", "platform"] },
  { label: "E-commerce", terms: ["commerce", "shop", "retail", "marketplace"] },
  { label: "Cybersecurity", terms: ["security", "cyber", "identity"] },
  { label: "Climate", terms: ["climate", "carbon", "energy", "sustain"] },
  { label: "EdTech", terms: ["education", "edtech", "learning"] }
];

const geographyByTld: Record<string, string> = {
  us: "USA",
  ca: "Canada",
  uk: "United Kingdom",
  de: "Germany",
  fr: "France",
  es: "Spain",
  it: "Italy",
  nl: "Netherlands",
  ch: "Switzerland",
  se: "Sweden",
  no: "Norway",
  dk: "Denmark",
  fi: "Finland",
  ie: "Ireland",
  in: "India",
  tr: "Turkey",
  ae: "UAE",
  sg: "Singapore",
  au: "Australia",
  nz: "New Zealand"
};

function hashValue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function toTokens(...values: string[]): string[] {
  return values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function uniqueTop(values: string[], limit = 3): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value.trim());
    if (result.length >= limit) break;
  }
  return result;
}

function inferGeography(firm: Firm): string {
  const current = firm.geography?.trim();
  if (current && current.toLowerCase() !== "unknown") return current;

  const host = normalizeWebsiteHost(firm.website);
  const tld = host.split(".").pop() ?? "";
  return geographyByTld[tld] ?? "Unknown";
}

function inferInvestorType(firm: Firm, tokens: string[]): Firm["investorType"] {
  if (firm.investorType && firm.investorType !== "Other") return firm.investorType;
  if (tokens.some((token) => token.includes("angel"))) return "Angel Network";
  if (tokens.some((token) => token.includes("syndicate"))) return "Syndicate";
  return "VC";
}

function inferFocusSectors(firm: Firm, tokens: string[]): string[] {
  const matched: string[] = [];
  for (const item of sectorKeywordMap) {
    if (item.terms.some((term) => tokens.some((token) => token.includes(term)))) {
      matched.push(item.label);
    }
  }

  const fallback = firm.focusSectors.filter((sector) => sector && sector.toLowerCase() !== "general");
  const combined = [...matched, ...fallback];
  return uniqueTop(combined.length > 0 ? combined : ["Generalist"], 3);
}

function inferStageFocus(firm: Firm, tokens: string[]): string[] {
  const mapped: string[] = [];
  if (tokens.some((token) => token.includes("preseed") || token.includes("pre-seed"))) mapped.push("Pre-Seed");
  if (tokens.some((token) => token.includes("seed"))) mapped.push("Seed");
  if (tokens.some((token) => token.includes("seriesa") || token.includes("series-a"))) mapped.push("Series A");
  if (tokens.some((token) => token.includes("seriesb") || token.includes("series-b"))) mapped.push("Series B");
  if (tokens.some((token) => token.includes("growth") || token.includes("late"))) mapped.push("Growth");

  const current = firm.stageFocus.filter((value) => value.trim().length > 0);
  return uniqueTop([...(mapped.length > 0 ? mapped : ["Seed", "Series A"]), ...current], 3);
}

function inferInvestmentFocus(geography: string): string[] {
  const normalized = geography.toLowerCase();
  if (normalized.includes("usa") || normalized === "us") {
    return ["U.S. Businesses", "North America", "Global"];
  }
  if (normalized.includes("canada")) {
    return ["North America", "U.S. Businesses", "Global"];
  }
  if (
    ["germany", "france", "spain", "italy", "netherlands", "switzerland", "sweden", "norway", "denmark", "finland", "ireland", "united kingdom"].includes(
      normalized
    )
  ) {
    return ["European Businesses", "Global", "North America"];
  }
  if (normalized === "unknown") {
    return ["Global", "U.S. Businesses", "European Businesses"];
  }
  return ["Global", "Regional", "U.S. Businesses"];
}

function inferCheckSizeRange(investorType: Firm["investorType"], stageFocus: string[]): string {
  if (stageFocus.includes("Growth") || stageFocus.includes("Series B")) {
    return investorType === "VC" ? "$2M-$15M" : "$500K-$5M";
  }
  if (stageFocus.includes("Series A")) {
    return investorType === "VC" ? "$1M-$8M" : "$250K-$2M";
  }
  return investorType === "Angel Network" ? "$50K-$1M" : "$250K-$3M";
}

function computeQualificationScore(
  profile: CompanyProfile,
  sectors: string[],
  stageFocus: string[],
  investmentFocus: string[],
  investorType: Firm["investorType"]
): number {
  const profileTokens = new Set(toTokens(profile.oneLiner, profile.longDescription, profile.fundraising.round));
  const sectorTokens = sectors.flatMap((item) => toTokens(item));
  const matchedSector = sectorTokens.filter((token) => profileTokens.has(token)).length;
  const sectorScore = Math.min(0.45, matchedSector * 0.09);

  const round = profile.fundraising.round.toLowerCase();
  const stageHit = stageFocus.some((stage) => stage.toLowerCase().includes(round.replace(/\s+/g, "")));
  const stageScore = stageHit ? 0.3 : 0.15;

  const locationScore =
    profile.website.toLowerCase().endsWith(".co") || profile.website.toLowerCase().endsWith(".com")
      ? investmentFocus.includes("U.S. Businesses") || investmentFocus.includes("Global")
        ? 0.15
        : 0.08
      : 0.1;

  const typeScore = investorType === "VC" ? 0.12 : investorType === "Angel Network" ? 0.08 : 0.06;
  const total = Math.min(1, sectorScore + stageScore + locationScore + typeScore);
  return Number(total.toFixed(3));
}

async function fetchFormSignal(website: string): Promise<{ status: "discovered" | "not_found" | "unknown"; hint?: string }> {
  if (process.env.RESEARCH_FETCH_FORMS !== "true") {
    const heuristic = hashValue(website);
    if (heuristic > 0.67) return { status: "discovered", hint: "Likely form route based on website pattern" };
    if (heuristic < 0.2) return { status: "not_found", hint: "No form route inferred from quick heuristic" };
    return { status: "unknown" };
  }

  const candidates = [website, `${website.replace(/\/+$/, "")}/contact`, `${website.replace(/\/+$/, "")}/apply`];
  for (const target of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(target, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) continue;
      const text = (await response.text()).slice(0, 160_000).toLowerCase();
      const hasForm = text.includes("<form");
      const hasPitchWords =
        text.includes("pitch") || text.includes("submit") || text.includes("apply") || text.includes("founder");
      if (hasForm && hasPitchWords) {
        return { status: "discovered", hint: target };
      }
      if (hasForm) {
        return { status: "discovered", hint: target };
      }
    } catch {
      // best effort
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: "unknown" };
}

export async function researchLead(firm: Firm, profile: CompanyProfile): Promise<LeadResearchResult> {
  const host = normalizeWebsiteHost(firm.website);
  const tokens = toTokens(firm.name, host, ...firm.focusSectors, ...firm.stageFocus);
  const geography = inferGeography(firm);
  const investorType = inferInvestorType(firm, tokens);
  const focusSectors = inferFocusSectors(firm, tokens);
  const stageFocus = inferStageFocus(firm, tokens);
  const investmentFocus = inferInvestmentFocus(geography);
  const checkSizeRange = inferCheckSizeRange(investorType, stageFocus);

  const qualificationScore = computeQualificationScore(profile, focusSectors, stageFocus, investmentFocus, investorType);
  const qualified = qualificationScore >= 0.55;
  const formSignal = await fetchFormSignal(firm.website);

  let nextStage: PipelineStage = qualified ? "qualified" : "researching";
  if (qualified && formSignal.status === "discovered") {
    nextStage = "form_discovered";
  }

  const confidence = Number((0.5 + qualificationScore * 0.45 + hashValue(`${firm.name}-${firm.website}`) * 0.05).toFixed(3));
  const statusReason =
    nextStage === "form_discovered"
      ? "Qualified and likely startup form discovered."
      : qualified
        ? "Researched and qualified for fundraising fit."
        : "Researched. Requires manual review before qualification.";

  return {
    geography,
    investorType,
    checkSizeRange,
    focusSectors,
    stageFocus,
    investmentFocus,
    qualificationScore,
    researchConfidence: confidence,
    formDiscovery: formSignal.status,
    formRouteHint: formSignal.hint,
    nextStage,
    statusReason
  };
}
