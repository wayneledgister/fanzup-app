import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api-client";
import {
  acceptanceDocuments, categorize, deadReason, DECLINED, EXPIRED, failureTitle, formatHold, holdAnnouncement, holdSecondsLeft, REFUNDING, UNCONFIRMED, waitForCapture,
} from "../src/checkout-flow";
import { acceptingBackers, campaignStatusLabel, MONEY_STATE_COPY, perkStock } from "../src/backing-copy";
import { MoneyState } from "../src/schemas";

describe("categorize (design §4.3; shared by web and mobile)", () => {
  it("create-step API errors say nothing was charged", () => {
    expect(categorize(new ApiError(502, "provider_unavailable", "x")).category).toBe("network");
    expect(categorize(new ApiError(0, "network", "x")).next).toMatch(/nothing was charged/);
    expect(categorize(new ApiError(409, "perk_sold_out", "That perk just sold out."))).toMatchObject({ category: "closed", message: "That perk just sold out." });
    expect(categorize(new ApiError(403, "acceptance_required", "Accept the terms."))).toMatchObject({ category: "other", next: "Nothing was charged." });
  });
  it("checkout_expired is 'expired' at either stage", () => {
    expect(categorize(new ApiError(409, "checkout_expired", "x"), "pay").category).toBe("expired");
  });
  it("pay-step errors we can't classify are 'unconfirmed' and never claim nothing was charged", () => {
    expect(categorize(new ApiError(500, "error", "x"), "pay")).toEqual(UNCONFIRMED);
    expect(categorize(new Error("boom"), "pay")).toEqual(UNCONFIRMED);
    expect(UNCONFIRMED.next).not.toMatch(/nothing was charged/i);
  });
  it("Stripe.js and Stripe React Native card errors", () => {
    expect(categorize({ type: "card_error", code: "card_declined" }, "pay")).toEqual(DECLINED);
    expect(categorize({ code: "Failed", declineCode: "insufficient_funds" }, "pay")).toEqual(DECLINED);
    expect(categorize({ code: "Failed", stripeErrorCode: "expired_card" }, "pay").category).toBe("expired");
    expect(categorize({ code: "payment_intent_authentication_failure" }, "pay").category).toBe("authentication failed");
  });
  it("titles", () => {
    expect(failureTitle(UNCONFIRMED)).toBe("Payment not confirmed");
    expect(failureTitle(DECLINED)).toBe("Payment declined");
    expect(failureTitle(REFUNDING)).toBe("Payment not possible");
  });
});

describe("backing status rules", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  it("deadReason", () => {
    expect(deadReason({ status: "refunded", holdExpiresAt: null }, now)).toEqual(REFUNDING);
    expect(deadReason({ status: "canceled", holdExpiresAt: null }, now)).toEqual(EXPIRED);
    expect(deadReason({ status: "pending_payment", holdExpiresAt: "2026-11-27T11:59:59Z" }, now)).toEqual(EXPIRED);
    expect(deadReason({ status: "pending_payment", holdExpiresAt: "2026-11-27T12:10:00Z" }, now)).toBeNull();
    expect(deadReason({ status: "held", holdExpiresAt: null }, now)).toBeNull();
  });
  it("hold countdown and announcements change only at 5 min, 1 min and expiry", () => {
    expect(holdSecondsLeft("2026-11-27T12:10:00Z", now)).toBe(600);
    expect(holdSecondsLeft("2026-11-27T11:00:00Z", now)).toBe(0);
    expect(formatHold(605)).toBe("10:05");
    expect(holdAnnouncement(600)).toBe("");
    expect(holdAnnouncement(300)).toMatch(/5 minutes/);
    expect(holdAnnouncement(60)).toMatch(/1 minute/);
    expect(holdAnnouncement(0)).toMatch(/expired/);
  });
  it("acceptance documents use the server's versions", () => {
    expect(acceptanceDocuments({ needsAcceptance: ["terms", "privacy"], legal: { termsVersion: "t3", privacyVersion: "p2" } })).toEqual([
      { kind: "terms", version: "t3" }, { kind: "privacy", version: "p2" },
    ]);
  });
});

describe("waitForCapture", () => {
  const sleep = async () => {};
  it("paid", async () => {
    const seq = [{ status: "pending_payment", holdExpiresAt: null }, { status: "held", holdExpiresAt: null }];
    expect(await waitForCapture(async () => seq.shift()!, { sleep })).toEqual({ kind: "paid" });
  });
  it("dead", async () => {
    expect(await waitForCapture(async () => ({ status: "refund_pending", holdExpiresAt: null }), { sleep })).toEqual({ kind: "dead", failure: REFUNDING });
  });
  it("keeps polling through errors, then times out without claiming success", async () => {
    let n = 0;
    const r = await waitForCapture(async () => { n++; throw new Error("x"); }, { sleep, attempts: 3 });
    expect(n).toBe(3);
    expect(r.kind).toBe("timeout");
  });
});

describe("backing copy", () => {
  it("covers every money state", () => {
    for (const s of MoneyState.options) expect(MONEY_STATE_COPY[s].label).toBeTruthy();
  });
  it("campaign status falls back to the raw status", () => {
    expect(campaignStatusLabel("failed")).toBe("Didn't reach its goal");
    expect(campaignStatusLabel("weird")).toBe("weird");
  });
  it("perk stock", () => {
    expect(perkStock({ remaining: 0, limit: 10 }).soldOut).toBe(true);
    expect(perkStock({ remaining: 5, limit: 100 }).low).toBe(true);
    expect(perkStock({ remaining: 50, limit: 100 }).low).toBe(false);
    expect(perkStock({ remaining: null, limit: null }).unlimited).toBe(true);
  });
  it("accepting backers", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    expect(acceptingBackers({ status: "live", endsAt: "2026-11-28T00:00:00Z" }, now)).toBe(true);
    expect(acceptingBackers({ status: "live", endsAt: "2026-11-27T11:00:00Z" }, now)).toBe(false);
    expect(acceptingBackers({ status: "funded", endsAt: "2026-11-28T00:00:00Z" }, now)).toBe(false);
  });
});

import { passwordScore, signUpErrors, signUpFailure, signUpMetadata } from "../src/auth-rules";
describe("auth rules (web + mobile sign-up)", () => {
  it("password score", () => {
    expect(passwordScore("short")).toBe(0);
    expect(passwordScore("Abcdefgh1")).toBe(3);
    expect(passwordScore("Abcdefgh1!")).toBe(4);
  });
  it("sign-up errors", () => {
    expect(Object.values(signUpErrors({ name: "Ana", email: "a@b.co", password: "Abcdefgh1", adult: true, terms: true })).every((v) => !v)).toBe(true);
    const e = signUpErrors({ name: "", email: "nope", password: "abc", adult: false, terms: false });
    expect(e).toMatchObject({ name: expect.any(String), email: "That doesn't look like an email address.", adult: expect.stringMatching(/18/) });
  });
  it("failure copy and metadata", () => {
    expect(signUpFailure("User already registered")).toMatch(/Log in instead/);
    expect(signUpFailure("boom")).toMatch(/try again/);
    expect(signUpMetadata(" Ana ", { termsVersion: "t", privacyVersion: "p" }, "id")).toEqual({ display_name: "Ana", adult_attested: true, terms_version: "t", privacy_version: "p", anon_id: "id" });
  });
});
