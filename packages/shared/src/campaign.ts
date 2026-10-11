/**
 * Reward campaign lifecycle ("Fund My Show", Mechanism 05). The DB enforces the same
 * transitions in a trigger (supabase/migrations) — keep both in sync.
 *
 *   draft → in_review → (revisions_requested → in_review)* → approved → live
 *   live → funded   (target reached by deadline)  → released (all tranches out) → closed
 *   live → failed   (target missed)               → refunded → closed
 *   any pre-live → withdrawn
 */
export const CAMPAIGN_STATUSES = [
  "draft",
  "in_review",
  "revisions_requested",
  "approved",
  "live",
  "funded",
  "failed",
  "released",
  "refunded",
  "closed",
  "withdrawn",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["in_review", "withdrawn"],
  in_review: ["revisions_requested", "approved", "withdrawn"],
  revisions_requested: ["in_review", "withdrawn"],
  approved: ["live", "withdrawn"],
  live: ["funded", "failed"],
  funded: ["released"],
  failed: ["refunded"],
  released: ["closed"],
  refunded: ["closed"],
  closed: [],
  withdrawn: [],
};

export const canTransition = (from: CampaignStatus, to: CampaignStatus) => CAMPAIGN_TRANSITIONS[from].includes(to);

/** Target-or-refund: the outcome is decided only at the deadline (Mechanism 05 §2). */
export function settleOutcome(raisedMinor: number, goalMinor: number): "funded" | "failed" {
  return raisedMinor >= goalMinor ? "funded" : "failed";
}

/**
 * Time left before a campaign's deadline, as the campaign page shows it (FR-BCK-004; design §11): whole days
 * (rounded up) from 24 h out, hours and minutes under 24 h, "Ended" from the deadline instant on.
 */
export function timeLeft(endsAt: string | null, now: number = Date.now()): { label: string; value: string; ended: boolean; msLeft: number } {
  if (!endsAt) return { label: "", value: "—", ended: true, msLeft: 0 };
  const ms = Date.parse(endsAt) - now;
  if (ms <= 0) return { label: "ended", value: "Ended", ended: true, msLeft: 0 };
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return { label: "left", value: `${h}h ${m}m`, ended: false, msLeft: ms };
  }
  return { label: "days left", value: String(Math.ceil(ms / 86_400_000)), ended: false, msLeft: ms };
}
