import { describe, expect, it } from "vitest";
import { BANNED } from "../src/copy-rules";
import { lastCompletedWeek, reviewChecks, weekStartUtc, weeklyPack, type ReviewCampaign } from "../src/agents";
import { POLICY } from "../src/policy";
// @ts-expect-error — plain .mjs used by `pnpm lint:copy`; no types.
import { BANNED as WEB_BANNED } from "../../../apps/web/scripts/copy-rules.mjs";

const NOW = new Date("2026-11-26T12:00:00Z");
const base: ReviewCampaign = {
  title: "Night Bus Tour", blurb: "Five cities in a van", story: "We are touring.", risks: "Weather.",
  goal_minor: 500_000, duration_days: 30, milestone_release: true, cap_minor_at_submission: 1_000_000,
};
const perk = { id: "p1", title: "Digital album", description: null, kind: "digital" as const, price_minor: 1500, fulfill_by: "2027-03-01" };
const tranches = [
  { seq: 1, pct: 50, milestone: null, evidence_required: null, target_date: null },
  { seq: 2, pct: 50, milestone: "Tour starts", evidence_required: "Venue contracts", target_date: "2027-02-01" },
];

describe("copy rules sync (FR-AGT-A1-002)", () => {
  it("shared BANNED equals the web lint:copy list", () => {
    const norm = (l: ReadonlyArray<readonly [RegExp, string]>) => l.map(([re, label]) => [re.source, re.flags, label]);
    expect(norm(BANNED)).toEqual(norm(WEB_BANNED));
  });
});

describe("reviewChecks (FR-AGT-A1-002)", () => {
  it("a clean campaign has only info findings", () => {
    const f = reviewChecks(base, [perk], tranches, NOW);
    expect(f.filter((x) => x.severity !== "info")).toEqual([]);
    expect(f.map((x) => x.code)).toContain("backers_needed");
  });
  it("flags banned, investment, urgency and escrow wording with quotes", () => {
    const c = { ...base, story: "Invest in us and earn returns! Only 3 left, hurry. Funds held in escrow. Guaranteed returns." };
    const codes = reviewChecks(c, [perk], tranches, NOW).map((x) => x.code);
    for (const code of ["banned_language", "investment_language", "urgency_claim", "escrow_wording"]) expect(codes).toContain(code);
    const inv = reviewChecks(c, [perk], tranches, NOW).find((x) => x.code === "investment_language")!;
    expect(inv.field).toBe("story");
    expect(inv.quote).toContain("Invest");
  });
  it("does not treat a returns policy as investment language", () => {
    const c = { ...base, risks: "See our returns policy for merch." };
    expect(reviewChecks(c, [perk], tranches, NOW).map((x) => x.code)).not.toContain("investment_language");
  });
  it("goal headroom, physical perks, early delivery and tranche problems", () => {
    const c = { ...base, goal_minor: 900_000 };
    const perks = [{ ...perk, id: "p2", kind: "physical" as const, title: "Vinyl", fulfill_by: "2026-12-01" }];
    const bad = [tranches[0], { ...tranches[1], evidence_required: " ", target_date: "2026-12-10" }, { seq: 3, pct: 0, milestone: "x", evidence_required: "y", target_date: "2027-01-01" }];
    const codes = reviewChecks(c, perks, bad, NOW).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["goal_headroom", "physical_perk", "perk_fulfill_date", "tranche_evidence_missing", "tranche_date"]));
  });
});

describe("weekly pack (FR-AGT-A8-001)", () => {
  it("weeks are Monday-based in UTC", () => {
    expect(weekStartUtc(new Date("2026-11-26T12:00:00Z"))).toBe("2026-11-23");
    expect(weekStartUtc(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23");
    expect(lastCompletedWeek(new Date("2026-11-26T12:00:00Z"))).toBe("2026-11-16");
  });
  it("totals refunds and verifications per day against the single-operator limits", () => {
    const L = POLICY.singleOperator.dailyLimits;
    const mk = (id: string, action: string, status: string, amount: number | null, at: string) => ({ id, action, status, amount_minor: amount, created_at: at, execute_after: at, has_error: false });
    const pack = weeklyPack("2026-11-16", [
      mk("a", "backing.refund", "executed", L.refundsMinor, "2026-11-17T10:00:00Z"),
      mk("b", "backing.refund", "executed", 100, "2026-11-17T11:00:00Z"),
      mk("c", "backing.refund", "cancelled", 999_999, "2026-11-17T12:00:00Z"),
      mk("d", "tranche.verify", "executed", null, "2026-11-18T09:00:00Z"),
      { ...mk("e", "backing.refund", "scheduled", 50, "2026-11-19T09:00:00Z"), execute_after: "2026-11-20T09:00:00Z" },
    ], false);
    expect(pack.totalActions).toBe(5);
    expect(pack.refundsByDay[0]).toEqual({ day: "2026-11-17", totalMinor: L.refundsMinor + 100, limitMinor: L.refundsMinor, overLimit: true });
    expect(pack.verificationsByDay).toEqual([{ day: "2026-11-18", count: 1, limit: L.verifications, overLimit: false }]);
    expect(pack.cancelled).toEqual(["c"]);
    expect(pack.delayed).toEqual(["e"]);
    expect(pack.signedOff).toBe(false);
  });
});
