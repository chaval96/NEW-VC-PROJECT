import { bounded, normalizedHash } from "./utils.js";
import type { OutreachAgent } from "./types.js";

export const researchAgent: OutreachAgent = {
  name: "FormDiscoveryAgent",
  async execute(context) {
    const base = normalizedHash(`${context.firm.name}-research`);
    const fit = bounded(0.45 + base * 0.55);
    const probableEntry =
      base > 0.7
        ? "Dedicated founders page"
        : base > 0.45
          ? "Contact/startup form likely in footer"
          : "General contact page likely";

    return {
      confidence: fit,
      summary: `${context.firm.name} researched, likely form entrypoint identified`,
      output: {
        website: context.firm.website,
        probableEntry,
        thesisFit: fit,
        expectedFormType: base > 0.6 ? "Custom form" : "Embedded form"
      }
    };
  }
};
