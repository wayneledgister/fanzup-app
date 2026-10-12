/**
 * Layer 2 offering money against the SQL (PR #11; specs/l2/03-tasks.md). Covers 01a AC-I1/I2/I5, AC-E1–E5, the issuer
 * cap (L2-T-019), 21-day minimum (L2-T-020), cancellation (L2-T-031/043), fund-move matching and strays (L2-T-032),
 * expiry with provider lookup (L2-T-026), counted reservations (L2-T-042/045), notices (L2-T-039/044), the op key scheme
 * (L2-T-040) and lock-then-check.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { n, type Sql } from "../src/db";
import {
  ACK, T0, at, bal, callStarted, expectCounters, expectEscrowInvariant, funded, inv, invest, l2Db, launch, limit, markFunding, mkCreator,
  mkInvestor, mkPool, notices, ops, pool, refundConfirmed, refused, reserve, settle, submit, svc, usage, val, type Db,
} from "./l2-db-kit";

let db: Db;
let sql: Sql;
beforeAll(async () => { db = await l2Db(); sql = db.sql; });
afterAll(async () => db?.drop());

const expireStep = async (poolId: string, now: Date, ids?: string[]) => {
  const cands = await svc(sql, (tx) => tx<{ investment_id: string; action: string }[]>`select * from public.l2_expiry_candidates(${now}) where pool_id = ${poolId}`);
  const pick = ids ?? cands.filter((c) => c.action === "expire").map((c) => c.investment_id);
  return n(await val<number>(sql, (tx) => tx`select public.expire_investment_reservations(${poolId}, ${pick}::uuid[], ${now})`));
};
const candidates = (now: Date) => svc(sql, (tx) => tx<{ investment_id: string; action: string; cancel_pending: boolean }[]>`select * from public.l2_expiry_candidates(${now})`);

describe("issuer cap on the maximum, aggregated by owner (L2-T-019)", () => {
  it("two artist profiles of one owner: Pools under each can't together exceed the cap (sequential)", async () => {
    const a1 = await mkCreator(sql, "Rising");
    const a2 = await mkCreator(sql, "Rising", a1.owner);
    // Rising cap $100,000; each Pool's maximum is $60,000.
    const p1 = await mkPool(sql, a1, { unitsTotal: 60, unitPriceMinor: 100_000, launch: false });
    const p2 = await mkPool(sql, a2, { unitsTotal: 60, unitPriceMinor: 100_000, launch: false });
    await submit(sql, p1.id, a1.owner, 0);
    await refused(submit(sql, p2.id, a1.owner, 0), "tier_cap_exceeded");
    await expect(submit(sql, p2.id, a1.owner, 0)).rejects.toMatchObject({ detail: expect.stringContaining("$40,000.00") });
  });

  it("concurrent submits under two artists of one owner: exactly one passes", async () => {
    const a1 = await mkCreator(sql, "Rising");
    const a2 = await mkCreator(sql, "Rising", a1.owner);
    const p1 = await mkPool(sql, a1, { unitsTotal: 60, unitPriceMinor: 100_000, launch: false });
    const p2 = await mkPool(sql, a2, { unitsTotal: 60, unitPriceMinor: 100_000, launch: false });
    const res = await Promise.allSettled([submit(sql, p1.id, a1.owner, 0), submit(sql, p2.id, a1.owner, 0)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toBe("tier_cap_exceeded");
  });

  it("an attested outside figure that leaves less than the maximum refuses submit, and re-attestation refuses launch", async () => {
    const c = await mkCreator(sql, "Rising");
    const p = await mkPool(sql, c, { unitsTotal: 60, unitPriceMinor: 100_000, launch: false });
    await refused(submit(sql, p.id, c.owner, 5_000_000), "tier_cap_exceeded");
    await refused(submit(sql, p.id, c.owner, -1), "attestation_required");
    await submit(sql, p.id, c.owner, 0);
    await svc(sql, (tx) => tx`select public.review_pool(${p.id}, ${"b40e0a39-c7ef-5798-91f3-504e09b530f4"}, 'approved', null, ${T0})`);
    await svc(sql, (tx) => tx`select public.execute_collection_mechanism(${p.id}, ${"b40e0a39-c7ef-5798-91f3-504e09b530f4"}, '{}', ${T0})`);
    await refused(launch(sql, p.id, c.owner, 4_500_000), "tier_cap_exceeded");
    await launch(sql, p.id, c.owner, 1_000_000);
    const row = await pool(sql, p.id);
    expect({ status: row.status, remaining: n(row.issuer_cap_remaining_minor), other: n(row.issuer_other_regcf_12m_minor as bigint) })
      .toEqual({ status: "live", remaining: 9_000_000, other: 1_000_000 });
  });

  it("the reservation backstop refuses issuer_cap_reached once issuer_cap_remaining_minor is lowered directly", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql, { accredited: true });
    await sql`update public.pools set issuer_cap_remaining_minor = 100000 where id = ${p.id}`;
    await reserve(sql, u, p.id, 2);
    await refused(reserve(sql, u, p.id, 9), "issuer_cap_reached");
    await reserve(sql, u, p.id, 8);
  });
});

describe("21-day minimum and frozen terms (L2-T-020; final review)", () => {
  it("rejects a 20-day Pool, launches a 21-day one with the deadline 21 days out", async () => {
    const c = await mkCreator(sql);
    await expect(mkPool(sql, c, { durationDays: 20, launch: false })).rejects.toThrow(/pools_duration_days_check/);
    const p = await mkPool(sql, c, { durationDays: 21 });
    expect((await pool(sql, p.id)).ends_at.getTime()).toBe(at(T0, { days: 21 }).getTime());
  });

  it("terms change only in draft / revisions_requested; approve and launch refuse a changed terms hash", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { launch: false });
    await sql`update public.pools set title = 'Album (deluxe)' where id = ${p.id}`; // draft: fine
    await submit(sql, p.id, c.owner, 0);
    await refused(sql`update public.pools set fans_bps = 2000, creator_bps = 7500 where id = ${p.id}`, "pool_not_editable");
    await refused(sql`update public.pool_tranches set pct = 60 where pool_id = ${p.id} and seq = 1`, "pool_not_editable");
    await sql`update public.pool_tranches set status = 'pending' where pool_id = ${p.id} and seq = 1`; // non-term columns stay writable
    // Simulate a write that bypassed the guard: the stored hash catches it at approval.
    await sql.begin(async (tx) => {
      await tx`alter table public.pools disable trigger pools_terms_frozen`;
      await tx`update public.pools set unit_price_minor = 20000 where id = ${p.id}`;
      await tx`alter table public.pools enable trigger pools_terms_frozen`;
    });
    await refused(svc(sql, (tx) => tx`select public.review_pool(${p.id}, ${"b40e0a39-c7ef-5798-91f3-504e09b530f4"}, 'approved', null, ${T0})`), "terms_changed");
    await svc(sql, (tx) => tx`select public.review_pool(${p.id}, ${"b40e0a39-c7ef-5798-91f3-504e09b530f4"}, 'revisions_requested', 'Fix the price', ${T0})`);
    await sql`update public.pools set unit_price_minor = 10000 where id = ${p.id}`; // revisions_requested: editable again
    await submit(sql, p.id, c.owner, 0);
  });
});

describe("Reg CF investor limit (AC-I1, AC-I5)", () => {
  it("concurrent reservations across two Pools never exceed the limit — exactly the ones that fit succeed", async () => {
    const c = await mkCreator(sql);
    const [p1, p2] = [await mkPool(sql, c), await mkPool(sql, c)];
    const u = await mkInvestor(sql); // limit $2,500 (floor)
    expect(await limit(sql, u)).toBe(250_000);
    const res = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reserve(sql, u, i % 2 ? p1.id : p2.id, 5))); // $500 each
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    for (const r of res.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason.message).toBe("regcf_limit_exceeded");
    expect(await usage(sql, u)).toBe(250_000);
    await expect(reserve(sql, u, p1.id, 1)).rejects.toMatchObject({ message: "regcf_limit_exceeded", detail: expect.stringContaining("$0.00 left") });
  });
});

describe("expiry, cancellation and returned fund moves free headroom only per the counted-reservation rule (AC-I2; L2-T-026, L2-T-042)", () => {
  it("an unfunded reservation with no provider call expires at once and frees its limit and Units", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 25);
    const later = at(T0, { minutes: 31 });
    expect(await usage(sql, u, later)).toBe(0); // uncounted: expired, no call started
    expect(await expireStep(p.id, later)).toBe(1);
    expect((await inv(sql, r.id)).status).toBe("expired");
    await expectCounters(sql, p.id, later);
    await reserve(sql, u, p.id, 25, later);
  });

  it("crash after fundTrade → expiry → a reservation over the limit is refused until the refund confirms", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 20); // $2,000 of $2,500
    await callStarted(sql, r.id); // the API committed provider_call_started_at; fundTrade moved money; mark_investment_funding never ran
    const expired = at(T0, { minutes: 31 });
    expect(await usage(sql, u, expired)).toBe(200_000); // still counted
    await refused(reserve(sql, u, p.id, 10, expired), "regcf_limit_exceeded");
    expect((await candidates(expired)).filter((x) => x.investment_id === r.id)).toEqual([]); // inside the lookup grace
    const afterGrace = at(T0, { minutes: 36 });
    expect((await candidates(afterGrace)).find((x) => x.investment_id === r.id)?.action).toBe("lookup");
    // The lookup finds a funded trade: refs stored, status unchanged, still counted, no longer a candidate.
    expect(await val(sql, (tx) => tx`select public.record_investment_provider_refs(${r.id}, ${`tr-${r.id}`}, ${`fm-${r.id}`}, ${afterGrace})`)).toBe("reserved");
    expect((await candidates(afterGrace)).find((x) => x.investment_id === r.id)).toBeUndefined();
    await refused(reserve(sql, u, p.id, 10, afterGrace), "regcf_limit_exceeded");
    await expectCounters(sql, p.id, afterGrace);
    // The fund move settles: unapplied (reservation expired) → refund_pending, refunded in full from what arrived.
    expect(await funded(sql, r.id, 200_000, afterGrace)).toBe("refund:reservation_expired");
    expect(await usage(sql, u, afterGrace)).toBe(200_000);
    await refused(reserve(sql, u, p.id, 10, afterGrace), "regcf_limit_exceeded");
    await expectEscrowInvariant(sql, p.id);
    expect(await refundConfirmed(sql, r.id, 200_000, afterGrace)).toBe("applied");
    expect(await usage(sql, u, afterGrace)).toBe(0);
    await reserve(sql, u, p.id, 10, afterGrace);
    await expectEscrowInvariant(sql, p.id);
  });

  it("crash between createTrade and fundTrade → after the grace the voided trade lets expiry free the headroom", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 25);
    await callStarted(sql, r.id);
    const afterGrace = at(T0, { minutes: 36 });
    await refused(reserve(sql, u, p.id, 1, afterGrace), "regcf_limit_exceeded");
    // API: findTrade → unfunded trade → cancelTrade confirmed → expire.
    expect(await expireStep(p.id, afterGrace, [r.id])).toBe(1);
    expect((await inv(sql, r.id)).status).toBe("expired");
    expect(await usage(sql, u, afterGrace)).toBe(0);
    await expectCounters(sql, p.id, afterGrace);
    // A fund move can never be applied to it now (mark_investment_funding / a late settle both refuse).
    expect(await markFunding(sql, r.id, afterGrace)).toBe("expired");
  });

  it("expiry refuses a row the caller passes too early (re-checked under the pool lock)", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 1);
    await callStarted(sql, r.id);
    expect(await expireStep(p.id, at(T0, { minutes: 32 }), [r.id])).toBe(0); // inside the grace
    expect((await inv(sql, r.id)).status).toBe("reserved");
  });

  it("a returned fund move frees the limit and Units at once and stores the fund ref (L2-T-036)", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 25);
    await callStarted(sql, r.id);
    // The return webhook beats mark_investment_funding: no fund ref stored yet.
    expect(await val(sql, (tx) => tx`select public.record_investment_returned(${r.id}, ${"fm-returned-1"}, 'R01', ${T0})`)).toBe("returned");
    const row = await inv(sql, r.id);
    expect({ status: row.status, ref: row.provider_fund_ref }).toEqual({ status: "returned", ref: "fm-returned-1" });
    expect(await usage(sql, u)).toBe(0);
    await expectCounters(sql, p.id, T0);
    expect(await val(sql, (tx) => tx`select public.record_investment_returned(${r.id}, ${"fm-returned-1"}, 'R01', ${T0})`)).toBe("ignored");
  });
});

describe("mark_investment_funding (L2-T-028 SQL part; final review)", () => {
  it("moves only a live reservation; a dead one stays reserved (counted) and returns 'dead'; a moved-on row returns its status", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql, { accredited: true });
    const dead = await reserve(sql, u, p.id, 1);
    await callStarted(sql, dead.id);
    expect(await markFunding(sql, dead.id, at(T0, { minutes: 31 }))).toBe("dead");
    const d = await inv(sql, dead.id);
    expect({ status: d.status, ref: d.provider_fund_ref }).toEqual({ status: "reserved", ref: `fm-${dead.id}` });
    expect(await usage(sql, u, at(T0, { minutes: 31 }))).toBe(n(d.amount_minor));

    const live = await reserve(sql, u, p.id, 1);
    await callStarted(sql, live.id);
    expect(await funded(sql, live.id, live.amount)).toBe("applied"); // webhook beat mark_investment_funding
    expect(await markFunding(sql, live.id)).toBe("funded"); // current status, not 'dead' — resume-guard case (a)

    const pending = await reserve(sql, u, p.id, 1);
    await callStarted(sql, pending.id);
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${pending.id}, ${u}, ${T0})`)).toBe("cancel_pending");
    expect(await markFunding(sql, pending.id)).toBe("dead");
  });
});

describe("escrow invariants and target-or-refund (AC-E1–E5)", () => {
  it("funded path: E1 after every step, nothing to the issuer before close, tranches in order, escrow ends at zero", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 500_000 });
    const [a, b, cc] = [await mkInvestor(sql, { accredited: true }), await mkInvestor(sql, { accredited: true }), await mkInvestor(sql, { accredited: true })];
    const ia = await invest(sql, a, p.id, 30);
    await expectEscrowInvariant(sql, p.id);
    const ib = await invest(sql, b, p.id, 25);
    await expectEscrowInvariant(sql, p.id);
    await expectCounters(sql, p.id, T0);
    // C's fund move is in flight at the deadline.
    const ic = await reserve(sql, cc, p.id, 5);
    await callStarted(sql, ic.id);
    expect(await markFunding(sql, ic.id)).toBe("funding");
    const end = (await pool(sql, p.id)).ends_at;
    expect((await ops(sql, p.id)).filter((o) => o.kind === "disburse")).toHaveLength(0); // AC-E3
    expect(await bal(sql, "pool_issuer_payable", p.id)).toBe(0);
    expect(await settle(sql, p.id, end)).toBe("live"); // settle grace for funding investments
    const settledAt = at(end, { minutes: 11 });
    expect(await settle(sql, p.id, settledAt)).toBe("funded");
    const row = await pool(sql, p.id);
    expect({ raised: n(row.raised_minor), issued: row.units_issued, committed: row.units_committed, investors: row.investors_count })
      .toEqual({ raised: 550_000, issued: 55, committed: 60, investors: 2 });
    expect((await inv(sql, ic.id)).status).toBe("funding"); // never issued
    expect(0 - (await bal(sql, "pool_issuer_payable", p.id))).toBe(550_000);
    // C's fund move settles after settlement: unapplied (offering closed), refunded in full.
    expect(await funded(sql, ic.id, ic.amount, at(settledAt, { minutes: 1 }))).toBe("refund:offering_closed");
    await expectEscrowInvariant(sql, p.id, { closed: true });
    const o = await ops(sql, p.id);
    expect(o.map((x) => [x.kind, x.idempotency_key, n(x.amount_minor)])).toEqual(expect.arrayContaining([
      ["close_offering", `close:${p.id}`, 550_000], ["refund", `refund:inv:${ic.id}`, ic.amount],
    ]));
    const t1 = o.find((x) => x.kind === "disburse")!;
    expect(n(t1.amount_minor)).toBe(275_000);
    expect(await val(sql, (tx) => tx`select public.record_pool_tranche_released(${t1.subject_id}, 'db-1', 275000, 'disburse:db-1', ${settledAt})`)).toBe(275_000n);
    // Lock-then-check: the same confirmation again is a no-op.
    expect(await val(sql, (tx) => tx`select public.record_pool_tranche_released(${t1.subject_id}, 'db-1', 275000, 'disburse:db-1', ${settledAt})`)).toBe(275_000n);
    const [t2] = await svc(sql, (tx) => tx<{ id: string }[]>`select id from public.pool_tranches where pool_id = ${p.id} and seq = 2`);
    await svc(sql, (tx) => tx`select public.submit_pool_tranche_evidence(${t2.id}, ${c.owner}, 'Mixing and mastering are done.', '{}', ${settledAt})`);
    await svc(sql, (tx) => tx`select public.verify_pool_tranche(${t2.id}, ${"b40e0a39-c7ef-5798-91f3-504e09b530f4"}, ${settledAt})`);
    const d2 = (await ops(sql, p.id)).find((x) => x.subject_id === t2.id)!;
    expect(n(d2.amount_minor)).toBe(275_000);
    await val(sql, (tx) => tx`select public.record_pool_tranche_released(${t2.id}, 'db-2', 275000, 'disburse:db-2', ${settledAt})`);
    expect(await refundConfirmed(sql, ic.id, ic.amount, settledAt)).toBe("applied");
    expect(await bal(sql, "pool_escrow", p.id)).toBe(0); // AC-E5
    expect(await bal(sql, "pool_issuer_payable", p.id)).toBe(0);
    expect(await bal(sql, "pool_investor_liability", p.id)).toBe(0);
    void ia; void ib;
  });

  it("failed path: every investor refunded in full, one pool_failed notice each with reason and amount, Pool refunded at the end", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 900_000 });
    const [a, b] = [await mkInvestor(sql, { accredited: true }), await mkInvestor(sql, { accredited: true })];
    const ia1 = await invest(sql, a, p.id, 10);
    const ia2 = await invest(sql, a, p.id, 5);
    const ib = await invest(sql, b, p.id, 20);
    const end = (await pool(sql, p.id)).ends_at;
    expect(await settle(sql, p.id, end)).toBe("failed");
    const row = await pool(sql, p.id);
    expect({ status: row.status, raised: n(row.raised_minor), investors: row.investors_count, committed: row.units_committed })
      .toEqual({ status: "failed", raised: 0, investors: 0, committed: 0 });
    const refunds = (await ops(sql, p.id)).filter((o) => o.kind === "refund");
    expect(refunds.map((o) => o.idempotency_key).sort()).toEqual([ia1.id, ia2.id, ib.id].map((x) => `refund:inv:${x}`).sort());
    const failed = (await notices(sql, "pool_failed")).filter((x) => x.pool_id === p.id);
    expect(failed.map((x) => [x.user_id, x.refund_minor, x.reason]).sort()).toEqual([[a, 150_000, "target_not_reached"], [b, 200_000, "target_not_reached"]].sort());
    await expectEscrowInvariant(sql, p.id);
    for (const i of [ia1, ia2]) await refundConfirmed(sql, i.id, i.amount, end);
    expect((await pool(sql, p.id)).status).toBe("failed");
    await refused(refundConfirmed(sql, ib.id, ib.amount + 1, end, "rf-wrong"), "refund_amount_mismatch");
    await refundConfirmed(sql, ib.id, ib.amount, end);
    expect((await pool(sql, p.id)).status).toBe("refunded");
    expect(await bal(sql, "pool_escrow", p.id)).toBe(0);
  });
});

describe("settlement honours counted reservations (L2-T-045)", () => {
  it("a reservation with a provider call started survives a funded settlement: still counted, not issued, resolved by lookup", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 100_000 });
    const p2 = await mkPool(sql, c, { durationDays: 60 });
    const big = await mkInvestor(sql, { accredited: true });
    const u = await mkInvestor(sql); // $2,500 limit
    await invest(sql, big, p.id, 20);
    const r = await reserve(sql, u, p.id, 20, at(T0, { days: 29, hours: 23 }));
    await callStarted(sql, r.id, at(T0, { days: 29, hours: 23 }));
    const uncalled = await reserve(sql, u, p.id, 1, at(T0, { days: 29, hours: 23 }));
    const end = (await pool(sql, p.id)).ends_at;
    expect(await settle(sql, p.id, end)).toBe("funded");
    expect((await inv(sql, r.id)).status).toBe("reserved");
    expect((await inv(sql, uncalled.id)).status).toBe("expired");
    const row = await pool(sql, p.id);
    expect({ raised: n(row.raised_minor), issued: row.units_issued, committed: row.units_committed }).toEqual({ raised: 200_000, issued: 20, committed: 40 });
    expect(0 - (await bal(sql, "pool_issuer_payable", p.id))).toBe(200_000);
    expect(await usage(sql, u, end)).toBe(200_000);
    await refused(reserve(sql, u, p2.id, 10, end), "regcf_limit_exceeded");
    await expectCounters(sql, p.id, end);
    // Pool no longer live → candidate after the grace; the lookup finds a fund move → refs stored → it settles unapplied.
    expect((await candidates(at(end, { minutes: 6 }))).find((x) => x.investment_id === r.id)?.action).toBe("lookup");
    await val(sql, (tx) => tx`select public.record_investment_provider_refs(${r.id}, ${`tr-${r.id}`}, ${`fm-${r.id}`}, ${end})`);
    expect(await funded(sql, r.id, 200_000, at(end, { minutes: 7 }))).toBe("refund:offering_closed");
    await expectCounters(sql, p.id, at(end, { minutes: 7 }));
    await refundConfirmed(sql, r.id, 200_000, at(end, { minutes: 8 }));
    await reserve(sql, u, p2.id, 10, at(end, { minutes: 9 }));
  });

  it("a failed Pool with such a row stays failed until the lookup resolves it (voided trade), then becomes refunded", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 900_000 });
    const u = await mkInvestor(sql, { accredited: true });
    const f = await invest(sql, u, p.id, 5);
    const r = await reserve(sql, u, p.id, 3, at(T0, { days: 29, hours: 23 }));
    await callStarted(sql, r.id, at(T0, { days: 29, hours: 23 }));
    const end = (await pool(sql, p.id)).ends_at;
    expect(await settle(sql, p.id, end)).toBe("failed");
    expect((await pool(sql, p.id)).units_committed).toBe(3); // counted reservation (+ funding) only
    await expectCounters(sql, p.id, end);
    await refundConfirmed(sql, f.id, f.amount, end);
    expect((await pool(sql, p.id)).status).toBe("failed");
    expect(await expireStep(p.id, at(end, { minutes: 6 }), [r.id])).toBe(1); // trade voided at the provider
    expect((await pool(sql, p.id)).status).toBe("refunded");
  });
});

describe("investor cancellation (L2-T-031, L2-T-043, L2-T-039)", () => {
  it("reserved with no provider call → cancelled at once, nothing charged; after the cut-off → cancel_window_closed", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 10);
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`)).toBe("cancelled");
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`)).toBe("cancelled"); // idempotent
    expect(await usage(sql, u)).toBe(0);
    const note = (await notices(sql, "investment_cancelled")).find((x) => x.investment_id === r.id)!;
    expect(note).toMatchObject({ refund_minor: 0, nothing_charged: true });
    const late = await reserve(sql, u, p.id, 1, at(T0, { days: 28, hours: 1 }));
    await refused(svc(sql, (tx) => tx`select public.cancel_investment(${late.id}, ${u}, ${at(T0, { days: 28, hours: 1 })})`), "cancel_window_closed");
  });

  it("cancel in funding before the cut-off, fund move settles after the cut-off → refund_pending, refund = received, never issued", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 100_000 });
    const big = await mkInvestor(sql, { accredited: true });
    await invest(sql, big, p.id, 20);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 10);
    await callStarted(sql, r.id);
    await markFunding(sql, r.id);
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`)).toBe("cancel_pending");
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${at(T0, { days: 29 })})`)).toBe("cancel_pending"); // repeat, after cut-off
    expect((await notices(sql, "cancel_pending")).filter((x) => x.investment_id === r.id)).toHaveLength(1);
    const late = at(T0, { days: 29 });
    expect(await funded(sql, r.id, 100_000, late)).toBe("refund:cancelled_by_investor");
    const row = await inv(sql, r.id);
    expect({ status: row.status, reason: row.status_reason, received: n(row.funded_received_minor) }).toEqual({ status: "refund_pending", reason: "cancelled_by_investor", received: 100_000 });
    expect((await ops(sql, p.id)).find((o) => o.idempotency_key === `refund:inv:${r.id}`)).toMatchObject({ amount_minor: 100_000n });
    expect((await notices(sql, "investment_cancelled")).find((x) => x.investment_id === r.id)).toMatchObject({ refund_minor: 100_000 });
    expect(n((await pool(sql, p.id)).raised_minor)).toBe(200_000);
    await expectEscrowInvariant(sql, p.id);
    expect(await settle(sql, p.id, (await pool(sql, p.id)).ends_at)).toBe("funded");
    expect((await inv(sql, r.id)).status).toBe("refund_pending");
    await refundConfirmed(sql, r.id, 100_000, late);
    expect((await inv(sql, r.id)).status).toBe("refunded");
  });

  it("cancel in funding, then the fund move is returned → returned, no refund op", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 5);
    await callStarted(sql, r.id);
    await markFunding(sql, r.id);
    await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`);
    expect(await val(sql, (tx) => tx`select public.record_investment_returned(${r.id}, ${`fm-${r.id}`}, 'R01', ${T0})`)).toBe("returned");
    expect((await ops(sql, p.id)).filter((o) => o.subject_id === r.id)).toHaveLength(0);
    expect(await usage(sql, u)).toBe(0);
  });

  it("reserved with a provider call started → cancel_pending; no trade → cancelled after the grace, headroom freed", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 25);
    await callStarted(sql, r.id);
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`)).toBe("cancel_pending");
    expect(await callStarted(sql, r.id)).toHaveLength(0); // the purchase's conditional update can't re-arm it
    expect(await usage(sql, u, at(T0, { minutes: 1 }))).toBe(250_000);
    expect((await candidates(at(T0, { minutes: 2 }))).find((x) => x.investment_id === r.id)).toBeUndefined();
    const c6 = (await candidates(at(T0, { minutes: 6 }))).find((x) => x.investment_id === r.id)!;
    expect(c6).toMatchObject({ action: "lookup", cancel_pending: true });
    expect(await expireStep(p.id, at(T0, { minutes: 6 }), [r.id])).toBe(1);
    expect((await inv(sql, r.id)).status).toBe("cancelled");
    expect(await usage(sql, u, at(T0, { minutes: 6 }))).toBe(0);
    expect((await notices(sql, "investment_cancelled")).find((x) => x.investment_id === r.id)).toMatchObject({ nothing_charged: true });
  });

  it("reserved with a call started and a fund move → stays counted, settles as cancelled_by_investor with a refund", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 5);
    await callStarted(sql, r.id);
    await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`);
    await val(sql, (tx) => tx`select public.record_investment_provider_refs(${r.id}, ${`tr-${r.id}`}, ${`fm-${r.id}`}, ${T0})`);
    expect((await candidates(at(T0, { minutes: 6 }))).find((x) => x.investment_id === r.id)).toBeUndefined();
    expect(await funded(sql, r.id, 50_000, at(T0, { minutes: 7 }))).toBe("refund:cancelled_by_investor");
    await expectCounters(sql, p.id, at(T0, { minutes: 7 }));
    await expectEscrowInvariant(sql, p.id);
  });

  it("funded → refund_pending with the received amount, counters adjusted at once", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await invest(sql, u, p.id, 10);
    expect(await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`)).toBe("cancelled");
    const row = await pool(sql, p.id);
    expect({ raised: n(row.raised_minor), investors: row.investors_count, committed: row.units_committed }).toEqual({ raised: 0, investors: 0, committed: 0 });
    expect((await notices(sql, "investment_cancelled")).find((x) => x.investment_id === r.id)).toMatchObject({ refund_minor: 100_000 });
    await expectEscrowInvariant(sql, p.id);
  });
});

describe("fund-move matching and strays (L2-T-032; design §3.1)", () => {
  const stray = (poolId: string, ref: string, amount: number, invId: string | null = null) =>
    val<string>(sql, (tx) => tx`select public.record_stray_fund_move(${poolId}, ${ref}, ${amount}, gen_random_uuid(), ${invId}, ${T0})`);

  it("(a) a second, different fund move for a funded investment is a stray: posted once, own refund op, investment unchanged", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await invest(sql, u, p.id, 10);
    expect(await funded(sql, r.id, 100_000, T0, "fm-second")).toBe("stray");
    expect(await stray(p.id, "fm-second", 100_000, r.id)).toBe("stray");
    expect(await stray(p.id, "fm-second", 100_000, r.id)).toBe("duplicate");
    expect((await inv(sql, r.id)).status).toBe("funded");
    expect(n((await pool(sql, p.id)).raised_minor)).toBe(100_000);
    expect((await ops(sql, p.id)).filter((o) => o.idempotency_key === "refund:fund:fm-second")).toHaveLength(1);
    await expectEscrowInvariant(sql, p.id);
    await refused(val(sql, (tx) => tx`select public.record_stray_fund_refund_confirmed('fm-second', 'rf-s', 99999, 'refund:rf-s', ${T0})`), "refund_amount_mismatch");
    expect(await val(sql, (tx) => tx`select public.record_stray_fund_refund_confirmed('fm-second', 'rf-s', 100000, 'refund:rf-s', ${T0})`)).toBe("applied");
    await expectEscrowInvariant(sql, p.id);
  });

  it("(b) a stray after the investment was cancelled: both refund ops exist and both confirm", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await invest(sql, u, p.id, 10);
    await val(sql, (tx) => tx`select public.cancel_investment(${r.id}, ${u}, ${T0})`);
    expect(await funded(sql, r.id, 100_000, T0, "fm-b2")).toBe("stray");
    await stray(p.id, "fm-b2", 100_000, r.id);
    const keys = (await ops(sql, p.id)).map((o) => o.idempotency_key).sort();
    expect(keys).toEqual([`refund:fund:fm-b2`, `refund:inv:${r.id}`].sort());
    await refundConfirmed(sql, r.id, 100_000);
    await val(sql, (tx) => tx`select public.record_stray_fund_refund_confirmed('fm-b2', 'rf-b2', 100000, 'refund:rf-b2', ${T0})`);
    expect(await bal(sql, "pool_escrow", p.id)).toBe(0);
  });

  it("(c) amount mismatch → refund_pending for the received amount + unapplied_funding break; AC-E1 on the received amount", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 10);
    await callStarted(sql, r.id);
    await markFunding(sql, r.id);
    expect(await funded(sql, r.id, 99_000)).toBe("refund:amount_mismatch");
    expect(n((await inv(sql, r.id)).funded_received_minor)).toBe(99_000);
    expect((await ops(sql, p.id)).find((o) => o.subject_id === r.id)).toMatchObject({ amount_minor: 99_000n });
    const [br] = await svc(sql, (tx) => tx<{ kind: string; amount_minor: bigint }[]>`select kind, amount_minor from public.pool_breaks where pool_id = ${p.id}`);
    expect(br).toEqual({ kind: "unapplied_funding", amount_minor: 99_000n });
    expect((await notices(sql, "payment_refunded_unapplied")).find((x) => x.investment_id === r.id)).toMatchObject({ reason: "amount_mismatch", refund_minor: 99_000 });
    await expectEscrowInvariant(sql, p.id);
    await expectCounters(sql, p.id, T0);
  });

  it("(d) fund moves on an expired and on a cancelled reservation are refunded from the received amount", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql, { accredited: true });
    const e = await reserve(sql, u, p.id, 2);
    await expireStep(p.id, at(T0, { minutes: 31 }));
    expect(await funded(sql, e.id, 20_000, at(T0, { minutes: 32 }))).toBe("refund:reservation_expired");
    const x = await reserve(sql, u, p.id, 3);
    await val(sql, (tx) => tx`select public.cancel_investment(${x.id}, ${u}, ${T0})`);
    expect(await funded(sql, x.id, 30_000)).toBe("refund:reservation_cancelled");
    await expectEscrowInvariant(sql, p.id);
    await expectCounters(sql, p.id, at(T0, { minutes: 32 }));
  });

  it("(e) the same event twice → duplicate (lock, then check)", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const u = await mkInvestor(sql);
    const r = await reserve(sql, u, p.id, 1);
    await callStarted(sql, r.id);
    await markFunding(sql, r.id);
    const res = await Promise.all([funded(sql, r.id, 10_000), funded(sql, r.id, 10_000)]);
    expect(res.sort()).toEqual(["applied", "duplicate"]);
    expect(n((await pool(sql, p.id)).raised_minor)).toBe(10_000);
  });
});

describe("commitment notice and transaction confirmation (L2-T-044)", () => {
  it("one commitment notice per investment, whichever path runs first; settlement confirms each issued investment", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 100_000 });
    const u = await mkInvestor(sql, { accredited: true });
    const a = await reserve(sql, u, p.id, 6);
    await callStarted(sql, a.id);
    await markFunding(sql, a.id);
    await funded(sql, a.id, a.amount);
    const b = await reserve(sql, u, p.id, 5);
    await callStarted(sql, b.id);
    await funded(sql, b.id, b.amount); // webhook first
    expect(await markFunding(sql, b.id)).toBe("funded");
    const commits = (await notices(sql, "commitment_received")).filter((x) => x.pool_id === p.id);
    expect(commits.map((x) => x.investment_id).sort()).toEqual([a.id, b.id].sort());
    const end = (await pool(sql, p.id)).ends_at;
    expect(commits[0]).toMatchObject({ amount_minor: 60_000, unit_price_minor: 10_000, units: 6, issuer_name: "Test Artist LLC" });
    expect(new Date(String(commits[0].cancel_by)).getTime()).toBe(at(end, { hours: -48 }).getTime());
    expect(await settle(sql, p.id, end)).toBe("funded");
    const conf = (await notices(sql, "units_issued")).filter((x) => x.pool_id === p.id);
    expect(conf).toHaveLength(2);
    expect(conf[0]).toMatchObject({ security_type: "revenue-share Units", offering_units_sold: 11, offering_unit_price_minor: 10_000, callable: false,
      return_cap_bps: 15_000, intermediary_compensation_pending: "L2-Q3", fee_schedule_pending: "L2-Q7", yield_pending: "L2-Q9" });
  });
});

describe("op key scheme (L2-T-040)", () => {
  it("re-queuing the same refund/disburse/close leaves one op; keys follow the scheme", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c);
    const id = "00000000-0000-4000-8000-000000000001";
    for (let i = 0; i < 2; i++) {
      await svc(sql, (tx) => tx`select public.l2_queue_op('refund', ${id}, ${p.id}, 100, ${T0})`);
      await svc(sql, (tx) => tx`select public.l2_queue_op('disburse', ${id}, ${p.id}, 100, ${T0})`);
      await svc(sql, (tx) => tx`select public.l2_queue_op('close_offering', ${p.id}, ${p.id}, 100, ${T0})`);
      await svc(sql, (tx) => tx`select public.l2_queue_op('refund', ${id}, ${p.id}, 100, ${T0}, 'fm-key')`);
    }
    expect((await ops(sql, p.id)).map((o) => o.idempotency_key).sort()).toEqual([`close:${p.id}`, `disburse:${id}`, "refund:fund:fm-key", `refund:inv:${id}`].sort());
  });
});

describe("flag on entry paths only (L2-T-038, SQL part)", () => {
  it("with the flag off: entry functions refuse; settlement, fund moves, refunds and cancellation still run", async () => {
    const c = await mkCreator(sql);
    const p = await mkPool(sql, c, { targetMinor: 900_000 });
    const u = await mkInvestor(sql, { accredited: true });
    const r1 = await invest(sql, u, p.id, 10);
    const r2 = await reserve(sql, u, p.id, 5);
    await callStarted(sql, r2.id);
    await markFunding(sql, r2.id);
    const r3 = await invest(sql, u, p.id, 2);
    const { setFlag } = await import("./l2-db-kit");
    await setFlag(sql, false);
    try {
      await refused(reserve(sql, u, p.id, 1), "layer2_disabled");
      const c2 = await mkCreator(sql);
      await refused(mkPool(sql, c2), "layer2_disabled");
      expect(await val(sql, (tx) => tx`select public.cancel_investment(${r3.id}, ${u}, ${T0})`)).toBe("cancelled");
      expect(await funded(sql, r2.id, r2.amount, at(T0, { seconds: 5 }))).toBe("applied");
      const end = (await pool(sql, p.id)).ends_at;
      expect(await settle(sql, p.id, end)).toBe("failed");
      for (const r of [r1, r2, r3]) await refundConfirmed(sql, r.id, r.amount, end);
      expect((await pool(sql, p.id)).status).toBe("refunded");
    } finally {
      await setFlag(sql, true);
    }
  });
});

describe("clients have no access to any Layer 2 object (L2-T-037)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(import.meta.dirname, "../../../supabase/migrations");
  const src = readdirSync(dir).filter((f) => /^\d{14}_l2_.*\.sql$/.test(f)).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const names = (re: RegExp) => [...new Set([...src.matchAll(re)].map((m) => m[1]))];
  const tables = names(/create table public\.([a-z0-9_]+)/g);
  const views = names(/create (?:or replace )?(?:materialized )?view public\.([a-z0-9_]+)/g);
  const sequences = names(/create sequence public\.([a-z0-9_]+)/g);
  const functions = names(/create (?:or replace )?function public\.([a-z0-9_]+)/g);

  it("parses the migrations (sanity)", () => {
    expect(tables).toEqual(expect.arrayContaining(["pools", "investments", "pool_ops", "pool_stray_fund_moves", "l2_notice_keys", "investor_profiles"]));
    expect(functions).toEqual(expect.arrayContaining(["reserve_investment", "settle_pool", "l2_maybe_mark_refunded", "l2_op_start_call"]));
    expect(views).toEqual([]);
    expect(sequences).toEqual([]);
  });

  it("anon and authenticated hold no table, column, sequence or function privilege; no public pool view exists", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const t of [...tables, ...views]) {
        const [r] = await sql<{ any: boolean; cols: boolean }[]>`
          select has_table_privilege(${role}, ${`public.${t}`}, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as any,
                 has_any_column_privilege(${role}, ${`public.${t}`}, 'SELECT, INSERT, UPDATE, REFERENCES') as cols`;
        expect({ role, t, ...r }).toEqual({ role, t, any: false, cols: false });
      }
      const fns = await sql<{ sig: string; ok: boolean }[]>`
        select p.oid::regprocedure::text as sig, has_function_privilege(${role}, p.oid, 'EXECUTE') as ok
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${functions})`;
      expect(fns.length).toBeGreaterThanOrEqual(functions.length);
      expect(fns.filter((f) => f.ok).map((f) => f.sig), role).toEqual([]);
      const seqs = await sql<{ oid: number; s: string }[]>`
        select c.oid::int as oid, c.relname as s from pg_class c join pg_depend d on d.objid = c.oid join pg_class t on t.oid = d.refobjid
         where c.relkind = 'S' and t.relnamespace = 'public'::regnamespace and t.relname = any(${tables})`;
      for (const q of seqs) {
        const [r] = await sql<{ ok: boolean }[]>`select has_sequence_privilege(${role}, ${q.oid}::oid, 'USAGE, SELECT, UPDATE') as ok`;
        expect({ role, seq: q.s, ok: r.ok }).toEqual({ role, seq: q.s, ok: false });
      }
    }
    const v = await sql`select 1 from pg_views where schemaname = 'public' and (viewname = 'pool_cards' or viewname like 'pool%' or viewname like 'l2%')`;
    expect(v).toHaveLength(0);
  });
});

void ACK;
