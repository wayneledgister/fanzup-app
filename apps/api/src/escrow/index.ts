import Stripe from "stripe";
import type { Env } from "../env";
import type { EscrowProvider } from "./provider";
import { SandboxEscrow } from "./sandbox";
import { StripeDevEscrow } from "./stripe-dev";

export type { EscrowProvider } from "./provider";
export { SandboxEscrow } from "./sandbox";

export function createStripe(env: Env): Stripe | null {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
}

export function createEscrow(env: Env, stripe: Stripe | null): EscrowProvider {
  if (env.ESCROW_PROVIDER === "stripe-dev") return new StripeDevEscrow(stripe!);
  return new SandboxEscrow();
}
