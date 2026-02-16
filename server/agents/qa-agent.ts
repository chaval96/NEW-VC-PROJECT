import type { OutreachAgent } from "./types.js";

export const qaAgent: OutreachAgent = {
  name: "QAAgent",
  async execute(context) {
    const required = [
      context.profile.senderName,
      context.profile.senderEmail,
      context.profile.fundraising.deckUrl,
      context.profile.fundraising.amount,
      context.profile.oneLiner
    ];

    const complete = required.every((value) => Boolean(value && value.trim().length > 0));

    return {
      confidence: complete ? 0.96 : 0.25,
      summary: complete
        ? "Validation complete. Required form submission fields are present"
        : "Validation failed. Missing critical sender or fundraising metadata",
      output: {
        checks: {
          senderIdentity: Boolean(context.profile.senderEmail),
          deckIncluded: Boolean(context.profile.fundraising.deckUrl),
          fundraiseDetails: Boolean(context.profile.fundraising.amount)
        },
        canProceed: complete
      }
    };
  }
};
