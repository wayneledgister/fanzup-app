import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  ESCROW_PROVIDER: z.enum(["sandbox", "stripe-dev"]).default("sandbox"),
  PORT: z.coerce.number().default(8787),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  NODE_ENV: z.string().default("development"),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const env = Env.parse(src);
  if (!env.SUPABASE_URL && !env.SUPABASE_JWT_SECRET) throw new Error("Set SUPABASE_URL (JWKS) or SUPABASE_JWT_SECRET to verify users");
  if (env.ESCROW_PROVIDER === "stripe-dev") {
    if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("stripe-dev escrow requires a Stripe TEST key (sk_test_…)");
  }
  return env;
}
