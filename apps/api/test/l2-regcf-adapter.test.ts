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
  });
});
