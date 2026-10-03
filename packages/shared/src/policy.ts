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

  // ── v2 requirements Appendix A — accepted as a set by Wayne, 2026-10-03 (G1). ──
  checkout: {
    /** FR-PAY-001. Common checkout hold; long enough for 3-D Secure. */
    holdMinutes: 15,
    /** FR-TAX-004. Limits card-testing. */
    maxUnconfirmedPerUser: 3,
  },
  refunds: {
    /** FR-PAY-003, NFR-COMP-05 (E1 Compliance): auto-refunds initiated within this many minutes. */
    autoInitiateMinutes: 60,
    /** FR-DSP-001. Policy default ($500); replaced by FR-ID-007 rules while single-operator mode is on. */
    secondApprovalAboveMinor: 500_00,
  },
  approvals: {
    /** FR-PAY-005, FR-ID-003. Policy default ($5,000). */
    secondVerifierAboveMinor: 5_000_00,
  },
  /** FR-ID-007 single-operator mode (card G1-A option 1). Policy defaults. */
  singleOperator: {
    delayAboveMinor: 1_000_00,
    delayHours: 24,
    dailyLimits: { refundsMinor: 5_000_00, verifications: 3 },
  },
  outbound: {
    /** FR-PAY-004, NFR-OPS-05 (E1 Compliance). */
    maxAttempts: 8,
    /** Design §5: `wait_funds` retries don't count as attempts; raised as a break after this many days. */
    waitFundsBreakDays: 7,
  },
  recon: {
    /** FR-PAY-007 (E1 Compliance): $1. */
    materialityMinor: 100,
    maxBreakAgeBusinessDays: 1,
  },
  /** NFR-SEC-13, FR-TAX-004 (E1 Security). Recorded at M1; enforced at M2. */
  rateLimits: { backingPerMinute: 5, backingPerHour: 20, writesPerMinutePerUser: 60, writesPerMinutePerIp: 120 },
  staff: { idleTimeoutMinutes: 15 },
  /** FR-PRV-001. Placeholder documents until counsel-approved versions (P0b). */
  legal: { termsVersion: "2026-10-03-beta", privacyVersion: "2026-10-03-beta" },

  // ── Layer 2 (CR-002, demo on mock rails). Mirrored in platform_settings by migration 20261005000200 (sync test). ──
  /**
   * Reg CF investor limits — REGULATORY figures, 17 CFR 227.100(a)(2) as amended (inflation adjustment effective
   * 2022-09-20). Verified 2026-10-03 against the SEC's "Regulation Crowdfunding inflation adjustments" notice
   * (sec.gov/files/inflation-adjustments-infographic.pdf). Re-verify before any live use: the SEC adjusts these at
   * least every five years.
   *  (i)  income OR net worth below thresholdMinor → greater of floorMinor or lowBps of the greater of income/net worth
   *       (no explicit cap in (i) — implemented literally; counsel item L2-Q-limit)
   *  (ii) income AND net worth at/above thresholdMinor → highBps of the greater, capped at thresholdMinor
   *  Accredited investors: no limit (227.100(a)(2) applies to non-accredited only since the 2021 amendments).
   */
  regCf: {
    floorMinor: 2_500_00,
    thresholdMinor: 124_000_00,
    lowBps: 500,
    highBps: 1_000,
    verifiedOn: "2026-10-03",
    /** Issuer cap per 12 months (227.100(a)(1)); the creator's tier cap (tiers.ts) is lower and applies first. */
    issuerCapMinor: 5_000_000_00,
  },
  l2: {
    /** Policy default: an unfunded Unit reservation holds the investor's limit and the Units this long. */
    reserveMinutes: 30,
    /** Policy default: at the deadline, wait this long for fund moves already in flight before settling. */
    settleGraceMinutes: 10,
    /** Reg CF: investors may cancel until 48 hours before the offering deadline (227.304). */
    cancelCutoffHours: 48,
    /** Rule 501 / 227.501: Units can't be resold for 12 months from issue (Mechanism 07 P0). */
    lockupMonths: 12,
    /** Policy defaults for the creator wizard (FR-L2-CR-003). */
    defaults: { returnCapBps: 15_000, maturityMonths: 60, distribution: "quarterly" as const, fansBps: 3_000, platformBps: 500 },
    deadlineDays: { min: 14, max: 60 },
    /** Royalty periods follow the distribution schedule; a period's cash is due this long after it ends (01b §5). */
    periodMonths: 3,
    settlementDueDays: 45,
    /** Policy default: at-risk longer than this → DEFAULT (01b §5). */
    cureDays: 30,
    /** Demo state deny-list (state blue-sky review is L2-Q8). Empty = all US states eligible in the demo. */
    blockedStates: [] as readonly string[],
    /** Version of the risk acknowledgment text shown before purchase (InvestmentRiskDisclosure). */
    riskAckVersion: "2026-10-03-demo",
  },
} as const;

/** Processing deducted from an artist's proceeds for one charge. */
export const processingFeeMinor = (chargeMinor: number) =>
  Math.round(chargeMinor * POLICY.processing.pct) + POLICY.processing.fixedMinor;
