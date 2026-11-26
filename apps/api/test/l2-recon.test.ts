/**
 * Stray fund moves (design §3.1; L2-T-032 API part: matching order, stray routing, refund by fund ref), Layer 2
 * reconciliation (design §5.1; L2-T-023 in-flight allowance, L2-T-033 counters / liability / confirmation amounts,
 * L2-T-036 per-transaction refs, L2-T-039 refund_overdue, stray_fund_move_aged) and the L2 pause rule (L2-T-030:
 * a pausing break defers the Pool's disbursement, never its refunds, never an M1 payout), plus the failed-Pool notices
 * (round-1 review: the creator gets a creator notice; investor-cancelled investments get no pool_failed notice).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signPayload } from "@fanzup/mock-escrow/signing";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { ingestRegCfEvent } from "../src/l2/events";
import { reconcileL2Ledger } from "../src/l2/recon";
import { isPayoutPaused, isPoolPayoutPaused } from "../src/recon";
import { executeDueActions } from "../src/staff";
import { ids } from "./helpers";
import {
  advance, afterDeadline, buy, cancel, heldMinor, investor, invRow, l2kit, livePool, openBreaks, poolLedger, poolRow, risingCreator, tick, WEBHOOK_SECRET,
  type L2Kit,
} from "./l2-helpers";

const kinds = async (k: L2Kit, pool: string) => (await openBreaks(k.sql, pool)).map((b) => b.kind);
const days = (d: number) => new Date(Date.now() + d * 86_400_000);
/** A second trade + fund move at the provider naming `externalId` (one FanZuP never asked for). */
function strayFundMove(k: L2Kit, offering: string, account: string, externalId: string, amount = 50_00) {
  const t = k.engine.createTrade({ offeringId: offering, accountId: account, units: 1, unitPrice: amount, amount, externalId }, `stray-trade-${randomUUID()}`);
  return k.engine.fundTrade(t.id, { amount, externalId }, `stray-fund-${randomUUID()}`) as { id: string };
}
async function postEvent(k: L2Kit, type: string, data: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, type, createdAt: new Date().toISOString(), data });
  return k.app.inject({ method: "POST", url: "/api/v1/webhooks/regcf", headers: { "content-type": "application/json", "x-mock-escrow-signature": signPayload(WEBHOOK_SECRET, body) }, payload: body });
}
const accountOf = async (k: L2Kit, userId: string) =>
  (await asService(k.sql, (tx) => tx<{ a: string }[]>`select provider_account_ref as a from public.investor_profiles where user_id = ${userId}`))[0].a;

describe("stray fund moves (design §3.1)", () => {
  let k: L2Kit;
  let pool: string;
  let fan: Awaited<ReturnType<typeof investor>>;
  let inv: string;
  beforeAll(async () => {
    k = await l2kit();
    const creator = await risingCreator(k, "Established");
    pool = await livePool(k, creator);
    fan = await investor(k, { accredited: true });
    inv = (await buy(k, fan, pool, 10)).json().investmentId;
    await advance(k, 3);
  });
  afterAll(async () => { await k?.close(); });

  it("(a) a second, different fund move naming a funded investment → stray posted once, own refund op refund:fund:<ref>, refunded by fund ref; investment and counters unchanged", async () => {
    const before = await poolRow(k.sql, pool);
    const fm = strayFundMove(k, before.offering, await accountOf(k, fan.id), inv);
    await k.engine.advance(3); // settles → webhook → matched by externalId, but the investment has another fund ref → stray
    const [s] = await asService(k.sql, (tx) => tx<{ amount: bigint; refunded_at: Date | null; investment_id: string }[]>`
      select amount_minor as amount, refunded_at, investment_id from public.pool_stray_fund_moves where fund_ref = ${fm.id}`);
    expect({ amount: n(s.amount), refunded: s.refunded_at, inv: s.investment_id }).toEqual({ amount: 50_00, refunded: null, inv });
    const [op] = await asService(k.sql, (tx) => tx<{ idempotency_key: string; fund_ref: string; amount_minor: bigint }[]>`
      select idempotency_key, fund_ref, amount_minor from public.pool_ops where fund_ref = ${fm.id}`);
    expect(op).toMatchObject({ idempotency_key: `refund:fund:${fm.id}`, fund_ref: fm.id });
    expect((await invRow(k.sql, inv)).status).toBe("funded");
    const after = await poolRow(k.sql, pool);
    expect({ raised: n(after.raised_minor), units: after.units_committed }).toEqual({ raised: n(before.raised_minor), units: before.units_committed });
    // AC-E1 with the open stray: escrow == Σ received of funded/refund_pending + open strays; recon opens nothing.
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(await heldMinor(k.sql, pool));
    expect((await reconcileL2Ledger(k, { poolId: pool, now: k.clock })).breaks).toEqual([]);
    // Redelivery is a duplicate; the runner refunds it by its fund ref.
    for (const w of k.engine.webhookLog().filter((x) => x.type === "fund_move.settled")) await k.engine.redeliver(w.id);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.pool_stray_fund_moves where fund_ref = ${fm.id}`)).toHaveLength(1);
    await advance(k, 3);
    const refund = k.engine.list("refund", (r) => r.fundMoveId === fm.id);
    expect(refund).toHaveLength(1);
    const [s2] = await asService(k.sql, (tx) => tx<{ refunded_at: Date | null }[]>`select refunded_at from public.pool_stray_fund_moves where fund_ref = ${fm.id}`);
    expect(s2.refunded_at).not.toBeNull();
    expect((await invRow(k.sql, inv)).status).toBe("funded");
    expect((await reconcileL2Ledger(k, { poolId: pool, now: k.clock })).breaks).toEqual([]);
  });

  it("a fund move naming no investment of ours but our offering → stray, refunded in full", async () => {
    const p = await poolRow(k.sql, pool);
    const fm = strayFundMove(k, p.offering, await accountOf(k, fan.id), randomUUID(), 70_00);
    await advance(k, 3);
    await advance(k, 3);
    const [s] = await asService(k.sql, (tx) => tx<{ refunded_at: Date | null; investment_id: string | null }[]>`select refunded_at, investment_id from public.pool_stray_fund_moves where fund_ref = ${fm.id}`);
    expect(s.investment_id).toBeNull();
    expect(s.refunded_at).not.toBeNull();
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(await heldMinor(k.sql, pool));
  });
});

describe("Layer 2 reconciliation kinds and the pause rule (design §5.1)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("L2-T-023: a fund move settled at the provider whose event isn't processed yet is in flight — no escrow_diff, listed in inFlight; past the grace it is a break", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 6);
    const realDeliver = k.engine.deliver;
    k.engine.deliver = async (body) => {
      await ingestRegCfEvent(k.sql, k.regcf.parseWebhook(body, signPayload(WEBHOOK_SECRET, body))); // stored, not processed
      return true;
    };
    await k.engine.advance(3);
    k.engine.deliver = realDeliver;
    const rec = await reconcileL2Ledger(k, { poolId: pool, now: new Date() });
    expect(rec.breaks).toEqual([]);
    const fundRef = (await invRow(k.sql, r.json().investmentId)).provider_fund_ref;
    expect(rec.inFlight).toEqual([expect.objectContaining({ poolId: pool, ref: fundRef, kind: "fund_move", amountMinor: 300_00 })]);
    const late = await reconcileL2Ledger(k, { poolId: pool, now: new Date(Date.now() + (POLICY.recon.inflightGraceMinutes + 1) * 60_000) });
    expect(late.breaks.map((b) => b.kind).sort()).toEqual(["escrow_diff", "unmatched_provider_txn"]);
    // Once the inbox is drained, ledger == provider again and the derived breaks clear.
    await tick(k);
    expect((await reconcileL2Ledger(k, { poolId: pool, now: new Date() })).breaks).toEqual([]);
    expect(await kinds(k, pool)).toEqual([]);
  });

  it("L2-T-033: a hand-edited raised_minor opens counter_mismatch and pauses nothing; a ledger-only liability posting opens liability_mismatch and defers the Pool's disbursement while refunds continue and no M1 payout pauses", async () => {
    const pool = await livePool(k, creator);
    const offering = (await poolRow(k.sql, pool)).offering;
    const fan = await investor(k, { accredited: true });
    await buy(k, fan, pool, 200);
    await advance(k, 3);
    await asService(k.sql, (tx) => tx`update public.pools set raised_minor = raised_minor + 1 where id = ${pool}`);
    await reconcileL2Ledger(k, { poolId: pool, now: k.clock });
    expect(await kinds(k, pool)).toEqual(["counter_mismatch"]);
    expect(await isPoolPayoutPaused(k.sql, pool, k.clock)).toBe(false);
    await asService(k.sql, (tx) => tx`update public.pools set raised_minor = raised_minor - 1 where id = ${pool}`);

    await tick(k, await afterDeadline(k.sql, pool));
    await advance(k, 3); // close + tranche 1 released
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(5_000_00);
    expect(await kinds(k, pool)).toEqual([]); // counter_mismatch cleared by the run
    await asService(k.sql, (tx) => tx`select public.ledger_post_pool('test.adjustment', ${"test:" + randomUUID()}, ${pool},
      ${tx.json([{ kind: "pool_issuer_payable", amount: 250 }, { kind: "pool_investor_liability", amount: -250 }])})`);
    await reconcileL2Ledger(k, { poolId: pool, now: k.clock });
    expect(await kinds(k, pool)).toEqual(["liability_mismatch"]);
    expect(await isPoolPayoutPaused(k.sql, pool, k.clock)).toBe(true);
    expect(await isPayoutPaused(k.sql)).toBe(false); // M1 payouts unaffected

    // Tranche 2 verified → its disbursement waits on the break; a stray refund on the same Pool still goes out.
    const [t2] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.pool_tranches where pool_id = ${pool} and seq = 2`);
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pool-tranches/${t2.id}/evidence`, headers: { authorization: creator.auth }, payload: { notes: "Masters delivered to the distributor" } });
    const v = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-tranches/${t2.id}/verify`, headers: { authorization: k.staff }, payload: { reason: "Master files checked" } });
    expect(v.json().action.status).toBe("scheduled");
    await executeDueActions(k.deps, new Date(Date.now() + (POLICY.singleOperator.delayHours + 1) * 3_600_000));
    // A stray fund move lands in the closed offering's escrow (the provider's own record, then its signed event).
    const fmId = `FM_late_${randomUUID().slice(0, 8)}`;
    k.engine.loadFixture({ objects: { fundMove: [{ id: fmId, tradeId: null, offeringId: offering, amount: 40_00, externalId: randomUUID(), status: "settled", settledAt: new Date().toISOString() }] } });
    await postEvent(k, "fund_move.settled", { fundMoveId: fmId, offeringId: offering, amount: 40_00, externalId: randomUUID() });
    await tick(k);
    const ops = await asService(k.sql, (tx) => tx<{ kind: string; status: string; last_error: string | null }[]>`
      select kind, status, last_error from public.pool_ops where pool_id = ${pool} and kind in ('disburse', 'refund') and status <> 'confirmed' order by kind`);
    expect(ops).toEqual([
      { kind: "disburse", status: "initiated", last_error: "waiting: recon_pause" },
      { kind: "refund", status: "sent", last_error: null },
    ]);
  });

  it("L2-T-033: a refund webhook with a different amount opens amount_mismatch, fails the op and dead-letters the event path", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 4);
    await advance(k, 3);
    await cancel(k, fan, r.json().investmentId);
    await tick(k); // refund op sent to the provider
    const [op] = await asService(k.sql, (tx) => tx<{ id: string; status: string }[]>`select id, status from public.pool_ops where kind = 'refund' and subject_id = ${r.json().investmentId}`);
    expect(op.status).toBe("sent");
    const w = await postEvent(k, "refund.settled", { refundId: `RF_forged_${randomUUID().slice(0, 8)}`, amount: 199_99, externalId: op.id });
    expect(w.statusCode).toBe(200);
    const [ev] = await asService(k.sql, (tx) => tx<{ status: string; claim_token: string | null }[]>`select status, claim_token from public.provider_events where payload #>> '{data,externalId}' = ${op.id} and payload #>> '{data,amount}' = '19999'`);
    expect(ev).toEqual({ status: "failed", claim_token: null });
    const [after] = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.pool_ops where id = ${op.id}`);
    expect(after.status).toBe("failed");
    expect(await kinds(k, pool)).toEqual(["amount_mismatch"]);
    const [b] = await openBreaks(k.sql, pool);
    expect(n(b.amount_minor)).toBe(199_99 - 200_00);
    expect((await invRow(k.sql, r.json().investmentId)).status).toBe("refund_pending");
  });

  it("L2-T-036: a provider refund with no ledger posting, offset by a hand-made posting with another ref → unmatched_provider_txn and unmatched_ledger_txn with zero balance diff, pausing", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 6);
    await advance(k, 3);
    const fundRef = (await invRow(k.sql, r.json().investmentId)).provider_fund_ref!;
    const realDeliver = k.engine.deliver;
    k.engine.deliver = async () => true; // the provider's event never reaches us
    k.engine.refundFundMove(fundRef, { amount: 300_00, externalId: "out-of-band" }, `oob-${randomUUID()}`);
    await k.engine.advance(3);
    k.engine.deliver = realDeliver;
    await asService(k.sql, (tx) => tx`select public.ledger_post_pool('investment.refunded', ${"test:" + randomUUID()}, ${pool},
      ${tx.json([{ kind: "pool_investor_liability", amount: 300_00 }, { kind: "pool_escrow", amount: -300_00 }])}, null, 'RF_handmade', 'test')`);
    const rec = await reconcileL2Ledger(k, { poolId: pool, now: k.clock });
    expect(rec.pools[0].escrow.diffMinor).toBe(0);
    expect(rec.breaks.map((b) => b.kind)).toEqual(expect.arrayContaining(["unmatched_provider_txn", "unmatched_ledger_txn"]));
    expect(await isPoolPayoutPaused(k.sql, pool, k.clock)).toBe(true);
  });

  it("L2-T-039: a refund op left failed for more than 5 business days opens refund_overdue (alert, non-pausing); an unconfirmed stray refund ages into stray_fund_move_aged", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 2);
    await advance(k, 3);
    k.regcf.failNext("refundFundMove", "permanent", "refund_refused_test");
    await cancel(k, fan, r.json().investmentId);
    await tick(k);
    const [op] = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.pool_ops where kind = 'refund' and subject_id = ${r.json().investmentId}`);
    expect(op.status).toBe("failed");
    await reconcileL2Ledger(k, { poolId: pool, now: days(3) });
    expect(await kinds(k, pool)).toEqual([]);
    k.regcf.failNext("refundFundMove", "permanent", "refund_refused_test");
    strayFundMove(k, (await poolRow(k.sql, pool)).offering, await accountOf(k, fan.id), randomUUID(), 30_00);
    await advance(k, 3);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await reconcileL2Ledger(k, { poolId: pool, now: days(10) });
    expect((await kinds(k, pool)).sort()).toEqual(["refund_overdue", "refund_overdue", "stray_fund_move_aged"]);
    // The alert fires when each break first opens, not again on every run while it stays open (review round 2, PR #12).
    await reconcileL2Ledger(k, { poolId: pool, now: days(11) });
    const overdueAlerts = errors.mock.calls.filter((c) => String(c[0]).includes('"msg":"refund.overdue"'));
    errors.mockRestore();
    expect(overdueAlerts).toHaveLength(2);
    // refund_overdue never pauses; stray_fund_move_aged does (material).
    await asService(k.sql, (tx) => tx`update public.pool_breaks set resolved_at = now(), resolution = 'test' where pool_id = ${pool} and kind = 'stray_fund_move_aged'`);
    expect(await isPoolPayoutPaused(k.sql, pool, days(10))).toBe(false);
  });
});

describe("failed-offering and transaction notices (design §5.2; round-1 review)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("failed Pool: each investor gets one l2_pool_failed with their refund amount; an investor who cancelled gets none; the creator gets the creator template", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => investor(k, { accredited: true })));
    await buy(k, a, pool, 4);
    await buy(k, a, pool, 2);
    await buy(k, b, pool, 3);
    const rc = await buy(k, c, pool, 5);
    await advance(k, 3);
    await cancel(k, c, rc.json().investmentId);
    await tick(k, await afterDeadline(k.sql, pool));
    await advance(k, 3);
    await tick(k);
    const rows = await asService(k.sql, (tx) => tx<{ user_id: string; template: string }[]>`
      select user_id, template from public.notifications where subject_id = ${pool} and template like 'l2_pool_failed%' order by template, user_id`);
    expect(rows.filter((r) => r.template === "l2_pool_failed").map((r) => r.user_id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.filter((r) => r.template === "l2_pool_failed_creator").map((r) => r.user_id)).toEqual([creator.id]);
    const [payload] = await asService(k.sql, (tx) => tx<{ refund: bigint }[]>`
      select (payload ->> 'refund_minor')::bigint as refund from public.outbox where topic = 'l2.notify' and payload ->> 'template' = 'pool_failed' and payload ->> 'user_id' = ${a.id}`);
    expect(n(payload.refund)).toBe(300_00);
    expect((await poolRow(k.sql, pool)).status).toBe("refunded");
    void ids;
  });

  it("funded Pool: one 227.303(f) confirmation per issued investment", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const fans = await Promise.all([1, 2].map(() => investor(k, { accredited: true })));
    for (const f of fans) await buy(k, f, pool, 100);
    await advance(k, 3);
    await tick(k, await afterDeadline(k.sql, pool));
    await tick(k);
    for (const f of fans) {
      const got = await asService(k.sql, (tx) => tx<{ template: string }[]>`select template from public.notifications where user_id = ${f.id} and template in ('l2_units_issued', 'l2_commitment_received')`);
      expect(got.map((x) => x.template).sort()).toEqual(["l2_commitment_received", "l2_units_issued"]);
    }
  });
});
