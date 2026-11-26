import type * as z from "zod/v4";
import type { Tx } from "../db";

export interface AgentTask {
  id: string;
  agent: string;
  subject_kind: string;
  subject_id: string | null;
  subject_key: string;
  attempts: number;
  correlation_id: string | null;
}

/**
 * One Phase 0 agent: gather (read-only, as fanzup_agent) → deterministic checks → one model call → proposal body.
 * Deterministic findings are always part of the body, with or without the model (FR-AGT-F-006).
 */
export interface AgentDefinition<I, A, F = unknown> {
  name: "campaign_review" | "ops_weekly";
  kind: "review_packet" | "weekly_pack";
  promptVersion: string;
  schema: z.ZodType<A>;
  system: string;
  gather(tx: Tx, task: AgentTask, now: Date): Promise<I>;
  checks(input: I, now: Date): F;
  /** A reason to complete the task without a proposal (e.g. the subject moved on), or null. */
  skip?(input: I): string | null;
  prompt(input: I, findings: F): string;
  body(input: I, findings: F, assessment: A | null): Record<string, unknown>;
}
