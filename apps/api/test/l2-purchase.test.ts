/**
 * Purchase idempotency and the resume guard (design §5; L2-T-028), reservation expiry with provider lookups (design
 * §4.3; L2-T-026), counted reservations in the API (L2-T-042), cancellation of reserved / funding investments with a
 * provider call started (L2-T-031, L2-T-043), settlement with a call-started reservation (L2-T-045, API side), and the
 * 227.303(d) commitment notice once per investment (L2-T-044).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { reconcileL2Ledger } from "../src/l2/recon";
import {
  ACK, advance, afterDeadline, buy, cancel, countCalls, crashAfter, fundMovesAtMock, investor, invRow, l2kit, livePool, openBreaks, poolRow, risingCreator, tick,
  type L2Kit,
} from "./l2-helpers";

const me = async (k: L2Kit, u: { auth: string }) => (await k.app.inject({ method: "GET", url: "/api/v1/investor/me", headers: { authorization: u.auth } })).json();
const invOf = async (k: L2Kit, userId: string, poolId: string) =>
  (await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.investments where investor_id = ${userId} and pool_id = ${poolId} order by created_at desc limit 1`))[0].id;
const claim = async (k: L2Kit, userId: string, key: string) =>
  (await asService(k.sql, (tx) => tx<{ state: string; status_code: number | null; resource_id: string | null }[]>`
    select state, status_code, resource_id from public.api_idempotency where key = ${`investments:${userId}:${key}`}`))[0];
const notes = (k: L2Kit, userId: string, template: string) =>
  asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.notifications where user_id = ${userId} and template = ${template}`);
/** Expire a reservation by time (as if the request came back after reserve_expires_at). */
const expire = (k: L2Kit, id: string) => asService(k.sql, (tx) => tx`update public.investments set reserve_expires_at = now() - interval '1 minute' where id = ${id}`);
const afterGrace = () => new Date(Date.now() + (POLICY.l2.expiryLookupGraceMinutes + 1) * 60_000);
/** A claim + reservation committed by a request that crashed before any provider step (built like invest() does). */
async function strandedClaim(k: L2Kit, u: { id: string }, poolId: string, units: number, key: string) {
  const body = { units, riskAckVersion: ACK };
  const hash = createHash("sha256").update(JSON.stringify({ u: u.id, poolId, body })).digest("hex");
  const [r] = await asService(k.sql, (tx) => tx<{ investment_id: string }[]>`select investment_id from public.reserve_investment(${u.id}, ${poolId}, ${units}, ${ACK}, ${new Date()})`);
  await asService(k.sql, (tx) => tx`insert into public.api_idempotency (key, user_id, request_hash, state, resource_id, claimed_at)
                                    values (${`investments:${u.id}:${key}`}, ${u.id}, ${hash}, 'in_progress', ${r.investment_id}, now())`);
  return r.investment_id;
}

describe("purchase resume guard (design §5, L2-T-028)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  let pool: string;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("crash after fundTrade → retry with the same key → 201, exactly one fund move, the claim stored done", async () => {
    pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const key = `crash-${randomUUID()}`;
    crashAfter(k, "fundTrade");
    expect((await buy(k, fan, pool, 4, key)).statusCode).toBe(502);
    const inv = await invOf(k, fan.id, pool);
    expect(await claim(k, fan.id, key)).toMatchObject({ state: "in_progress", resource_id: inv });
    expect(await fundMovesAtMock(k, inv)).toHaveLength(1);
    const again = await buy(k, fan, pool, 4, key);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toMatchObject({ investmentId: inv, status: "funding", amountMinor: 200_00, units: 4 });
    expect(await fundMovesAtMock(k, inv)).toHaveLength(1);
    expect(await claim(k, fan.id, key)).toMatchObject({ state: "done", status_code: 201 });
    await advance(k, 3);
    expect((await invRow(k.sql, inv)).status).toBe("funded");
    // Commitment notice once, though both mark_investment_funding and the fund-move path ran (L2-T-044).
    await tick(k);
    expect(await notes(k, fan.id, "l2_commitment_received")).toHaveLength(1);
  });

  it("the done write lost after an applied purchase → retry answers 201 with the current status and calls nothing", async () => {
    const fan = await investor(k, { accredited: true });
    const key = `lost-${randomUUID()}`;
    expect((await buy(k, fan, pool, 2, key)).statusCode).toBe(201);
    await advance(k, 3);
    await asService(k.sql, (tx) => tx`update public.api_idempotency set state = 'in_progress', response = null, status_code = null where key = ${`investments:${fan.id}:${key}`}`);
    const calls = countCalls(k, ["createTrade", "fundTrade", "findTrade"]);
    const r = await buy(k, fan, pool, 2, key);
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("funded");
    expect(calls).toEqual({ createTrade: 0, fundTrade: 0, findTrade: 0 });
  });

  it("crash between createTrade and fundTrade → the expiry step voids the trade and expires → the retry gets the stored 409, no fund move, headroom back", async () => {
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 }); // $2,500 limit
    const key = `mid-${randomUUID()}`;
    k.regcf.failNext("fundTrade");
    expect((await buy(k, fan, pool, 40, key)).statusCode).toBe(502);
    const inv = await invOf(k, fan.id, pool);
    expect((await invRow(k.sql, inv)).provider_call_started_at).not.toBeNull();
    expect((await me(k, fan)).usedMinor).toBe(2_000_00);
    await tick(k, new Date(Date.now() + (POLICY.l2.reserveMinutes + POLICY.l2.expiryLookupGraceMinutes + 1) * 60_000));
    expect((await invRow(k.sql, inv)).status).toBe("expired");
    expect(k.engine.list("trade", (t) => t.externalId === inv).map((t) => t.status)).toEqual(["cancelled"]);
    const r = await buy(k, fan, pool, 40, key);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "reservation_expired" });
    expect(r.json().refundPending).toBeUndefined();
    expect(await fundMovesAtMock(k, inv)).toHaveLength(0);
    expect((await me(k, fan)).usedMinor).toBe(0);
    expect((await buy(k, fan, pool, 40, key)).json()).toMatchObject({ error: "reservation_expired" }); // stored, replayed
  });

  it("(d) a dead reservation with no provider call started → stored 409 and no provider call at all", async () => {
    const fan = await investor(k, { accredited: true });
    const key = `dead-${randomUUID()}`;
    const inv = await strandedClaim(k, fan, pool, 1, key);
    await expire(k, inv);
    const calls = countCalls(k, ["createTrade", "fundTrade", "findTrade", "cancelTrade"]);
    const r = await buy(k, fan, pool, 1, key);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("reservation_expired");
    expect(calls).toEqual({ createTrade: 0, fundTrade: 0, findTrade: 0, cancelTrade: 0 });
    expect(await claim(k, fan.id, key)).toMatchObject({ state: "done", status_code: 409 });
  });

  it("(e) dead, call started, no trade at the provider → 409 and nothing created", async () => {
    const fan = await investor(k, { accredited: true });
    const key = `nt-${randomUUID()}`;
    k.regcf.failNext("createTrade"); // the marker is committed, the provider never saw the call
    expect((await buy(k, fan, pool, 1, key)).statusCode).toBe(502);
    const inv = await invOf(k, fan.id, pool);
    await expire(k, inv);
    const calls = countCalls(k, ["createTrade", "fundTrade", "findTrade"]);
    const r = await buy(k, fan, pool, 1, key);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual(expect.objectContaining({ error: "reservation_expired" }));
    expect(calls).toEqual({ createTrade: 0, fundTrade: 0, findTrade: 1 });
    expect(k.engine.list("trade", (t) => t.externalId === inv)).toHaveLength(0);
  });

  it("(e) dead with an unfunded trade → the trade is voided at the provider, 409, no fund move ever", async () => {
    const fan = await investor(k, { accredited: true });
    const key = `uf-${randomUUID()}`;
    k.regcf.failNext("fundTrade");
    expect((await buy(k, fan, pool, 1, key)).statusCode).toBe(502);
    const inv = await invOf(k, fan.id, pool);
    await expire(k, inv);
    const calls = countCalls(k, ["fundTrade", "cancelTrade"]);
    const r = await buy(k, fan, pool, 1, key);
    expect(r.json()).toMatchObject({ error: "reservation_expired" });
    expect(calls).toEqual({ fundTrade: 0, cancelTrade: 1 });
    expect(k.engine.list("trade", (t) => t.externalId === inv).map((t) => t.status)).toEqual(["cancelled"]);
    await tick(k, afterGrace());
    expect((await invRow(k.sql, inv)).status).toBe("expired");
    expect(await fundMovesAtMock(k, inv)).toHaveLength(0);
  });

  it("(e)/(a′) + L2-T-042: dead with a funded trade → 409 refundPending; usage stays counted until the refund; the same answer after the fund move settles", async () => {
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 }); // $2,500 limit
    const key = `ft-${randomUUID()}`;
    crashAfter(k, "fundTrade");
    expect((await buy(k, fan, pool, 40, key)).statusCode).toBe(502); // $2,000, fund move created at the provider
    const inv = await invOf(k, fan.id, pool);
    await expire(k, inv);
    // Counted reservation (call started): a new purchase that would pass the limit is refused, even past expiry.
    expect((await buy(k, fan, pool, 20)).json().error).toBe("regcf_limit_exceeded");
    const r = await buy(k, fan, pool, 40, key);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "reservation_expired", refundPending: true });
    expect((await invRow(k.sql, inv)).provider_fund_ref).not.toBeNull();
    // Refs stored: the expiry step doesn't look it up again.
    const calls = countCalls(k, ["findTrade"]);
    await tick(k, afterGrace());
    expect(calls.findTrade).toBe(0);
    expect((await invRow(k.sql, inv)).status).toBe("reserved");
    expect((await buy(k, fan, pool, 20)).json().error).toBe("regcf_limit_exceeded");
    // The fund move settles: unapplied (reservation_expired) → refund_pending, refunded in full; still counted until then.
    await k.engine.advance(3);
    expect(await invRow(k.sql, inv)).toMatchObject({ status: "refund_pending", status_reason: "reservation_expired" });
    expect((await buy(k, fan, pool, 20)).json().error).toBe("regcf_limit_exceeded");
    await asService(k.sql, (tx) => tx`update public.api_idempotency set state = 'in_progress', response = null where key = ${`investments:${fan.id}:${key}`}`);
    expect((await buy(k, fan, pool, 40, key)).json()).toMatchObject({ error: "reservation_expired", refundPending: true }); // (a′)
    await advance(k, 3);
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect((await me(k, fan)).usedMinor).toBe(0);
    expect((await buy(k, fan, pool, 20)).statusCode).toBe(201);
    await tick(k);
    expect(await notes(k, fan.id, "l2_payment_refunded_unapplied")).toHaveLength(1);
    expect((await reconcileL2Ledger(k, { poolId: pool, now: k.clock })).breaks).toEqual([]);
  });

  it("a rule violation is stored on the claim and replayed with the same key", async () => {
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    const key = `rule-${randomUUID()}`;
    const a = await buy(k, fan, pool, 60, key); // $3,000 > $2,500
    expect(a.statusCode).toBe(409);
    expect(a.json().error).toBe("regcf_limit_exceeded");
    expect(await claim(k, fan.id, key)).toMatchObject({ state: "done", status_code: 409, resource_id: null });
    const b = await buy(k, fan, pool, 60, key);
    expect(b.json()).toMatchObject({ error: "regcf_limit_exceeded" });
    expect((await buy(k, fan, pool, 61, key)).statusCode).toBe(422);
  });
});

describe("cancellation with a provider call started (L2-T-031, L2-T-043) and settlement with a counted reservation (L2-T-045)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  let pool: string;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
    pool = await livePool(k, creator);
  });
  afterAll(async () => { await k?.close(); });

  it("reserved, no call started → cancelled at once, nothing charged", async () => {
    const fan = await investor(k, { accredited: true });
    const [r] = await asService(k.sql, (tx) => tx<{ investment_id: string }[]>`select investment_id from public.reserve_investment(${fan.id}, ${pool}, 3, ${ACK}, ${new Date()})`);
    const c = await cancel(k, fan, r.investment_id);
    expect(c.json()).toMatchObject({ result: "cancelled", investment: { status: "cancelled" } });
  });

  it("reserved, call started, no trade → cancel_pending, then cancelled after the lookup (nothing charged), headroom freed", async () => {
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    k.regcf.failNext("createTrade");
    await buy(k, fan, pool, 40);
    const inv = await invOf(k, fan.id, pool);
    expect((await cancel(k, fan, inv)).json()).toMatchObject({ result: "cancel_pending", investment: { status: "reserved", canCancelUntil: null } });
    expect((await cancel(k, fan, inv)).json().result).toBe("cancel_pending"); // idempotent
    expect((await me(k, fan)).usedMinor).toBe(2_000_00);
    await tick(k, new Date(Date.now() + 60_000)); // inside the lookup grace: nothing happens yet
    expect((await invRow(k.sql, inv)).status).toBe("reserved");
    await tick(k, afterGrace());
    expect((await invRow(k.sql, inv)).status).toBe("cancelled");
    expect((await me(k, fan)).usedMinor).toBe(0);
    await tick(k);
    expect(await notes(k, fan.id, "l2_cancel_pending")).toHaveLength(1);
    expect(await notes(k, fan.id, "l2_investment_cancelled")).toHaveLength(1);
  });

  it("reserved with an unfunded trade → cancel_pending → trade voided at the provider, cancelled, no fund move ever", async () => {
    const fan = await investor(k, { accredited: true });
    k.regcf.failNext("fundTrade");
    await buy(k, fan, pool, 2);
    const inv = await invOf(k, fan.id, pool);
    expect((await cancel(k, fan, inv)).json().result).toBe("cancel_pending");
    await tick(k, afterGrace());
    expect((await invRow(k.sql, inv)).status).toBe("cancelled");
    expect(k.engine.list("trade", (t) => t.externalId === inv).map((t) => t.status)).toEqual(["cancelled"]);
    expect(await fundMovesAtMock(k, inv)).toHaveLength(0);
  });

  it("reserved with a fund move → stays counted; on settlement refund_pending (cancelled_by_investor), refunded in full", async () => {
    const fan = await investor(k, { accredited: true });
    crashAfter(k, "fundTrade");
    await buy(k, fan, pool, 2);
    const inv = await invOf(k, fan.id, pool);
    expect((await cancel(k, fan, inv)).json().result).toBe("cancel_pending");
    await tick(k, afterGrace());
    expect(await invRow(k.sql, inv)).toMatchObject({ status: "reserved" });
    expect((await invRow(k.sql, inv)).provider_fund_ref).not.toBeNull();
    await k.engine.advance(3);
    expect(await invRow(k.sql, inv)).toMatchObject({ status: "refund_pending", status_reason: "cancelled_by_investor" });
    await advance(k, 3);
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    await tick(k);
    expect(await notes(k, fan.id, "l2_investment_cancelled")).toHaveLength(1);
  });

  it("funding → cancel_pending; the fund move settles → refund_pending, refund for the received amount, never issued", async () => {
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 3);
    expect(r.json().status).toBe("funding");
    const c = await cancel(k, fan, r.json().investmentId);
    expect(c.json()).toMatchObject({ result: "cancel_pending", investment: { status: "funding" } });
    await advance(k, 3);
    await advance(k, 3);
    expect((await invRow(k.sql, r.json().investmentId)).status).toBe("refunded");
    const [op] = await asService(k.sql, (tx) => tx<{ amount_minor: bigint; idempotency_key: string }[]>`
      select amount_minor, idempotency_key from public.pool_ops where kind = 'refund' and subject_id = ${r.json().investmentId}`);
    expect({ amount: n(op.amount_minor), key: op.idempotency_key }).toEqual({ amount: 150_00, key: `refund:inv:${r.json().investmentId}` });
  });

  it("settlement: a reservation whose provider call started stays counted (not issued, not closed); the lookup then refunds it (offering_closed)", async () => {
    const big = await investor(k, { accredited: true });
    expect((await buy(k, big, pool, 200)).statusCode).toBe(201); // meets the target
    await advance(k, 3);
    const fan = await investor(k, { accredited: true });
    crashAfter(k, "fundTrade"); // fund move created; mark_investment_funding never ran
    await buy(k, fan, pool, 4);
    const inv = await invOf(k, fan.id, pool);
    const unitsBefore = (await poolRow(k.sql, pool)).units_committed;
    await tick(k, await afterDeadline(k.sql, pool));
    expect((await poolRow(k.sql, pool)).status).toBe("funded");
    expect((await invRow(k.sql, inv)).status).toBe("reserved");
    expect((await poolRow(k.sql, pool)).units_committed).toBe(unitsBefore);
    const [{ raised }] = await asService(k.sql, (tx) => tx<{ raised: bigint }[]>`select raised_minor as raised from public.pools where id = ${pool}`);
    expect(n(raised)).not.toBe(0);
    expect((await openBreaks(k.sql, pool)).filter((b) => b.kind === "counter_mismatch")).toHaveLength(0);
    // The §4.3 step (Pool no longer live) finds the fund move: refs stored; it settles unapplied (offering_closed) and is refunded.
    await tick(k, new Date(k.clock.getTime() + (POLICY.l2.expiryLookupGraceMinutes + 1) * 60_000));
    expect((await invRow(k.sql, inv)).provider_fund_ref).not.toBeNull();
    await advance(k, 3);
    expect(await invRow(k.sql, inv)).toMatchObject({ status: "refund_pending", status_reason: "offering_closed" });
    await advance(k, 3);
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    const rec = await reconcileL2Ledger(k, { poolId: pool, now: k.clock });
    expect(rec.breaks.filter((b) => b.kind === "counter_mismatch" || b.kind === "liability_mismatch" || b.kind === "escrow_diff")).toEqual([]);
  });
});
