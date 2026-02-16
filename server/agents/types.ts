import type { CompanyProfile, Firm } from "../domain/types.js";

export interface AgentContext {
  runId: string;
  firm: Firm;
  profile: CompanyProfile;
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
