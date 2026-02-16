import { normalizedHash } from "./utils.js";
import type { OutreachAgent } from "./types.js";

export const outreachAgent: OutreachAgent = {
  name: "SubmissionAgent",
  async execute(context) {
    const base = normalizedHash(`${context.firm.website}-submit`);
    const requiresManual = base < 0.15;

    return {
      confidence: 0.7 + base * 0.2,
      summary: "Website form submission prepared",
      output: {
        channel: "website_form",
        submitted: context.mode === "production" && !requiresManual,
        requiresHumanConfirmation: true,
        requiresManualReview: requiresManual,
        constraints: [
          "Always include DocSend link",
          "Do not upload local files unless explicitly required",
          "Stop and flag CAPTCHA, login wall, or account requirement"
        ]
      }
    };
  }
};
