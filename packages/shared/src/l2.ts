/**
 * Layer 2 rules shared by web, API and tests (CR-002; specs/l2/02-design.md §4, §7, §8).
 * The database enforces the same rules; sync tests keep the two equal. Amounts are integer cents.
 */
import { POLICY } from "./policy";

// ── Vocabulary ─────────────────────────────────────────────────────────
export const REVENUE_TYPES = ["master", "sync", "publishing"] as const;
export type RevenueType = (typeof REVENUE_TYPES)[number];

export const COLLECTION_MECHANISMS = ["DISTRIBUTOR_REDIRECT", "SPLIT_PAYEE", "LOCKBOX", "LETTER_OF_DIRECTION", "SELF_REPORT"] as const;
export type CollectionMechanism = (typeof COLLECTION_MECHANISMS)[number];

export const RISK_BADGES = ["SECURED_ISH", "VERIFIED", "TRUST_BASED"] as const;
export type RiskBadge = (typeof RISK_BADGES)[number];

export const POOL_STATUSES = [
  "draft", "in_review", "revisions_requested", "approved", "live", "funded", "failed", "refunded", "matured", "withdrawn",
] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

export const INVESTMENT_STATUSES = ["reserved", "funding", "funded", "issued", "expired", "cancelled", "returned", "refund_pending", "refunded"] as const;
export type InvestmentStatus = (typeof INVESTMENT_STATUSES)[number];

export const KYC_STATUSES = ["not_started", "pending", "approved", "rejected", "manual_review"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const COLLECTION_STATES = ["COLLECTING", "AT_RISK", "DEFAULT", "REMEDIATION", "CHARGED_OFF"] as const;
export type CollectionState = (typeof COLLECTION_STATES)[number];

// ── Collection mechanism → risk badge (Mechanism 01 revenue-type table; 01b §1.1) ──
export const MECHANISM_STRENGTH: Record<CollectionMechanism, 1 | 2 | 3> = {
  DISTRIBUTOR_REDIRECT: 3,
  SPLIT_PAYEE: 3,
  LOCKBOX: 2,
  LETTER_OF_DIRECTION: 2,
  SELF_REPORT: 1,
};
/** The strongest collection tier each revenue type can reach. Publishing is trust-based pending counsel (L2-Q5). */
export const REVENUE_TYPE_CEILING: Record<RevenueType, 1 | 2 | 3> = { master: 3, sync: 2, publishing: 1 };

export function riskBadge(mechanism: CollectionMechanism, revenueTypes: readonly RevenueType[]): RiskBadge {
  const types = revenueTypes.length ? revenueTypes : (["master"] as const);
  const tier = Math.min(...types.map((t) => Math.min(MECHANISM_STRENGTH[mechanism], REVENUE_TYPE_CEILING[t])));
  return tier >= 3 ? "SECURED_ISH" : tier === 2 ? "VERIFIED" : "TRUST_BASED";
}

/** Plain-language labels. The strongest badge never says "secured": the claim itself is always unsecured. */
export const RISK_BADGE_COPY: Record<RiskBadge, { label: string; short: string }> = {
  SECURED_ISH: { label: "More secure collection", short: "Royalties are paid to the Pool's collection account by the distributor before the artist is paid. Your claim is still unsecured." },
  VERIFIED: { label: "Verified collection", short: "Royalties land in a controlled account and are checked against statements. Revenue paid outside that account isn't captured." },
  TRUST_BASED: { label: "Trust-based collection", short: "Depends on the artist reporting revenue and paying the Pool's share. Publishing collection is pending counsel." },
};

export const REVENUE_TYPE_COPY: Record<RevenueType, { label: string; note?: string }> = {
  master: { label: "Master recording royalties", note: "Streaming and downloads, paid by the distributor" },
  sync: { label: "Sync licensing" },
  publishing: { label: "Publishing / PRO", note: "Trust-based — pending counsel" },
};

// ── Reg CF investor limit (17 CFR 227.100(a)(2); POLICY.regCf) ─────────
export interface InvestorFinancials {
  annualIncomeMinor: number;
  netWorthMinor: number;
  accredited: boolean;
}

/** The investor's 12-month Reg CF limit in cents, or null when unlimited (accredited). */
export function regCfLimitMinor(f: InvestorFinancials): number | null {
  if (f.accredited) return null;
  const { floorMinor, thresholdMinor, lowBps, highBps } = POLICY.regCf;
  const greater = Math.max(f.annualIncomeMinor, f.netWorthMinor, 0);
  if (f.annualIncomeMinor < thresholdMinor || f.netWorthMinor < thresholdMinor) {
    return Math.max(floorMinor, Math.floor((greater * lowBps) / 10_000));
  }
  return Math.min(thresholdMinor, Math.floor((greater * highBps) / 10_000));
}

// ── Waterfall (01a §4; design §7) ──────────────────────────────────────
export interface WaterfallHolding {
  investmentId: string;
  units: number;
  /** Cap remaining for this investment: amount × cap multiple − already distributed. */
  capRemainingMinor: number;
}
export interface WaterfallInput {
  /** Collected, unallocated revenue being distributed in this run. */
  collectedMinor: number;
  fansBps: number;
  creatorBps: number;
  platformBps: number;
  holdings: WaterfallHolding[];
}
export interface WaterfallResult {
  fanPoolMinor: number;
  payouts: { investmentId: string; amountMinor: number; capped: boolean }[];
  creatorMinor: number;
  platformMinor: number;
  /** Part of the fan share that couldn't be paid because every holder reached the cap; goes to the creator. */
  capOverflowMinor: number;
  allCapped: boolean;
}

const byId = (a: { investmentId: string }, b: { investmentId: string }) => (a.investmentId < b.investmentId ? -1 : a.investmentId > b.investmentId ? 1 : 0);

/**
 * Split `amount` across holders pro-rata by Units using the largest-remainder method.
 * Deterministic: remainders are broken by investment id ascending. Σ result == amount.
 */
export function largestRemainder(amount: number, holders: { investmentId: string; units: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const total = holders.reduce((s, h) => s + h.units, 0);
  if (amount <= 0 || total <= 0) {
    for (const h of holders) out.set(h.investmentId, 0);
    return out;
  }
  const big = BigInt(amount);
  const parts = [...holders].sort(byId).map((h) => {
    const num = big * BigInt(h.units);
    return { id: h.investmentId, base: Number(num / BigInt(total)), rem: num % BigInt(total) };
  });
  let left = amount - parts.reduce((s, p) => s + p.base, 0);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? (a.id < b.id ? -1 : 1) : a.rem > b.rem ? -1 : 1));
  for (const p of order) {
    out.set(p.id, p.base + (left > 0 ? 1 : 0));
    if (left > 0) left--;
  }
  return out;
}

export function allocateWaterfall(input: WaterfallInput): WaterfallResult {
  const { collectedMinor: C, fansBps, creatorBps, platformBps } = input;
  if (!Number.isSafeInteger(C) || C < 0) throw new Error("collectedMinor must be a non-negative integer");
  if (fansBps + creatorBps + platformBps !== 10_000) throw new Error("split must sum to 10000 bps");
  const fanPool = Math.floor((C * fansBps) / 10_000);
  const platform = Math.floor((C * platformBps) / 10_000);
  const holdings = [...input.holdings].sort(byId).filter((h) => h.units > 0);

  const paid = new Map<string, number>(holdings.map((h) => [h.investmentId, 0]));
  const remainingCap = new Map(holdings.map((h) => [h.investmentId, Math.max(0, h.capRemainingMinor)]));
  let toAllocate = fanPool;
  // Iterate: split what's left among holders with cap room; clip at the cap; repeat with the excess.
  for (let guard = 0; toAllocate > 0 && guard <= holdings.length; guard++) {
    const open = holdings.filter((h) => (remainingCap.get(h.investmentId) ?? 0) > 0);
    if (!open.length) break;
    const split = largestRemainder(toAllocate, open);
    let excess = 0;
    for (const h of open) {
      const want = split.get(h.investmentId) ?? 0;
      const room = remainingCap.get(h.investmentId)!;
      const give = Math.min(want, room);
      paid.set(h.investmentId, paid.get(h.investmentId)! + give);
      remainingCap.set(h.investmentId, room - give);
      excess += want - give;
    }
    toAllocate = excess;
  }
  const capOverflow = toAllocate;
  const payouts = holdings
    .map((h) => ({ investmentId: h.investmentId, amountMinor: paid.get(h.investmentId)!, capped: remainingCap.get(h.investmentId) === 0 }))
    .filter((p) => p.amountMinor > 0);
  const paidTotal = payouts.reduce((s, p) => s + p.amountMinor, 0);
  const creator = C - paidTotal - platform; // includes the creator split, rounding residue and cap overflow
  return {
    fanPoolMinor: fanPool,
    payouts,
    creatorMinor: creator,
    platformMinor: platform,
    capOverflowMinor: capOverflow,
    allCapped: holdings.length > 0 && holdings.every((h) => remainingCap.get(h.investmentId) === 0),
  };
}

/** Canonical JSON (sorted keys, no whitespace) — the input to the run hash (design §7). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** Cap for one investment, in cents. */
export const capMinor = (amountMinor: number, capBps: number) => Math.floor((amountMinor * capBps) / 10_000);

/** Potential-payout illustration (always includes zero): what the fan share would pay per Unit for a given yearly royalty level. */
export function illustratePerUnit(opts: { yearlyCoveredRoyaltiesMinor: number; fansBps: number; unitsTotal: number; unitPriceMinor: number; capBps: number; years: number }) {
  const perYear = Math.floor((opts.yearlyCoveredRoyaltiesMinor * opts.fansBps) / 10_000 / Math.max(1, opts.unitsTotal));
  const cap = capMinor(opts.unitPriceMinor, opts.capBps);
  return { perYearMinor: perYear, totalMinor: Math.min(cap, perYear * opts.years), capMinor: cap };
}

export const L2_POLICY = POLICY.l2;
