/**
 * Royalty ingestion and the Waterfall: collected-only reconciliation (01b AC-R1…R4, R8), deterministic/idempotent
 * distribution runs (01a AC-W1…W4, W6), payouts through the provider, 1099 data rows, cap → matured, default states.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, n } from "../src/db";
import { commitDistribution, computeDistribution, reconcileL2Ledger } from "../src/l2/service";
import { tick } from "./helpers";
import { advance, afterDeadline, buy, investor, l2kit, livePool, poolLedger, poolRow, risingCreator, type L2Kit } from "./l2-helpers";

const STAFF_ID = "b40e0a39-c7ef-5798-91f3-504e09b530f4";

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

const statement = (k: L2Kit, creator: { auth: string }, pool: string, label: string, master: number, publishing = 0) =>
  k.app.inject({
    method: "POST", url: `/api/v1/creator/pools/${pool}/statements`, headers: { authorization: creator.auth },
    payload: { periodLabel: label, periodStart: "2027-01-01", periodEnd: "2027-03-31", lines: [{ revenueType: "master", source: "Mock Distributor", amountMinor: master }, ...(publishing ? [{ revenueType: "publishing", source: "Mock PRO", amountMinor: publishing }] : [])] },
  });
const deposit = (k: L2Kit, pool: string, amountMinor: number, reference: string) =>
  k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/deposits`, headers: { authorization: k.staff }, payload: { amountMinor, reference } });
const recon = (k: L2Kit, pool: string) => k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/recon`, headers: { authorization: k.staff } });
const unallocated = async (k: L2Kit, pool: string) => 0 - ((await poolLedger(k.sql, pool)).pool_revenue_unallocated ?? 0);
const txCount = async (k: L2Kit, pool: string) => (await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.ledger_transactions where pool_id = ${pool}`))[0].c;

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

  it("AC-R1/R2/R3: cash without a statement and a statement without cash are both 'not collected'", async () => {
    expect((await deposit(k, pool, 12_345, "Q9 2026")).statusCode).toBe(200);
    await advance(k, 2);
    const s = await statement(k, creator, pool, "Q1 2027", 90_001, 50_000);
    expect(s.statusCode, s.body).toBe(201);
    expect(s.json()).toMatchObject({ coveredMinor: 90_001, grossMinor: 140_001, verification: "API_VERIFIED" });
    await recon(k, pool);
    expect(await unallocated(k, pool)).toBe(0);
    const led = await poolLedger(k.sql, pool);
    expect(led.pool_collection).toBe(12_345); // the cash is mirrored…
    expect(0 - led.pool_revenue_suspense).toBe(12_345); // …but sits in suspense, not distributable
    const dry = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/dry-run`, headers: { authorization: k.staff }, payload: { label: "Q1 2027" } });
    expect(dry.json().allocation.runTotalMinor).toBe(0);
  });

  it("matching cash makes a statement collected; reconciliation is idempotent (AC-R8)", async () => {
    await deposit(k, pool, 90_001, "Q1 2027");
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

  it("AC-W1/W4: dry-run is deterministic and conserves every cent; commit allocates exactly that", async () => {
    const a = await computeDistribution(k.sql, pool, "Q1 2027");
    const b = await computeDistribution(k.sql, pool, "Q1 2027");
    expect(b.hash).toBe(a.hash);
    // fans 30% of 90,001 = 27,000 split 40:100:60; platform 5% = 4,500; creator the rest
    expect(a.allocation.payouts.map((p) => p.amountMinor).sort((x, y) => x - y)).toEqual([5_400, 8_100, 13_500]);
    expect(a.allocation.platformMinor).toBe(4_500);
    expect(a.allocation.creatorMinor).toBe(58_501);
    expect(a.allocation.payouts.reduce((s, p) => s + p.amountMinor, 0) + a.allocation.platformMinor + a.allocation.creatorMinor).toBe(90_001);

    const c = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/commit`, headers: { authorization: k.staff }, payload: { label: "Q1 2027", hash: a.hash, reason: "Q1 statement reconciled to the lockbox" } });
    expect(c.json().action.status, c.body).toBe("executed");
    const led = await poolLedger(k.sql, pool);
    expect(await unallocated(k, pool)).toBe(0);
    expect(0 - led.pool_distributions_payable).toBe(27_000);
    expect(0 - led.pool_creator_payable).toBe(58_501);
    expect(0 - led.pool_platform_payable).toBe(4_500);
  });

  it("AC-W6: committing the same run again moves nothing", async () => {
    const before = await txCount(k, pool);
    const [run] = await asService(k.sql, (tx) => tx<{ id: string; input_hash: string }[]>`select id, input_hash from public.distribution_runs where pool_id = ${pool}`);
    const again = await commitDistribution(k.sql, pool, "Q1 2027", run.input_hash, STAFF_ID);
    expect(again).toMatchObject({ runId: run.id, replayed: true });
    const [{ c }] = await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.distribution_runs where pool_id = ${pool}`);
    expect(c).toBe(1);
    expect(await txCount(k, pool)).toBe(before);
  });

  it("payouts settle through the provider; the collection mirror reconciles; 1099-DIV rows and the portfolio agree", async () => {
    await advance(k, 3);
    const led = await poolLedger(k.sql, pool);
    expect(led.pool_distributions_payable).toBe(0);
    expect(led.pool_collection).toBe(12_345); // only the unmatched Q9 cash is left
    expect((await reconcileL2Ledger(k.deps, pool)).diffMinor).toBe(0);
    const rows = await asService(k.sql, (tx) => tx<{ form: string; box: string; amount: bigint }[]>`select form, box, amount_minor as amount from public.tax_1099_rows where pool_id = ${pool}`);
    expect(rows.every((r) => r.form === "1099-DIV" && r.box === "1a")).toBe(true);
    expect(rows.reduce((s, r) => s + n(r.amount), 0)).toBe(27_000);
    const pf = await k.app.inject({ method: "GET", url: "/api/v1/portfolio", headers: { authorization: fans[1].auth } });
    const h = pf.json().investments[0];
    expect(h).toMatchObject({ status: "issued", units: 100, receivedMinor: 13_500, capMinor: 7_500_00 });
    expect(h.payouts[0]).toMatchObject({ label: "Q1 2027", amountMinor: 13_500, status: "paid", taxForm: "1099-DIV" });
  });

  it("AC-R4: short cash is collected at the cash amount with a shortfall break; topping up cures it", async () => {
    await statement(k, creator, pool, "Q2 2027", 50_000);
    await deposit(k, pool, 30_000, "Q2 2027");
    await advance(k, 2);
    await recon(k, pool);
    expect(await unallocated(k, pool)).toBe(30_000);
    const [br] = await asService(k.sql, (tx) => tx<{ amount: bigint }[]>`select amount_minor as amount from public.pool_breaks where pool_id = ${pool} and kind = 'revenue_shortfall' and resolved_at is null`);
    expect(n(br.amount)).toBe(20_000);
    await deposit(k, pool, 20_000, "Q2 2027");
    await advance(k, 2);
    await recon(k, pool);
    expect(await unallocated(k, pool)).toBe(50_000);
    const open = await asService(k.sql, (tx) => tx`select 1 from public.pool_breaks where pool_id = ${pool} and kind = 'revenue_shortfall' and resolved_at is null`);
    expect(open).toHaveLength(0);
  });

  it("AC-W3: a run computed before new cash was collected can't be committed", async () => {
    const stale = await computeDistribution(k.sql, pool, "Q2 2027");
    await statement(k, creator, pool, "Q3 2027", 10_000);
    await deposit(k, pool, 10_000, "Q3 2027");
    await advance(k, 2);
    await recon(k, pool);
    const c = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/commit`, headers: { authorization: k.staff }, payload: { label: "Q2 2027", hash: stale.hash, reason: "Committing the stale dry-run" } });
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toBe("run_stale");
  });

  it("the database refuses allocations that don't conserve, break the split, or pass a cap", async () => {
    const run = await computeDistribution(k.sql, pool, "Q2+Q3 2027");
    const bad = (alloc: object) => asService(k.sql, (tx) => tx`select public.commit_distribution_run(${pool}, 'tamper', ${run.hash}, ${tx.json(alloc as never)}, ${STAFF_ID})`);
    await expect(bad({ ...run.allocation, creatorMinor: run.allocation.creatorMinor + 1 })).rejects.toThrow("run_not_conserved");
    await expect(bad({ ...run.allocation, platformMinor: run.allocation.platformMinor + 1, creatorMinor: run.allocation.creatorMinor - 1 })).rejects.toThrow("run_split_mismatch");
    const p0 = run.allocation.payouts[0];
    await expect(bad({ ...run.allocation, runTotalMinor: run.allocation.runTotalMinor + 1 })).rejects.toThrow("run_stale");
    const over = { ...run.allocation, payouts: [{ investmentId: p0.investmentId, amountMinor: 10_000_00 }], creatorMinor: run.allocation.runTotalMinor - run.allocation.platformMinor - 10_000_00 };
    await expect(bad(over)).rejects.toThrow(/run_over_cap|run_split_mismatch|run_not_conserved/);
  });
});

describe("Return cap and default handling", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("AC-W2: payouts stop at the cap, the excess goes to the creator, and the Pool matures (cap reached)", async () => {
    const { pool } = await fundedPool(k, creator, [10, 10], { unitsTotal: 20, useOfFunds: [{ label: "Studio", amountMinor: 1_000_00 }], returnCapBps: 10_000, fansBps: 9_000 });
    await statement(k, creator, pool, "Q1 2027", 3_000_00);
    await deposit(k, pool, 3_000_00, "Q1 2027");
    await advance(k, 2);
    await recon(k, pool);
    const run = await computeDistribution(k.sql, pool, "Q1 2027");
    expect(run.allCapped).toBe(true);
    expect(run.allocation.payouts.map((p) => p.amountMinor)).toEqual([500_00, 500_00]); // 1.0× of $500 each
    expect(run.allocation.capOverflowMinor).toBe(2_700_00 - 1_000_00);
    await commitDistribution(k.sql, pool, "Q1 2027", run.hash, STAFF_ID);
    const [p] = await asService(k.sql, (tx) => tx<{ status: string; reason: string }[]>`select status::text, matured_reason as reason from public.pools where id = ${pool}`);
    expect(p).toEqual({ status: "matured", reason: "cap_reached" });
  });

  it("01b §5: a missed period goes AT_RISK, then DEFAULT after the cure period; staff move to REMEDIATION; paying cures it", async () => {
    const { pool, fans } = await fundedPool(k, creator, [100, 100]);
    const [{ closed }] = await asService(k.sql, (tx) => tx<{ closed: Date }[]>`select closed_at as closed from public.pools where id = ${pool}`);
    const at = (days: number) => new Date(closed.getTime() + days * 86_400_000);
    await tick(k, at(80));
    expect((await poolRow(k.sql, pool)).collection_state).toBe("COLLECTING");
    await tick(k, at(92 + 46)); // Q1 ends ~day 92, cash due 45 days later
    expect((await poolRow(k.sql, pool)).collection_state).toBe("AT_RISK");
    await tick(k, at(92 + 46 + 31));
    expect((await poolRow(k.sql, pool)).collection_state).toBe("DEFAULT");
    await tick(k); // notices are drained from the outbox on the next tick
    const notes = await asService(k.sql, (tx) => tx<{ user_id: string }[]>`select user_id from public.notifications where template = 'l2_collection_state'`);
    expect(notes.map((x) => x.user_id)).toEqual(expect.arrayContaining([fans[0].id, fans[1].id]));
    const bad = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/collection-state`, headers: { authorization: k.staff }, payload: { to: "COLLECTING", reason: "Skipping remediation is not allowed" } });
    expect(bad.json().error).toBe("illegal_collection_transition");
    const rem = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/collection-state`, headers: { authorization: k.staff }, payload: { to: "REMEDIATION", reason: "Artist agreed a catch-up plan" } });
    expect(rem.json().action.status, rem.body).toBe("executed");
    await k.app.inject({
      method: "POST", url: `/api/v1/creator/pools/${pool}/statements`, headers: { authorization: creator.auth },
      payload: { periodLabel: "P1", periodStart: closed.toISOString().slice(0, 10), periodEnd: at(92).toISOString().slice(0, 10), lines: [{ revenueType: "master", source: "Mock Distributor", amountMinor: 40_000 }] },
    });
    await deposit(k, pool, 40_000, "P1");
    await advance(k, 2);
    await tick(k, at(92 + 46 + 32));
    expect((await poolRow(k.sql, pool)).collection_state).toBe("COLLECTING");
  });
});
