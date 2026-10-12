/**
 * Layer 2 revenue, default, maturity, Waterfall and tranches against the SQL (PR #11). Covers 01b AC-R1–R4, R8 with
 * incremental top-ups, the default state machine (L2-T-022, L2-T-038 flag-off rules), maturity (L2-T-034), the Waterfall
 * commit W1–W6 incl. fans equality and conservation (L2-T-024), tranche release ordering and amount recompute
 * (L2-T-027), and the shared-rules ⇄ database sync (policy, risk badge, limit).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allocateWaterfall, canonicalJson, COLLECTION_MECHANISMS, COLLECTION_STATES, INVESTMENT_STATUSES, KYC_STATUSES, POOL_STATUSES,
  REVENUE_TYPES, regCfLimitMinor, riskBadge, type RevenueType } from "@fanzup/shared/l2";
import { POLICY } from "@fanzup/shared/policy";
import { createHash } from "node:crypto";
import { n, type Sql } from "../src/db";
import { STAFF, T0, at, bal, inv, invest, l2Db, mkCreator, mkInvestor, mkPool, ops, pool, refused, setFlag, settle, svc, val, type Db } from "./l2-db-kit";

let db: Db;
let sql: Sql;
beforeAll(async () => { db = await l2Db(); sql = db.sql; });
afterAll(async () => db?.drop());

const DAY = 86_400_000;

/** A funded Pool with two issued holdings (30 and 25 Units at $100). */
async function fundedPool(o: { maturityMonths?: number; returnCapBps?: number; tranches?: number[]; unitPriceMinor?: number } = {}) {
  const c = await mkCreator(sql);
  const p = await mkPool(sql, c, { targetMinor: 100_000, ...o });
  const [a, b] = [await mkInvestor(sql, { accredited: true }), await mkInvestor(sql, { accredited: true })];
  const ia = await invest(sql, a, p.id, 30);
  const ib = await invest(sql, b, p.id, 25);
  const end = (await pool(sql, p.id)).ends_at;
  expect(await settle(sql, p.id, end)).toBe("funded");
  const row = await pool(sql, p.id);
  return { c, id: p.id, ia, ib, closedAt: row.closed_at!, maturesAt: row.matures_at! };
}
const windows = (poolId: string) =>
  svc(sql, (tx) => tx<{ seq: number; period_start: Date; period_end: Date; ends_at: Date; due_at: Date }[]>`select * from public.l2_period_windows(${poolId})`);
const day = (d: Date) => d.toISOString().slice(0, 10);
async function statement(poolId: string, w: { period_start: Date; period_end: Date }, coveredMinor: number, label = `P-${day(w.period_start)}`) {
  const lines = [{ revenueType: "master", source: "Distributor", amountMinor: coveredMinor }];
  const sha = createHash("sha256").update(canonicalJson(lines)).digest("hex");
  await svc(sql, (tx) => tx`insert into public.revenue_statements (pool_id, period_label, period_start, period_end, lines, gross_minor, covered_minor, verification, sha256)
    values (${poolId}, ${label}, ${day(w.period_start)}, ${day(w.period_end)}, ${tx.json(lines)}, ${coveredMinor}, ${coveredMinor}, 'SELF_REPORTED', ${sha})`);
  return label;
}
let depN = 0;
const deposit = (poolId: string, amount: number, reference: string, now: Date) => {
  const ref = `dep-${++depN}`;
  return val<string>(sql, (tx) => tx`select public.record_collection_deposit(${poolId}, ${ref}, ${amount}, ${reference}, ${now}, ${`deposit:${ref}`}, ${now})`);
};
const recon = (poolId: string, now: Date) => val<{ statements: { collected_now_minor: number }[]; collection_state: string }>(sql, (tx) => tx`select public.reconcile_pool_revenue(${poolId}, ${now})`);
const stmt = (poolId: string, label: string) =>
  svc(sql, (tx) => tx<{ status: string; collected_minor: bigint }[]>`select status, collected_minor from public.revenue_statements where pool_id = ${poolId} and period_label = ${label}`).then((r) => r[0]);
const breaks = (poolId: string) =>
  svc(sql, (tx) => tx<{ kind: string; amount_minor: bigint; resolved_at: Date | null }[]>`select kind, amount_minor, resolved_at from public.pool_breaks where pool_id = ${poolId} order by opened_at, kind`);
const state = async (poolId: string) => (await pool(sql, poolId)).collection_state;
const setState = (poolId: string, to: string, now: Date) => svc(sql, (tx) => tx`select public.set_collection_state(${poolId}, ${STAFF}, ${to}::public.collection_state, 'Staff decision with a reason', ${now})`);

describe("collected-only reconciliation (01b AC-R1–R4, R8)", () => {
  it("statements tie to expected period windows and stop at maturity; only funded Pools take them", async () => {
    const p = await fundedPool({ maturityMonths: 12 });
    const w = await windows(p.id);
    expect(w).toHaveLength(4);
    expect(day(w[0].period_start)).toBe(day(p.closedAt));
    expect(w[3].ends_at.getTime()).toBe(p.maturesAt.getTime());
    await refused(statement(p.id, { period_start: w[0].period_start, period_end: new Date(w[0].period_end.getTime() - DAY) }, 100), "period_not_expected");
    await refused(statement(p.id, { period_start: p.maturesAt, period_end: new Date(p.maturesAt.getTime() + 80 * DAY) }, 100), "pool_matured");
    const c = await mkCreator(sql);
    const live = await mkPool(sql, c);
    await refused(statement(live.id, w[0], 100), "pool_not_funded");
  });

  it("R3 no cash → reported; R1/R2 cash alone isn't distributable; R4 short → collected at the cash amount + shortfall; top-ups collect only the increment; R8 idempotent", async () => {
    const p = await fundedPool();
    const [w1] = await windows(p.id);
    const now = new Date(w1.ends_at.getTime() + DAY);
    const label = await statement(p.id, w1, 10_000);
    await recon(p.id, now);
    expect(await stmt(p.id, label)).toEqual({ status: "reported", collected_minor: 0n }); // R3
    expect(await deposit(p.id, 6_000, "unrelated", now)).toBe("applied");
    await recon(p.id, now);
    expect(0 - (await bal(sql, "pool_revenue_unallocated", p.id))).toBe(0); // R1/R2: suspense only
    expect(0 - (await bal(sql, "pool_revenue_suspense", p.id))).toBe(6_000);
    await deposit(p.id, 6_000, label, now);
    const r1 = await recon(p.id, now);
    expect(r1.statements[0].collected_now_minor).toBe(6_000);
    expect(await stmt(p.id, label)).toEqual({ status: "short", collected_minor: 6_000n }); // R4
    expect((await breaks(p.id)).map((b) => [b.kind, n(b.amount_minor), b.resolved_at === null])).toEqual([["revenue_shortfall", 4_000, true]]);
    expect(0 - (await bal(sql, "pool_revenue_unallocated", p.id))).toBe(6_000);
    // Re-run with no new cash: nothing moves (R8).
    const r2 = await recon(p.id, now);
    expect(r2.statements[0].collected_now_minor).toBe(0);
    // Top-up: only the increment is collected; the shortfall resolves.
    await deposit(p.id, 4_000, label, now);
    expect((await recon(p.id, now)).statements[0].collected_now_minor).toBe(4_000);
    expect(await stmt(p.id, label)).toEqual({ status: "collected", collected_minor: 10_000n });
    expect(0 - (await bal(sql, "pool_revenue_unallocated", p.id))).toBe(10_000);
    expect((await breaks(p.id)).find((b) => b.kind === "revenue_shortfall")!.resolved_at).not.toBeNull();
    const keys = await svc(sql, (tx) => tx<{ k: string }[]>`select idempotency_key as k from public.ledger_transactions where pool_id = ${p.id} and kind = 'revenue.collected' order by k`);
    expect(keys.map((x) => x.k.split(":").pop())).toEqual(["10000", "6000"]);
    await recon(p.id, now);
    expect(0 - (await bal(sql, "pool_revenue_unallocated", p.id))).toBe(10_000); // R8
    // A duplicate deposit webhook posts nothing (lock, then check).
    const again = await val<string>(sql, (tx) => tx`select public.record_collection_deposit(${p.id}, ${`dep-${depN}`}, 4000, ${label}, ${now}, ${`deposit:dep-${depN}`}, ${now})`);
    expect(again).toBe("duplicate");
  });

  it("overage stays in suspense with a revenue_overage break", async () => {
    const p = await fundedPool();
    const [w1] = await windows(p.id);
    const now = new Date(w1.ends_at.getTime() + DAY);
    const label = await statement(p.id, w1, 5_000);
    await deposit(p.id, 7_500, label, now);
    await recon(p.id, now);
    expect(await stmt(p.id, label)).toEqual({ status: "collected", collected_minor: 5_000n });
    expect(0 - (await bal(sql, "pool_revenue_suspense", p.id))).toBe(2_500);
    expect((await breaks(p.id)).map((b) => [b.kind, n(b.amount_minor)])).toEqual([["revenue_overage", 2_500]]);
  });
});

describe("default state machine (01b §5; L2-T-022, L2-T-038)", () => {
  it("past due → AT_RISK → DEFAULT; recon never leaves DEFAULT/REMEDIATION; REMEDIATION → COLLECTING by staff only once cured; zero-cash statements don't count", async () => {
    const p = await fundedPool();
    const [w1] = await windows(p.id);
    expect((await recon(p.id, new Date(w1.due_at.getTime() - 60_000))).collection_state).toBe("COLLECTING");
    const label = await statement(p.id, w1, 0); // a zero statement with no cash is never "collected" for default purposes
    const late = new Date(w1.due_at.getTime() + 60_000);
    expect((await recon(p.id, late)).collection_state).toBe("AT_RISK");
    expect(await stmt(p.id, label)).toEqual({ status: "reported", collected_minor: 0n });
    const cured = at(late, { days: POLICY.l2.cureDays, minutes: 1 });
    expect((await recon(p.id, cured)).collection_state).toBe("DEFAULT");
    await refused(setState(p.id, "COLLECTING", cured), "illegal_collection_transition");
    await setState(p.id, "REMEDIATION", cured);
    await refused(setState(p.id, "COLLECTING", cured), "not_cured");
    // Cash for the missed period arrives (a fresh statement replaces the zero one: new label, same window is refused).
    await svc(sql, (tx) => tx`delete from public.revenue_statements where pool_id = ${p.id} and period_label = ${label}`);
    const real = await statement(p.id, w1, 8_000, "Q1-real");
    await deposit(p.id, 8_000, real, cured);
    expect((await recon(p.id, cured)).collection_state).toBe("REMEDIATION"); // never automatic
    await setState(p.id, "COLLECTING", cured);
    expect(await state(p.id)).toBe("COLLECTING");
  });

  it("with the flag off: no adverse transition, the AT_RISK cure still runs, staff still move a Pool in DEFAULT", async () => {
    const p = await fundedPool();
    const [w1] = await windows(p.id);
    const late = new Date(w1.due_at.getTime() + 60_000);
    await setFlag(sql, false);
    try {
      expect((await recon(p.id, late)).collection_state).toBe("COLLECTING");
      await setFlag(sql, true);
      expect((await recon(p.id, late)).collection_state).toBe("AT_RISK");
      await setFlag(sql, false);
      const atCure = at(late, { days: POLICY.l2.cureDays + 1 });
      expect((await recon(p.id, atCure)).collection_state).toBe("AT_RISK"); // no AT_RISK → DEFAULT while off
      const label = await statement(p.id, w1, 3_000);
      await deposit(p.id, 3_000, label, atCure);
      expect((await recon(p.id, atCure)).collection_state).toBe("COLLECTING"); // cure still applies
      // A Pool already in DEFAULT can still be moved by staff while the flag is off.
      await sql`update public.pools set collection_state = 'DEFAULT' where id = ${p.id}`;
      await setState(p.id, "REMEDIATION", atCure);
      expect(await state(p.id)).toBe("REMEDIATION");
      await refused(svc(sql, (tx) => tx`select public.commit_distribution_run(${p.id}, 'x1', ${"c".repeat(64)}, '{}', ${STAFF}, ${atCure})`), "layer2_disabled");
    } finally {
      await setFlag(sql, true);
    }
  });
});

describe("maturity (L2-T-034)", () => {
  it("funded → matured at matures_at whatever the runs; final cash for the last period is distributed on the matured Pool", async () => {
    const p = await fundedPool({ maturityMonths: 12 });
    const w = await windows(p.id);
    expect(n(await val(sql, (tx) => tx`select public.mature_due_pools(${new Date(p.maturesAt.getTime() - 1000)})`))).toBe(0);
    expect(n(await val(sql, (tx) => tx`select public.mature_due_pools(${p.maturesAt})`))).toBeGreaterThanOrEqual(1);
    const row = await pool(sql, p.id);
    expect({ status: row.status, reason: row.matured_reason }).toEqual({ status: "matured", reason: "maturity" });
    // Cash for every period (the last one reconciled after maturity) → the final run is committed on the matured Pool.
    const after = at(p.maturesAt, { days: 10 });
    for (const x of w) {
      const label = await statement(p.id, x, 5_000);
      await deposit(p.id, 5_000, label, after);
    }
    await recon(p.id, after);
    const run = await commit(p.id, "final", after);
    expect(run.alloc.runTotalMinor).toBe(20_000);
    expect(run.alloc.payouts.length).toBe(2);
    // No window starts after maturity, so once every period is collected nothing is ever past due again.
    expect(w.every((x) => x.ends_at.getTime() <= p.maturesAt.getTime())).toBe(true);
    expect(await val(sql, (tx) => tx`select public.l2_past_due(${p.id}, ${at(p.maturesAt, { days: 4000 })})`)).toBe(false);
    expect((await recon(p.id, at(p.maturesAt, { days: 4000 }))).collection_state).toBe("COLLECTING");
  });
});

async function holdings(poolId: string) {
  const rows = await svc(sql, (tx) => tx<{ id: string; units: number; cap_minor: bigint; distributed_minor: bigint }[]>`
    select id, units, cap_minor, distributed_minor from public.investments where pool_id = ${poolId} and status = 'issued' order by id`);
  return rows.map((r) => ({ investmentId: r.id, units: r.units, capRemainingMinor: n(r.cap_minor) - n(r.distributed_minor) }));
}
async function allocation(poolId: string) {
  const p = await pool(sql, poolId);
  const C = 0 - (await bal(sql, "pool_revenue_unallocated", poolId));
  const r = allocateWaterfall({ collectedMinor: C, fansBps: p.fans_bps as number, creatorBps: p.creator_bps as number, platformBps: p.platform_bps as number, holdings: await holdings(poolId) });
  const alloc = { runTotalMinor: C, creatorMinor: r.creatorMinor, platformMinor: r.platformMinor, capOverflowMinor: r.capOverflowMinor,
    payouts: r.payouts.map((x) => ({ investmentId: x.investmentId, amountMinor: x.amountMinor })) };
  return { alloc, hash: createHash("sha256").update(canonicalJson(alloc)).digest("hex"), result: r };
}
const commitRaw = (poolId: string, label: string, hash: string, alloc: unknown, now: Date) =>
  val<string>(sql, (tx) => tx`select public.commit_distribution_run(${poolId}, ${label}, ${hash}, ${tx.json(alloc as never)}, ${STAFF}, ${now})`);
async function commit(poolId: string, label: string, now: Date) {
  const a = await allocation(poolId);
  const id = await commitRaw(poolId, label, a.hash, a.alloc, now);
  return { id, ...a };
}
async function collect(poolId: string, amount: number, now: Date, w: { period_start: Date; period_end: Date }) {
  const label = await statement(poolId, w, amount);
  await deposit(poolId, amount, label, now);
  await recon(poolId, now);
}

describe("Waterfall commit (01a AC-W1–W6; L2-T-024)", () => {
  it("W1/W4/W6: a committed run equals allocateWaterfall of the same inputs, conserves every cent, and commits once", async () => {
    const p = await fundedPool();
    const [w1] = await windows(p.id);
    const now = new Date(w1.ends_at.getTime() + DAY);
    await collect(p.id, 100_001, now, w1);
    const a = await allocation(p.id);
    await refused(commitRaw(p.id, "Q1", a.hash, { ...a.alloc, runTotalMinor: 100_000 }, now), "run_stale"); // W3
    await refused(commitRaw(p.id, "Q1", a.hash, { ...a.alloc, creatorMinor: a.alloc.creatorMinor + 1 }, now), "run_not_conserved"); // W4
    const id = await commitRaw(p.id, "Q1", a.hash, a.alloc, now);
    expect(await commitRaw(p.id, "Q1", a.hash, a.alloc, now)).toBe(id); // W6
    await refused(commitRaw(p.id, "Q1", "d".repeat(64), a.alloc, now), "run_conflict");
    const pays = await svc(sql, (tx) => tx<{ kind: string; investment_id: string | null; amount_minor: bigint }[]>`
      select kind, investment_id, amount_minor from public.distribution_payouts where run_id = ${id} order by kind, investment_id`);
    const fans = pays.filter((x) => x.kind === "investor").map((x) => ({ investmentId: x.investment_id, amountMinor: n(x.amount_minor) }));
    expect(fans).toEqual(a.alloc.payouts.slice().sort((x, y) => (x.investmentId < y.investmentId ? -1 : 1)));
    expect(pays.reduce((s, x) => s + n(x.amount_minor), 0)).toBe(100_001);
    expect(fans.reduce((s, x) => s + x.amountMinor, 0)).toBe(Math.floor((100_001 * 3000) / 10_000));
    expect(await bal(sql, "pool_revenue_unallocated", p.id)).toBe(0);
    expect((await ops(sql, p.id)).filter((o) => o.kind === "payout").map((o) => o.idempotency_key).every((k) => /^payout:[0-9a-f-]{36}$/.test(k))).toBe(true);
    const i = await inv(sql, a.alloc.payouts[0].investmentId);
    expect(n(i.distributed_minor as bigint)).toBe(a.alloc.payouts[0].amountMinor); // counted at commit
    // Payout confirmations: exact amount, once.
    const [inv1] = await svc(sql, (tx) => tx<{ id: string; amount_minor: bigint }[]>`select id, amount_minor from public.distribution_payouts where run_id = ${id} and kind = 'investor' limit 1`);
    await refused(val(sql, (tx) => tx`select public.record_pool_payout_confirmed(${inv1.id}, 'po-1', ${n(inv1.amount_minor) + 1}, 'payout:po-1', ${now})`), "payout_amount_mismatch");
    expect(await val(sql, (tx) => tx`select public.record_pool_payout_confirmed(${inv1.id}, 'po-1', ${n(inv1.amount_minor)}, 'payout:po-1', ${now})`)).toBe("applied");
    expect(await val(sql, (tx) => tx`select public.record_pool_payout_confirmed(${inv1.id}, 'po-1', ${n(inv1.amount_minor)}, 'payout:po-1', ${now})`)).toBe("duplicate");
    // 1099-DIV data row (Mechanism 04 default, L2-Q6), for the confirmation's tax year, counted once.
    const tax = await svc(sql, (tx) => tx<{ tax_year: number; form: string; box: string; amount_minor: bigint }[]>`
      select tax_year, form, box, amount_minor from public.tax_1099_rows where pool_id = ${p.id}`);
    expect(tax).toEqual([{ tax_year: now.getUTCFullYear(), form: "1099-DIV", box: "1a", amount_minor: inv1.amount_minor }]);
  });

  it("fans equality: moving fan cents to the creator while a holder is under its cap is refused allocation_invalid", async () => {
    const p = await fundedPool();
    const [w1] = await windows(p.id);
    const now = new Date(w1.ends_at.getTime() + DAY);
    await collect(p.id, 50_000, now, w1);
    const a = await allocation(p.id);
    const bad = { ...a.alloc, creatorMinor: a.alloc.creatorMinor + 1, payouts: a.alloc.payouts.map((x, k) => (k === 0 ? { ...x, amountMinor: x.amountMinor - 1 } : x)) };
    await refused(commitRaw(p.id, "Q1", "e".repeat(64), bad, now), "allocation_invalid");
    const over = { ...a.alloc, creatorMinor: 0, payouts: a.alloc.payouts.map((x, k) => (k === 0 ? { ...x, amountMinor: x.amountMinor + a.alloc.creatorMinor } : x)) };
    await refused(commitRaw(p.id, "Q1", "f".repeat(64), over, now), "run_split_mismatch");
    expect(await bal(sql, "pool_revenue_unallocated", p.id)).toBe(-50_000); // nothing moved
  });

  it("W2: every holder ends at its cap → the cap overflow goes to the creator and the Pool matures (cap_reached); past the cap is refused", async () => {
    const p = await fundedPool({ returnCapBps: 10_000 }); // caps = $3,000 and $2,500
    const [w1] = await windows(p.id);
    const now = new Date(w1.ends_at.getTime() + DAY);
    await collect(p.id, 2_000_000, now, w1); // fans 30% = 600,000 > Σ caps 550,000
    const a = await allocation(p.id);
    expect(a.result.allCapped).toBe(true);
    const tooMuch = { ...a.alloc, creatorMinor: a.alloc.creatorMinor - 1, payouts: a.alloc.payouts.map((x, k) => (k === 0 ? { ...x, amountMinor: x.amountMinor + 1 } : x)) };
    await refused(commitRaw(p.id, "Q1", "1".repeat(64), tooMuch, now), "run_over_cap");
    await commitRaw(p.id, "Q1", a.hash, a.alloc, now);
    const row = await pool(sql, p.id);
    expect({ status: row.status, reason: row.matured_reason }).toEqual({ status: "matured", reason: "cap_reached" });
    const [r] = await svc(sql, (tx) => tx<{ fans_minor: bigint; creator_minor: bigint; cap_overflow_minor: bigint }[]>`select fans_minor, creator_minor, cap_overflow_minor from public.distribution_runs where pool_id = ${p.id}`);
    expect({ fans: n(r.fans_minor), overflow: n(r.cap_overflow_minor) }).toEqual({ fans: 550_000, overflow: 50_000 });
  });
});

describe("tranches released in order; amount re-derived before the first call and frozen after (L2-T-027)", () => {
  it("tranche 3 verified before tranche 2 is released sends the correct remainder", async () => {
    const p = await fundedPool({ tranches: [40, 30, 30], unitPriceMinor: 10_003 });
    const raised = n((await pool(sql, p.id)).raised_minor);
    expect(raised).toBe(55 * 10_003);
    const tr = await svc(sql, (tx) => tx<{ id: string; seq: number }[]>`select id, seq from public.pool_tranches where pool_id = ${p.id} order by seq`);
    const now = at(p.closedAt, { days: 1 });
    for (const t of tr.slice(1)) {
      await svc(sql, (tx) => tx`select public.submit_pool_tranche_evidence(${t.id}, ${p.c.owner}, 'Evidence for this milestone.', '{}', ${now})`);
    }
    await svc(sql, (tx) => tx`select public.verify_pool_tranche(${tr[2].id}, ${STAFF}, ${now})`);
    await svc(sql, (tx) => tx`select public.verify_pool_tranche(${tr[1].id}, ${STAFF}, ${now})`);
    const disb = async () => (await ops(sql, p.id)).filter((o) => o.kind === "disburse");
    expect((await disb()).map((o) => o.subject_id)).toEqual([tr[0].id]); // only tranche 1 (queued at close)
    const t1 = Math.floor((raised * 40) / 100);
    expect(n((await disb())[0].amount_minor)).toBe(t1);
    await refused(val(sql, (tx) => tx`select public.record_pool_tranche_released(${tr[1].id}, 'x', 1, 'disburse:x', ${now})`), "earlier_tranche_pending");
    await val(sql, (tx) => tx`select public.record_pool_tranche_released(${tr[0].id}, 'db-t1', ${t1}, 'disburse:db-t1', ${now})`);
    const t2 = Math.floor((raised * 30) / 100);
    expect((await disb()).map((o) => [o.subject_id, n(o.amount_minor)])).toEqual([[tr[0].id, t1], [tr[1].id, t2]]);
    await val(sql, (tx) => tx`select public.record_pool_tranche_released(${tr[1].id}, 'db-t2', ${t2}, 'disburse:db-t2', ${now})`);
    const t3op = (await disb()).find((o) => o.subject_id === tr[2].id)!;
    expect(n(t3op.amount_minor)).toBe(raised - t1 - t2); // the last tranche is the remainder, rounding included
    // The runner: claim, re-derive, start; a wrong claim can't start it.
    const claimed = await svc(sql, (tx) => tx<{ id: string; claim_token: string }[]>`select id, claim_token from public.l2_claim_pool_ops(${now}, 50)`);
    const mine = claimed.find((c) => c.id === t3op.id)!;
    expect(await svc(sql, (tx) => tx`select * from public.l2_op_start_call(${t3op.id}, gen_random_uuid(), ${now})`)).toEqual([{ amount_minor: n(t3op.amount_minor) === 0 ? 0n : t3op.amount_minor, outcome: "not_claimed" }]);
    expect(await svc(sql, (tx) => tx`select * from public.l2_op_start_call(${t3op.id}, ${mine.claim_token}, ${now})`)).toEqual([{ amount_minor: BigInt(raised - t1 - t2), outcome: "call" }]);
    await val(sql, (tx) => tx`select public.record_pool_tranche_released(${tr[2].id}, 'db-t3', ${raised - t1 - t2}, 'disburse:db-t3', ${now})`);
    expect(await bal(sql, "pool_issuer_payable", p.id)).toBe(0);
    expect(await bal(sql, "pool_escrow", p.id)).toBe(0);
  });

  it("a disburse op whose owed amount changes after the call started fails disburse_amount_changed instead of sending a stale figure", async () => {
    const p = await fundedPool();
    const now = at(p.closedAt, { minutes: 1 });
    const op = (await ops(sql, p.id)).find((o) => o.kind === "disburse")!;
    const [c] = await svc(sql, (tx) => tx<{ id: string; claim_token: string }[]>`select id, claim_token from public.l2_claim_pool_ops(${now}, 50) where kind = 'disburse'`);
    expect(c.id).toBe(op.id);
    expect((await svc(sql, (tx) => tx<{ outcome: string }[]>`select * from public.l2_op_start_call(${op.id}, ${c.claim_token}, ${now})`))[0].outcome).toBe("call");
    await sql`update public.pools set raised_minor = raised_minor - 1000 where id = ${p.id}`; // what tranche 1 is owed changes
    expect((await svc(sql, (tx) => tx<{ outcome: string }[]>`select * from public.l2_op_start_call(${op.id}, ${c.claim_token}, ${now})`))[0].outcome).toBe("disburse_amount_changed");
    expect((await ops(sql, p.id)).find((o) => o.id === op.id)!.status).toBe("failed");
  });
});

describe("shared rules ⇄ database (L2 sync)", () => {
  it("POLICY.regCf and POLICY.l2 equal platform_settings", async () => {
    const [r] = await sql<{ value: Record<string, unknown> }[]>`select value from public.platform_settings where key = 'regcf_limits'`;
    expect(r.value).toEqual({ floor_minor: POLICY.regCf.floorMinor, threshold_minor: POLICY.regCf.thresholdMinor, low_bps: POLICY.regCf.lowBps,
      high_bps: POLICY.regCf.highBps, issuer_cap_minor: POLICY.regCf.issuerCapMinor, min_offering_days: POLICY.regCf.minOfferingDays });
    const [l] = await sql<{ value: Record<string, unknown> }[]>`select value from public.platform_settings where key = 'l2_policy'`;
    const L = POLICY.l2;
    expect(l.value).toEqual({ reserve_minutes: L.reserveMinutes, settle_grace_minutes: L.settleGraceMinutes, cancel_cutoff_hours: L.cancelCutoffHours,
      lockup_months: L.lockupMonths, period_months: L.periodMonths, settlement_due_days: L.settlementDueDays, cure_days: L.cureDays,
      blocked_states: [...L.blockedStates], risk_ack_version: L.riskAckVersion, deadline_min_days: L.deadlineDays.min, deadline_max_days: L.deadlineDays.max,
      expiry_lookup_grace_minutes: L.expiryLookupGraceMinutes, refund_direct_business_days: L.refundDirectBusinessDays });
    const [d] = await sql<{ def: string }[]>`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'pools_duration_days_check'`;
    expect(d.def).toContain(`>= ${L.deadlineDays.min}`);
    expect(d.def).toContain(`<= ${L.deadlineDays.max}`);
  });

  it("enums match packages/shared/l2", async () => {
    const e = async (t: string) => (await sql.unsafe<{ v: string }[]>(`select unnest(enum_range(null::public.${t}))::text v`)).map((r) => r.v);
    expect(await e("pool_status")).toEqual([...POOL_STATUSES]);
    expect(await e("investment_status")).toEqual([...INVESTMENT_STATUSES]);
    expect(await e("kyc_status")).toEqual([...KYC_STATUSES]);
    expect(await e("collection_state")).toEqual([...COLLECTION_STATES]);
    expect(await e("collection_mechanism")).toEqual([...COLLECTION_MECHANISMS]);
    expect(await e("revenue_type")).toEqual([...REVENUE_TYPES]);
  });

  it("riskBadge (TS) equals l2_risk_badge (SQL) for every mechanism × revenue-type set", async () => {
    const sets: RevenueType[][] = [];
    for (let m = 1; m < 1 << REVENUE_TYPES.length; m++) sets.push(REVENUE_TYPES.filter((_, i) => m & (1 << i)));
    for (const mech of COLLECTION_MECHANISMS) for (const types of sets) {
      const [r] = await sql<{ b: string }[]>`select public.l2_risk_badge(${mech}::public.collection_mechanism, ${types}::public.revenue_type[])::text b`;
      expect({ mech, types, b: r.b }).toEqual({ mech, types, b: riskBadge(mech, types) });
    }
  });

  it("regCfLimitMinor (TS) equals regcf_investor_limit (SQL)", async () => {
    for (const [income, nw, acc] of [[3_000_000, 2_000_000, false], [8_000_000, 15_000_000, false], [20_000_000, 15_000_000, false], [12_400_000, 12_400_000, false],
      [200_000_000, 500_000_000, false], [1, 1, true]] as [number, number, boolean][]) {
      const u = await mkInvestor(sql, { incomeMinor: income, netWorthMinor: nw, accredited: acc });
      const v = await val<bigint | null>(sql, (tx) => tx`select public.regcf_investor_limit(${u})`);
      expect(v == null ? null : n(v)).toBe(regCfLimitMinor({ annualIncomeMinor: income, netWorthMinor: nw, accredited: acc }));
    }
  });

  it("rule details show dollars", async () => {
    expect(await val(sql, (tx) => tx`select public.l2_usd(123456789)`)).toBe("$1,234,567.89");
    expect(await val(sql, (tx) => tx`select public.l2_usd(5)`)).toBe("$0.05");
  });
});
