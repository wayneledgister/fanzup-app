/**
 * Policy defaults — every product number that isn't set by the docs lives here.
 * Adopted as a set by Wayne in council D1 (2026-10-03, Card B). Change values here only.
 * Each entry notes its basis; "policy default" means a product choice, not a regulatory figure.
 */
export const POLICY = {
  campaign: {
    /** Mechanism 05 §2.4 example: half on funding, half on a verified milestone. */
    defaultTranchesPct: [50, 50] as const,
    minTranches: 2,
    maxTranches: 3,
    /** Policy default; mirrors Kickstarter's 60-day maximum. */
    minDays: 7,
    maxDays: 60,
    /** Shown to artists as an estimate. */
    reviewEstimate: "usually within 2 business days",
  },
  adminSlaBusinessDays: { campaignReview: 2, identity: 1, disputes: 3, refunds: 1 },
  tickets: { maxPerOrder: 6 },
  /** Artist sets shipping per item; platform adds no flat rate (fees.html: fulfillment at cost). */
  merch: { platformFlatShippingMinor: 0 },
  streaming: { tipCapMinor: 500_00, replayHours: 48 },
  account: { deletionGraceDays: 14 },
  /** Card processing is passed through to the artist at cost (fees.html); fans pay sticker price. */
  processing: { pct: 0.029, fixedMinor: 30, payer: "artist" as "artist" | "fan" },
} as const;

/** Processing deducted from an artist's proceeds for one charge. */
export const processingFeeMinor = (chargeMinor: number) =>
  Math.round(chargeMinor * POLICY.processing.pct) + POLICY.processing.fixedMinor;
