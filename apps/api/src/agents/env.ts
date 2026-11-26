/**
 * Agent worker configuration (CR-003, FR-AGT-F-006). Separate from the API's env so the agent worker needs no
 * payment-provider or auth secrets, and the API needs no model key. Fails closed like `loadEnv`.
 */
import { z } from "zod";
import { isDeployed, sanitizePgUrl } from "../env";

const AgentEnv = z.object({
  /**
   * The agent worker's own login: the `fanzup_agent` role (on Supabase's pooler, `fanzup_agent.<project-ref>`). Required
   * when deployed, so the process never holds the owner credential (review M2, docs/SETUP.md D3).
   */
  AGENT_DATABASE_URL: z.string().url().optional(),
  /** Local and test only: the owner URL; asAgent still switches to fanzup_agent for every transaction. */
  DATABASE_URL: z.string().url().optional(),
  /** none = deterministic findings only (default). fake = tests/local only. anthropic = Claude via the Messages API. */
  AGENT_MODEL_PROVIDER: z.enum(["none", "fake", "anthropic"]).default("none"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DEPLOY_ENV: z.enum(["local", "ci", "staging", "production"]).optional(),
  AGENT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
});
export type AgentEnv = z.infer<typeof AgentEnv> & { deployed: boolean; databaseUrl: string };

/** The agent role's login name, bare or in Supavisor's `<role>.<project-ref>` form. */
export function isAgentLogin(url: string): boolean {
  const user = decodeURIComponent(new URL(url).username);
  return user === "fanzup_agent" || user.startsWith("fanzup_agent.");
}

export function loadAgentEnv(src: NodeJS.ProcessEnv = process.env): AgentEnv {
  const withAlias = { ...src };
  if (!withAlias.DATABASE_URL && withAlias.POSTGRES_URL) withAlias.DATABASE_URL = sanitizePgUrl(withAlias.POSTGRES_URL);
  const parsed = AgentEnv.parse(withAlias);
  const deployed = isDeployed(src, parsed.DEPLOY_ENV);
  if (deployed && !parsed.AGENT_DATABASE_URL) {
    throw new Error("AGENT_DATABASE_URL: required when deployed; the agent worker must log in as fanzup_agent, not the owner (CR-003)");
  }
  const databaseUrl = parsed.AGENT_DATABASE_URL ?? parsed.DATABASE_URL;
  if (!databaseUrl) throw new Error("AGENT_DATABASE_URL (or DATABASE_URL locally): required");
  if (deployed && !isAgentLogin(databaseUrl)) {
    throw new Error("AGENT_DATABASE_URL: must log in as fanzup_agent (or fanzup_agent.<project-ref> through the pooler) when deployed");
  }
  const env: AgentEnv = { ...parsed, deployed, databaseUrl };
  if (env.deployed && env.AGENT_MODEL_PROVIDER === "fake") {
    throw new Error("AGENT_MODEL_PROVIDER: the fake model can't run in a deployed environment (CR-003)");
  }
  if (env.AGENT_MODEL_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY: required for AGENT_MODEL_PROVIDER=anthropic");
  }
  return env;
}
