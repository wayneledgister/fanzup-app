/**
 * Layer 2 offering money: Reg CF limit (01a AC-I1, I2, I5), Unit availability, escrow invariants (01a AC-E1…E5),
 * target-or-refund, cancellation, late funding, duplicate webhooks. Specs: specs/l2/01-requirements.md §2–3.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asService, n } from "../src/db";
import { reconcileL2Ledger } from "../src/l2/service";
import { tick, tokenWith } from "./helpers";
import { ACK, advance, afterDeadline, buy, heldMinor, investor, l2kit, livePool, poolLedger, poolRow, risingCreator, type L2Kit } from "./l2-helpers";

const me = async (k: L2Kit, u: { auth: string }) => (await k.app.inject({ method: "GET", url: "/api/v1/investor/me", headers: { authorization: u.auth } })).json();
const invStatus = async (k: L2Kit, id: string) => (await asService(k.sql, (tx) => tx<{ s: string }[]>`select status::text as s from public.investments where id = ${id}`))[0].s;

/** AC-E1: Σ held == escrow ledger account == provider escrow balance. */
async function assertE1(k: L2Kit, poolId: string) {
  const led = await poolLedger(k.sql, poolId);
  const p = await poolRow(k.sql, poolId);
  const provider = (await k.regcf.getEscrow(p.offering)).balance;
  expect(led.pool_escrow ?? 0, "escrow ledger == provider escrow").toBe(provider);
  if (p.status === "live" || p.status === "failed" || p.status === "refunded") {
    expect(await heldMinor(k.sql, poolId), "Σ held == escrow ledger").toBe(led.pool_escrow ?? 0);
    expect(0 - (led.pool_investor_liability ?? 0), "investor liability == escrow (pre-close)").toBe((led.pool_escrow ?? 0) + 0);
  }
  expect(led.pool_escrow ?? 0, "AC-E5 escrow never negative").toBeGreaterThanOrEqual(0);
}

describe("Reg CF investment limit (01a §3)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established"); // many Pools in one test file: Rising's $100k cap would (correctly) stop us
  });
  afterAll(async () => { await k?.close(); });

  it("AC-I1: concurrent purchases across offerings never exceed the investor's limit", async () => {
    const poolA = await livePool(k, creator);
    const poolB = await livePool(k, creator);
    // income $30k / net worth $20k → limit = greater of $2,500 or 5% of $30k = $2,500
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    expect((await me(k, fan)).limitMinor).toBe(2_500_00);
    const attempts = Array.from({ length: 10 }, (_, i) => buy(k, fan, i % 2 ? poolA : poolB, 10)); // $500 each
    const results = await Promise.all(attempts);
    const ok = results.filter((r) => r.statusCode === 201);
    const refused = results.filter((r) => r.statusCode === 409);
    expect(ok).toHaveLength(5);
    expect(refused).toHaveLength(5);
    expect(new Set(refused.map((r) => r.json().error))).toEqual(new Set(["regcf_limit_exceeded"]));
    const m = await me(k, fan);
    expect(m.usedMinor).toBe(2_500_00);
    expect(m.remainingMinor).toBe(0);
  });

  it("AC-I1 (SQL): racing reservations on separate connections admit exactly what fits", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    const tries = await Promise.allSettled(
      Array.from({ length: 8 }, () => asService(k.sql, (tx) => tx`select * from public.reserve_investment(${fan.id}, ${pool}, 20, ${ACK})`)),
    );
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(2); // 2 × $1,000 fit in $2,500; a third doesn't
    expect(tries.filter((t) => t.status === "rejected").every((t) => (t as PromiseRejectedResult).reason.message === "regcf_limit_exceeded")).toBe(true);
  });

  it("Units never oversell under concurrency", async () => {
    const pool = await livePool(k, creator, { unitsTotal: 200, useOfFunds: [{ label: "Studio", amountMinor: 10_000_00 }] });
    const fans = await Promise.all(Array.from({ length: 5 }, () => investor(k, { accredited: true })));
    const res = await Promise.all(fans.map((f) => buy(k, f, pool, 70)));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(2);
    expect(res.filter((r) => r.statusCode === 409).every((r) => r.json().error === "pool_sold_out")).toBe(true);
    expect((await poolRow(k.sql, pool)).units_committed).toBe(140);
  });

  it("AC-I2: an unfunded reservation expires and frees the limit and the Units", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    const [r] = await asService(k.sql, (tx) => tx<{ investment_id: string }[]>`select * from public.reserve_investment(${fan.id}, ${pool}, 50, ${ACK})`);
    expect((await me(k, fan)).remainingMinor).toBe(0);
    await tick(k, new Date(Date.now() + 31 * 60_000));
    expect(await invStatus(k, r.investment_id)).toBe("expired");
    expect((await me(k, fan)).remainingMinor).toBe(2_500_00);
    expect((await poolRow(k.sql, pool)).units_committed).toBe(0);
  });

  it("AC-I2: a returned fund move (whole dollars ending in 13) frees the limit at once", async () => {
    const pool = await livePool(k, creator, { unitPriceMinor: 113_00, unitsTotal: 100 });
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    const r = await buy(k, fan, pool, 1);
    expect(r.statusCode, r.body).toBe(201);
    expect((await me(k, fan)).usedMinor).toBe(113_00);
    await advance(k, 3);
    expect(await invStatus(k, r.json().investmentId)).toBe("returned");
    expect((await me(k, fan)).usedMinor).toBe(0);
    expect(Number((await poolRow(k.sql, pool)).raised_minor)).toBe(0);
    await assertE1(k, pool);
  });

  it("AC-I5: the database enforces the limit even when the API is bypassed; accredited investors have none", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { incomeMinor: 30_000_00, netWorthMinor: 20_000_00 });
    await expect(asService(k.sql, (tx) => tx`select * from public.reserve_investment(${fan.id}, ${pool}, 51, ${ACK})`)).rejects.toThrow("regcf_limit_exceeded");
    const rich = await investor(k, { accredited: true });
    expect((await me(k, rich)).limitMinor).toBeNull();
    expect((await buy(k, rich, pool, 300)).statusCode).toBe(201);
  });

  it("purchases need KYC, certification, the current risk acknowledgment, and can't be the creator's own", async () => {
    const pool = await livePool(k, creator);
    const pending = await investor(k, { settle: false });
    expect((await buy(k, pending, pool, 1)).json().error).toBe("kyc_required");
    const rejected = await investor(k, { lastName: "KYCFAIL" });
    expect((await me(k, rejected)).kycStatus).toBe("rejected");
    expect((await buy(k, rejected, pool, 1)).json().error).toBe("kyc_required");
    const fan = await investor(k);
    const stale = await k.app.inject({ method: "POST", url: `/api/v1/pools/${pool}/investments`, headers: { authorization: fan.auth, "idempotency-key": `k-${randomUUID()}` }, payload: { units: 1, riskAckVersion: "old" } });
    expect(stale.json().error).toBe("risk_ack_required");
    await k.app.inject({ method: "POST", url: "/api/v1/investor/kyc", headers: { authorization: creator.auth }, payload: { firstName: "C", lastName: "Reator", state: "GA" } });
    await k.app.inject({ method: "POST", url: "/api/v1/investor/certification", headers: { authorization: creator.auth }, payload: { annualIncomeMinor: 1, netWorthMinor: 1, accredited: true } });
    await k.engine.advance(3);
    expect((await buy(k, creator, pool, 1)).json().error).toBe("self_investment");
  });

  it("AMLHOLD → manual review; staff decide (never their own)", async () => {
    const pool = await livePool(k, creator);
    const held = await investor(k, { lastName: "AMLHOLD" });
    expect((await me(k, held)).kycStatus).toBe("manual_review");
    const q = await k.app.inject({ method: "GET", url: "/api/v1/staff/l2/queue", headers: { authorization: k.staff } });
    expect(q.json().items.some((i: { type: string; id: string }) => i.type === "kyc_review" && i.id === held.id)).toBe(true);
    const d = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/investors/${held.id}/kyc`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Sanctions list hit was a name match only" } });
    expect(d.json().action.status, d.body).toBe("executed");
    expect((await me(k, held)).kycStatus).toBe("approved");
    expect((await buy(k, held, pool, 1)).statusCode).toBe(201);
    const self = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/investors/b40e0a39-c7ef-5798-91f3-504e09b530f4/kyc`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Trying to approve myself here" } });
    expect(self.statusCode).toBe(403);
  });

  it("purchase is idempotent per Idempotency-Key", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const key = `same-${randomUUID()}`;
    const a = await buy(k, fan, pool, 3, key);
    const b = await buy(k, fan, pool, 3, key);
    expect(b.json()).toEqual(a.json());
    expect((await buy(k, fan, pool, 4, key)).statusCode).toBe(422);
    const [{ c }] = await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.investments where investor_id = ${fan.id}`);
    expect(c).toBe(1);
  });
});

describe("Escrow invariants (01a AC-E1…E5)", () => {
  let k: L2Kit;
  let creator: Awaited<ReturnType<typeof risingCreator>>;
  beforeAll(async () => {
    k = await l2kit();
    creator = await risingCreator(k, "Established");
  });
  afterAll(async () => { await k?.close(); });

  it("funded Pool: E1 at every step, nothing to the issuer before close (E3), tranches gated (E4), escrow ends at zero (E5)", async () => {
    const pool = await livePool(k, creator); // target $10,000; 400 Units × $50
    const fans = await Promise.all([investor(k, { accredited: true }), investor(k, { accredited: true }), investor(k, { accredited: true })]);
    for (const [f, units] of [[fans[0], 40], [fans[1], 100], [fans[2], 60]] as const) {
      expect((await buy(k, f, pool, units)).statusCode).toBe(201);
      await advance(k, 3);
      await assertE1(k, pool);
    }
    expect(await heldMinor(k.sql, pool)).toBe(10_000_00);
    // E3: before the deadline nothing can be released.
    const [t2] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.pool_tranches where pool_id = ${pool} and seq = 2`);
    await expect(asService(k.sql, (tx) => tx`select public.verify_pool_tranche(${t2.id}, ${"b40e0a39-c7ef-5798-91f3-504e09b530f4"})`)).rejects.toThrow("pool_not_funded");
    expect((await poolLedger(k.sql, pool)).pool_issuer_payable ?? 0).toBe(0);

    await tick(k, await afterDeadline(k.sql, pool));
    expect((await poolRow(k.sql, pool)).status).toBe("funded");
    const issued = await asService(k.sql, (tx) => tx<{ status: string; lockup: Date }[]>`select status::text, lockup_ends_at as lockup from public.investments where pool_id = ${pool}`);
    expect(issued.every((i) => i.status === "issued")).toBe(true);
    expect(issued[0].lockup.getTime()).toBeGreaterThan(Date.now() + 364 * 86_400_000);
    await advance(k, 3); // tranche 1 disbursement settles
    let led = await poolLedger(k.sql, pool);
    expect(led.pool_escrow).toBe(5_000_00);
    expect(-led.pool_issuer_payable).toBe(5_000_00);
    await assertE1(k, pool);

    // E4: tranche 2 needs evidence, then a verifier who isn't the owner.
    const ev = await k.app.inject({ method: "POST", url: `/api/v1/creator/pool-tranches/${t2.id}/evidence`, headers: { authorization: creator.auth }, payload: { notes: "Masters delivered to the distributor", links: ["https://example.com/masters"] } });
    expect(ev.statusCode, ev.body).toBe(201);
    await expect(asService(k.sql, (tx) => tx`select public.verify_pool_tranche(${t2.id}, ${creator.id})`)).rejects.toThrow("reviewer_is_owner");
    const v = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-tranches/${t2.id}/verify`, headers: { authorization: k.staff }, payload: { reason: "Master files checked against the tracklist" } });
    expect(v.json().action.status).toBe("scheduled"); // $5,000 > single-operator delay threshold
    await tick(k, new Date(Date.now() + 25 * 3_600_000));
    await advance(k, 3);
    led = await poolLedger(k.sql, pool);
    expect(led.pool_escrow, "AC-E5 escrow ends at zero").toBe(0);
    expect(led.pool_issuer_payable).toBe(0);
    await assertE1(k, pool);
    expect((await reconcileL2Ledger(k.deps, pool)).diffMinor).toBe(0);
  });

  it("AC-E2: below target at the deadline → every investor refunded in full; escrow and provider back to zero", async () => {
    const pool = await livePool(k, creator);
    const fans = await Promise.all([investor(k, { accredited: true }), investor(k, { accredited: true })]);
    const ids: string[] = [];
    for (const f of fans) {
      const r = await buy(k, f, pool, 30);
      ids.push(r.json().investmentId);
    }
    await advance(k, 3);
    await assertE1(k, pool);
    await tick(k, await afterDeadline(k.sql, pool));
    expect((await poolRow(k.sql, pool)).status).toBe("failed");
    await advance(k, 3);
    expect((await poolRow(k.sql, pool)).status).toBe("refunded");
    for (const id of ids) expect(await invStatus(k, id)).toBe("refunded");
    const led = await poolLedger(k.sql, pool);
    expect(led.pool_escrow).toBe(0);
    expect(led.pool_investor_liability).toBe(0);
    expect((await k.regcf.getEscrow((await poolRow(k.sql, pool)).offering)).balance).toBe(0);
    const pf = await k.app.inject({ method: "GET", url: "/api/v1/portfolio", headers: { authorization: fans[0].auth } });
    expect(pf.json().investments[0]).toMatchObject({ status: "refunded", amountMinor: 1_500_00 });
  });

  it("cancellation before the cutoff refunds in full; after it, it's refused", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 10);
    await advance(k, 3);
    const c = await k.app.inject({ method: "POST", url: `/api/v1/investments/${r.json().investmentId}/cancel`, headers: { authorization: fan.auth } });
    expect(c.json().status, c.body).toBe("refund_pending");
    await advance(k, 3);
    expect(await invStatus(k, r.json().investmentId)).toBe("refunded");
    await assertE1(k, pool);
    const r2 = await buy(k, fan, pool, 10);
    await advance(k, 3);
    const late = new Date((await poolRow(k.sql, pool)).ends_at.getTime() - 3_600_000);
    await expect(asService(k.sql, (tx) => tx`select public.cancel_investment(${r2.json().investmentId}, ${fan.id}, ${late})`)).rejects.toThrow("cancel_window_closed");
  });

  it("a fund move that settles after the offering closed is recorded and refunded (money in, money out)", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    const r = await buy(k, fan, pool, 200); // meets target, settles
    await advance(k, 3);
    const late = await buy(k, fan, pool, 2); // in flight at the deadline
    await tick(k, await afterDeadline(k.sql, pool, 20 * 60_000)); // past the grace period
    expect((await poolRow(k.sql, pool)).status).toBe("funded");
    await advance(k, 3);
    expect(await invStatus(k, late.json().investmentId)).toBe("refund_pending");
    await advance(k, 3);
    expect(await invStatus(k, late.json().investmentId)).toBe("refunded");
    expect(await invStatus(k, r.json().investmentId)).toBe("issued");
    expect((await reconcileL2Ledger(k.deps, pool)).diffMinor).toBe(0);
  });

  it("duplicate webhook deliveries are harmless", async () => {
    const pool = await livePool(k, creator);
    const fan = await investor(k, { accredited: true });
    await buy(k, fan, pool, 5);
    await advance(k, 3);
    const before = await poolLedger(k.sql, pool);
    for (const w of k.engine.webhookLog().filter((x) => x.type === "fund_move.settled")) await k.engine.redeliver(w.id);
    await tick(k);
    expect(await poolLedger(k.sql, pool)).toEqual(before);
    expect(n((await poolRow(k.sql, pool)).raised_minor)).toBe(250_00);
  });

  it("staff can't approve a Pool they own (FR-ID-003)", async () => {
    const staffId = "b40e0a39-c7ef-5798-91f3-504e09b530f4";
    const [a] = await asService(k.sql, (tx) => tx<{ id: string }[]>`
      insert into public.artists (owner_id, slug, name, tier, identity_status) values (${staffId}, ${"staff-art-" + randomUUID().slice(0, 6)}, 'Staff Band', 'Rising', 'verified') returning id`);
    const staffAuth = `Bearer ${await tokenWith(staffId, { aal: "aal2" })}`;
    const c = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: staffAuth }, payload: (await import("./l2-helpers")).draft() });
    expect(c.statusCode, c.body).toBe(201);
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${c.json().id}/submit`, headers: { authorization: staffAuth } });
    const r = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${c.json().id}/review`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Approving my own Pool here" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("reviewer_is_owner");
    void a;
  });
});
