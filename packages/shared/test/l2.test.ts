import { describe, expect, it } from "vitest";
import { allocateWaterfall, canonicalJson, largestRemainder, regCfLimitMinor, riskBadge, type WaterfallInput } from "../src/l2";
import { POLICY } from "../src/policy";
import { PoolDraftRequest, PoolLaunchRequest, PoolSubmitRequest } from "../src/l2schemas";

describe("Reg CF investor limit (17 CFR 227.100(a)(2), verified 2026-10-03)", () => {
  const L = (income: number, nw: number, accredited = false) => regCfLimitMinor({ annualIncomeMinor: income * 100, netWorthMinor: nw * 100, accredited });
  it("uses the verified figures", () => {
    expect(POLICY.regCf).toMatchObject({ floorMinor: 250_000, thresholdMinor: 12_400_000, lowBps: 500, highBps: 1000 });
  });
  it("floor of $2,500 when 5% is smaller", () => expect(L(30_000, 20_000)).toBe(250_000));
  it("5% of the greater figure when either is below $124k", () => expect(L(80_000, 150_000)).toBe(750_000));
  it("10% of the greater when both are at or above $124k", () => expect(L(200_000, 150_000)).toBe(2_000_000));
  it("10% branch is capped at $124k", () => expect(L(2_000_000, 5_000_000)).toBe(12_400_000));
  it("exactly at the threshold uses the 10% branch", () => expect(L(124_000, 124_000)).toBe(1_240_000));
  it("accredited investors have no limit", () => expect(L(10, 10, true)).toBeNull());
});

describe("risk badge (Mechanism 01; design §8)", () => {
  it("distributor redirect on masters is the strongest", () => expect(riskBadge("DISTRIBUTOR_REDIRECT", ["master"])).toBe("SECURED_ISH"));
  it("is capped by the weakest revenue type", () => {
    expect(riskBadge("SPLIT_PAYEE", ["master", "sync"])).toBe("VERIFIED");
    expect(riskBadge("DISTRIBUTOR_REDIRECT", ["master", "publishing"])).toBe("TRUST_BASED");
  });
  it("lockbox is verified; self-report is trust-based", () => {
    expect(riskBadge("LOCKBOX", ["master"])).toBe("VERIFIED");
    expect(riskBadge("SELF_REPORT", ["master"])).toBe("TRUST_BASED");
  });
});

const holdings = (spec: [string, number, number][]) => spec.map(([investmentId, units, capRemainingMinor]) => ({ investmentId, units, capRemainingMinor }));
const sum = (r: ReturnType<typeof allocateWaterfall>) => r.payouts.reduce((s, p) => s + p.amountMinor, 0) + r.creatorMinor + r.platformMinor;

describe("Waterfall (01a §4)", () => {
  const base: WaterfallInput = { collectedMinor: 1_000_001, fansBps: 3000, creatorBps: 6500, platformBps: 500, holdings: holdings([["a", 3, 1e9], ["b", 3, 1e9], ["c", 1, 1e9]]) };

  it("AC-W4 conserves every cent, with odd amounts", () => {
    for (const C of [0, 1, 7, 99, 1_000_001, 123_456_789]) {
      const r = allocateWaterfall({ ...base, collectedMinor: C });
      expect(sum(r)).toBe(C);
      expect(r.payouts.reduce((s, p) => s + p.amountMinor, 0)).toBeLessThanOrEqual(r.fanPoolMinor);
    }
  });

  it("AC-W1 is deterministic regardless of input order", () => {
    const a = allocateWaterfall(base);
    const b = allocateWaterfall({ ...base, holdings: [...base.holdings].reverse() });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("splits pro-rata by Units with largest remainder, ties by id", () => {
    // fan pool = 300000 (of 1,000,001 → floor 300000.3); 3:3:1 → 128571.43 / 128571.43 / 42857.14
    const r = allocateWaterfall(base);
    expect(r.fanPoolMinor).toBe(300_000);
    expect(r.payouts).toEqual([
      { investmentId: "a", amountMinor: 128_572, capped: false },
      { investmentId: "b", amountMinor: 128_571, capped: false },
      { investmentId: "c", amountMinor: 42_857, capped: false },
    ]);
    expect(largestRemainder(10, [{ investmentId: "x", units: 1 }, { investmentId: "y", units: 1 }, { investmentId: "z", units: 1 }])).toEqual(
      new Map([["x", 4], ["y", 3], ["z", 3]]),
    );
  });

  it("AC-W2 never pays past the cap; excess goes to holders with room, then to the creator", () => {
    const r = allocateWaterfall({ ...base, holdings: holdings([["a", 3, 50_000], ["b", 3, 1e9], ["c", 1, 1e9]]) });
    const a = r.payouts.find((p) => p.investmentId === "a")!;
    expect(a).toEqual({ investmentId: "a", amountMinor: 50_000, capped: true });
    expect(r.payouts.reduce((s, p) => s + p.amountMinor, 0)).toBe(300_000);
    expect(sum(r)).toBe(base.collectedMinor);

    const all = allocateWaterfall({ ...base, holdings: holdings([["a", 3, 100], ["b", 3, 100], ["c", 1, 0]]) });
    expect(all.allCapped).toBe(true);
    expect(all.payouts.map((p) => p.amountMinor)).toEqual([100, 100]);
    expect(all.capOverflowMinor).toBe(300_000 - 200);
    expect(sum(all)).toBe(base.collectedMinor);
  });

  it("rejects a split that doesn't sum to 100%", () => {
    expect(() => allocateWaterfall({ ...base, creatorBps: 6000 })).toThrow();
  });

  it("canonical JSON sorts keys", () => expect(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }] })).toBe('{"a":[{"c":1,"d":2}],"b":1}'));
});

describe("21-day minimum offering (227.303(e)(3)(i); L2-T-020)", () => {
  const draft = {
    slug: "test-pool", title: "Album", tracklist: ["One"], useOfFunds: [{ label: "Mixing", amountMinor: 100_000 }], revenueTypes: ["master"],
    fansBps: 3000, unitsTotal: 100, unitPriceMinor: 5_000, collectionMechanism: "DISTRIBUTOR_REDIRECT",
    tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 50 }],
  } as const;
  it("policy minimum is 21 days and the deadline bounds follow it", () => {
    expect(POLICY.regCf.minOfferingDays).toBe(21);
    expect(POLICY.l2.deadlineDays.min).toBe(POLICY.regCf.minOfferingDays);
  });
  it("the draft schema rejects 20 days and accepts 21", () => {
    expect(PoolDraftRequest.safeParse({ ...draft, durationDays: 20 }).success).toBe(false);
    expect(PoolDraftRequest.safeParse({ ...draft, durationDays: 21 }).success).toBe(true);
  });
  it("submit and launch bodies carry the issuer attestation (L2-Q12)", () => {
    expect(PoolSubmitRequest.safeParse({}).success).toBe(false);
    expect(PoolSubmitRequest.safeParse({ otherRegCfSales12mMinor: 0 }).success).toBe(true);
    expect(PoolLaunchRequest.safeParse({ otherRegCfSales12mMinor: -1 }).success).toBe(false);
  });
});

describe("Waterfall fans equality (L2-T-024): fan cents leave the fan class only when every holder is capped", () => {
  it("not all capped → payouts sum to exactly the fan pool", () => {
    for (const caps of [[50_000, 1e9, 1e9], [1, 2, 1e9], [0, 1e9, 3]]) {
      const r = allocateWaterfall({ collectedMinor: 1_000_003, fansBps: 3000, creatorBps: 6500, platformBps: 500,
        holdings: holdings([["a", 3, caps[0]], ["b", 3, caps[1]], ["c", 1, caps[2]]]) });
      expect(r.allCapped).toBe(false);
      expect(r.payouts.reduce((s, p) => s + p.amountMinor, 0)).toBe(r.fanPoolMinor);
    }
  });
});
