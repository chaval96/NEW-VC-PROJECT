import type { Firm, WaskCompanyProfile } from "../domain/types.js";

export interface AgentContext {
  runId: string;
  firm: Firm;
  profile: WaskCompanyProfile;
  now: string;
  mode: "dry_run" | "production";
}

export interface AgentOutput {
  confidence: number;
  summary: string;
  output: Record<string, unknown>;
}

export interface OutreachAgent {
  name: string;
  execute(context: AgentContext): Promise<AgentOutput>;
}
