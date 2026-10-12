/** PR #13 review round 2: exact investor money (finding 1), cancel state at the cut-off (3), illustration period (4), closed copy (5). */
import { describe, expect, it } from "vitest";
import { illustratePerUnit } from "@fanzup/shared/l2";
import { formatUsd } from "@/lib/format";
import { cancelState, closedCopy, illustrationPeriod, illustrationYears, pastCancelBy } from "@/components/invest/l2copy";

describe("formatUsd — exact cents for investor money", () => {
  it("shows cents whenever they aren't zero and never rounds", () => {
    expect(formatUsd(3750)).toBe("$37.50");
    expect(formatUsd(250)).toBe("$2.50");
    expect(formatUsd(100000)).toBe("$1,000");
    expect(formatUsd(1)).toBe("$0.01");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(99)).toBe("$0.99");
    expect(formatUsd(123456789)).toBe("$1,234,567.89");
  });
});

describe("cancelState — the cut-off alone decides", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const base = { status: "funded" as const, poolStatus: "live" as const, cancelRequestedAt: null };
  it("open before the cut-off", () => {
    const at = "2026-10-12T12:00:00Z";
    expect(cancelState({ ...base, canCancelUntil: at, cancelBy: at }, now)).toBe("open");
  });
  it("closed after the cut-off, even if a stale read still carries canCancelUntil — never both lines", () => {
    const past = "2026-10-11T11:00:00Z";
    expect(cancelState({ ...base, canCancelUntil: past, cancelBy: past }, now)).toBe("closed");
    expect(cancelState({ ...base, canCancelUntil: null, cancelBy: past }, now)).toBe("closed");
    expect(pastCancelBy({ cancelBy: past }, now)).toBe(true);
  });
  it("none once a cancellation is pending, or for settled / closed investments", () => {
    const at = "2026-10-12T12:00:00Z";
    expect(cancelState({ ...base, status: "funding", canCancelUntil: null, cancelBy: at, cancelRequestedAt: at }, now)).toBe("none");
    expect(cancelState({ ...base, status: "issued", canCancelUntil: null, cancelBy: at }, now)).toBe("none");
    expect(cancelState({ ...base, poolStatus: "failed", canCancelUntil: null, cancelBy: at }, now)).toBe("none");
  });
});

describe("payout illustration period", () => {
  it("uses fractional years and prints months when the years aren't whole", () => {
    expect(illustrationYears(18)).toBe(1.5);
    expect(illustrationPeriod(18)).toBe("18 months");
    expect(illustrationPeriod(6)).toBe("6 months");
    expect(illustrationPeriod(12)).toBe("1 year");
    expect(illustrationPeriod(36)).toBe("3 years");
  });
  it("an 18-month Pool illustrates 1.5 years of payouts, in whole cents", () => {
    const r = illustratePerUnit({ yearlyCoveredRoyaltiesMinor: 5_000_00, fansBps: 3000, unitsTotal: 7, unitPriceMinor: 50_00, capBps: 15_000, years: illustrationYears(18) });
    expect(r.perYearMinor).toBe(21428);
    expect(r.totalMinor).toBe(Math.min(r.capMinor, Math.floor(21428 * 1.5)));
    expect(Number.isInteger(r.totalMinor)).toBe(true);
  });
});

describe("closed offering copy is status-specific", () => {
  it("failed: refunds on their way; refunded: refunded in full; withdrawn: no money taken", () => {
    expect(closedCopy("failed")).toContain("Refunds are on their way");
    expect(closedCopy("failed")).not.toContain("refunded in full");
    expect(closedCopy("refunded")).toContain("every investor was refunded in full");
    expect(closedCopy("withdrawn")).toContain("No investor money was taken");
    expect(closedCopy("funded")).toContain("Units were issued");
  });
});
