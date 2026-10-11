import type { Env } from "../env";
import type { Sql } from "../db";
import { SandboxProvider } from "./sandbox";
import { StripeTestProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export * from "./types";
export { SandboxProvider } from "./sandbox";
export { StripeTestProvider } from "./stripe";

export function createProvider(env: Env, sql: Sql): PaymentProvider {
  if (env.ESCROW_PROVIDER === "stripe-test") {
    return new StripeTestProvider({
      secretKey: env.STRIPE_SECRET_KEY!,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    });
  }
  return new SandboxProvider(sql);
}
