import { bounded, normalizedHash } from "./utils.js";
import type { OutreachAgent } from "./types.js";

const tagWeights: Record<string, number> = {
  adtech: 0.2,
  ai: 0.15,
  marketing: 0.12,
  saas: 0.1,
  b2b: 0.08,
  enterprise: 0.09,
  cloud: 0.09
};

export const qualificationAgent: OutreachAgent = {
  name: "QualificationAgent",
  async execute(context) {
    const weightedTagScore = context.firm.focusSectors.reduce(
      (acc, tag) => acc + (tagWeights[tag.toLowerCase()] ?? 0.04),
      0
    );
    const base = normalizedHash(`${context.firm.id}-qualification`);
    const score = bounded(0.35 + weightedTagScore + base * 0.25);

    return {
      confidence: score,
      summary: `Fit score computed at ${Math.round(score * 100)}%`,
      output: {
        qualificationScore: score,
        recommended: score >= 0.62,
        reason:
          score >= 0.62
            ? "Thesis and stage fit meet submission threshold"
            : "Below current quality threshold, queued for manual review"
      }
    };
  }
};
