import dayjs from "dayjs";
import { normalizedHash } from "./utils.js";
import type { OutreachAgent } from "./types.js";

export const followUpAgent: OutreachAgent = {
  name: "TrackingAgent",
  async execute(context) {
    const base = normalizedHash(`${context.firm.name}-tracking`);
    const checkpoints = base > 0.6 ? [1, 3, 7] : [1, 4, 8];
    const reviewSchedule = checkpoints.map((days) => dayjs(context.now).add(days, "day").toISOString());

    return {
      confidence: 0.8,
      summary: "Post-submission tracking schedule generated",
      output: {
        nextChecks: ["Confirm submission receipt", "Check status updates", "Escalate for manual review if stale"],
        reviewSchedule
      }
    };
  }
};
