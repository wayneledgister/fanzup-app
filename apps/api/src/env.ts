import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  /**
   * Payment provider (ADR-003). "sandbox" = no network, local/CI only. "stripe-test" = Stripe TEST mode.
   * "stripe-dev" is accepted as the old name for "stripe-test".
   */
  ESCROW_PROVIDER: z
    .enum(["sandbox", "stripe-test", "stripe-dev"])
    .default("sandbox")
    .transform((v) => (v === "stripe-dev" ? "stripe-test" : v)),
  /** local | ci | staging | production. Deployed environments fail closed (NFR-SEC-04, FR-PAY-008). */
  DEPLOY_ENV: z.enum(["local", "ci", "staging", "production"]).optional(),
  /** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` to /api/internal/tick. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Connections per instance. Keep low on serverless (Vercel), higher on a long-running host. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  PORT: z.coerce.number().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  /** Public web origin, used for return links (Stripe onboarding, emails). */
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  NODE_ENV: z.string().default("development"),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(200).default(30_000),
  /**
   * Layer 2 Reg CF provider (CR-002, ADR-007). "none" (default) = Layer 2 can't be enabled. "mock" = apps/mock-escrow,
   * local/CI only — refused in a deployed environment, so Layer 2 can't run in production by construction.
   */
  REGCF_PROVIDER: z.enum(["none", "mock"]).default("none"),
  MOCK_ESCROW_URL: z.string().url().default("http://localhost:8790"),
  MOCK_ESCROW_API_KEY: z.string().min(8).default("mock_escrow_dev_key"),
  MOCK_ESCROW_WEBHOOK_SECRET: z.string().min(16).default("mock_escrow_dev_webhook_secret"),
});
export type Env = z.infer<typeof Env> & { deployed: boolean };

/**
 * Accept the variable names the Supabase ↔ Vercel integration injects, so connecting the integration
 * is enough: POSTGRES_URL (transaction pooler, 6543) → DATABASE_URL. Explicit DATABASE_URL always wins.
 */
function withIntegrationAliases(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...src };
  if (!out.DATABASE_URL && out.POSTGRES_URL) out.DATABASE_URL = sanitizePgUrl(out.POSTGRES_URL);
  if (!out.SUPABASE_URL && out.NEXT_PUBLIC_SUPABASE_URL) out.SUPABASE_URL = out.NEXT_PUBLIC_SUPABASE_URL;
  return out;
}

/** Drop query params the integration adds that aren't Postgres startup options (e.g. `supa=base-pooler.x`). */
export function sanitizePgUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k !== "sslmode") u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** Deployed = anything that isn't a developer machine or CI (design §9, G2 condition 15). */
export function isDeployed(src: NodeJS.ProcessEnv, deployEnv?: string): boolean {
  if (deployEnv === "local" || deployEnv === "ci") return false;
  return deployEnv === "staging" || deployEnv === "production" || !!src.VERCEL_ENV || !!src.RENDER || src.NODE_ENV === "production";
}

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.parse(withIntegrationAliases(src));
  const env: Env = { ...parsed, deployed: isDeployed(src, parsed.DEPLOY_ENV) };
  if (!env.SUPABASE_URL && !env.SUPABASE_JWT_SECRET) throw new Error("Set SUPABASE_URL (JWKS) or SUPABASE_JWT_SECRET to verify users");
  // FR-PAY-008 / NFR-SEC-04: a deployed environment never runs the sandbox, and nothing ever runs live keys
  // (no custody configuration has been approved — E1 card B).
  if (env.deployed && env.ESCROW_PROVIDER === "sandbox") {
    throw new Error("ESCROW_PROVIDER: the sandbox provider can't run in a deployed environment; set ESCROW_PROVIDER=stripe-test with Stripe TEST keys");
  }
  if (env.deployed && env.REGCF_PROVIDER === "mock") {
    throw new Error("REGCF_PROVIDER: the mock escrow provider can't run in a deployed environment (CR-002; Layer 2 stays off in production)");
  }
  if (env.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    throw new Error("STRIPE_SECRET_KEY: only Stripe TEST keys (sk_test_… / rk_test_…) are allowed until custody is approved (FR-PAY-008)");
  }
  if (env.ESCROW_PROVIDER === "stripe-test") {
    if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY: required for ESCROW_PROVIDER=stripe-test");
    if (env.deployed && !env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET: required in a deployed environment");
  }
  if (env.STRIPE_PUBLISHABLE_KEY && !env.STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_")) {
    throw new Error("STRIPE_PUBLISHABLE_KEY: only pk_test_… keys are allowed (FR-PAY-008)");
  }
  return env;
}
