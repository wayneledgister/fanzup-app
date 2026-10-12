/**
 * Pure Layer 2 copy helpers (no React), unit-tested in test/l2copy.test.ts (PR #13 review round 2, findings 4 and 5).
 */
import type { InvestmentStatus, PoolStatus } from "@fanzup/shared/l2";

/** Closed-offering copy per status: never claims a refund that hasn't finished, or money that was never taken. */
export function closedCopy(status: PoolStatus): string {
  switch (status) {
    case "funded":
    case "matured":
      return "Units were issued to investors when it closed. There's no marketplace to buy or sell them.";
    case "failed":
      return "It didn't reach its target. Refunds are on their way to every investor, in full.";
    case "refunded":
      return "It didn't reach its target, so every investor was refunded in full.";
    case "withdrawn":
      return "The artist withdrew it before it closed. No investor money was taken.";
    default:
      return "It isn't taking investments.";
  }
}

/** The illustration's horizon in (possibly fractional) years: maturity months / 12, never rounded. */
export const illustrationYears = (maturityMonths: number) => Math.max(0, maturityMonths) / 12;

/** "3 years", "1 year", or "18 months" when the maturity isn't a whole number of years. */
export function illustrationPeriod(maturityMonths: number): string {
  if (maturityMonths > 0 && maturityMonths % 12 === 0) {
    const y = maturityMonths / 12;
    return `${y} year${y === 1 ? "" : "s"}`;
  }
  return `${maturityMonths} month${maturityMonths === 1 ? "" : "s"}`;
}

type CancelFields = { status: InvestmentStatus; poolStatus: PoolStatus; canCancelUntil?: string | null; cancelBy?: string | null; cancelRequestedAt?: string | null };

/** True once the cancel-by instant has passed. */
export function pastCancelBy(i: { cancelBy?: string | null }, now = Date.now()) {
  return !!i.cancelBy && new Date(i.cancelBy).getTime() <= now;
}

/**
 * Which cancel line an investment shows (PR #13 review round 2, finding 3): `open` (the cancel control, until the
 * cut-off), `closed` ("Can't be cancelled", decided by the cut-off alone), or `none`. Never both.
 */
export function cancelState(i: CancelFields, now = Date.now()): "open" | "closed" | "none" {
  if (i.cancelRequestedAt || i.poolStatus !== "live" || !["reserved", "funding", "funded"].includes(i.status)) return "none";
  if (pastCancelBy(i, now)) return "closed";
  return i.canCancelUntil && !pastCancelBy({ cancelBy: i.canCancelUntil }, now) ? "open" : "none";
}
