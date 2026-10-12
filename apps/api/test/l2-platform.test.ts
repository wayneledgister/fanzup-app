/**
 * Layer 2 platform rules: server-side flag on ENTRY paths only (FR-PLT-001 slice; L2-T-038), mock provider refused when
 * deployed, signed webhooks into main's claimed inbox (L2-T-006, L2-T-029), creator tier rules, AC-R6, reviewer ≠
 * owner, Form C built under the submit locks (round-1 review), idempotent launch, certification can't move the state
 * after KYC started, single-operator delay and daily limits for Layer 2 actions (L2-T-010), notices and the mock Form C
 * carry the D-2 line (L2-T-016, L2-T-039, L2-T-044), and M1 reconciliation unaffected by Layer 2 activity (gate cond. 1).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { signPayload } from "@fanzup/mock-escrow/signing";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { loadEnv } from "../src/env";
import { formCInput } from "../src/l2/service";
import { L2_DEMO_LINE, L2_TEMPLATES, renderL2, type L2TemplateId } from "../src/l2/notices";
import { L2_INTERMEDIARY_LINE } from "../src/l2/formc";
import { reconcileL2Ledger } from "../src/l2/recon";
import { executeDueActions } from "../src/staff";
import { runReconciliation } from "../src/recon";
import { back, createUser, ids, kit, pay, type Kit } from "./helpers";
import {
  ACK, ATTEST, advance, afterDeadline, approvedPool, buy, cancel, crashAfter, draft, investor, invRow, l2kit, livePool, poolLedger, poolRow, risingCreator,
  setFlag, tick, WEBHOOK_SECRET, type L2Kit,
} from "./l2-helpers";

const notices = (k: L2Kit, userId: string) =>
  asService(k.sql, (tx) => tx<{ template: string }[]>`select template from public.notifications where user_id = ${userId} order by created_at, template`).then((r) => r.map((x) => x.template));

describe("layer2 flag and environment (FR-PLT-001 slice; L2 gate condition 7)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit({ flag: false }); });
  afterAll(async () => { await k?.close(); });

  it("with the DB flag off every entry route is 404 layer2_disabled, and entry SQL refuses", async () => {
    const fan = await createUser(k.sql);
    for (const [method, url, auth] of [
      ["GET", "/api/v1/pools", null], ["GET", "/api/v1/pools/x", null], ["GET", "/api/v1/portfolio", fan.auth], ["POST", "/api/v1/investor/kyc", fan.auth],
      ["GET", "/api/v1/creator/pools", fan.auth], ["POST", `/api/v1/staff/l2/pools/${randomUUID()}/review`, k.staff], ["POST", "/api/v1/dev/l2/advance", null],
      ["POST", `/api/v1/staff/l2/pools/${randomUUID()}/deposits`, k.staff],
    ] as const) {
      const r = await k.app.inject({ method, url, headers: auth ? { authorization: auth } : {}, payload: method === "POST" ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().error).toBe("layer2_disabled");
    }
    await expect(asService(k.sql, (tx) => tx`select * from public.reserve_investment(${fan.id}, ${randomUUID()}, 1, 'x', ${new Date()})`)).rejects.toThrow("layer2_disabled");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/config" })).json().flags).toEqual({ layer2: false, layer2Completion: true });
    // Completion routes answer with the flag off (staff watch money in flight).
    expect((await k.app.inject({ method: "GET", url: "/api/v1/staff/l2/queue", headers: { authorization: k.staff } })).statusCode).toBe(200);
  });

  it("staff turn the flag on through an audited privileged action", async () => {
    const r = await k.app.inject({ method: "POST", url: "/api/v1/staff/flags/layer2", headers: { authorization: k.staff }, payload: { on: true, reason: "Local demo of the album royalty Pool" } });
    expect(r.json().action.status, r.body).toBe("executed");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/config" })).json().flags).toEqual({ layer2: true, layer2Completion: true });
    const [a] = await asService(k.sql, (tx) => tx<{ action: string }[]>`select action from public.audit_events where action like 'staff.flag.set%' order by id desc limit 1`);
    expect(a.action).toBe("staff.flag.set.executed");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools" })).statusCode).toBe(200);
    await setFlag(k.sql, false);
  });

  it("without a Reg CF provider the flag can't be on, every Layer 2 route is off, and the mock provider is refused when deployed", async () => {
    const plain: Kit = await kit();
    try {
      await setFlag(plain.sql, true);
      expect((await plain.app.inject({ method: "GET", url: "/api/v1/pools" })).statusCode).toBe(404);
      // No provider: no completion signal either (the web never renders the cancel-only view).
      expect((await plain.app.inject({ method: "GET", url: "/api/v1/config" })).json().flags).toEqual({ layer2: false, layer2Completion: false });
      const fan = await createUser(plain.sql);
      expect((await plain.app.inject({ method: "POST", url: `/api/v1/investments/${randomUUID()}/cancel`, headers: { authorization: fan.auth } })).json().error).toBe("layer2_disabled");
      const staff = await import("./helpers").then((h) => h.tokenWith(ids.reviewer, { aal: "aal2" }));
      const on = await plain.app.inject({ method: "POST", url: "/api/v1/staff/flags/layer2", headers: { authorization: `Bearer ${staff}` }, payload: { on: true, reason: "Trying without a provider" } });
      expect(on.json().error).toBe("provider_missing");
    } finally {
      await plain.close();
    }
    const base = { DATABASE_URL: "postgres://x@localhost/db", SUPABASE_JWT_SECRET: "s".repeat(40), ESCROW_PROVIDER: "stripe-test", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(() => loadEnv({ ...base, DEPLOY_ENV: "production", REGCF_PROVIDER: "mock" } as NodeJS.ProcessEnv)).toThrow(/mock escrow/);
    expect(() => loadEnv({ ...base, VERCEL_ENV: "preview", REGCF_PROVIDER: "mock" } as NodeJS.ProcessEnv)).toThrow(/mock escrow/);
    expect(loadEnv({ ...base, DEPLOY_ENV: "production" } as NodeJS.ProcessEnv).REGCF_PROVIDER).toBe("none");
  });
});

describe("flag off: money already in flight finishes, investors keep the cancel right (L2-T-038, design §2)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("cancels, webhooks, expiry lookups, settlement (funded and failed), ops, recon, staff views and collection state all run with the flag off", async () => {
    const creator = await risingCreator(k, "Established");
    const poolA = await livePool(k, creator); // target $10,000
    const poolB = await livePool(k, creator);
    const [f1, f2, f3, f4, f5] = await Promise.all([1, 2, 3, 4, 5].map(() => investor(k, { accredited: true })));
    expect((await buy(k, f1, poolA, 199)).statusCode).toBe(201);
    const b2 = await buy(k, f2, poolB, 10);
    const b3 = await buy(k, f3, poolB, 5);
    await advance(k, 3);
    crashAfter(k, "createTrade"); // f4: a trade exists at the provider, the response was lost
    const b4 = await buy(k, f4, poolA, 2);
    expect(b4.statusCode).toBe(502);
    const [inv4] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.investments where investor_id = ${f4.id}`);
    expect((await buy(k, f5, poolA, 1)).statusCode).toBe(201); // fund move pending at the provider

    // Staff turn Layer 2 off while escrow is held and money is in flight: always accepted.
    const off = await k.app.inject({ method: "POST", url: "/api/v1/staff/flags/layer2", headers: { authorization: k.staff }, payload: { on: false, reason: "Pausing the demo with escrow held" } });
    expect(off.json().action.status, off.body).toBe("executed");
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools" })).json().error).toBe("layer2_disabled");
    expect((await buy(k, f1, poolA, 1)).json().error).toBe("layer2_disabled");

    // 227.304(a): cancellation stays open — a funded investment, and a reservation whose provider call started.
    const c3 = await cancel(k, f3, b3.json().investmentId);
    expect(c3.json(), c3.body).toMatchObject({ result: "cancelled", investment: { status: "refund_pending" } });
    const c4 = await cancel(k, f4, inv4.id);
    expect(c4.json()).toMatchObject({ result: "cancel_pending", investment: { status: "reserved" } });
    expect((await k.app.inject({ method: "GET", url: `/api/v1/investments/${inv4.id}`, headers: { authorization: f4.auth } })).json().cancelRequestedAt).not.toBeNull();

    // The pending fund move's webhook is stored and applied; the cancel-pending reservation is resolved by the lookup.
    await advance(k, 3);
    expect((await k.app.inject({ method: "GET", url: "/api/v1/portfolio", headers: { authorization: f5.auth } })).statusCode).toBe(404); // entry read
    const [i5] = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.investments where investor_id = ${f5.id}`);
    expect(i5.status).toBe("funded");
    await tick(k, new Date(k.clock.getTime() + (POLICY.l2.expiryLookupGraceMinutes + 1) * 60_000));
    expect((await invRow(k.sql, inv4.id)).status).toBe("cancelled");
    expect(k.engine.list("trade", (t) => t.externalId === inv4.id).map((t) => t.status)).toEqual(["cancelled"]);

    // Settlement at the deadline (A funds, B fails), refunds, close and the first disbursement — all with the flag off.
    await tick(k, await afterDeadline(k.sql, poolA));
    await advance(k, 3);
    await advance(k, 3);
    expect((await poolRow(k.sql, poolA)).status).toBe("funded");
    expect(["failed", "refunded"]).toContain((await poolRow(k.sql, poolB)).status);
    expect((await poolRow(k.sql, poolB)).status).toBe("refunded");
    expect((await poolLedger(k.sql, poolA)).pool_escrow).toBe(5_000_00);
    for (const id of [b2.json().investmentId, b3.json().investmentId]) expect((await invRow(k.sql, id)).status).toBe("refunded");
    expect((await k.app.inject({ method: "GET", url: `/api/v1/staff/l2/pools/${poolA}/money`, headers: { authorization: k.staff } })).statusCode).toBe(200);
    expect((await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${poolA}/recon`, headers: { authorization: k.staff } })).json().ledger.diffMinor).toBe(0);
    expect((await reconcileL2Ledger(k, { now: k.clock })).breaks).toEqual([]);

    // No adverse collection-state move while off; staff can still move a Pool already in DEFAULT.
    await asService(k.sql, (tx) => tx`update public.pools set closed_at = closed_at - interval '200 days', matures_at = matures_at - interval '200 days' where id = ${poolA}`);
    await tick(k, new Date(k.clock.getTime() + 60_000));
    expect((await poolRow(k.sql, poolA)).collection_state).toBe("COLLECTING");
    await asService(k.sql, (tx) => tx`update public.pools set collection_state = 'DEFAULT' where id = ${poolA}`);
    const rem = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${poolA}/collection-state`, headers: { authorization: k.staff }, payload: { to: "REMEDIATION", reason: "Catch-up plan agreed while paused" } });
    expect(rem.json().action.status, rem.body).toBe("executed");

    await tick(k);
    expect(await notices(k, f3.id)).toEqual(expect.arrayContaining(["l2_investment_cancelled"]));
    expect(await notices(k, f4.id)).toEqual(expect.arrayContaining(["l2_cancel_pending", "l2_investment_cancelled"]));
    expect(await notices(k, f2.id)).toEqual(expect.arrayContaining(["l2_pool_failed", "l2_refund_completed"]));
  });
});

describe("signed webhooks (ADR-007; stored before processing, processed through main's claimed inbox)", () => {
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

  it("stores a valid event once; the same event id again is acknowledged as a duplicate and not reprocessed; the claim is released", async () => {
    const body = evt("offering.closed", { offeringId: "off_x" });
    const a = await post(body, signPayload(WEBHOOK_SECRET, body));
    const b = await post(body, signPayload(WEBHOOK_SECRET, body));
    expect(a.json()).toEqual({ received: true, duplicate: false });
    expect(b.json()).toEqual({ received: true, duplicate: true });
    const rows = await asService(k.sql, (tx) => tx<{ status: string; claim_token: string | null; lease_until: Date | null }[]>`
      select status, claim_token, lease_until from public.provider_events where provider = 'mock-escrow'`);
    expect(rows).toEqual([{ status: "processed", claim_token: null, lease_until: null }]);
  });

  it("an event for an object we don't know yet waits (back to received through the claim) instead of failing; also with the flag off", async () => {
    await setFlag(k.sql, false);
    const body = evt("fund_move.settled", { fundMoveId: "FM_unknown", tradeId: "T_x", amount: 100, externalId: randomUUID() });
    expect((await post(body, signPayload(WEBHOOK_SECRET, body))).statusCode).toBe(200);
    const [r] = await asService(k.sql, (tx) => tx<{ status: string; claim_token: string | null }[]>`select status, claim_token from public.provider_events where object_ref = 'FM_unknown'`);
    expect(r).toEqual({ status: "received", claim_token: null });
    await setFlag(k.sql, true);
  });
});

describe("creator rules, Form C, launch, certification, reviewer ≠ owner", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("Starter creators can't create Pools (PRD 01 §6.3)", async () => {
    const starter = await risingCreator(k, "Starter");
    const r = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: starter.auth }, payload: draft() });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("tier_not_eligible");
  });

  it("the Rising Reg CF cap applies across the creator's Pools and counts the attested outside sales (L2-T-019)", async () => {
    const c = await risingCreator(k);
    await livePool(k, c, { unitsTotal: 1_000, unitPriceMinor: 60_00 }); // max $60,000 of the $100,000 cap
    const second = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ unitsTotal: 1_000, unitPriceMinor: 50_00 }) });
    const s = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${second.json().id}/submit`, headers: { authorization: c.auth }, payload: ATTEST });
    expect(s.json().error).toBe("tier_cap_exceeded");
    const third = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ unitsTotal: 600, unitPriceMinor: 50_00 }) });
    const t = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${third.json().id}/submit`, headers: { authorization: c.auth }, payload: { otherRegCfSales12mMinor: 15_000_00 } });
    expect(t.statusCode).toBe(409);
    expect(t.json().error).toBe("tier_cap_exceeded"); // $60k + $30k + $15k attested > $100k
    const missing = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${third.json().id}/submit`, headers: { authorization: c.auth }, payload: {} });
    expect(missing.statusCode).toBe(400);
  });

  it("validates the draft: use of funds = target, split = 100%, milestones = 100%, at least 21 days", async () => {
    const c = await risingCreator(k);
    const r1 = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ fansBps: 9000, platformBps: 1500 }) });
    expect(r1.json().error).toBe("split_invalid");
    const r2 = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 40, milestone: "x" }] }) });
    expect(r2.json().error).toBe("tranches_invalid");
    const r3 = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ unitsTotal: 10 }) });
    expect(r3.json().error).toBe("units_too_few");
    expect((await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft({ durationDays: 20 }) })).statusCode).toBe(400);
  });

  it("AC-R6: an approved Pool can't go live before its collection mechanism is executed", async () => {
    const c = await risingCreator(k);
    const cr = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft() });
    const id = cr.json().id;
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth }, payload: ATTEST });
    await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/review`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Form C matches the Pool data" } });
    const l = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/launch`, headers: { authorization: c.auth }, payload: ATTEST });
    expect(l.statusCode).toBe(409);
    expect(l.json().error).toBe("collection_not_executed");
  });

  it("the mock Form C carries the D-2 line and the pending intermediary; revisions → resubmit makes a new version; the hash is deterministic", async () => {
    const c = await risingCreator(k);
    const cr = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft() });
    const id = cr.json().id;
    const a = await formCInput(k.sql, id);
    const b = await formCInput(k.sql, id);
    expect(b.sha256).toBe(a.sha256);
    expect(a.body.notice.startsWith(L2_DEMO_LINE)).toBe(true);
    expect(a.body.intermediary).toBe("Intermediary: pending — L2-Q3");
    expect(L2_INTERMEDIARY_LINE).toBe("Intermediary: pending — L2-Q3");
    expect(JSON.stringify(a.body)).not.toMatch(/registered intermediary|FINRA-registered/i);
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth }, payload: ATTEST });
    const rv = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/review`, headers: { authorization: k.staff }, payload: { decision: "revisions_requested", notes: "Name the distributor in the story.", reason: "Collection counterparty unclear" } });
    expect(rv.json().action.status).toBe("executed");
    const up = await k.app.inject({ method: "PATCH", url: `/api/v1/creator/pools/${id}`, headers: { authorization: c.auth }, payload: draft({ slug: `fix-${randomUUID().slice(0, 6)}`, story: "Distributed by Mock Distributor Inc." }) });
    expect(up.statusCode, up.body).toBe(200);
    const s2 = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth }, payload: ATTEST });
    expect(s2.json().formC.sha256).not.toBe(a.sha256);
    const [{ v }] = await asService(k.sql, (tx) => tx<{ v: number }[]>`select max(version)::int as v from public.pool_documents where pool_id = ${id}`);
    expect(v).toBe(2);
    const other = await createUser(k.sql);
    expect((await k.app.inject({ method: "GET", url: `/api/v1/creator/pools/${id}`, headers: { authorization: other.auth } })).statusCode).toBe(404);
  });

  it("round-1 review: a PATCH racing the submit can't make the Form C and the frozen terms disagree", async () => {
    const c = await risingCreator(k);
    for (let i = 0; i < 4; i++) {
      const cr = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: c.auth }, payload: draft() });
      const id = cr.json().id;
      const [s, p] = await Promise.all([
        k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: c.auth }, payload: ATTEST }),
        k.app.inject({ method: "PATCH", url: `/api/v1/creator/pools/${id}`, headers: { authorization: c.auth }, payload: draft({ slug: `race-${randomUUID().slice(0, 6)}`, title: "Raced Title" }) }),
      ]);
      expect(s.statusCode, s.body).toBe(200);
      expect([200, 409]).toContain(p.statusCode);
      const [row] = await asService(k.sql, (tx) => tx<{ title: string; same: boolean; doc_title: string; doc_sha: string }[]>`
        select p.title, p.terms_sha256 = public.l2_pool_terms_hash(p.id) as same, d.body #>> '{project,album}' as doc_title, d.sha256 as doc_sha
          from public.pools p join public.pool_documents d on d.id = p.form_c_document_id where p.id = ${id}`);
      expect(row.same).toBe(true);
      expect(row.doc_title).toBe(row.title);
      expect(row.doc_sha).toBe((await formCInput(k.sql, id)).sha256);
    }
  });

  it("round-1 review: a retried launch replays the same provider objects (end date from stored values, not the request time)", async () => {
    const c = await risingCreator(k);
    const id = await approvedPool(k, c);
    k.regcf.failNext("createCollectionAccount");
    const first = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/launch`, headers: { authorization: c.auth }, payload: ATTEST });
    expect(first.statusCode).toBe(502);
    await new Promise((r) => setTimeout(r, 1100)); // a retry later must still send identical parameters
    const second = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/launch`, headers: { authorization: c.auth }, payload: ATTEST });
    expect(second.statusCode, second.body).toBe(200);
    expect(k.engine.list("offering", (o) => o.externalId === id)).toHaveLength(1);
    expect((await poolRow(k.sql, id)).status).toBe("live");
  });

  it("round-1 review: certification can't change the state of residence once the identity check started", async () => {
    const fan = await investor(k, { state: "AR" });
    const r = await k.app.inject({ method: "POST", url: "/api/v1/investor/certification", headers: { authorization: fan.auth }, payload: { annualIncomeMinor: 1, netWorthMinor: 1, accredited: true, state: "NY" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("state_locked");
    const same = await k.app.inject({ method: "POST", url: "/api/v1/investor/certification", headers: { authorization: fan.auth }, payload: { annualIncomeMinor: 1, netWorthMinor: 1, accredited: true, state: "AR" } });
    expect(same.statusCode).toBe(200);
    expect(same.json().state).toBe("AR");
  });

  it("discovery never sorts by money: only deadline or newest are accepted", async () => {
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools?sort=raised" })).statusCode).toBe(400);
    expect((await k.app.inject({ method: "GET", url: "/api/v1/pools?sort=ending" })).statusCode).toBe(200);
  });
});

describe("Layer 2 staff actions in main's executing-claim executor: single-operator delay and daily limits (L2-T-010)", () => {
  let k: L2Kit;
  beforeAll(async () => { k = await l2kit(); });
  afterAll(async () => { await k?.close(); });

  it("a distribution commit above the delay threshold is scheduled, claimed by the worker and executed once", async () => {
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const f = await investor(k, { accredited: true });
    await buy(k, f, pool, 200);
    await advance(k, 3);
    await tick(k, await afterDeadline(k.sql, pool));
    await advance(k, 3);
    const [w] = (await k.app.inject({ method: "GET", url: `/api/v1/creator/pools/${pool}/periods`, headers: { authorization: creator.auth } })).json().periods;
    await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${pool}/statements`, headers: { authorization: creator.auth }, payload: { periodLabel: "Q1", periodStart: w.periodStart, periodEnd: w.periodEnd, lines: [{ revenueType: "master", source: "Mock", amountMinor: 2_000_00 }] } });
    await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/deposits`, headers: { authorization: k.staff }, payload: { amountMinor: 2_000_00, reference: "Q1" } });
    await advance(k, 2);
    await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/recon`, headers: { authorization: k.staff } });
    const dry = (await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/dry-run`, headers: { authorization: k.staff }, payload: { label: "Q1" } })).json();
    const c = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/commit`, headers: { authorization: k.staff }, payload: { label: "Q1", hash: dry.hash, reason: "First quarter reconciled" } });
    expect(c.json().action.status, c.body).toBe("scheduled"); // $2,000 > single-operator delay threshold
    expect(await asService(k.sql, (tx) => tx`select 1 from public.distribution_runs where pool_id = ${pool}`)).toHaveLength(0);
    await executeDueActions(k.deps, new Date(Date.now() + (POLICY.singleOperator.delayHours + 1) * 3_600_000));
    await executeDueActions(k.deps, new Date(Date.now() + (POLICY.singleOperator.delayHours + 2) * 3_600_000));
    expect(await asService(k.sql, (tx) => tx`select 1 from public.distribution_runs where pool_id = ${pool}`)).toHaveLength(1);
    const [a] = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.privileged_actions where id = ${c.json().action.id}`);
    expect(a.status).toBe("executed");
  });

  it("pool_tranche.verify and pool.distribution_commit have a daily limit in single-operator mode", async () => {
    for (const action of ["pool_tranche.verify", "pool.distribution_commit"]) {
      await asService(k.sql, (tx) => tx`
        insert into public.privileged_actions (action, actor_id, aal, reason, amount_minor, status)
        select ${action}, ${ids.reviewer}, 'aal2', 'seeded for the daily limit test', 1, 'executed' from generate_series(1, ${POLICY.singleOperator.dailyLimits.verifications})`);
    }
    const t = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-tranches/${randomUUID()}/verify`, headers: { authorization: k.staff }, payload: { reason: "One more verification today" } });
    expect(t.statusCode).toBe(404); // unknown milestone: refused before the limit — use a real one below
    const creator = await risingCreator(k, "Established");
    const pool = await livePool(k, creator);
    const [t2] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.pool_tranches where pool_id = ${pool} and seq = 2`);
    const v = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-tranches/${t2.id}/verify`, headers: { authorization: k.staff }, payload: { reason: "One more verification today" } });
    expect(v.statusCode).toBe(409);
    expect(v.json().error).toBe("daily_limit");
    const dry = (await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/dry-run`, headers: { authorization: k.staff }, payload: { label: "X1" } })).json();
    const c = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${pool}/distributions/commit`, headers: { authorization: k.staff }, payload: { label: "X1", hash: dry.hash, reason: "One more commit today" } });
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toBe("daily_limit");
  });
});

describe("notices and documents carry the D-2 line (L2-T-016 API part, L2-T-039, L2-T-044)", () => {
  it("every Layer 2 template renders the D-2 sentence verbatim", () => {
    const vars = { pool: "Night Bloom", amount: "$10.00", refund: "$10.00", units: 2, price: "$5.00", issuer: "X LLC", cancelBy: "2027-01-01 00:00 UTC",
      status: "approved", state: "AT_RISK", label: "Q1", ref: "RF_1", reason: "offering_closed", days: 5, date: "2027-01-01", unitsSold: 10, offeringPrice: "$5.00",
      capMultiple: 1.5, maturesAt: "2031-01-01", platformPct: 5, nothingCharged: false };
    for (const t of Object.keys(L2_TEMPLATES) as L2TemplateId[]) {
      const r = renderL2(t, vars);
      expect(r.text, t).toContain("Demo — not an offer of securities. Mock escrow and data.");
      expect(r.text, t).not.toMatch(/undefined|registered intermediary|guarantee|\byield\b/i);
    }
    // 227.303(f) fields labelled pending where they are.
    const conf = renderL2("l2_units_issued", vars).text;
    for (const s of ["L2-Q2", "L2-Q3", "L2-Q7", "L2-Q9", "not callable", "Transaction date"]) expect(conf).toContain(s);
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
    expect(n((await poolLedger(k.sql, pool)).pool_escrow)).toBe(5_000_00);
    void ACK;
  });
});
