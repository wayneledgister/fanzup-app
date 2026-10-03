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
