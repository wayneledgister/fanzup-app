import type { Env } from "../env";
import { HttpMockEscrow } from "./http";
import type { RegCfProvider } from "./types";

export * from "./types";

/** Layer 2 provider from env (ADR-007). Undefined unless REGCF_PROVIDER=mock (refused when deployed, env.ts). */
export function createRegCf(env: Env): RegCfProvider | undefined {
  if (env.REGCF_PROVIDER !== "mock") return undefined;
  return new HttpMockEscrow({ baseUrl: env.MOCK_ESCROW_URL, apiKey: env.MOCK_ESCROW_API_KEY, webhookSecret: env.MOCK_ESCROW_WEBHOOK_SECRET });
}
