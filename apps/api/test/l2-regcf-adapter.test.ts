/** RegCfProvider in-process adapter over the mock engine (ADR-007; L2-T-006, L2-T-041): lookups and error classes. */
import { describe, expect, it } from "vitest";
import { MockEscrowEngine } from "@fanzup/mock-escrow/engine";
import { InProcessRegCf } from "../src/regcf/inprocess";
import { RegCfError } from "../src/regcf/types";

const SECRET = "test_webhook_secret";

describe("InProcessRegCf lookups", () => {
  it("findTrade / getTrade / cancelTrade / listTransactions go through the interface; trade_funded is a permanent error", async () => {
    const engine = new MockEscrowEngine({ db: ":memory:", webhookSecret: SECRET, deliver: async () => true });
    const rc = new InProcessRegCf(engine, SECRET);
    const iss = await rc.createIssuer({ name: "Test Artist LLC", externalId: "artist-1" }, "issuer:artist-1");
    const off = await rc.createOffering({ issuerId: iss.id, name: "Pool", targetAmount: 100_000, maxAmount: 200_000, unitPrice: 5_000, endDate: "2027-03-01", externalId: "pool-1" }, "offering:pool-1");
    const party = await rc.createParty({ firstName: "Jordan", lastName: "Pierce", state: "AR", externalId: "user-1" }, "party:user-1");
    const acct = await rc.createAccount({ partyId: party.id, externalId: "user-1" }, "account:user-1");
    await rc.advance!(3);
    expect(await rc.findTrade({ externalId: "inv-1" })).toBeNull();
    const t1 = await rc.createTrade({ offeringId: off.id, accountId: acct.id, units: 1, unitPrice: 5_000, amount: 5_000, externalId: "inv-1" }, "trade:inv-1");
    expect(await rc.findTrade({ externalId: "inv-1" })).toMatchObject({ id: t1.id, status: "created", fundMoves: [] });
    expect(await rc.cancelTrade(t1.id, "cancel_trade:inv-1")).toMatchObject({ status: "cancelled" });
    const t2 = await rc.createTrade({ offeringId: off.id, accountId: acct.id, units: 2, unitPrice: 5_000, amount: 10_000, externalId: "inv-2" }, "trade:inv-2");
    const fm = await rc.fundTrade(t2.id, { amount: 10_000, externalId: "inv-2" }, "fund:inv-2");
    const err = await rc.cancelTrade(t2.id, "cancel_trade:inv-2").catch((e) => e);
    expect(err).toBeInstanceOf(RegCfError);
    expect({ cls: err.cls, code: err.code }).toEqual({ cls: "permanent", code: "trade_funded" });
    expect((await rc.getTrade(t2.id)).fundMoves.map((f) => f.id)).toEqual([fm.id]);
    await rc.advance!(3);
    expect((await rc.listTransactions({ offeringId: off.id })).map((x) => [x.id, x.kind, x.status, x.amount, x.externalId])).toEqual([[fm.id, "fund_move", "settled", 10_000, "inv-2"]]);
    // Fund-move-level refund (design §3.1, stray refunds by fund ref).
    const rf = await rc.refundFundMove(fm.id, { amount: 10_000, externalId: "op-1" }, `refund:fund:${fm.id}`);
    expect((await rc.refundFundMove(fm.id, { amount: 10_000, externalId: "op-1" }, `refund:fund:${fm.id}`)).id).toBe(rf.id);
    const twice = await rc.refundFundMove(fm.id, { amount: 10_000, externalId: "op-2" }, "refund:fund:other").catch((e) => e);
    expect({ cls: twice.cls, code: twice.code }).toEqual({ cls: "permanent", code: "already_refunded" });
  });
});

describe("HttpMockEscrow refundFundMove", () => {
  it("POSTs /v1/fund-moves/:id/refund with the API key and the idempotency key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "RF_1", fundMoveId: "FM_1", amount: 500, status: "pending" }), { status: 201 });
    }) as typeof fetch;
    try {
      const { HttpMockEscrow } = await import("../src/regcf/http");
      const rc = new HttpMockEscrow({ baseUrl: "http://mock.local/", apiKey: "test-api-key", webhookSecret: SECRET });
      expect(await rc.refundFundMove("FM_1", { amount: 500, externalId: "op-1" }, "refund:fund:FM_1")).toMatchObject({ id: "RF_1" });
    } finally {
      globalThis.fetch = real;
    }
    expect(calls[0].url).toBe("http://mock.local/v1/fund-moves/FM_1/refund");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "x-api-key": "test-api-key", "idempotency-key": "refund:fund:FM_1" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ amount: 500, externalId: "op-1" });
  });
});
