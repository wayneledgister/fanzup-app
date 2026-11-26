/**
 * PR #12 review round 5 (L2 design §5 Outbound "Attempt generations"): a `pool_ops` movement the provider reports
 * failed/returned is never re-adopted by the lookup-before-call, and a retry never reuses the key (or externalId) of the
 * failed movement. The mock escrow's `failRefund` makes a pending refund fail at the bank (`regcf.refund.failed`); the
 * provider keeps listing that refund `failed`. `pool_op.replay` starts generation 1 (`<key>:r1`, externalId
 * `<op id>:r1`): exactly one new refund, the investment refunded once, the ledger posts once (keyed by the op).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { reconcileL2Ledger } from "../src/l2/service";
import { RegCfError } from "../src/regcf/types";
import { advance, buy, cancel, investor, invRow, l2kit, livePool, poolLedger, risingCreator, tick, type L2Kit } from "./l2-helpers";

type Op = { id: string; status: string; provider_ref: string | null; attempt_gen: number; idempotency_key: string; last_error: string | null;
  failed_refs: { gen: number; ref: string; status: string; via: string }[] };
const refundOp = async (k: L2Kit, inv: string) =>
  (await asService(k.sql, (tx) => tx<Op[]>`
    select id, status, provider_ref, attempt_gen, idempotency_key, last_error, failed_refs from public.pool_ops where subject_id = ${inv} and kind = 'refund'`))[0];
const replay = (k: L2Kit, opId: string, reason: string) =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-ops/${opId}/replay`, headers: { authorization: k.staff }, payload: { reason } });
const refundsPosted = async (k: L2Kit, pool: string) => n((await asService(k.sql, (tx) => tx<{ c: bigint }[]>`
  select count(*) as c from public.ledger_transactions where pool_id = ${pool} and kind = 'investment.refunded'`))[0].c);

/** Record every refund call the runner makes (its idempotency key and externalId). */
function recordRefundCalls(k: L2Kit) {
  const calls: { op: string; externalId: string; idem: string }[] = [];
  const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const op of ["refundFundMove", "refundTrade"]) {
    const orig = target[op];
    target[op] = (...a: unknown[]) => {
      calls.push({ op, externalId: (a[1] as { externalId: string }).externalId, idem: a[2] as string });
      return orig(...a);
    };
  }
  return calls;
}

/** A funded investment, cancelled: its refund op is queued. */
async function cancelledInvestment(k: L2Kit) {
  const creator = await risingCreator(k, "Established");
  const pool = await livePool(k, creator);
  const fan = await investor(k, { accredited: true });
  const inv = (await buy(k, fan, pool, 2)).json().investmentId as string;
  await advance(k, 3);
  expect((await invRow(k.sql, inv)).status).toBe("funded");
  expect((await cancel(k, fan, inv)).json().result).toBe("cancelled");
  const op = await refundOp(k, inv);
  expect(op).toMatchObject({ status: "initiated", attempt_gen: 0 });
  return { pool, inv, op };
}

/** The pending refund the provider holds for the op's generation `gen`. */
const pendingRefund = (k: L2Kit, opId: string, gen = 0) => {
  const ext = gen > 0 ? `${opId}:r${gen}` : opId;
  const [r] = k.engine.list("refund", (x) => x.externalId === ext);
  expect(r?.status).toBe("pending");
  return r;
};

/** Replay → exactly one new refund call (`<key>:r1`, externalId `<op id>:r1`) → confirmed; refunded once; posted once. */
async function replayRefundsOnce(k: L2Kit, calls: ReturnType<typeof recordRefundCalls>, x: { pool: string; inv: string; op: Op }) {
  const res = await replay(k, x.op.id, "Refund failed at the bank; send a new one");
  expect(res.statusCode, res.body).toBe(200);
  expect(await refundOp(k, x.inv)).toMatchObject({ status: "initiated", attempt_gen: 1, provider_ref: null });
  const before = calls.length;
  await advance(k, 3);
  expect(calls.slice(before)).toEqual([expect.objectContaining({ idem: `${x.op.idempotency_key}:r1`, externalId: `${x.op.id}:r1` })]);
  const done = await refundOp(k, x.inv);
  const atProvider = k.engine.list("refund", (r) => String(r.externalId).startsWith(x.op.id));
  expect(atProvider.map((r) => r.status).sort()).toEqual(["failed", "settled"]);
  const settled = atProvider.find((r) => r.status === "settled")!;
  expect(done).toMatchObject({ status: "confirmed", attempt_gen: 1, provider_ref: settled.id });
  expect(done.failed_refs).toEqual([expect.objectContaining({ gen: 0, status: "failed" })]);
  expect((await invRow(k.sql, x.inv)).status).toBe("refunded");
  expect(await refundsPosted(k, x.pool)).toBe(1);
  expect((await poolLedger(k.sql, x.pool)).pool_escrow).toBe(0);
  // Later ticks, provider time and recon change nothing.
  await advance(k, 10);
  expect(calls).toHaveLength(before + 1);
  expect(await refundsPosted(k, x.pool)).toBe(1);
  const r = await reconcileL2Ledger(k, { poolId: x.pool, now: new Date(k.clock.getTime() + (POLICY.recon.inflightGraceMinutes + 1) * 60_000) });
  expect(r.breaks).toEqual([]);
}

describe("an L2 investor refund that fails at the provider (review round 5)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("regcf.refund.failed → op failed (ref kept, never re-adopted); pool_op.replay → one new refund under `…:r1` → refunded once", async () => {
    const calls = recordRefundCalls(k);
    const x = await cancelledInvestment(k);
    await tick(k); // the runner sends the refund → `sent`
    expect(calls).toEqual([expect.objectContaining({ idem: x.op.idempotency_key, externalId: x.op.id })]);
    const rf = pendingRefund(k, x.op.id);
    expect(await refundOp(k, x.inv)).toMatchObject({ status: "sent", provider_ref: rf.id });

    k.engine.failRefund(rf.id, "R02");
    await advance(k, 3); // regcf.refund.failed delivered and processed
    const failed = await refundOp(k, x.inv);
    expect(failed).toMatchObject({ status: "failed", attempt_gen: 0, last_error: "refund failed: R02" });
    expect(failed.failed_refs).toEqual([expect.objectContaining({ gen: 0, ref: rf.id, status: "failed", via: "webhook" })]);
    expect((await invRow(k.sql, x.inv)).status).toBe("refund_pending");
    expect(await refundsPosted(k, x.pool)).toBe(0);
    // The provider keeps listing the failed refund; nothing re-adopts it or calls again by itself.
    await advance(k, 5);
    expect(calls).toHaveLength(1);
    expect((await refundOp(k, x.inv)).status).toBe("failed");
    const audit = await asService(k.sql, (tx) => tx<{ c: number }[]>`
      select count(*)::int as c from public.audit_events where action = 'pool_op.movement_failed' and entity_id = ${x.op.id}`);
    expect(audit[0].c).toBe(1);

    await replayRefundsOnce(k, calls, x);
    const [audit2] = await asService(k.sql, (tx) => tx<{ data: { attempt_gen: number } }[]>`
      select data from public.audit_events where action = 'pool_op.replayed' and entity_id = ${x.op.id}`);
    expect(audit2.data.attempt_gen).toBe(1);
  });

  it("webhook lost: recon's lookup finds the refund failed → op failed (no op_unconfirmed break); replay → refunded once", async () => {
    const calls = recordRefundCalls(k);
    const x = await cancelledInvestment(k);
    await tick(k);
    const rf = pendingRefund(k, x.op.id);
    const deliver = k.engine.deliver;
    k.engine.deliver = async () => true; // the provider's refund.failed webhook is lost
    try {
      k.engine.failRefund(rf.id);
      await k.engine.deliverWebhooks();
    } finally {
      k.engine.deliver = deliver;
    }
    await tick(k);
    expect((await refundOp(k, x.inv)).status).toBe("sent");
    const r = await reconcileL2Ledger(k, { poolId: x.pool, now: new Date(k.clock.getTime() + (POLICY.recon.inflightGraceMinutes + 1) * 60_000) });
    expect(r.breaks.filter((b) => b.kind === "op_unconfirmed")).toEqual([]);
    const failed = await refundOp(k, x.inv);
    expect(failed).toMatchObject({ status: "failed", attempt_gen: 0, last_error: "refund failed: failed" });
    expect(failed.failed_refs).toEqual([expect.objectContaining({ gen: 0, ref: rf.id, via: "recon_lookup" })]);
    await replayRefundsOnce(k, calls, x);
  });

  it("the runner's lookup finds its earlier call's refund failed (response lost): op failed, not `sent`; replay → refunded once", async () => {
    const calls = recordRefundCalls(k);
    const x = await cancelledInvestment(k);
    // The provider accepts the refund but the response is lost: the op stays `initiated` with its call started.
    const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const origs = { refundFundMove: target.refundFundMove, refundTrade: target.refundTrade };
    for (const op of ["refundFundMove", "refundTrade"] as const) {
      target[op] = async (...a: unknown[]) => {
        Object.assign(target, origs);
        await origs[op](...a);
        throw new RegCfError("retry", "network", "refund response lost (test)");
      };
    }
    await tick(k);
    Object.assign(target, origs);
    expect(await refundOp(k, x.inv)).toMatchObject({ status: "initiated", attempt_gen: 0 });
    k.engine.failRefund(pendingRefund(k, x.op.id).id);
    const deliver = k.engine.deliver;
    k.engine.deliver = async () => true; // and the failure webhook is lost too
    try {
      await k.engine.deliverWebhooks();
    } finally {
      k.engine.deliver = deliver;
    }
    await tick(k, new Date(k.clock.getTime() + 3_601_000)); // retry: lookup (generation 0) → failed → op failed, no call
    const failed = await refundOp(k, x.inv);
    expect(failed).toMatchObject({ status: "failed", attempt_gen: 0 });
    expect(failed.failed_refs).toEqual([expect.objectContaining({ gen: 0, via: "runner" })]);
    expect(calls).toHaveLength(1);
    await replayRefundsOnce(k, calls, x);
  });

  it("a crash within generation 1: lookup-before-call still prevents a second refund", async () => {
    const calls = recordRefundCalls(k);
    const x = await cancelledInvestment(k);
    await tick(k);
    k.engine.failRefund(pendingRefund(k, x.op.id).id);
    await advance(k, 3);
    expect((await refundOp(k, x.inv)).status).toBe("failed");
    expect((await replay(k, x.op.id, "Refund failed at the bank; send a new one")).statusCode).toBe(200);

    // Generation 1: the provider accepts the refund, the response is lost.
    const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const origs = { refundFundMove: target.refundFundMove, refundTrade: target.refundTrade };
    for (const op of ["refundFundMove", "refundTrade"] as const) {
      target[op] = async (...a: unknown[]) => {
        Object.assign(target, origs);
        await origs[op](...a);
        throw new RegCfError("retry", "network", "refund response lost (test)");
      };
    }
    await tick(k);
    Object.assign(target, origs);
    expect(await refundOp(k, x.inv)).toMatchObject({ status: "initiated", attempt_gen: 1 });
    expect(calls).toHaveLength(2);
    // The retry looks generation 1 up, finds the pending refund → `sent` without a call; it settles once.
    await tick(k, new Date(k.clock.getTime() + 3_601_000));
    expect(calls).toHaveLength(2);
    expect((await refundOp(k, x.inv)).status).toBe("sent");
    await advance(k, 3);
    expect((await refundOp(k, x.inv)).status).toBe("confirmed");
    expect(k.engine.list("refund", (r) => r.externalId === `${x.op.id}:r1`)).toHaveLength(1);
    expect((await invRow(k.sql, x.inv)).status).toBe("refunded");
    expect(await refundsPosted(k, x.pool)).toBe(1);
  });
});
