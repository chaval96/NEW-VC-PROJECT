import type { CompanyProfile, Firm, InvestorMatch } from "../../shared/types.js";

const BATCH_SIZE = 20;

function buildSystemPrompt(profile: CompanyProfile): string {
  return `You are an expert VC analyst evaluating investor fit for a startup.

Company: ${profile.company}
Website: ${profile.website}
Description: ${profile.oneLiner}
Round: ${profile.fundraising.round} | Amount: ${profile.fundraising.amount}
Valuation: ${profile.fundraising.valuation} | Instrument: ${profile.fundraising.instrument}
ARR: ${profile.metrics.arr} | MRR: ${profile.metrics.mrr}
Customers: ${profile.metrics.subscribers} | Countries: ${profile.metrics.countries}

For each investor, provide a JSON array of objects with:
- firmId: string
- firmName: string
- score: number (0-100, how well this investor fits)
- reasoning: string (1-2 sentences)
- highlights: string[] (positive signals)
- concerns: string[] (risk factors)

Return ONLY the JSON array, no markdown or wrapping.`;
}

function buildUserPrompt(firms: Firm[]): string {
  const list = firms.map((f) => ({
    firmId: f.id,
    firmName: f.name,
    website: f.website,
    investorType: f.investorType,
    geography: f.geography,
    checkSizeRange: f.checkSizeRange,
    focusSectors: f.focusSectors,
    stageFocus: f.stageFocus,
  }));
  return `Evaluate these investors:\n${JSON.stringify(list, null, 2)}`;
}

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

async function callOpenAI(system: string, user: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

function parseResponse(raw: string, firms: Firm[]): InvestorMatch[] {
  try {
    const jsonStr = raw.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as InvestorMatch[];
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to deterministic
  }
  return deterministicFallback(firms);
}

function deterministicFallback(firms: Firm[]): InvestorMatch[] {
  const sectorWeights: Record<string, number> = {
    adtech: 20, ai: 15, marketing: 12, saas: 10, b2b: 8, enterprise: 9, cloud: 9, fintech: 5, growth: 7,
  };

  return firms.map((f) => {
    const sectorScore = f.focusSectors.reduce(
      (acc, s) => acc + (sectorWeights[s.toLowerCase()] ?? 4), 0
    );
    const typeBonus = f.investorType === "VC" ? 10 : f.investorType === "Angel Network" ? 5 : 0;
    const score = Math.min(100, Math.max(10, 35 + sectorScore + typeBonus));

    return {
      firmId: f.id,
      firmName: f.name,
      score,
      reasoning: `Sector alignment score of ${sectorScore} with ${f.investorType} type bonus.`,
      highlights: f.focusSectors.filter((s) => (sectorWeights[s.toLowerCase()] ?? 0) > 8),
      concerns: score < 50 ? ["Low sector overlap"] : [],
    };
  });
}

export async function assessInvestors(
  profile: CompanyProfile,
  firms: Firm[]
): Promise<InvestorMatch[]> {
  if (firms.length === 0) return [];

  const system = buildSystemPrompt(profile);
  const allMatches: InvestorMatch[] = [];

  for (let i = 0; i < firms.length; i += BATCH_SIZE) {
    const batch = firms.slice(i, i + BATCH_SIZE);
    const user = buildUserPrompt(batch);

    let raw = "";
    try {
      raw = await callClaude(system, user);
    } catch {
      try {
        raw = await callOpenAI(system, user);
      } catch {
        allMatches.push(...deterministicFallback(batch));
        continue;
      }
    }

    allMatches.push(...parseResponse(raw, batch));
  }

  return allMatches.sort((a, b) => b.score - a.score);
}
