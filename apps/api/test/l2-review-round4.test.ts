/**
 * PR #12 review round 4, finding 1: `pool_op.replay` decides "the provider moved money for a different amount" only from
 * the op's `amount_mismatch` break (or a `last_error` starting `amount_mismatch`), never from `provider_ref` alone — a
 * `sent` op's ref is the provider's acceptance ref. Replaying a `sent` op under `op_unconfirmed` moves that ref to
 * `accepted_ref`, so a re-call that then dead-letters stays replayable and the refund is not stranded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { reconcileL2Ledger } from "../src/l2/service";
import { advance, buy, cancel, countCalls, investor, invRow, l2kit, livePool, poolLedger, risingCreator, tick, type L2Kit } from "./l2-helpers";

type Op = { id: string; status: string; provider_ref: string | null; accepted_ref: string | null; attempts: number; last_error: string | null };
const refundOp = async (k: L2Kit, inv: string) =>
  (await asService(k.sql, (tx) => tx<Op[]>`
    select id, status, provider_ref, accepted_ref, attempts, last_error from public.pool_ops where subject_id = ${inv} and kind = 'refund'`))[0];
const replay = (k: L2Kit, opId: string, reason: string) =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-ops/${opId}/replay`, headers: { authorization: k.staff }, payload: { reason } });

describe("pool_op.replay after a replayed `sent` op dead-letters (review round 4, finding 1)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("sent (ref unknown to the provider) → op_unconfirmed → replay → re-call dead-letters → replay again → refunded once", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const inv = (await buy(k, fan, pool, 2)).json().investmentId as string;
    await advance(k, 3);
    expect((await invRow(k.sql, inv)).status).toBe("funded");
    expect((await cancel(k, fan, inv)).json().result).toBe("cancelled");
    const op = await refundOp(k, inv);
    expect(op.status).toBe("initiated");

    // The provider accepted the call (acceptance ref stored by `sent()`) but has no record of the movement.
    const sentAt = new Date(k.clock.getTime() - (POLICY.recon.inflightGraceMinutes + 5) * 60_000);
    await asService(k.sql, (tx) => tx`
      update public.pool_ops set status = 'sent', provider_ref = 'RF_accepted_then_lost', sent_at = ${sentAt}, call_started_at = ${sentAt} where id = ${op.id}`);
    const r = await reconcileL2Ledger(k, { poolId: pool, now: k.clock });
    expect(r.breaks.map((b) => b.kind)).toEqual(["op_unconfirmed"]);

    const first = await replay(k, op.id, "Provider has no record of this refund; send it again");
    expect(first.statusCode, first.body).toBe(200);
    const queued = await refundOp(k, inv);
    expect({ status: queued.status, provider_ref: queued.provider_ref, accepted_ref: queued.accepted_ref })
      .toEqual({ status: "initiated", provider_ref: null, accepted_ref: "RF_accepted_then_lost" });

    // The re-call fails with a retryable error until the op dead-letters.
    const calls = countCalls(k, ["refundFundMove", "refundTrade"]);
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) k.regcf.failNext("refundFundMove", "retry", "provider_timeout");
    for (let i = 0; i < POLICY.outbound.maxAttempts && (await refundOp(k, inv)).status !== "dead"; i++) {
      await tick(k, new Date(k.clock.getTime() + 3_601_000));
    }
    const dead = await refundOp(k, inv);
    expect(dead.status).toBe("dead");
    expect(dead.provider_ref).toBeNull();
    expect(dead.last_error).not.toMatch(/^amount_mismatch/);
    expect(k.engine.list("refund", (x) => x.externalId === op.id)).toEqual([]); // nothing moved

    // Replayable again: no amount_mismatch break exists or existed for this op.
    const second = await replay(k, op.id, "Provider outage is over; retry the refund");
    expect(second.statusCode, second.body).toBe(200);
    const before = calls.refundFundMove + calls.refundTrade;
    await advance(k, 3);
    expect(calls.refundFundMove + calls.refundTrade - before).toBe(1);
    const done = await refundOp(k, inv);
    expect(done.status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    const atProvider = k.engine.list("refund", (x) => x.externalId === op.id);
    expect(atProvider).toHaveLength(1); // no double refund
    expect(done.provider_ref).toBe(atProvider[0].id);
    expect(n((await asService(k.sql, (tx) => tx<{ c: bigint }[]>`
      select count(*) as c from public.ledger_transactions where pool_id = ${pool} and kind = 'investment.refunded'`))[0].c)).toBe(1);
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(0);
    const audit = await asService(k.sql, (tx) => tx<{ data: { from_status: string } }[]>`
      select data from public.audit_events where action = 'pool_op.replayed' and entity_id = ${op.id} order by created_at`);
    expect(audit.map((a) => a.data.from_status)).toEqual(["sent", "dead"]);
  });

  it("a dead op carrying a provider_ref but no amount_mismatch break or error is replayable (provider_ref alone never blocks)", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const inv = (await buy(k, fan, pool, 2)).json().investmentId as string;
    await advance(k, 3);
    expect((await cancel(k, fan, inv)).json().result).toBe("cancelled");
    const op = await refundOp(k, inv);
    await asService(k.sql, (tx) => tx`
      update public.pool_ops set status = 'dead', provider_ref = 'RF_acceptance_only', last_error = 'retry: provider_timeout', call_started_at = now() where id = ${op.id}`);
    const res = await replay(k, op.id, "Provider outage is over; retry the refund");
    expect(res.statusCode, res.body).toBe(200);
    await advance(k, 3);
    expect((await refundOp(k, inv)).status).toBe("confirmed");
    expect((await invRow(k.sql, inv)).status).toBe("refunded");
    expect(k.engine.list("refund", (x) => x.externalId === op.id)).toHaveLength(1);
  });
});
