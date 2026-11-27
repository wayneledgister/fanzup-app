/**
 * Checkout rules shared by the web checkout and the mobile checkout (CR-004, NFR-MOB-04). Moved unchanged from
 * `apps/web/src/pages/fan/Checkout.tsx`: FR-BCK-001 failure categories (design §4.3), FR-PAY-001 hold
 * announcements (design §11 accessibility), dead/paid backing statuses, and the capture poll loop.
 */
import { ApiError } from "./api-client";
import { isDeadBacking } from "./checkout-key";
import type { Me } from "./schemas";

export type FailureCategory = "declined" | "expired" | "authentication failed" | "network" | "unconfirmed" | "closed" | "other";
export type Failure = { category: FailureCategory; message: string; next: string };

/** Backing statuses that mean the card was charged and the payment applied: show the confirmation, not the card form. */
export const PAID_STATUSES: readonly string[] = ["held", "released"];

/**
 * FR-BCK-001 M1 trim + FR-PLT-006: physical perks may exist, but no shipping address is collected and test-mode
 * perks aren't owed — so nothing may promise shipping.
 */
export const PHYSICAL_PERK_NOTE = "This is a physical perk. FanZuP doesn't collect shipping addresses in this test-money beta, and artists don't owe perks for test backings.";

/**
 * A pay-step error we can't classify (5xx, network, unknown): the card may or may not have been charged, so never say
 * "nothing was charged" — send the fan to My backings. Paying the same backing again can't charge twice (design §4.3).
 */
export const UNCONFIRMED: Failure = { category: "unconfirmed", message: "We couldn't confirm your payment.", next: "Check My backings before trying again — you won't be charged twice." };
export const STILL_WAITING: Failure = { category: "unconfirmed", message: "We're still waiting for your payment to be confirmed.", next: "Check My backings in a minute — you won't be charged twice." };
export const EXPIRED: Failure = { category: "expired", message: "This checkout expired before payment.", next: "Start again below — nothing was charged." };
export const REFUNDING: Failure = { category: "closed", message: "Your payment arrived after the campaign or your checkout closed, so it's being refunded in full.", next: "You'll get an email when the refund completes." };
export const DECLINED: Failure = { category: "declined", message: "Your card was declined.", next: "Try another card. Nothing was charged." };

/** The callout title for a failure, as both clients show it. */
export const failureTitle = (f: Failure) =>
  f.category === "unconfirmed" ? "Payment not confirmed" : `Payment ${f.category === "other" || f.category === "closed" ? "not possible" : f.category}`;

/**
 * Design §4.3: provider signal → category shown → next step. `stage` says which call failed: "create" (`POST /backings`,
 * before any card is touched) or "pay" (the card step). "Nothing was charged" is said only for create-step errors and
 * for declines. Accepts Stripe.js and Stripe React Native error shapes (`code`, `decline_code`/`declineCode`, `type`).
 */
export function categorize(e: unknown, stage: "create" | "pay" = "create"): Failure {
  const x = (e ?? {}) as { code?: string; decline_code?: string; declineCode?: string; stripeErrorCode?: string; type?: string; status?: number; message?: string };
  const code = x.decline_code ?? x.declineCode ?? x.stripeErrorCode ?? x.code ?? "";
  if (e instanceof ApiError) {
    if (e.code === "checkout_expired") return { category: "expired", message: "This checkout expired before payment.", next: "Start again from the campaign page — nothing was charged." };
    if (stage === "pay") return UNCONFIRMED;
    if (e.code === "network" || e.code === "provider_unavailable" || e.status >= 500) return { category: "network", message: "We couldn't reach the payment processor.", next: "Check your connection and try again — nothing was charged." };
    if (["campaign_closed", "perk_sold_out"].includes(e.code)) return { category: "closed", message: e.message, next: "Go back to the campaign page to pick another perk — nothing was charged." };
    return { category: "other", message: e.message, next: "Nothing was charged." };
  }
  if (code === "expired_card") return { category: "expired", message: "Your card has expired.", next: "Use a card that hasn't expired. Nothing was charged." };
  if (code === "authentication_required" || code === "payment_intent_authentication_failure" || x.type === "authentication_error")
    return { category: "authentication failed", message: "Your bank's check wasn't completed.", next: "Try again and complete your bank's check." };
  if (x.type === "card_error" || /declin|insufficient|cvc/i.test(code)) return DECLINED;
  if (stage === "pay") return UNCONFIRMED;
  return { category: "network", message: x.message ?? "Something went wrong.", next: "Check your connection and try again — nothing was charged." };
}

/** A backing that can't be paid any more, as the fan should hear it; null while it's still payable. */
export function deadReason(b: { status: string; holdExpiresAt: string | null }, now = Date.now()): Failure | null {
  if (b.status === "refund_pending" || b.status === "refunded") return REFUNDING;
  if (isDeadBacking(b.status)) return EXPIRED;
  if (b.status === "pending_payment" && b.holdExpiresAt && Date.parse(b.holdExpiresAt) <= now) return EXPIRED;
  return null;
}

/** Seconds left on the perk hold (never negative). */
export const holdSecondsLeft = (holdExpiresAt: string, now = Date.now()) => Math.max(0, Math.round((Date.parse(holdExpiresAt) - now) / 1000));

/** "m:ss" for the hold countdown. */
export const formatHold = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * What the screen-reader live region says about the hold: text changes only at 5 minutes, 1 minute and expiry, so each
 * threshold is announced once (design §11 accessibility).
 */
export function holdAnnouncement(secondsLeft: number): string {
  if (secondsLeft <= 0) return "Your perk hold expired.";
  if (secondsLeft <= 60) return "1 minute left to pay before your perk hold expires.";
  if (secondsLeft <= 300) return "5 minutes left to pay before your perk hold expires.";
  return "";
}

/** The documents to re-accept before backing; current versions come from the server (`GET /me.legal`), never the client build. */
export function acceptanceDocuments(me: Pick<Me, "needsAcceptance" | "legal">) {
  return me.needsAcceptance.map((k) => ({
    kind: k as "terms" | "privacy" | "adult_attestation",
    version: k === "terms" ? me.legal.termsVersion : k === "privacy" ? me.legal.privacyVersion : "v1",
  }));
}

export type CaptureOutcome = { kind: "paid" } | { kind: "dead"; failure: Failure } | { kind: "timeout"; failure: Failure };

/**
 * Wait until the backend has applied the payment (webhook / sandbox event → ledger). Neither client ever decides on
 * its own that a payment succeeded: only `GET /backings/:id` does.
 */
export async function waitForCapture(
  getBacking: () => Promise<{ status: string; holdExpiresAt: string | null }>,
  opts: { attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CaptureOutcome> {
  const attempts = opts.attempts ?? 40;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    try {
      const b = await getBacking();
      if (PAID_STATUSES.includes(b.status)) return { kind: "paid" };
      const why = deadReason(b);
      if (why) return { kind: "dead", failure: why };
    } catch { /* keep polling */ }
    await sleep(opts.intervalMs ?? 1000);
  }
  return { kind: "timeout", failure: STILL_WAITING };
}

/** Sandbox provider only: the card number that pays (any other is declined). */
export const SANDBOX_PAYING_CARD = "4242424242424242";
