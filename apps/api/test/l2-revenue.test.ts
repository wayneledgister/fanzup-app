/**
 * Royalty ingestion and the Waterfall: collected-only reconciliation (01b AC-R1…R4, R8), statements on expected period
 * windows (SELF_REPORTED; L2-T-035), deterministic/idempotent distribution runs (01a AC-W1…W4, W6), a committed run equals
 * allocateWaterfall() (L2-T-024), stale dry-runs refused at request time, payouts through the provider, 1099 data rows,
 * cap → matured, maturity by date and final runs (L2-T-034), default states and REMEDIATION → COLLECTING (L2-T-022),
 * the mock deposit trigger as a staff action (L2-T-040).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allocateWaterfall } from "@fanzup/shared/l2";
import { asService, n } from "../src/db";
import { commitDistribution, computeDistribution, reconcileL2Ledger } from "../src/l2/service";
import { advance, afterDeadline, buy, investor, l2kit, livePool, openBreaks, poolLedger, poolRow, risingCreator, STAFF_ID, tick, type L2Kit } from "./l2-helpers";

async function fundedPool(k: L2Kit, creator: { auth: string }, holdings: number[], over: Record<string, unknown> = {}) {
  const pool = await livePool(k, creator, over);
  const fans = [];
  for (const units of holdings) {
    const f = await investor(k, { accredited: true });
    const r = await buy(k, f, pool, units);
    if (r.statusCode !== 201) throw new Error(r.body);
    fans.push({ ...f, investmentId: r.json().investmentId as string, units });
  }
  await advance(k, 3);
  await tick(k, await afterDeadline(k.sql, pool));
  await advance(k, 3);
  if ((await poolRow(k.sql, pool)).status !== "funded") throw new Error("pool did not fund");
  return { pool, fans };
}

const periods = async (k: L2Kit, creator: { auth: string }, pool: string) =>
  (await k.app.inject({ method: "GET", url: `/api/v1/creator/pools/${pool}/periods`, headers: { authorization: creator.auth } })).json().periods as { seq: number; periodStart: string; periodEnd: string; dueAt: string }[];
async function statement(k: L2Kit, creator: { auth: string }, pool: string, seq: number, label: string, master: number, publishing = 0) {
  const w = (await periods(k, creator, pool)).find((x) => x.seq === seq)!;
  return k.app.inject({
    method: "POST", url: `/api/v1/creator/pools/${pool}/statements`, headers: { authorization: creator.auth },
    payload: { periodLabel: label, periodStart: w.periodStart, periodEnd: w.periodEnd, lines: [{ revenueType: "master", source: "Mock Distributor", amountMinor: master }, ...(publishing ? [{ revenueType: "publishing", source: "Mock PRO", amountMinor: publishing }] : [])] },
  });
}
const deposit = (k: L2Kit, pool: string, amountMinor: number, reference: string) =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/deposits`, headers: { authorization: k.staff }, payload: { amountMinor, reference } });
const recon = (k: L2Kit, pool: string) => k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/recon`, headers: { authorization: k.staff } });
const unallocated = async (k: L2Kit, pool: string) => 0 - ((await poolLedger(k.sql, pool)).pool_revenue_unallocated ?? 0);
const txCount = async (k: L2Kit, pool: string) => (await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.ledger_transactions where pool_id = ${pool}`))[0].c;
const commit = (k: L2Kit, pool: string, label: string, hash: string, reason = "Statement reconciled to the lockbox") =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/commit`, headers: { authorization: k.staff }, payload: { label, hash, reason } });

describe("Royalty ingestion → Waterfall", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  let pool: string;
  let fans: Awaited<ReturnType<typeof fundedPool>>["fans"];
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
    ({ pool, fans } = await fundedPool(k, creator, [40, 100, 60]));
  });
  afterAll(async () => { await k?.close(); });

  it("statements are SELF_REPORTED and must name one expected period window (L2-T-035, design §6)", async () => {
    const bad = await k.app.inject({
      method: "POST", url: `/api/v1/creator/pools/${pool}/statements`, headers: { authorization: creator.auth },
      payload: { periodLabel: "Odd window", periodStart: "2027-01-01", periodEnd: "2027-03-31", lines: [{ revenueType: "master", source: "Mock Distributor", amountMinor: 1 }] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("period_not_expected");
    const ws = await periods(k, creator, pool);
    expect(ws.length).toBe(20); // 60 months of quarters
    expect(ws[0].periodStart).toBe((await poolRow(k.sql, pool)).closed_at!.toISOString().slice(0, 10));
  });

  it("AC-R1/R2/R3: cash without a statement and a statement without cash are both 'not collected'", async () => {
    expect((await deposit(k, pool, 12_345, "Q9 2026")).json().action.status).toBe("executed");
    await advance(k, 2);
    const s = await statement(k, creator, pool, 1, "Q1", 90_001, 50_000);
    expect(s.statusCode, s.body).toBe(201);
    expect(s.json()).toMatchObject({ coveredMinor: 90_001, grossMinor: 140_001, verification: "SELF_REPORTED" });
    await recon(k, pool);
    expect(await unallocated(k, pool)).toBe(0);
    const led = await poolLedger(k.sql, pool);
    expect(led.pool_collection).toBe(12_345); // the cash is mirrored…
    expect(0 - led.pool_revenue_suspense).toBe(12_345); // …but sits in suspense, not distributable
    const dry = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/dry-run`, headers: { authorization: k.staff }, payload: { label: "Q1" } });
    expect(dry.json().allocation.runTotalMinor).toBe(0);
  });

  it("matching cash makes a statement collected; reconciliation is idempotent (AC-R8)", async () => {
    await deposit(k, pool, 90_001, "Q1");
    await advance(k, 2);
    const r1 = await recon(k, pool);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(await unallocated(k, pool)).toBe(90_001);
    const before = await txCount(k, pool);
    await recon(k, pool);
    await tick(k);
    expect(await txCount(k, pool)).toBe(before);
    expect(await unallocated(k, pool)).toBe(90_001);
  });

  it("a stale dry-run is refused at request time with 409 run_stale, before any staff action is recorded", async () => {
    const run = await computeDistribution(k.sql, pool, "Q1");
    const stale = run.hash.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    const before = (await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.privileged_actions where action = 'pool.distribution_commit'`))[0].c;
    const r = await commit(k, pool, "Q1", stale);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("run_stale");
    const after = (await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.privileged_actions where action = 'pool.distribution_commit'`))[0].c;
    expect(after).toBe(before);
  });

  it("AC-W1/W4 + L2-T-024: dry-run is deterministic; the committed run equals allocateWaterfall() of the same inputs", async () => {
    const a = await computeDistribution(k.sql, pool, "Q1");
    const b = await computeDistribution(k.sql, pool, "Q1");
    expect(b.hash).toBe(a.hash);
    // fans 30% of 90,001 = 27,000 split 40:100:60; platform 5% = 4,500; creator the rest
    expect(a.allocation.payouts.map((p) => p.amountMinor).sort((x, y) => x - y)).toEqual([5_400, 8_100, 13_500]);
    expect(a.allocation.platformMinor).toBe(4_500);
    expect(a.allocation.creatorMinor).toBe(58_501);

    // Independent computation from the database state, through the shared pure function.
    const holdings = await asService(k.sql, (tx) => tx<{ id: string; units: number; cap: bigint; dist: bigint }[]>`
      select id, units, cap_minor as cap, distributed_minor as dist from public.investments where pool_id = ${pool} and status = 'issued'`);
    const expected = allocateWaterfall({ collectedMinor: 90_001, fansBps: 3000, creatorBps: 6500, platformBps: 500,
      holdings: holdings.map((h) => ({ investmentId: h.id, units: h.units, capRemainingMinor: n(h.cap) - n(h.dist) })) });

    const c = await commit(k, pool, "Q1", a.hash);
    expect(c.json().action.status, c.body).toBe("executed");
    const [run] = await asService(k.sql, (tx) => tx<{ id: string; run_total_minor: bigint; fans_minor: bigint; creator_minor: bigint; platform_minor: bigint; cap_overflow_minor: bigint; input_hash: string }[]>`
      select id, run_total_minor, fans_minor, creator_minor, platform_minor, cap_overflow_minor, input_hash from public.distribution_runs where pool_id = ${pool} and label = 'Q1'`);
    expect(run.input_hash).toBe(a.hash);
    expect({ total: n(run.run_total_minor), fans: n(run.fans_minor), creator: n(run.creator_minor), platform: n(run.platform_minor), overflow: n(run.cap_overflow_minor) })
      .toEqual({ total: 90_001, fans: expected.payouts.reduce((s, p) => s + p.amountMinor, 0), creator: expected.creatorMinor, platform: expected.platformMinor, overflow: expected.capOverflowMinor });
    const payouts = await asService(k.sql, (tx) => tx<{ investment_id: string; amount_minor: bigint }[]>`
      select investment_id, amount_minor from public.distribution_payouts where run_id = ${run.id} and kind = 'investor' order by investment_id`);
    expect(payouts.map((p) => ({ investmentId: p.investment_id, amountMinor: n(p.amount_minor) })))
      .toEqual(expected.payouts.map((p) => ({ investmentId: p.investmentId, amountMinor: p.amountMinor })).sort((x, y) => (x.investmentId < y.investmentId ? -1 : 1)));
    const led = await poolLedger(k.sql, pool);
    expect(await unallocated(k, pool)).toBe(0);
    expect(0 - led.pool_distributions_payable).toBe(27_000);
  });

  it("AC-W6: committing the same run again moves nothing", async () => {
    const before = await txCount(k, pool);
    const [run] = await asService(k.sql, (tx) => tx<{ id: string; input_hash: string }[]>`select id, input_hash from public.distribution_runs where pool_id = ${pool}`);
    const again = await commitDistribution(k.sql, pool, "Q1", run.input_hash, STAFF_ID);
    expect(again).toMatchObject({ runId: run.id, replayed: true });
    expect((await commit(k, pool, "Q1", run.input_hash)).json()).toMatchObject({ runId: run.id, replayed: true });
    const [{ c }] = await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.distribution_runs where pool_id = ${pool}`);
    expect(c).toBe(1);
    expect(await txCount(k, pool)).toBe(before);
  });

  it("payouts settle through the provider; the collection mirror reconciles; 1099-DIV rows and the portfolio agree", async () => {
    await advance(k, 3);
    const led = await poolLedger(k.sql, pool);
    expect(led.pool_distributions_payable).toBe(0);
    expect(led.pool_collection).toBe(12_345); // only the unmatched Q9 cash is left
    expect((await reconcileL2Ledger(k, { poolId: pool, now: k.clock })).diffMinor).toBe(0);
    const rows = await asService(k.sql, (tx) => tx<{ form: string; box: string; amount: bigint }[]>`select form, box, amount_minor as amount from public.tax_1099_rows where pool_id = ${pool}`);
    expect(rows.every((r) => r.form === "1099-DIV" && r.box === "1a")).toBe(true);
    expect(rows.reduce((s, r) => s + n(r.amount), 0)).toBe(27_000);
    const pf = await k.app.inject({ method: "GET", url: "/api/v1/portfolio", headers: { authorization: fans[1].auth } });
    const h = pf.json().investments[0];
    expect(h).toMatchObject({ status: "issued", units: 100, receivedMinor: 13_500, capMinor: 7_500_00 });
    expect(h.payouts[0]).toMatchObject({ label: "Q1", amountMinor: 13_500, status: "paid", taxForm: "1099-DIV" });
  });

  it("AC-R4: short cash is collected at the cash amount with a shortfall break; topping up cures it", async () => {
    await statement(k, creator, pool, 2, "Q2", 50_000);
    await deposit(k, pool, 30_000, "Q2");
    await advance(k, 2);
    await recon(k, pool);
    expect(await unallocated(k, pool)).toBe(30_000);
    const [br] = await asService(k.sql, (tx) => tx<{ amount: bigint }[]>`select amount_minor as amount from public.pool_breaks where pool_id = ${pool} and kind = 'revenue_shortfall' and resolved_at is null`);
    expect(n(br.amount)).toBe(20_000);
    await deposit(k, pool, 20_000, "Q2");
    await advance(k, 2);
    await recon(k, pool);
    expect(await unallocated(k, pool)).toBe(50_000);
    expect((await openBreaks(k.sql, pool)).filter((b) => b.kind === "revenue_shortfall")).toHaveLength(0);
  });

  it("L2-T-040: the deposit trigger is a staff action keyed deposit:<action id> — identical figures make two deposits", async () => {
    const a = await deposit(k, pool, 777, "same-ref");
    const b = await deposit(k, pool, 777, "same-ref");
    expect(a.json().action.id).not.toBe(b.json().action.id);
    expect(a.json().depositId).not.toBe(b.json().depositId);
    // A retried action (the same key) makes one deposit.
    const again = await k.regcf.simulateDeposit!((await poolRow(k.sql, pool)).collection, { amount: 777, reference: "same-ref", externalId: pool }, `deposit:${a.json().action.id}`);
    expect(again.id).toBe(a.json().depositId);
    expect(k.engine.list("deposit", (d) => d.reference === "same-ref")).toHaveLength(2);
    await advance(k, 2);
    await recon(k, pool);
  });

  it("AC-W3: a run computed before new cash was collected can't be committed", async () => {
    const stale = await computeDistribution(k.sql, pool, "Q2");
    await statement(k, creator, pool, 3, "Q3", 10_000);
    await deposit(k, pool, 10_000, "Q3");
    await advance(k, 2);
    await recon(k, pool);
    const c = await commit(k, pool, "Q2", stale.hash, "Committing the stale dry-run");
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toBe("run_stale");
  });

  it("the database refuses allocations that don't conserve, break the split, or pass a cap", async () => {
    const run = await computeDistribution(k.sql, pool, "Q2+Q3");
    const bad = (alloc: object) => asService(k.sql, (tx) => tx`select public.commit_distribution_run(${pool}, 'tamper', ${run.hash}, ${tx.json(alloc as never)}, ${STAFF_ID}, ${new Date()})`);
    await expect(bad({ ...run.allocation, creatorMinor: run.allocation.creatorMinor + 1 })).rejects.toThrow("run_not_conserved");
    await expect(bad({ ...run.allocation, platformMinor: run.allocation.platformMinor + 1, creatorMinor: run.allocation.creatorMinor - 1 })).rejects.toThrow("run_split_mismatch");
    const p0 = run.allocation.payouts[0];
    await expect(bad({ ...run.allocation, runTotalMinor: run.allocation.runTotalMinor + 1 })).rejects.toThrow("run_stale");
    const over = { ...run.allocation, payouts: [{ investmentId: p0.investmentId, amountMinor: 10_000_00 }], creatorMinor: run.allocation.runTotalMinor - run.allocation.platformMinor - 10_000_00 };
    await expect(bad(over)).rejects.toThrow(/run_over_cap|run_split_mismatch|run_not_conserved/);
  });
});

describe("Return cap, maturity and default handling", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("AC-W2: payouts stop at the cap, the excess goes to the creator, and the Pool matures (cap reached)", async () => {
    const { pool } = await fundedPool(k, creator, [10, 10], { unitsTotal: 20, useOfFunds: [{ label: "Studio", amountMinor: 1_000_00 }], returnCapBps: 10_000, fansBps: 9_000 });
    await statement(k, creator, pool, 1, "Q1", 3_000_00);
    await deposit(k, pool, 3_000_00, "Q1");
    await advance(k, 2);
    await recon(k, pool);
    const run = await computeDistribution(k.sql, pool, "Q1");
    expect(run.allCapped).toBe(true);
    expect(run.allocation.payouts.map((p) => p.amountMinor)).toEqual([500_00, 500_00]); // 1.0× of $500 each
    expect(run.allocation.capOverflowMinor).toBe(2_700_00 - 1_000_00);
    await commitDistribution(k.sql, pool, "Q1", run.hash, STAFF_ID);
    const [p] = await asService(k.sql, (tx) => tx<{ status: string; reason: string }[]>`select status::text, matured_reason as reason from public.pools where id = ${pool}`);
    expect(p).toEqual({ status: "matured", reason: "cap_reached" });
  });

  it("L2-T-034: the worker matures a Pool at matures_at; late cash for the last period is distributed by a final run; later periods are refused", async () => {
    const { pool } = await fundedPool(k, creator, [100, 100], { maturityMonths: 12 });
    const { matures_at } = await poolRow(k.sql, pool);
    const ws = await periods(k, creator, pool);
    expect(ws).toHaveLength(4);
    expect(ws[3].periodEnd).toBe(new Date(matures_at!.getTime() - 86_400_000).toISOString().slice(0, 10));
    await tick(k, new Date(matures_at!.getTime() + 60_000));
    expect((await poolRow(k.sql, pool)).status).toBe("matured");
    // The last window's statement is still accepted on a matured Pool and its cash is distributed by a final run.
    expect((await statement(k, creator, pool, 4, "Q4", 40_000)).statusCode).toBe(201);
    await deposit(k, pool, 40_000, "Q4");
    await advance(k, 2);
    await recon(k, pool);
    const run = await computeDistribution(k.sql, pool, "Final");
    expect(run.poolStatus).toBe("matured");
    expect((await commit(k, pool, "Final", run.hash, "Final run after maturity")).json().action.status).toBe("executed");
    expect(await unallocated(k, pool)).toBe(0);
    const late = await k.app.inject({
      method: "POST", url: `/api/v1/creator/pools/${pool}/statements`, headers: { authorization: creator.auth },
      payload: { periodLabel: "After", periodStart: matures_at!.toISOString().slice(0, 10), periodEnd: new Date(matures_at!.getTime() + 80 * 86_400_000).toISOString().slice(0, 10), lines: [{ revenueType: "master", source: "x", amountMinor: 1 }] },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe("pool_matured");
  });

  it("01b §5 + L2-T-022: a missed period → AT_RISK → DEFAULT; staff → REMEDIATION; → COLLECTING refused not_cured until the cash reconciles", async () => {
    const { pool, fans } = await fundedPool(k, creator, [100, 100]);
    // Move the Pool's close 200 days into the past so the first quarter is past due at real time (staff actions run now).
    await asService(k.sql, (tx) => tx`update public.pools set closed_at = closed_at - interval '200 days', matures_at = matures_at - interval '200 days',
                                         collection_state_since = collection_state_since - interval '200 days' where id = ${pool}`);
    k.clock = new Date();
    await tick(k);
    expect((await poolRow(k.sql, pool)).collection_state).toBe("AT_RISK");
    await tick(k, new Date(Date.now() + 31 * 86_400_000));
    expect((await poolRow(k.sql, pool)).collection_state).toBe("DEFAULT");
    await tick(k); // notices are drained from the outbox on the next tick
    const notes = await asService(k.sql, (tx) => tx<{ user_id: string }[]>`select user_id from public.notifications where template = 'l2_collection_state'`);
    expect(notes.map((x) => x.user_id)).toEqual(expect.arrayContaining([fans[0].id, fans[1].id]));
    const state = (to: string, reason: string) => k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/collection-state`, headers: { authorization: k.staff }, payload: { to, reason } });
    expect((await state("COLLECTING", "Skipping remediation is not allowed")).json().error).toBe("illegal_collection_transition");
    expect((await state("REMEDIATION", "Artist agreed a catch-up plan")).json().action.status).toBe("executed");
    const early = await state("COLLECTING", "Trying to cure before the cash arrives");
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("not_cured");
    expect((await statement(k, creator, pool, 1, "P1", 40_000)).statusCode).toBe(201);
    await deposit(k, pool, 40_000, "P1");
    await k.engine.advance(2);
    await recon(k, pool);
    expect((await poolRow(k.sql, pool)).collection_state).toBe("REMEDIATION"); // recon never leaves REMEDIATION by itself
    expect((await state("COLLECTING", "Missed quarter paid in full")).json().action.status).toBe("executed");
    expect((await poolRow(k.sql, pool)).collection_state).toBe("COLLECTING");
  });
});
