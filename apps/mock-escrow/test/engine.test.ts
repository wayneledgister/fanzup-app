import { describe, expect, it } from "vitest";
import { MockEscrowEngine, type WebhookEnvelope } from "../src/engine";
import { signPayload, verifySignature, SIGNATURE_HEADER } from "../src/signing";
import { buildServer } from "../src/server";

const SECRET = "test_webhook_secret";
function engine() {
  const inbox: { evt: WebhookEnvelope; headers: Record<string, string>; body: string }[] = [];
  const e = new MockEscrowEngine({ db: ":memory:", webhookSecret: SECRET, deliver: async (body, headers, evt) => (inbox.push({ evt, headers, body }), true) });
  return { e, inbox, types: () => inbox.map((x) => x.evt.type) };
}
let n = 0;
const k = () => `idem-key-${++n}-xxxx`;

function offering(e: MockEscrowEngine) {
  const iss = e.createIssuer({ name: "Nova Reyes Music LLC", externalId: "artist-1" }, k());
  return e.createOffering({ issuerId: iss.id, name: "Album Pool", targetAmount: 100_000, maxAmount: 200_000, unitPrice: 5_000, endDate: "2027-01-01", externalId: "pool-1" }, k());
}
function investor(e: MockEscrowEngine, lastName = "Pierce") {
  const p = e.createParty({ firstName: "Jordan", lastName, state: "AR", externalId: `user-${lastName}` }, k());
  const a = e.createAccount({ partyId: p.id, externalId: `user-${lastName}` }, k());
  e.createLink({ accountId: a.id, partyId: p.id }, k());
  return { party: p, account: a };
}

describe("mock escrow engine (ADR-007)", () => {
  it("decides KYC asynchronously with deterministic triggers", async () => {
    const { e, inbox } = engine();
    const ok = investor(e, "Pierce").party;
    const fail = investor(e, "Kycfail").party;
    const hold = investor(e, "AMLHOLD").party;
    expect(e.get("party", ok.id).kycStatus).toBe("pending");
    await e.advance(1);
    expect(inbox).toHaveLength(0);
    await e.advance(2);
    const by = Object.fromEntries(inbox.map((x) => [x.evt.data.partyId, x.evt.data.kycStatus]));
    expect(by).toEqual({ [ok.id]: "approved", [fail.id]: "rejected", [hold.id]: "manual_review" });
  });

  it("idempotency: same key + body replays; different body is refused", () => {
    const { e } = engine();
    const key = k();
    const a = e.createIssuer({ name: "X LLC", externalId: "a" }, key);
    const b = e.createIssuer({ name: "X LLC", externalId: "a" }, key);
    expect(b.id).toBe(a.id);
    expect(() => e.createIssuer({ name: "Y LLC", externalId: "a" }, key)).toThrow(/different request/);
    expect(() => e.createIssuer({ name: "Y LLC", externalId: "a" }, undefined)).toThrow(/Idempotency-Key/);
  });

  it("fund moves settle into escrow; whole-dollar amounts ending in 13 are returned", async () => {
    const { e, types } = engine();
    const o = offering(e);
    const { party, account } = investor(e);
    await e.advance(3);
    expect(e.get("party", party.id).kycStatus).toBe("approved");
    const t1 = e.createTrade({ offeringId: o.id, accountId: account.id, units: 2, unitPrice: 5_000, amount: 10_000, externalId: "inv-1" }, k());
    e.fundTrade(t1.id, { amount: 10_000, externalId: "inv-1" }, k());
    const t2 = e.createTrade({ offeringId: o.id, accountId: account.id, units: 1, unitPrice: 11_300, amount: 11_300, externalId: "inv-2" }, k());
    e.fundTrade(t2.id, { amount: 11_300, externalId: "inv-2" }, k());
    expect(e.getEscrow(o.id).balance).toBe(0);
    await e.advance(3);
    expect(e.getEscrow(o.id).balance).toBe(10_000);
    expect(types()).toEqual(expect.arrayContaining(["fund_move.settled", "fund_move.returned"]));
  });

  it("escrow is released only after close and never past the balance; refunds return the full amount", async () => {
    const { e } = engine();
    const o = offering(e);
    const { account } = investor(e);
    await e.advance(3);
    const t = e.createTrade({ offeringId: o.id, accountId: account.id, units: 4, unitPrice: 5_000, amount: 20_000, externalId: "inv" }, k());
    e.fundTrade(t.id, { amount: 20_000, externalId: "inv" }, k());
    expect(() => e.disburseToIssuer(o.id, { amount: 1, externalId: "d0" }, k())).toThrow(/after the offering closes/);
    await e.advance(3);
    expect(() => e.refundTrade(t.id, { amount: 1, externalId: "r" }, k())).toThrow(/full funded amount/);
    e.closeOffering(o.id, k());
    expect(() => e.disburseToIssuer(o.id, { amount: 20_001, externalId: "d1" }, k())).toThrow(/Not enough/);
    e.disburseToIssuer(o.id, { amount: 12_000, externalId: "d2" }, k());
    await e.advance(2);
    expect(e.getEscrow(o.id).balance).toBe(8_000);
  });

  it("collection account: deposits in, payouts out, never negative", async () => {
    const { e, types } = engine();
    const o = offering(e);
    const { account } = investor(e);
    const ca = e.createCollectionAccount({ offeringId: o.id, externalId: "pool-1" }, k());
    e.simulateDeposit(ca.id, { amount: 50_000, reference: "Q1 2027", externalId: "dep-1" }, k());
    await e.advance(1);
    expect(e.getCollectionAccount(ca.id).balance).toBe(50_000);
    e.payoutFromCollection(ca.id, { recipientType: "investor", recipientRef: account.id, amount: 30_000, externalId: "po-1" }, k());
    expect(() => e.payoutFromCollection(ca.id, { recipientType: "issuer", recipientRef: "x", amount: 30_000, externalId: "po-2" }, k())).toThrow(/Not enough/);
    await e.advance(2);
    expect(e.getCollectionAccount(ca.id).balance).toBe(20_000);
    expect(types()).toEqual(expect.arrayContaining(["deposit.settled", "payout.settled"]));
  });

  it("signs webhooks; a tampered or stale signature fails", async () => {
    const { e, inbox } = engine();
    investor(e);
    await e.advance(3);
    const w = inbox[0];
    expect(verifySignature(SECRET, w.body, w.headers[SIGNATURE_HEADER])).toEqual({ ok: true });
    expect(verifySignature(SECRET, w.body.replace("approved", "rejected"), w.headers[SIGNATURE_HEADER]).ok).toBe(false);
    expect(verifySignature("wrong", w.body, w.headers[SIGNATURE_HEADER]).ok).toBe(false);
    const stale = signPayload(SECRET, w.body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifySignature(SECRET, w.body, stale)).toEqual({ ok: false, reason: "stale" });
  });

  it("retries webhook delivery until the receiver accepts", async () => {
    let accept = false;
    const got: string[] = [];
    const e = new MockEscrowEngine({ db: ":memory:", webhookSecret: SECRET, deliver: async (_b, _h, evt) => (accept ? (got.push(evt.id), true) : false) });
    investor(e);
    await e.advance(3);
    expect(e.webhookLog()[0]).toMatchObject({ status: "pending", attempts: 1 });
    accept = true;
    e.db.prepare("update webhooks set next_at = 0").run();
    await e.tick();
    expect(got).toHaveLength(1);
  });
});

describe("mock escrow HTTP service", () => {
  const cfg = { port: 0, apiKey: "k_test_123", webhookSecret: SECRET, webhookUrl: "http://127.0.0.1:1/none", dbPath: ":memory:", tickMs: 1000 };
  it("requires the API key and an Idempotency-Key", async () => {
    const { app } = buildServer(cfg, new MockEscrowEngine({ db: ":memory:", webhookSecret: SECRET }));
    expect((await app.inject({ method: "POST", url: "/v1/issuers", payload: { name: "A LLC", externalId: "a" } })).statusCode).toBe(401);
    const noKey = await app.inject({ method: "POST", url: "/v1/issuers", headers: { "x-api-key": "k_test_123" }, payload: { name: "A LLC", externalId: "a" } });
    expect(noKey.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/v1/issuers", headers: { "x-api-key": "k_test_123", "idempotency-key": "abcdefgh-1" }, payload: { name: "A LLC", externalId: "a" } });
    expect(ok.statusCode).toBe(201);
    const again = await app.inject({ method: "POST", url: "/v1/issuers", headers: { "x-api-key": "k_test_123", "idempotency-key": "abcdefgh-1" }, payload: { name: "A LLC", externalId: "a" } });
    expect(again.json().id).toBe(ok.json().id);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    await app.close();
  });
  it("refuses to start in a deployed environment", async () => {
    const { configFromEnv } = await import("../src/server");
    expect(() => configFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/deployed/);
    expect(() => configFromEnv({ RENDER: "1" } as NodeJS.ProcessEnv)).toThrow(/deployed/);
  });
});
