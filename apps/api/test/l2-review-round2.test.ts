/**
 * PR #12 review round 2: the `pool_op.replay` staff action (a dead or failed pool op can be retried, flag off too, and
 * shows in the M1 staff queue), the purchase guard's fresh clock (a reservation that expires during createTrade is never
 * funded), one stored launch deadline (provider end date == Pool ends_at, also on a retried launch), and investment
 * refunds by the stored fund move for the amount actually received.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { invest } from "../src/l2/purchase";
import { launchPool } from "../src/l2/service";
import {
  ACK, advance, afterDeadline, approvedPool, ATTEST, buy, cancel, countCalls, fundMovesAtMock, investor, invRow, l2kit, livePool, poolLedger, poolRow,
  risingCreator, setFlag, tick, type L2Kit,
} from "./l2-helpers";

type Op = { id: string; status: string; attempts: number; call_started_at: Date | null; amount_minor: bigint; claim_token: string | null; lease_until: Date | null };
const opOf = async (k: L2Kit, where: { subject: string; kind: string }) =>
  (await asService(k.sql, (tx) => tx<Op[]>`
    select id, status, attempts, call_started_at, amount_minor, claim_token, lease_until from public.pool_ops where subject_id = ${where.subject} and kind = ${where.kind}`))[0];
const replay = (k: L2Kit, opId: string, reason = "Provider outage is over; retry the refund") =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-ops/${opId}/replay`, headers: { authorization: k.staff }, payload: { reason } });
const queue = async (k: L2Kit, type: string) =>
  (await k.app.inject({ method: "GET", url: `/api/v1/staff/queue?type=${type}`, headers: { authorization: k.staff } })).json().items as { type: string; id: string; summary: string }[];

describe("pool_op.replay (review round 2, finding 1)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("provider outage → the refund op dead-letters → listed in /staff/queue → replayed with the flag off → the investor is refunded", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const inv = (await buy(k, fan, pool, 2)).json().investmentId as string;
    await advance(k, 3);
    expect((await invRow(k.sql, inv)).status).toBe("funded");
    expect((await cancel(k, fan, inv)).json().result).toBe("cancelled");
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) k.regcf.failNext("refundFundMove", "retry", "provider_outage");
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) await tick(k, new Date(k.clock.getTime() + 3_601_000));
    const dead = await opOf(k, { subject: inv, kind: "refund" });
    expect(dead).toMatchObject({ status: "dead", attempts: POLICY.outbound.maxAttempts });
    expect(dead.call_started_at).not.toBeNull();
    expect(await queue(k, "pool_dead_letters")).toEqual(expect.arrayContaining([expect.objectContaining({ id: dead.id, summary: expect.stringContaining("Pool refund dead") })]));

    await setFlag(k.sql, false); // money already owed is a completion path
    const r = await replay(k, dead.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().action).toMatchObject({ status: "executed" }); // never delayed, whatever the amount
    const back = await opOf(k, { subject: inv, kind: "refund" });
    expect(back).toMatchObject({ status: "initiated", claim_token: null, lease_until: null, amount_minor: dead.amount_minor });
    expect(back.call_started_at).toEqual(dead.call_started_at);
    expect((await queue(k, "pool_dead_letters")).map((i) => i.id)).not.toContain(dead.id);
    const [audit] = await asService(k.sql, (tx) => tx<{ data: { from_status: string } }[]>`select data from public.audit_events where action = 'pool_op.replayed' and entity_id = ${dead.id}`);
    expect(audit.data.from_status).toBe("dead");

    await advance(k, 3);
    expect((await opOf(k, { subject: inv, kind: "refund" })).status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(0);
    // Replaying an op that isn't failed or dead is refused.
    const again = await replay(k, dead.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("not_replayable");
    await setFlag(k.sql, true);
  });

  it("a failed disbursement is replayed with its frozen amount and released", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    await buy(k, fan, pool, 201); // $10,050 raised
    await advance(k, 3);
    k.regcf.failNext("disburse", "permanent", "issuer_bank_rejected");
    await tick(k, await afterDeadline(k.sql, pool));
    const [t1] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.pool_tranches where pool_id = ${pool} and seq = 1`);
    const failed = await opOf(k, { subject: t1.id, kind: "disburse" });
    expect(failed).toMatchObject({ status: "failed" });
    expect(n(failed.amount_minor)).toBe(5_025_00);
    expect(failed.call_started_at).not.toBeNull();
    expect((await queue(k, "pool_dead_letters")).map((i) => i.id)).toContain(failed.id);

    const r = await replay(k, failed.id, "Issuer bank details fixed; retry the release");
    expect(r.json().action).toMatchObject({ status: "executed" });
    await advance(k, 3);
    expect((await opOf(k, { subject: t1.id, kind: "disburse" })).status).toBe("confirmed");
    const [rel] = await asService(k.sql, (tx) => tx<{ status: string; released_minor: bigint }[]>`select status::text, released_minor from public.pool_tranches where id = ${t1.id}`);
    expect({ status: rel.status, released: n(rel.released_minor) }).toEqual({ status: "released", released: 5_025_00 });
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(10_050_00 - 5_025_00);
  });
});

describe("purchase guard clock (review round 2, finding 2)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("a reservation that expires while createTrade is in flight is looked up and voided (case e), never funded", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const t0 = new Date();
    let late = false;
    const clock = () => (late ? new Date(t0.getTime() + (POLICY.l2.reserveMinutes + 1) * 60_000) : t0);
    const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const orig = target.createTrade;
    target.createTrade = async (...a: unknown[]) => {
      target.createTrade = orig;
      const r = await orig(...a);
      late = true; // the request stalled: the reservation expired before fundTrade
      return r;
    };
    const calls = countCalls(k, ["fundTrade", "findTrade", "cancelTrade"]);
    const r = await invest({ sql: k.sql, regcf: k.regcf }, fan.id, pool, `clock-${randomUUID()}`, { units: 1, riskAckVersion: ACK }, t0, clock);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "reservation_expired" });
    expect((r.body as { refundPending?: boolean }).refundPending).toBeUndefined();
    expect(calls).toEqual({ fundTrade: 0, findTrade: 1, cancelTrade: 1 });
    const [inv] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.investments where investor_id = ${fan.id} and pool_id = ${pool}`);
    expect(k.engine.list("trade", (t) => t.externalId === inv.id).map((t) => t.status)).toEqual(["cancelled"]);
    expect(await fundMovesAtMock(k, inv.id)).toHaveLength(0);
  });
});

describe("one stored launch deadline (review round 2, finding 3)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("launch days after approval: provider endDate == Pool ends_at; a retried launch replays the same deadline", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await approvedPool(k, creator);
    const d = { sql: k.sql, regcf: k.regcf };
    const first = new Date(Date.now() + 3 * 86_400_000);
    k.regcf.failNext("createCollectionAccount");
    await expect(launchPool(d, creator.id, pool, ATTEST, first)).rejects.toMatchObject({ code: "provider_unavailable" });
    const [planned] = await asService(k.sql, (tx) => tx<{ status: string; launch_ends_at: Date }[]>`select status::text, launch_ends_at from public.pools where id = ${pool}`);
    expect(planned.status).toBe("approved");
    // Planned from the first attempt's clock (+ duration as SQL adds days, DST included), not from the approval date.
    const [want] = await asService(k.sql, (tx) => tx<{ t: Date }[]>`select ${first}::timestamptz + make_interval(days => 30) as t`);
    expect(planned.launch_ends_at.getTime()).toBe(want.t.getTime());

    const retry = new Date(first.getTime() + 86_400_000); // a day later: identical provider params, same deadline
    const out = await launchPool(d, creator.id, pool, ATTEST, retry);
    const p = await poolRow(k.sql, pool);
    expect(p.status).toBe("live");
    expect(p.ends_at.getTime()).toBe(planned.launch_ends_at.getTime());
    expect(out.endsAt).toBe(p.ends_at.toISOString());
    const offers = k.engine.list("offering", (o) => o.externalId === pool);
    expect(offers).toHaveLength(1);
    expect(new Date(String(offers[0].endDate)).getTime()).toBe(p.ends_at.getTime());
  });
});

describe("refund by the stored fund move (review round 2, finding 4)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("received amount ≠ trade amount → refund_pending (amount_mismatch) → refundFundMove for the amount received → refunded", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const inv = (await buy(k, fan, pool, 2)).json().investmentId as string; // $100 trade
    const [fm] = await fundMovesAtMock(k, inv);
    k.engine.setPendingFundMoveAmount(String(fm.id), 95_00); // the bank delivers $95
    const calls = countCalls(k, ["refundTrade", "refundFundMove"]);
    await advance(k, 3);
    const mid = await invRow(k.sql, inv);
    expect({ status: mid.status, reason: mid.status_reason }).toEqual({ status: "refund_pending", reason: "amount_mismatch" });
    expect(n((await opOf(k, { subject: inv, kind: "refund" })).amount_minor)).toBe(95_00);
    await advance(k, 3);
    expect(calls).toEqual({ refundTrade: 0, refundFundMove: 1 });
    expect(k.engine.list("refund", (r) => r.fundMoveId === fm.id).map((r) => Number(r.amount))).toEqual([95_00]);
    expect((await opOf(k, { subject: inv, kind: "refund" })).status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(0);
  });
});
