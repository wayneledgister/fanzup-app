/**
 * Page-local demo data + helpers for the Layer 2 (Reg CF) investing area.
 * Everything here is fictional prototype data layered on top of `@/lib/mock`.
 * Amounts are integers in cents.
 */
import { artistById, holdings, poolById, pools, type Holding, type Pool } from "@/lib/mock";

/** "Today" for the prototype, so dates and countdowns stay stable in review screenshots. */
export const TODAY = new Date("2026-10-02T12:00:00");

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function addHours(iso: string, hours: number): Date {
  const d = new Date(`${iso}T23:59:00`);
  d.setHours(d.getHours() + hours);
  return d;
}

export function daysLeft(iso: string) {
  return Math.ceil((new Date(`${iso}T23:59:00`).getTime() - TODAY.getTime()) / 86_400_000);
}

/**
 * The demo fan's investment limit, as set by their investor certification and confirmed by the
 * funding-portal partner. This is the fan's own (fictional) data — not a regulatory threshold.
 */
export const DEMO_INVESTOR = {
  name: "Jordan Pierce",
  annualLimitMinor: 500_000,
  /** Reg CF investments the fan reported making on other platforms in the last 12 months. */
  usedElsewhereMinor: 0,
  certifiedOn: "2026-02-20",
  kycStatus: "verified" as const,
  paymentMethod: "Bank account (ACH) ending 6789",
};

/** Reg CF limit usage across the trailing 12 months. */
export function regCfUsage(extraMinor = 0) {
  const windowStart = new Date(TODAY);
  windowStart.setFullYear(windowStart.getFullYear() - 1);
  const onFanZuP = holdings.filter((h) => new Date(h.purchasedOn) >= windowStart).reduce((s, h) => s + h.investedMinor, 0);
  const used = onFanZuP + DEMO_INVESTOR.usedElsewhereMinor;
  const remaining = Math.max(0, DEMO_INVESTOR.annualLimitMinor - used - extraMinor);
  return { limit: DEMO_INVESTOR.annualLimitMinor, onFanZuP, elsewhere: DEMO_INVESTOR.usedElsewhereMinor, used, remaining };
}

export type Collection = Pool["collection"];

/** Honest labels for how a Pool's share of revenue gets collected (PRD 02 §8). */
export const COLLECTION_INFO: Record<Collection, { label: string; tone: "success" | "info" | "warning"; short: string; long: string }> = {
  "Distributor redirect": {
    label: "Distributor redirect",
    tone: "success",
    short: "More secure — the distributor pays the Pool's share directly.",
    long: "The artist's distributor sends the Pool's share of revenue straight to the Pool's collection account before the artist is paid. Payouts don't depend on the artist sending money on, which makes this the most secure collection method we support.",
  },
  Lockbox: {
    label: "Lockbox account",
    tone: "info",
    short: "Revenue lands in a controlled account before the artist is paid.",
    long: "Covered revenue is paid into a controlled account. The Pool's share is taken out before the remainder goes to the artist. Revenue paid to the artist outside that account isn't captured.",
  },
  "Self-reported + verified": {
    label: "Self-reported + verified",
    tone: "warning",
    short: "Depends on the artist reporting revenue and paying the Pool's share.",
    long: "The artist reports covered revenue each period and pays the Pool's share. We check reports against distributor and platform statements, but payouts depend on the artist reporting accurately and paying on time.",
  },
};

export function poolWithArtist(p: Pool) {
  return { pool: p, artist: artistById(p.artistId) };
}

export interface HoldingView {
  holding: Holding;
  pool: Pool;
  artistName: string;
  capMinor: number;
  capProgress: number;
  maturesOn: string;
}

export function holdingViews(): HoldingView[] {
  return holdings.flatMap((h) => {
    const pool = poolById(h.poolId);
    if (!pool) return [];
    const capMinor = Math.round(h.investedMinor * pool.returnCapMultiple);
    return [
      {
        holding: h,
        pool,
        artistName: artistById(pool.artistId).name,
        capMinor,
        capProgress: capMinor ? h.distributionsMinor / capMinor : 0,
        maturesOn: addMonths(h.purchasedOn, pool.maturityYears * 12),
      },
    ];
  });
}

/** Per-holding distribution history. Totals match `holdings[].distributionsMinor`; your share = collected × rev-share % × your Units / Units outstanding. */
export const UNITS_OUTSTANDING: Record<string, number> = { "kai-marlo-catalog": 912, "velvet-circuit-tour": 270 };
export const DISTRIBUTIONS: Record<string, { period: string; paidOn: string; collectedMinor: number; yourShareMinor: number; note?: string }[]> = {
  "kai-marlo-catalog": [
    { period: "Q3 2026", paidOn: "2026-09-30", collectedMinor: 1_568_640, yourShareMinor: 1_720 },
    { period: "Q2 2026", paidOn: "2026-06-30", collectedMinor: 1_295_040, yourShareMinor: 1_420 },
  ],
  "velvet-circuit-tour": [],
};

export const ARTIST_UPDATES: Record<string, { date: string; title: string; body: string }[]> = {
  "kai-marlo-catalog": [
    { date: "2026-09-12", title: "Album one is mixed", body: "Mixing wrapped this week. Mastering is booked for October and the release plan is with the distributor." },
    { date: "2026-07-03", title: "Q2 revenue statement posted", body: "Q2 statements from the distributor are in your documents. The Pool's share was paid on June 30." },
  ],
  "velvet-circuit-tour": [{ date: "2026-09-20", title: "Routing the 2027 dates", body: "We're holding 14 cities across the Midwest and East Coast. Venue contracts go out after the offering closes." }],
};

/** Pools structured through an SPV that passes voting rights through to holders (Mechanism 03). */
export const SPV_POOLS: Record<string, string> = {
  "kai-marlo-catalog": "Kai Marlo Catalog Pool SPV",
};

export const visiblePools = () => [...pools].sort((a, b) => a.endsOn.localeCompare(b.endsOn));

/** Date-only ISO strings parse as UTC midnight; anchor to local noon so the day never shifts. */
export const day = (iso: string) => (iso.length === 10 ? `${iso}T12:00:00` : iso);
