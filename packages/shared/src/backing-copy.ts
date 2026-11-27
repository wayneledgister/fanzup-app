/**
 * What a fan reads about a backing's money and its campaign (FR-BCK-005, FR-PAY-009 fan view). Shared by the web's
 * My backings page and the mobile Backed tab so both say exactly the same thing (CR-004, NFR-MOB-04).
 */
import type { MoneyState } from "./schemas";

export type Tone = "gold" | "success" | "info" | "warning" | "neutral";

export const MONEY_STATE_COPY: Record<MoneyState, { label: string; tone: Tone; help: string }> = {
  pending: { label: "Payment pending", tone: "warning", help: "We're waiting for your payment to be confirmed." },
  held: { label: "Held until the deadline", tone: "gold", help: "If the goal isn't reached by the deadline, you're refunded in full automatically." },
  with_artist: { label: "Released in stages", tone: "info", help: "The campaign is funded. The artist receives the money as each milestone is verified." },
  released: { label: "Released to the artist", tone: "success", help: "Every milestone has been released to the artist." },
  refunding: { label: "Refund on its way", tone: "warning", help: "Your refund has started. It usually reaches your card within 5 business days." },
  refunded: { label: "Refunded", tone: "neutral", help: "You were refunded in full." },
  canceled: { label: "Not completed", tone: "neutral", help: "This checkout wasn't completed. Nothing was charged." },
};

export const CAMPAIGN_STATUS_COPY: Record<string, string> = {
  live: "Live", funded: "Funded", released: "Funded · all milestones released", failed: "Didn't reach its goal", refunded: "Didn't reach its goal · refunded", closed: "Closed",
};

export const campaignStatusLabel = (status: string) => CAMPAIGN_STATUS_COPY[status] ?? status;

/**
 * The test-money notice (FR-PLT-006), worded the same on every client. Shown until the API confirms live mode.
 * Design §12.1 / SETUP Part C: the stripe-test card below has funds available immediately.
 */
export const TEST_MODE_NOTICE = {
  title: "Test mode — no real money moves",
  intro: "FanZuP is in a test-money beta.",
  stripeTestCard: "4000 0000 0000 0077",
  stripeTestCardHint: "(any future expiry date, any CVC)",
  closing: "Artists don't owe perks for test backings; anything they send is a bonus.",
};

/**
 * Layer 1 refund promise (FR-PLT-006: while no custodian is live, no screen names one or says "escrow").
 * The web's `<EscrowNotice />` and the mobile one render these strings.
 */
export const REFUND_PROMISE = {
  title: "Refunded in full if the goal isn't met",
  compact: "If the goal isn't reached by the deadline, every backer is refunded in full automatically.",
  full:
    "Your card is charged when you back. If the campaign doesn't reach its goal by the deadline, every backer is refunded in full, " +
    "automatically. If it does, the artist receives the money in stages. Backing gets you the perks listed; it is not an investment and " +
    "doesn't include any share of the artist's earnings.",
};

/** The campaign page FAQ (Layer 1), the same on web and mobile. */
export const CAMPAIGN_FAQ: readonly { q: string; a: string }[] = [
  { q: "When am I charged?", a: "Your card is charged when you back. If the campaign doesn't reach its goal by the deadline, you're refunded in full automatically — you don't need to do anything." },
  { q: "What if the goal is reached?", a: "The artist receives the money in stages: part when the campaign is funded, the rest as each milestone below is verified." },
  { q: "Is backing an investment?", a: "No. Backing gets you the perk you choose. It doesn't give you any share of the artist's earnings or ownership of the project." },
  { q: "Why do I need an account?", a: "So your backing, your refund if it fails, and your perk are tied to you. You verify your email once, then you're straight back here." },
];

export const TRANCHE_STATUS_COPY: Record<string, string> = {
  pending: "Waiting", evidence_submitted: "Evidence submitted", verified: "Verified", released: "Released", rejected: "Not accepted",
};

/** Perk stock as the fan sees it: sold out, running low (≤ 15 % of the limit or ≤ 10 left), or plenty. */
export function perkStock(p: { remaining: number | null; limit: number | null }): { soldOut: boolean; low: boolean; unlimited: boolean } {
  const soldOut = p.remaining === 0;
  const low = p.remaining !== null && p.remaining > 0 && p.limit !== null && p.remaining <= Math.max(10, p.limit * 0.15);
  return { soldOut, low, unlimited: p.remaining === null };
}

/** Whether the campaign takes backers right now (live and before its deadline). */
export const acceptingBackers = (c: { status: string; endsAt: string | null }, now = Date.now()) =>
  c.status === "live" && !!c.endsAt && Date.parse(c.endsAt) > now;
