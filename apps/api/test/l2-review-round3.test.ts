/**
 * PR #12 review round 3: every live Pool is open at least min_offering_days (a late retry re-plans the deadline and moves
 * the provider offering's end date), a `sent` pool op whose confirmation webhook never came is recovered (or flagged) by
 * recon after `recon.inflightGraceMinutes`, `pool_op.replay` refuses an op the provider already moved for a different
 * amount until its break is resolved and the runner looks the movement up before any re-call, and the periodic sweep of
 * closed Pools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POLICY } from "@fanzup/shared/policy";
import { signPayload, SIGNATURE_HEADER } from "@fanzup/mock-escrow/signing";
import { asService, n } from "../src/db";
import { launchPool, reconcileL2Ledger } from "../src/l2/service";
import { RegCfError } from "../src/regcf/types";
import {
  advance, afterDeadline, approvedPool, ATTEST, buy, cancel, countCalls, investor, invRow, l2kit, livePool, openBreaks, poolLedger, poolRow,
  risingCreator, tick, WEBHOOK_SECRET, type L2Kit,
} from "./l2-helpers";

const DAY = 86_400_000;
const MIN_DAYS = POLICY.regCf.minOfferingDays;

type Op = { id: string; status: string; provider_ref: string | null; sent_at: Date | null; call_started_at: Date | null; amount_minor: bigint; last_error: string | null };
const refundOp = async (k: L2Kit, inv: string) =>
  (await asService(k.sql, (tx) => tx<Op[]>`
    select id, status, provider_ref, sent_at, call_started_at, amount_minor, last_error from public.pool_ops where subject_id = ${inv} and kind = 'refund'`))[0];
const replay = (k: L2Kit, opId: string, reason = "Provider outage is over; retry the refund") =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-ops/${opId}/replay`, headers: { authorization: k.staff }, payload: { reason } });

/** Drop the provider's webhooks of these types (delivered as far as the provider knows; the API never sees them). */
function dropWebhooks(k: L2Kit, types: string[]) {
  const orig = k.engine.deliver!;
  const dropped: string[] = [];
  k.engine.deliver = async (body, headers, evt) => {
    if (types.includes(evt.type)) {
      dropped.push(evt.type);
      return true;
    }
    return orig(body, headers, evt);
  };
  return { dropped, restore: () => { k.engine.deliver = orig; } };
}

/** Funded $100 investment, cancelled: its refund op is queued. */
async function cancelledInvestment(k: L2Kit, pool: string) {
  const fan = await investor(k, { accredited: true });
  const inv = (await buy(k, fan, pool, 2)).json().investmentId as string;
  await advance(k, 3);
  expect((await invRow(k.sql, inv)).status).toBe("funded");
  expect((await cancel(k, fan, inv)).json().result).toBe("cancelled");
  return inv;
}

/** Record the arguments of a provider call made through the kit's adapter. */
function recordArgs(k: L2Kit, op: string) {
  const calls: unknown[][] = [];
  const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const orig = target[op];
  target[op] = (...a: unknown[]) => {
    calls.push(a);
    return orig(...a);
  };
  return calls;
}

describe("launch window ≥ min_offering_days (review round 3, finding 1)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  const d = () => ({ sql: k.sql, regcf: k.regcf });
  const plusDays = async (t: Date, days: number) =>
    (await asService(k.sql, (tx) => tx<{ t: Date }[]>`select ${t}::timestamptz + make_interval(days => ${days}) as t`))[0].t;
  const pool = async (id: string) =>
    (await asService(k.sql, (tx) => tx<{ status: string; starts_at: Date; ends_at: Date; launch_ends_at: Date | null; offering: string }[]>`
      select status::text, starts_at, ends_at, launch_ends_at, provider_offering_ref as offering from public.pools where id = ${id}`))[0];
  const offeringEnd = (poolId: string) => {
    const offers = k.engine.list("offering", (o) => o.externalId === poolId);
    expect(offers).toHaveLength(1);
    return new Date(String(offers[0].endDate)).getTime();
  };

  it("a retry inside the plan replays identical provider parameters and keeps the deadline (window still ≥ 21 days)", async () => {
    const id = await approvedPool(k, creator); // 30-day Pool
    const creates = recordArgs(k, "createOffering");
    const updates = recordArgs(k, "updateOffering");
    const first = new Date(Date.now() + 2 * DAY);
    k.regcf.failNext("createOffering");
    await expect(launchPool(d(), creator.id, id, ATTEST, first)).rejects.toMatchObject({ code: "provider_unavailable" });
    const planned = (await pool(id)).launch_ends_at!;
    expect(planned.getTime()).toBe((await plusDays(first, 30)).getTime());

    const retry = new Date(first.getTime() + 2 * DAY); // 28 days left ≥ 21: same plan
    await launchPool(d(), creator.id, id, ATTEST, retry);
    expect(creates).toHaveLength(2);
    expect(creates[1]).toEqual(creates[0]); // same body, same key `offering:<pool>`
    expect(creates[0][1]).toBe(`offering:${id}`);
    expect(updates).toHaveLength(0);
    const p = await pool(id);
    expect(p.status).toBe("live");
    expect(p.ends_at.getTime()).toBe(planned.getTime());
    expect(p.starts_at.getTime()).toBe(retry.getTime());
    expect(p.ends_at.getTime() - p.starts_at.getTime()).toBeGreaterThanOrEqual(MIN_DAYS * DAY);
    expect(offeringEnd(id)).toBe(p.ends_at.getTime());
  });

  it("a retry that would leave < 21 days re-plans: the offering's end date moves to the new deadline (keyed by it)", async () => {
    const id = await approvedPool(k, creator);
    const updates = recordArgs(k, "updateOffering");
    const first = new Date(Date.now() + 2 * DAY);
    k.regcf.failNext("createCollectionAccount"); // the offering exists at the provider with the first plan's end date
    await expect(launchPool(d(), creator.id, id, ATTEST, first)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(offeringEnd(id)).toBe((await plusDays(first, 30)).getTime());

    const retry = new Date(first.getTime() + 10 * DAY); // only 20 days of the first plan left
    const out = await launchPool(d(), creator.id, id, ATTEST, retry);
    const p = await pool(id);
    expect(p.status).toBe("live");
    expect(p.starts_at.getTime()).toBe(retry.getTime());
    expect(p.ends_at.getTime()).toBe((await plusDays(retry, 30)).getTime());
    expect(p.ends_at.getTime() - p.starts_at.getTime()).toBeGreaterThanOrEqual(MIN_DAYS * DAY);
    expect(out.endsAt).toBe(p.ends_at.toISOString());
    expect(offeringEnd(id)).toBe(p.ends_at.getTime());
    expect(updates).toHaveLength(1);
    expect(updates[0][2]).toBe(`offering_end:${id}:${p.ends_at.toISOString()}`);
    const audit = await asService(k.sql, (tx) => tx<{ action: string }[]>`
      select action from public.audit_events where entity_id = ${id} and action like 'pool.launch_%' order by created_at, action`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["pool.launch_planned", "pool.launch_replanned", "pool.launched"]));
  });

  it("a retry after the planned deadline passed relaunches with a full window; provider end date == ends_at", async () => {
    const id = await approvedPool(k, creator);
    const first = new Date(Date.now() + 2 * DAY);
    k.regcf.failNext("createCollectionAccount");
    await expect(launchPool(d(), creator.id, id, ATTEST, first)).rejects.toMatchObject({ code: "provider_unavailable" });
    const retry = new Date(first.getTime() + 31 * DAY); // the first plan is in the past
    await launchPool(d(), creator.id, id, ATTEST, retry);
    const p = await pool(id);
    expect(p.status).toBe("live");
    expect(p.ends_at.getTime() - p.starts_at.getTime()).toBeGreaterThanOrEqual(MIN_DAYS * DAY);
    expect(p.ends_at.getTime()).toBeGreaterThan(retry.getTime());
    expect(offeringEnd(id)).toBe(p.ends_at.getTime());
    expect((await poolRow(k.sql, id)).offering).toBe(k.engine.list("offering", (o) => o.externalId === id)[0].id);
  });

  it("launch_pool refuses a window shorter than min_offering_days (launch_window_too_short)", async () => {
    const id = await approvedPool(k, creator);
    const t0 = new Date(Date.now() + DAY);
    const [plan] = await asService(k.sql, (tx) => tx<{ ends: Date }[]>`select public.l2_plan_launch(${id}, ${creator.id}, ${t0}) as ends`);
    const late = new Date(t0.getTime() + 10 * DAY);
    await expect(asService(k.sql, (tx) => tx`
      select public.launch_pool(${id}, ${creator.id}, 'iss_x', 'off_x', 'ca_x', 'Test LLC', 0, ${late}, ${plan.ends})`))
      .rejects.toMatchObject({ message: "launch_window_too_short" });
    expect((await pool(id)).status).toBe("approved");
  });
});

describe("lost confirmation webhook → recon recovers or flags it (review round 3, finding 2)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("in flight inside recon.inflightGraceMinutes; after it, looked up at the provider and confirmed through the SQL path", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const inv = await cancelledInvestment(k, pool);
    const drop = dropWebhooks(k, ["refund.settled"]);
    await advance(k, 3); // op → sent; the provider settles the refund; its webhook is lost
    drop.restore();
    expect(drop.dropped).toEqual(["refund.settled"]);
    const op = await refundOp(k, inv);
    expect(op.status).toBe("sent");
    expect(op.sent_at).not.toBeNull();
    expect(k.engine.list("refund", (r) => r.externalId === op.id).map((r) => r.status)).toEqual(["settled"]);

    const inside = await reconcileL2Ledger(k, { now: new Date(op.sent_at!.getTime() + 60_000) });
    expect(inside.inFlight.map((x) => x.ref)).toContain(op.provider_ref);
    expect(inside.recovered).toEqual([]);
    expect(inside.breaks.filter((b) => b.poolId === pool)).toEqual([]);
    expect((await refundOp(k, inv)).status).toBe("sent");

    const after = await reconcileL2Ledger(k, { now: new Date(op.sent_at!.getTime() + (POLICY.recon.inflightGraceMinutes + 1) * 60_000) });
    expect(after.recovered).toEqual([{ poolId: pool, opId: op.id, ref: op.provider_ref }]);
    expect((await refundOp(k, inv)).status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect(after.breaks.filter((b) => b.poolId === pool)).toEqual([]);
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(0);
  });

  it("a `sent` op the provider has no record of: op_unconfirmed break (non-pausing); refund_overdue counts it once overdue", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const inv = await cancelledInvestment(k, pool);
    const op = await refundOp(k, inv);
    expect(op.status).toBe("initiated");
    // The provider accepted nothing we can find (its object was lost): the op says `sent` with a ref the provider lacks.
    const sentAt = new Date(k.clock.getTime() - (POLICY.recon.inflightGraceMinutes + 5) * 60_000);
    await asService(k.sql, (tx) => tx`update public.pool_ops set status = 'sent', provider_ref = 'RF_lost_by_provider', sent_at = ${sentAt}, call_started_at = ${sentAt} where id = ${op.id}`);
    const r = await reconcileL2Ledger(k, { now: k.clock });
    const mine = r.breaks.filter((b) => b.poolId === pool);
    expect(mine.map((b) => b.kind)).toEqual(["op_unconfirmed"]);
    expect(mine[0]).toMatchObject({ dedupeKey: `op_unconfirmed:${op.id}`, amountMinor: 100_00, refs: { provider_status: "not_found", provider_ref: "RF_lost_by_provider" } });
    expect((await refundOp(k, inv)).status).toBe("sent");

    const overdue = await reconcileL2Ledger(k, { now: new Date(k.clock.getTime() + 14 * DAY) });
    expect(overdue.breaks.filter((b) => b.poolId === pool).map((b) => b.kind).sort()).toEqual(["op_unconfirmed", "refund_overdue"]);
    expect(overdue.breaks.find((b) => b.kind === "refund_overdue" && b.poolId === pool)?.refs).toMatchObject({ op_id: op.id, status: "sent" });
  });
});

describe("pool_op.replay after an amount mismatch; lookup before any re-call (review round 3, finding 3)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("a confirmation for a different amount → replay refused replay_requires_resolution → break resolved → replay looks up, never re-calls", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const inv = await cancelledInvestment(k, pool);
    // The provider's confirmation arrives for $90 (the op is $100): confirmOp fails the op and opens amount_mismatch.
    const orig = k.engine.deliver!;
    k.engine.deliver = async (body, headers, evt) => {
      if (evt.type !== "refund.settled") return orig(body, headers, evt);
      const forged = JSON.stringify({ ...evt, id: `${evt.id}_forged`, data: { ...evt.data, amount: 90_00 } });
      await k.app.inject({ method: "POST", url: "/api/v1/webhooks/regcf", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(WEBHOOK_SECRET, forged) }, payload: forged });
      return true; // the genuine delivery is lost
    };
    await advance(k, 3);
    k.engine.deliver = orig;
    const failed = await refundOp(k, inv);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.provider_ref).not.toBeNull();
    expect(failed.last_error).toMatch(/^amount_mismatch/);
    expect((await openBreaks(k.sql, pool)).map((b) => b.dedupe_key)).toContain(`amount_mismatch:${failed.id}`);

    const refused = await replay(k, failed.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("replay_requires_resolution");
    expect((await refundOp(k, inv)).status).toBe("failed");

    // Staff resolve the break (the provider's own record shows the full $100 moved); replay is then allowed.
    await asService(k.sql, (tx) => tx`update public.pool_breaks set resolved_at = now(), resolution = 'test: provider record shows the full amount' where dedupe_key = ${"amount_mismatch:" + failed.id} and resolved_at is null`);
    const calls = countCalls(k, ["refundFundMove", "refundTrade", "listTransactions"]);
    const ok = await replay(k, failed.id, "Provider record shows the full refund; confirm it");
    expect(ok.statusCode, ok.body).toBe(200);
    await tick(k);
    expect(calls.refundFundMove + calls.refundTrade).toBe(0); // looked up, not re-called
    expect(calls.listTransactions).toBeGreaterThan(0);
    expect((await refundOp(k, inv)).status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(0);
  });

  it("a retry after a lost response finds the provider's refund and confirms it without calling again", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const inv = await cancelledInvestment(k, pool);
    const drop = dropWebhooks(k, ["refund.settled"]);
    const calls = countCalls(k, ["refundFundMove"]);
    const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const counted = target.refundFundMove;
    target.refundFundMove = async (...a: unknown[]) => {
      target.refundFundMove = counted;
      await counted(...a); // the provider acts …
      throw new RegCfError("retry", "network", "refund response lost (test)"); // … the response never arrives
    };
    await tick(k);
    expect((await refundOp(k, inv)).status).toBe("initiated");
    await k.engine.advance(3); // the refund settles at the provider; its webhook is lost
    await tick(k, new Date(k.clock.getTime() + 3_601_000)); // the retry looks it up first
    drop.restore();
    expect(calls.refundFundMove).toBe(1);
    expect((await refundOp(k, inv)).status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
  });

  it("a dead op whose last call landed at the provider late: the replay finds the settled refund and confirms it without a call", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const inv = await cancelledInvestment(k, pool);
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) k.regcf.failNext("refundFundMove", "retry", "provider_timeout");
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) await tick(k, new Date(k.clock.getTime() + 3_601_000));
    const dead = await refundOp(k, inv);
    expect(dead.status).toBe("dead");
    expect(dead.call_started_at).not.toBeNull();
    // The provider processed the timed-out call after all (same key, same externalId) and settled it; no webhook reached us.
    const drop = dropWebhooks(k, ["refund.settled"]);
    const { provider_fund_ref: fund } = await invRow(k.sql, inv);
    const [{ key }] = await asService(k.sql, (tx) => tx<{ key: string }[]>`select idempotency_key as key from public.pool_ops where id = ${dead.id}`);
    k.engine.refundFundMove(fund!, { amount: n(dead.amount_minor), externalId: dead.id }, key);
    await k.engine.advance(3);
    const atProvider = k.engine.list("refund", (r) => r.externalId === dead.id);
    expect(atProvider.map((r) => r.status)).toEqual(["settled"]);

    const calls = countCalls(k, ["refundFundMove", "refundTrade"]);
    expect((await replay(k, dead.id)).statusCode).toBe(200);
    await tick(k);
    drop.restore();
    expect(calls).toEqual({ refundFundMove: 0, refundTrade: 0 });
    const done = await refundOp(k, inv);
    expect({ status: done.status, ref: done.provider_ref }).toEqual({ status: "confirmed", ref: atProvider[0].id });
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect(n((await asService(k.sql, (tx) => tx<{ c: bigint }[]>`
      select count(*) as c from public.ledger_transactions where pool_id = ${pool} and kind = 'investment.refunded'`))[0].c)).toBe(1);
  });
});

describe("periodic sweep of closed Pools (review round 3, finding 4)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("a refunded Pool is skipped per tick but swept every recon.closedPoolSweepHours; a provider-only movement on it is found", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    await tick(k, await afterDeadline(k.sql, pool)); // no investments: the Pool fails and closes with nothing open
    await advance(k, 3);
    expect(["refunded", "withdrawn"]).toContain((await poolRow(k.sql, pool)).status);
    const t0 = new Date(Date.now() + 60 * DAY);
    const first = await reconcileL2Ledger(k, { now: t0 });
    expect(first.sweptClosed).toBe(true);
    expect(first.pools.map((p) => p.poolId)).toContain(pool);
    expect(first.breaks.filter((b) => b.poolId === pool)).toEqual([]);

    // Money lands in its collection account and our side never hears of it.
    const drop = dropWebhooks(k, ["deposit.settled"]);
    await k.regcf.simulateDeposit!((await poolRow(k.sql, pool)).collection, { amount: 12_00, reference: "stray", externalId: "dep-closed" }, `deposit:closed:${pool}`);
    await k.engine.advance(3);
    drop.restore();

    const hourLater = await reconcileL2Ledger(k, { now: new Date(t0.getTime() + 3_600_000) });
    expect(hourLater.sweptClosed).toBe(false);
    expect(hourLater.pools.map((p) => p.poolId)).not.toContain(pool);

    const nextDay = await reconcileL2Ledger(k, { now: new Date(t0.getTime() + POLICY.recon.closedPoolSweepHours * 3_600_000) });
    expect(nextDay.sweptClosed).toBe(true);
    expect(nextDay.breaks.filter((b) => b.poolId === pool).map((b) => b.kind).sort()).toEqual(["collection_diff", "unmatched_provider_txn"]);
  });
});
