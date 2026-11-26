/**
 * Agent worker configuration (CR-003, FR-AGT-F-006). Separate from the API's env so the agent worker needs no
 * payment-provider or auth secrets, and the API needs no model key. Fails closed like `loadEnv`.
 */
import { z } from "zod";
import { isDeployed, sanitizePgUrl } from "../env";

const AgentEnv = z.object({
  DATABASE_URL: z.string().url(),
  /** none = deterministic findings only (default). fake = tests/local only. anthropic = Claude via the Messages API. */
  AGENT_MODEL_PROVIDER: z.enum(["none", "fake", "anthropic"]).default("none"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DEPLOY_ENV: z.enum(["local", "ci", "staging", "production"]).optional(),
  AGENT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
});
export type AgentEnv = z.infer<typeof AgentEnv> & { deployed: boolean };

export function loadAgentEnv(src: NodeJS.ProcessEnv = process.env): AgentEnv {
  const withAlias = { ...src };
  if (!withAlias.DATABASE_URL && withAlias.POSTGRES_URL) withAlias.DATABASE_URL = sanitizePgUrl(withAlias.POSTGRES_URL);
  const parsed = AgentEnv.parse(withAlias);
  const env: AgentEnv = { ...parsed, deployed: isDeployed(src, parsed.DEPLOY_ENV) };
  if (env.deployed && env.AGENT_MODEL_PROVIDER === "fake") {
    throw new Error("AGENT_MODEL_PROVIDER: the fake model can't run in a deployed environment (CR-003)");
  }
  if (env.AGENT_MODEL_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY: required for AGENT_MODEL_PROVIDER=anthropic");
  }
  return env;
}
