/**
 * Creator tiers — the single source of truth for tier names, gates and caps.
 * Source: PRD 01 §6.3, detailed in products/creator-tier3.html and creator-tier4.html.
 * Council D1 (2026-10-03), Blocker 1: every screen that shows tier rules must read from here.
 * Caps are Reg CF issuer limits per rolling 12 months across ALL Reg CF offerings (Layer 2).
 */
export type TierName = "Starter" | "Rising" | "Established" | "Pro";

export interface TierDef {
  name: TierName;
  /** Secondary label only (Brand naming: UI leads with the name). */
  ordinal: 1 | 2 | 3 | 4;
  /** Reg CF cap in cents, per 12 months across all Reg CF offerings. Starter has no securities. */
  regCfCapMinor: number | null;
  /** Reward-campaign goal limit in cents (Layer 1). */
  campaignCapMinor: number;
  /** Requirements in addition to the previous tier's. */
  gates: string[];
  minMonthlyListeners?: number;
  minHistoryMonths?: number;
}

export const TIERS: TierDef[] = [
  {
    name: "Starter",
    ordinal: 1,
    regCfCapMinor: null,
    campaignCapMinor: 10_000_00,
    gates: ["Identity verification (KYC)", "Verified email and phone", "100% complete profile", "At least one released track linked"],
  },
  {
    name: "Rising",
    ordinal: 2,
    regCfCapMinor: 100_000_00,
    campaignCapMinor: 100_000_00,
    gates: ["Streaming account linked", "1,000+ monthly listeners", "90 days of streaming history", "Business entity with an EIN (e.g. an LLC)"],
    minMonthlyListeners: 1_000,
    minHistoryMonths: 3,
  },
  {
    name: "Established",
    ordinal: 3,
    regCfCapMinor: 1_000_000_00,
    campaignCapMinor: 100_000_00,
    gates: ["LLC and EIN verified", "Business bank account linked and verified", "10,000+ monthly listeners", "12+ months of streaming history"],
    minMonthlyListeners: 10_000,
    minHistoryMonths: 12,
  },
  {
    name: "Pro",
    ordinal: 4,
    regCfCapMinor: 5_000_000_00,
    campaignCapMinor: 100_000_00,
    gates: ["2+ years of tax records (1099-NEC or business return)", "50,000+ monthly listeners", "Broker-dealer pre-screening call (FanZuP coordinates)"],
    minMonthlyListeners: 50_000,
    minHistoryMonths: 24,
  },
];

export const tier = (name: TierName) => TIERS.find((t) => t.name === name)!;
export const nextTier = (name: TierName) => TIERS.find((t) => t.ordinal === tier(name).ordinal + 1);

/** Tier requirements are assessed at campaign-creation time, not mid-campaign (PRD 01 §6.3). */
export const TIER_ASSESSMENT_NOTE = "Tier requirements are checked when you create a campaign, not during one.";
