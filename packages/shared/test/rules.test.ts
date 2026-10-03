import { describe, expect, it } from "vitest";
import { canTransition, settleOutcome } from "../src/campaign";
import { processingFeeMinor, POLICY } from "../src/policy";
import { TIERS, tier, nextTier } from "../src/tiers";

describe("campaign rules", () => {
  it("is target-or-refund: funded only at or above goal", () => {
    expect(settleOutcome(49_999, 50_000)).toBe("failed");
    expect(settleOutcome(50_000, 50_000)).toBe("funded");
  });
  it("money states are one-way", () => {
    expect(canTransition("live", "funded")).toBe(true);
    expect(canTransition("funded", "live")).toBe(false);
    expect(canTransition("refunded", "released")).toBe(false);
  });
});

describe("fees and policy", () => {
  it("card processing is 2.9% + 30¢, in whole cents", () => {
    expect(processingFeeMinor(10_000)).toBe(320);
    expect(Number.isInteger(processingFeeMinor(3333))).toBe(true);
  });
  it("artist pays processing (fees.html, council D1)", () => expect(POLICY.processing.payer).toBe("artist"));
  it("default milestone split adds to 100", () => expect(POLICY.campaign.defaultTranchesPct.reduce((a, b) => a + b, 0)).toBe(100));
});

describe("tiers (PRD 01 §6.3)", () => {
  it("are ordered with rising caps", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["Starter", "Rising", "Established", "Pro"]);
    expect(tier("Pro").regCfCapMinor).toBe(500_000_000);
    expect(nextTier("Rising")?.name).toBe("Established");
  });
});

describe("Appendix A policy defaults (accepted 2026-10-03)", () => {
  it("has every key M1 uses, with the accepted values", () => {
    expect(POLICY.checkout).toEqual({ holdMinutes: 15, maxUnconfirmedPerUser: 3 });
    expect(POLICY.refunds.autoInitiateMinutes).toBe(60);
    expect(POLICY.refunds.secondApprovalAboveMinor).toBe(50_000);
    expect(POLICY.approvals.secondVerifierAboveMinor).toBe(500_000);
    expect(POLICY.singleOperator).toEqual({ delayAboveMinor: 100_000, delayHours: 24, dailyLimits: { refundsMinor: 500_000, verifications: 3 } });
    expect(POLICY.outbound.maxAttempts).toBe(8);
    expect(POLICY.recon).toEqual({ materialityMinor: 100, maxBreakAgeBusinessDays: 1 });
    expect(POLICY.staff.idleTimeoutMinutes).toBe(15);
  });
});
