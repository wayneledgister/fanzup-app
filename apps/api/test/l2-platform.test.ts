/**
 * Layer 2 platform rules: server-side flag (FR-PLT-001 slice), mock provider refused when deployed, signed webhooks
 * (signature, replay, duplicates), creator tier rules, AC-R6, reviewer ≠ owner, no client access, shared ⇄ SQL sync,
 * Form C determinism, and M1 reconciliation unaffected by Layer 2 activity (L2 gate condition 1).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { signPayload } from "@fanzup/mock-escrow/signing";
import { COLLECTION_MECHANISMS, REVENUE_TYPES, regCfLimitMinor, riskBadge } from "@fanzup/shared/l2";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { loadEnv } from "../src/env";
import { formCInput } from "../src/l2/service";
import { runReconciliation } from "../src/recon";
import { back, createUser, ids, kit, pay, tick, type Kit } from "./helpers";
import { advance, afterDeadline, buy, draft, investor, l2kit, livePool, poolRow, risingCreator, setFlag, WEBHOOK_SECRET, type L2Kit } from "./l2-helpers";

describe("layer2 flag and environment (FR-PLT-001 slice; L2 gate condition 7)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit({ flag: false }); });
  afterAll(async () => { await k?.close(); });

  it("with the DB flag off every Layer 2 route is 404 layer2_disabled, and SQL refuses", async () => {
    const fan = await createUser(k.sql);
    for (const [method, url, auth] of [
      ["GET", "/api/v1/pools", null], ["GET", "/api/v1/pools/x", null], ["GET", "/api/v1/portfolio", fan.auth], ["POST", "/api/v1/investor/kyc", fan.auth],
      ["GET", "/api/v1/creator/pools", fan.auth], ["GET", "/api/v1/staff/l2/queue", k.staff], ["POST", "/api/v1/dev/l2/advance", null],
    ] as const) {
      const r = await k.app.inject({ method, url, headers: auth ? { authorization: auth } : {}, payload: method === "POST" ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().error).toBe("layer2_disabled");
    }
    await expect(asService(k.sql, (tx) => tx`select * from public.reserve_investment(${fan.id}, ${randomUUID()}, 1, 'x')`)).rejects.toThrow("layer2_disabled");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/config" })).json().flags).toEqual({ layer2: false });
  });

  it("staff turn the flag on through an audited privileged action", async () => {
    const r = await k.app.inject({ method: "POST", url: "/api/v1/staff/flags/layer2", headers: { authorization: k.staff }, payload: { on: true, reason: "Local demo of the album royalty Pool" } });
    expect(r.json().action.status, r.body).toBe("executed");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/config" })).json().flags).toEqual({ layer2: true });
    const [a] = await asService(k.sql, (tx) => tx<{ action: string }[]>`select action from public.audit_events where action like 'staff.flag.set%' order by id desc limit 1`);
    expect(a.action).toBe("staff.flag.set.executed");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools" })).statusCode).toBe(200);
    await setFlag(k.sql, false);
  });

  it("without a Reg CF provider the flag can't be on, and the mock provider is refused when deployed", async () => {
    const plain: Kit = await kit();
    try {
      await setFlag(plain.sql, true);
      expect((await plain.app.inject({ method: "GET", url: "/api/v1/pools" })).statusCode).toBe(404);
    } finally {
      await plain.close();
    }
    const base = { DATABASE_URL: "postgres://x@localhost/db", SUPABASE_JWT_SECRET: "s".repeat(40), ESCROW_PROVIDER: "stripe-test", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(() => loadEnv({ ...base, DEPLOY_ENV: "production", REGCF_PROVIDER: "mock" } as NodeJS.ProcessEnv)).toThrow(/mock escrow/);
    expect(() => loadEnv({ ...base, VERCEL_ENV: "preview", REGCF_PROVIDER: "mock" } as NodeJS.ProcessEnv)).toThrow(/mock escrow/);
    expect(loadEnv({ ...base, DEPLOY_ENV: "production" } as NodeJS.ProcessEnv).REGCF_PROVIDER).toBe("none");
  });
});

describe("signed webhooks (ADR-007; stored before processing)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  const evt = (type: string, data: object) => JSON.stringify({ id: `evt_${randomUUID()}`, type, createdAt: new Date().toISOString(), data });
  const post = (body: string, sig?: string) =>
    k.app.inject({ method: "POST", url: "/api/v1/webhooks/regcf", headers: { "content-type": "application/json", ...(sig ? { "x-mock-escrow-signature": sig } : {}) }, payload: body });

  it("rejects missing, wrong-secret, tampered and stale signatures without storing anything", async () => {
    const body = evt("offering.closed", { offeringId: "off_x" });
    expect((await post(body)).statusCode).toBe(400);
    expect((await post(body, signPayload("not-the-secret", body))).statusCode).toBe(400);
    expect((await post(body.replace("off_x", "off_y"), signPayload(WEBHOOK_SECRET, body))).statusCode).toBe(400);
    expect((await post(body, signPayload(WEBHOOK_SECRET, body, Math.floor(Date.now() / 1000) - 3600))).statusCode).toBe(400);
    const [{ c }] = await asService(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.provider_events where provider = 'mock-escrow'`);
    expect(c).toBe(0);
  });

  it("stores a valid event once; the same event id again is acknowledged as a duplicate and not reprocessed", async () => {
    const body = evt("offering.closed", { offeringId: "off_x" });
    const a = await post(body, signPayload(WEBHOOK_SECRET, body));
    const b = await post(body, signPayload(WEBHOOK_SECRET, body));
    expect(a.json()).toEqual({ received: true, duplicate: false });
    expect(b.json()).toEqual({ received: true, duplicate: true });
    const rows = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where provider = 'mock-escrow'`);
    expect(rows).toEqual([{ status: "processed" }]);
  });

  it("an event for an object we don't know yet waits instead of failing", async () => {
    const body = evt("fund_move.settled", { fundMoveId: "FM_unknown", tradeId: "T_x", amount: 100, externalId: randomUUID() });
    await post(body, signPayload(WEBHOOK_SECRET, body));
    const [r] = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where object_ref = 'FM_unknown'`);
    expect(r.status).toBe("received");
  });
});

describe("creator rules, Form C, reviewer ≠ owner, no client access", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("Starter creators can't create Pools (PRD 01 §6.3)", async () => {
    const starter = await risingCreator(k, "Starter");
    const r = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: starter.auth }, payload: draft() });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("tier_not_eligible");
  });

  it("the Rising Reg CF cap applies across all of the creator's Pools", async () => {
    const c = await risingCreator(k);
    await livePool(k, c, { unitsTotal: 1_000, unitPriceMinor: 60_00 }); // max $60,000
    const second = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ unitsTotal: 1_000, unitPriceMinor: 50_00 }) });
    const s = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${second.json().id}/submit`, headers: { authorization: c.auth } });
    expect(s.json().error).toBe("tier_cap_exceeded");
  });

  it("validates the draft: use of funds = target, split = 100%, milestones = 100%", async () => {
    const c = await risingCreator(k);
    const r1 = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ fansBps: 9000, platformBps: 1500 }) });
    expect(r1.json().error).toBe("split_invalid");
    const r2 = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 40, milestone: "x" }] }) });
    expect(r2.json().error).toBe("tranches_invalid");
    const r3 = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ unitsTotal: 10 }) });
    expect(r3.json().error).toBe("units_too_few");
  });

  it("AC-R6: an approved Pool can't go live before its collection mechanism is executed", async () => {
    const c = await risingCreator(k);
    const cr = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft() });
    const id = cr.json().id;
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth } });
    await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/review`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Form C matches the Pool data" } });
    const l = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/launch`, headers: { authorization: c.auth } });
    expect(l.statusCode).toBe(409);
    expect(l.json().error).toBe("collection_not_executed");
    await expect(asService(k.sql, (tx) => tx`select public.launch_pool(${id}, ${c.id}, 'i', 'o', 'c', 'n')`)).rejects.toThrow("collection_not_executed");
  });

  it("revisions requested → edit → resubmit produces a new Form C version; the Form C hash is deterministic", async () => {
    const c = await risingCreator(k);
    const cr = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft() });
    const id = cr.json().id;
    const a = await formCInput(k.sql, id);
    const b = await formCInput(k.sql, id);
    expect(b.sha256).toBe(a.sha256);
    expect(JSON.stringify(a.body)).toContain("Not filed with the SEC");
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth } });
    const rv = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/review`, headers: { authorization: k.staff }, payload: { decision: "revisions_requested", notes: "Name the distributor in the story.", reason: "Collection counterparty unclear" } });
    expect(rv.json().action.status).toBe("executed");
    const up = await k.app.inject({ method: "PATCH", url: `/api/v1/creator/pools/${id}`, headers: { authorization: c.auth }, payload: draft({ slug: `fix-${randomUUID().slice(0, 6)}`, story: "Distributed by Mock Distributor Inc." }) });
    expect(up.statusCode, up.body).toBe(200);
    const s2 = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth } });
    expect(s2.json().formC.sha256).not.toBe(a.sha256);
    const [{ v }] = await asService(k.sql, (tx) => tx<{ v: number }[]>`select max(version)::int as v from public.pool_documents where pool_id = ${id}`);
    expect(v).toBe(2);
    const other = await createUser(k.sql);
    expect((await k.app.inject({ method: "GET", url: `/api/v1/creator/pools/${id}`, headers: { authorization: other.auth } })).statusCode).toBe(404);
  });

  it("clients have no direct access to Layer 2 tables or functions", async () => {
    const fan = await createUser(k.sql);
    const asClient = (q: string) => k.sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: fan.id, role: "authenticated" })}, true)`;
      await tx.unsafe("set local role authenticated");
      return tx.unsafe(q);
    });
    for (const t of ["pools", "investments", "investor_profiles", "distribution_payouts", "pool_ops", "tax_1099_rows", "revenue_statements"]) {
      await expect(asClient(`select * from public.${t} limit 1`), t).rejects.toThrow(/permission denied/);
    }
    await expect(asClient(`select public.regcf_investor_limit('${fan.id}')`)).rejects.toThrow(/permission denied/);
    await expect(asClient(`select public.settle_pool('${randomUUID()}')`)).rejects.toThrow(/permission denied/);
  });

  it("discovery never sorts by money: only deadline or newest are accepted", async () => {
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools?sort=raised" })).statusCode).toBe(400);
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools?sort=ending" })).statusCode).toBe(200);
  });
});

describe("shared rules ⇄ database", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("policy mirrors match packages/shared POLICY", async () => {
    const rows = await asService(k.sql, (tx) => tx<{ key: string; value: Record<string, unknown> }[]>`select key, value from public.platform_settings where key in ('regcf_limits', 'l2_policy')`);
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(m.regcf_limits).toEqual({ floor_minor: POLICY.regCf.floorMinor, threshold_minor: POLICY.regCf.thresholdMinor, low_bps: POLICY.regCf.lowBps, high_bps: POLICY.regCf.highBps });
    expect(m.l2_policy).toEqual({
      reserve_minutes: POLICY.l2.reserveMinutes, settle_grace_minutes: POLICY.l2.settleGraceMinutes, cancel_cutoff_hours: POLICY.l2.cancelCutoffHours,
      lockup_months: POLICY.l2.lockupMonths, period_months: POLICY.l2.periodMonths, settlement_due_days: POLICY.l2.settlementDueDays, cure_days: POLICY.l2.cureDays,
      blocked_states: [...POLICY.l2.blockedStates], risk_ack_version: POLICY.l2.riskAckVersion,
    });
  });

  it("SQL risk badge equals the shared rule for every mechanism × revenue-type set", async () => {
    const sets = [["master"], ["sync"], ["publishing"], ["master", "sync"], ["master", "publishing"], ["master", "sync", "publishing"]] as const;
    for (const m of COLLECTION_MECHANISMS) for (const s of sets) {
      const [r] = await asService(k.sql, (tx) => tx<{ b: string }[]>`select public.l2_risk_badge(${m}, ${s as unknown as string[]}::public.revenue_type[])::text as b`);
      expect(r.b, `${m} ${s}`).toBe(riskBadge(m, [...s]));
    }
    expect(REVENUE_TYPES).toHaveLength(3);
  });

  it("SQL investor limit equals the shared formula", async () => {
    const cases = [[30_000_00, 20_000_00, false], [80_000_00, 150_000_00, false], [200_000_00, 150_000_00, false], [2_000_000_00, 5_000_000_00, false], [124_000_00, 124_000_00, false], [1, 1, true]] as const;
    for (const [inc, nw, acc] of cases) {
      const u = await createUser(k.sql);
      await asService(k.sql, (tx) => tx`insert into public.investor_profiles (user_id, annual_income_minor, net_worth_minor, accredited, certified_at) values (${u.id}, ${inc}, ${nw}, ${acc}, now())`);
      const [r] = await asService(k.sql, (tx) => tx<{ l: bigint | null }[]>`select public.regcf_investor_limit(${u.id}) as l`);
      expect(r.l == null ? null : n(r.l)).toBe(regCfLimitMinor({ annualIncomeMinor: inc, netWorthMinor: nw, accredited: acc }));
    }
  });
});

describe("M1 reconciliation is unaffected by Layer 2 money (L2 gate condition 1)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("Layer 1 recon still diffs to zero with Layer 2 postings in the same ledger; no Layer 2 notice failed", async () => {
    const fan = await createUser(k.sql);
    const b = await back(k, fan.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    await pay(k, b.json().backingId);
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const inv = await investor(k, { accredited: true });
    await buy(k, inv, pool, 200);
    await advance(k, 3);
    await tick(k, await afterDeadline(k.sql, pool));
    await advance(k, 3);
    expect((await poolRow(k.sql, pool)).status).toBe("funded");
    const r = await runReconciliation(k.sql, k.provider);
    expect(r.diffMinor).toBe(0);
    expect(r.breaks).toEqual([]);
    expect(r.campaigns.every((c) => c.campaignId !== pool)).toBe(true);
    await tick(k);
    const failed = await asService(k.sql, (tx) => tx`select topic, last_error from public.outbox where processed_at is null and attempts > 0`);
    expect(failed).toEqual([]);
  });
});
