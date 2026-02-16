import { normalizedHash } from "./utils.js";
import type { OutreachAgent } from "./types.js";

export const personalizationAgent: OutreachAgent = {
  name: "FormMappingAgent",
  async execute(context) {
    const signal = normalizedHash(`${context.firm.name}-mapping`);
    const positioningLine =
      signal > 0.66
        ? "Strong overlap with your AI-enabled B2B growth thesis."
        : signal > 0.33
          ? "Aligned with your operator-led SaaS and performance marketing focus."
          : "Relevant to your stage preference and cross-border growth strategy.";

    return {
      confidence: 0.72 + signal * 0.2,
      summary: "Form-ready payload prepared for VC submission fields",
      output: {
        headline: `Series A opportunity: ${context.profile.company}`,
        companyName: context.profile.company,
        companyWebsite: context.profile.website,
        companySummary: `${context.profile.oneLiner} ${positioningLine}`,
        longDescription: context.profile.longDescription,
        raise: `${context.profile.fundraising.round} | ${context.profile.fundraising.amount} | ${context.profile.fundraising.valuation}`,
        deckUrl: context.profile.fundraising.deckUrl,
        dataRoomUrl: context.profile.fundraising.dataRoomUrl,
        contact: {
          name: context.profile.senderName,
          title: context.profile.senderTitle,
          email: context.profile.senderEmail,
          phone: context.profile.senderPhone,
          linkedin: context.profile.linkedin,
          calendly: context.profile.calendly
        }
      }
    };
  }
};
