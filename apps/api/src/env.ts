import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  ESCROW_PROVIDER: z.enum(["sandbox", "stripe-dev"]).default("sandbox"),
  /** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` to /api/internal/tick. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Connections per instance. Keep low on serverless (Vercel), higher on a long-running host. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  PORT: z.coerce.number().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  NODE_ENV: z.string().default("development"),
});
export type Env = z.infer<typeof Env>;

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

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const env = Env.parse(withIntegrationAliases(src));
  if (!env.SUPABASE_URL && !env.SUPABASE_JWT_SECRET) throw new Error("Set SUPABASE_URL (JWKS) or SUPABASE_JWT_SECRET to verify users");
  if (env.ESCROW_PROVIDER === "stripe-dev") {
    if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("stripe-dev escrow requires a Stripe TEST key (sk_test_…)");
  }
  return env;
}
