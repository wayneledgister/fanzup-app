/**
 * The `pool_ops` runner as M1 on main (design §5 "Outbound"; L2-T-027): claim with lease + `claim_token`, outcome
 * writes only for the current claimant, `l2_op_start_call` before the first provider call, tranches released strictly in
 * order with the last one owed the remainder, disbursement only after the offering is closed. Plus the issuer-cap
 * backstop mapped to 409 (L2-T-019) and the investment view's 227.303(d) fields (L2-T-044).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, n } from "../src/db";
import { runPoolOp, type PoolOpRow } from "../src/l2/ops";
import { executeDueActions } from "../src/staff";
import { POLICY } from "@fanzup/shared/policy";
import { advance, afterDeadline, buy, countCalls, investor, l2kit, livePool, poolLedger, poolRow, risingCreator, tick, type L2Kit } from "./l2-helpers";

describe("pool_ops runner (L2-T-027)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("a runner that outlived its lease can't call the provider or overwrite the op of the runner that re-claimed it", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 4);
    await advance(k, 3);
    // Queue a refund op (investor cancel) without letting a tick run it.
    await asService(k.sql, (tx) => tx`select public.cancel_investment(${r.json().investmentId}, ${fan.id}, ${new Date()})`);
    const t0 = new Date(k.clock.getTime() + 1000);
    const [stale] = await asService(k.sql, (tx) => tx<PoolOpRow[]>`select * from public.l2_claim_pool_ops(${t0}, 20)`);
    expect(stale.kind).toBe("refund");
    const t1 = new Date(t0.getTime() + 6 * 60_000); // lease expired
    const [fresh] = await asService(k.sql, (tx) => tx<PoolOpRow[]>`select * from public.l2_claim_pool_ops(${t1}, 20)`);
    expect(fresh.id).toBe(stale.id);
    expect(fresh.claim_token).not.toBe(stale.claim_token);
    const calls = countCalls(k, ["refundTrade"]);
    await runPoolOp(k, fresh, t1);
    const [after] = await asService(k.sql, (tx) => tx<{ status: string; provider_ref: string; claim_token: string | null }[]>`select status, provider_ref, claim_token from public.pool_ops where id = ${fresh.id}`);
    expect(after).toMatchObject({ status: "sent", claim_token: null });
    await runPoolOp(k, stale, t1); // the old claimant wakes up
    const [still] = await asService(k.sql, (tx) => tx<{ status: string; provider_ref: string }[]>`select status, provider_ref from public.pool_ops where id = ${fresh.id}`);
    expect(still).toEqual({ status: "sent", provider_ref: after.provider_ref });
    expect(calls.refundTrade).toBe(1);
    await advance(k, 3);
    expect((await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.pool_ops where id = ${fresh.id}`))[0].status).toBe("confirmed");
  });

  it("tranche 3 verified before tranche 2 is released: disbursed in order, the last one gets the remainder; never before the close is confirmed", async () => {
    const pool = await livePool(k, creator, {
      tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 30, milestone: "Mastered" }, { seq: 3, pct: 20, milestone: "Released" }],
    });
    const fan = await investor(k, { accredited: true });
    await buy(k, fan, pool, 201); // $10,050 raised
    await advance(k, 3);
    const calls = countCalls(k, ["disburseToIssuer", "closeOffering"]);
    k.regcf.failNext("closeOffering"); // the close fails once: the first disbursement must wait for it
    await tick(k, await afterDeadline(k.sql, pool));
    expect(calls).toEqual({ disburseToIssuer: 0, closeOffering: 1 });
    const [d1] = await asService(k.sql, (tx) => tx<{ status: string; last_error: string }[]>`select status, last_error from public.pool_ops where pool_id = ${pool} and kind = 'disburse'`);
    expect(d1).toEqual({ status: "initiated", last_error: "waiting: offering close" });
    await tick(k, new Date(k.clock.getTime() + 10_000));
    await advance(k, 3);
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(10_050_00 - 5_025_00);
    const ts = await asService(k.sql, (tx) => tx<{ id: string; seq: number }[]>`select id, seq from public.pool_tranches where pool_id = ${pool} order by seq`);
    for (const t of ts.slice(1)) {
      await k.app.inject({ method: "POST", url: `/api/v1/creator/pool-tranches/${t.id}/evidence`, headers: { authorization: creator.auth }, payload: { notes: `Milestone ${t.seq} evidence (test)` } });
    }
    const verify = (id: string) => k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-tranches/${id}/verify`, headers: { authorization: k.staff }, payload: { reason: "Evidence checked against the plan" } });
    expect((await verify(ts[2].id)).json().action.status).toBe("scheduled");
    await executeDueActions(k.deps, new Date(Date.now() + (POLICY.singleOperator.delayHours + 1) * 3_600_000));
    expect(await asService(k.sql, (tx) => tx`select 1 from public.pool_ops where subject_id = ${ts[2].id}`)).toHaveLength(0); // waits for tranche 2
    expect((await verify(ts[1].id)).json().action.status).toBe("scheduled");
    await executeDueActions(k.deps, new Date(Date.now() + (POLICY.singleOperator.delayHours + 2) * 3_600_000));
    await advance(k, 3); // tranche 2 released → tranche 3 queued with the remainder
    await advance(k, 3);
    const rel = await asService(k.sql, (tx) => tx<{ seq: number; released_minor: bigint }[]>`select seq, released_minor from public.pool_tranches where pool_id = ${pool} order by seq`);
    expect(rel.map((t) => n(t.released_minor))).toEqual([5_025_00, 3_015_00, 2_010_00]);
    expect((await poolLedger(k.sql, pool)).pool_escrow).toBe(0);
    expect((await poolRow(k.sql, pool)).status).toBe("funded");
  });

  it("the issuer-cap backstop answers 409 issuer_cap_reached (L2-T-019); the investment view carries the 227.303(d) fields (L2-T-044)", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const ok = await buy(k, fan, pool, 2);
    const v = await k.app.inject({ method: "GET", url: `/api/v1/investments/${ok.json().investmentId}`, headers: { authorization: fan.auth } });
    const ends = (await poolRow(k.sql, pool)).ends_at;
    expect(v.json()).toMatchObject({
      cancelBy: new Date(ends.getTime() - POLICY.l2.cancelCutoffHours * 3_600_000).toISOString(),
      issuerName: expect.stringContaining("(demo issuer)"), cancelRequestedAt: null,
    });
    await asService(k.sql, (tx) => tx`update public.pools set issuer_cap_remaining_minor = 12000 where id = ${pool}`);
    const r = await buy(k, fan, pool, 1);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("issuer_cap_reached");
  });
});
