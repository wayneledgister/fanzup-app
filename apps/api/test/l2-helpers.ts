/** Layer 2 test kit: the in-process mock escrow engine wired to the API's real webhook route (ADR-007 §3). */
import { randomUUID } from "node:crypto";
import { MockEscrowEngine } from "@fanzup/mock-escrow/engine";
import { POLICY } from "@fanzup/shared/policy";
import { InProcessRegCf } from "../src/regcf/inprocess";
import { RegCfError } from "../src/regcf/types";
import { asService, n, type Sql } from "../src/db";
import { jobDeps } from "../src/app";
import { runWorkerTick } from "../src/jobs";
import { createUser, ids, kit, tokenWith, type Kit } from "./helpers";

export const WEBHOOK_SECRET = "test_regcf_webhook_secret_123";
export const ACK = POLICY.l2.riskAckVersion;
export const STAFF_ID = ids.reviewer;

export interface L2Kit extends Kit {
  engine: MockEscrowEngine;
  regcf: InProcessRegCf;
  staff: string;
  /**
   * The test's clock (design §4.2 one clock): every tick runs at it, so ops queued at a later instant (a settlement at
   * the deadline) still run on the next tick. `livePool` starts a new timeline at real time.
   */
  clock: Date;
}

export async function l2kit(opts: { flag?: boolean; seed?: boolean } = {}): Promise<L2Kit> {
  const engine = new MockEscrowEngine({ db: ":memory:", webhookSecret: WEBHOOK_SECRET });
  const regcf = new InProcessRegCf(engine, WEBHOOK_SECRET);
  const k = await kit({ regcf }, { REGCF_PROVIDER: "mock", MOCK_ESCROW_WEBHOOK_SECRET: WEBHOOK_SECRET }, { layer2Seed: !!opts.seed });
  engine.deliver = async (body, headers) => {
    const r = await k.app.inject({ method: "POST", url: "/api/v1/webhooks/regcf", headers, payload: body });
    return r.statusCode === 200;
  };
  if (opts.flag !== false) await setFlag(k.sql, true);
  return { ...k, engine, regcf, staff: `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}`, clock: new Date() };
}

export const setFlag = (sql: Sql, on: boolean) =>
  asService(sql, (tx) => tx`update public.platform_settings set value = ${tx.json(on)} where key = 'flag.layer2'`);

/**
 * One worker tick (M1 steps + the Layer 2 step) at `at` (which becomes the kit clock), or at the kit clock — never behind
 * the mock provider's virtual clock, whose event times stamp what the webhooks queue.
 */
export async function tick(k: L2Kit, at?: Date) {
  if (at) k.clock = at;
  else if (k.engine.now() > k.clock.getTime()) k.clock = new Date(k.engine.now());
  return runWorkerTick(jobDeps(k.deps), k.clock, { recon: false });
}

/** Worker tick, provider clock forward (KYC decisions, settlements → webhooks), worker tick again. */
export async function advance(k: L2Kit, seconds = 5, at?: Date) {
  await tick(k, at); // run queued ops first so the provider has something to settle
  await k.engine.advance(seconds);
  k.clock = new Date(k.clock.getTime() + seconds * 1000);
  return tick(k);
}

/** Make the next call of `op` succeed at the provider but lose its response (a crash after the call). */
export function crashAfter(k: L2Kit, op: "createTrade" | "fundTrade") {
  const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const orig = target[op];
  target[op] = async (...a: unknown[]) => {
    target[op] = orig;
    await orig(...a);
    throw new RegCfError("retry", "network", `${op} response lost (test)`);
  };
}

/** Count calls of provider lookups made through the kit's adapter. */
export function countCalls(k: L2Kit, ops: string[]) {
  const counts: Record<string, number> = Object.fromEntries(ops.map((o) => [o, 0]));
  const target = k.regcf as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const op of ops) {
    const orig = target[op];
    target[op] = (...a: unknown[]) => {
      counts[op]++;
      return orig(...a);
    };
  }
  return counts;
}

export async function risingCreator(k: Kit, tier: "Starter" | "Rising" | "Established" = "Rising") {
  const u = await createUser(k.sql, { name: "Test Creator" });
  const slug = `artist-${u.id.slice(0, 8)}`;
  await asService(k.sql, (tx) => tx`
    insert into public.artists (owner_id, slug, name, genre, city, tier, identity_status) values (${u.id}, ${slug}, ${"Artist " + u.id.slice(0, 4)}, 'Alt R&B', 'Atlanta, GA', ${tier}, 'verified')`);
  return u;
}

export async function investor(k: L2Kit, opts: { lastName?: string; incomeMinor?: number; netWorthMinor?: number; accredited?: boolean; state?: string; settle?: boolean } = {}) {
  const u = await createUser(k.sql, { name: `Investor ${randomUUID().slice(0, 4)}` });
  const kyc = await k.app.inject({ method: "POST", url: "/api/v1/investor/kyc", headers: { authorization: u.auth }, payload: { firstName: "Test", lastName: opts.lastName ?? "Fan", state: opts.state ?? "AR" } });
  if (kyc.statusCode !== 200) throw new Error(`kyc start ${kyc.statusCode} ${kyc.body}`);
  const cert = await k.app.inject({
    method: "POST", url: "/api/v1/investor/certification", headers: { authorization: u.auth },
    payload: { annualIncomeMinor: opts.incomeMinor ?? 50_000_00, netWorthMinor: opts.netWorthMinor ?? 40_000_00, accredited: opts.accredited ?? false, elsewhereMinor: 0 },
  });
  if (cert.statusCode !== 200) throw new Error(`certification ${cert.statusCode} ${cert.body}`);
  if (opts.settle !== false) await k.engine.advance(3); // KYC decision webhook
  return u;
}

export const draft = (over: Record<string, unknown> = {}) => ({
  slug: `album-${randomUUID().slice(0, 8)}`,
  title: "Night Bloom",
  tracklist: ["Intro", "Night Bloom", "Velvet Hour"],
  story: "A ten-song record made with the live band.",
  useOfFunds: [{ label: "Studio time", amountMinor: 6_000_00 }, { label: "Mixing and mastering", amountMinor: 4_000_00 }],
  revenueTypes: ["master"],
  fansBps: 3000,
  platformBps: 500,
  unitsTotal: 400,
  unitPriceMinor: 50_00,
  durationDays: 30,
  collectionMechanism: "DISTRIBUTOR_REDIRECT",
  collectionDetails: { counterparty: "Mock Distributor Inc." },
  tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 50, milestone: "Album mastered", evidenceRequired: "Master files delivered", targetDate: "2027-06-01" }],
  ...over,
});

export const ATTEST = { otherRegCfSales12mMinor: 0 };

/** Draft → submit → staff approves Form C + executes collection → creator launches. Returns the Pool id. */
export async function approvedPool(k: L2Kit, creator: { auth: string }, over: Record<string, unknown> = {}) {
  const c = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: creator.auth }, payload: draft(over) });
  if (c.statusCode !== 201) throw new Error(`create ${c.statusCode} ${c.body}`);
  const id = c.json().id as string;
  const s = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: creator.auth }, payload: ATTEST });
  if (s.statusCode !== 200) throw new Error(`submit ${s.statusCode} ${s.body}`);
  const r = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/review`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Form C matches the Pool data" } });
  if (r.statusCode !== 200 || r.json().action.status !== "executed") throw new Error(`review ${r.statusCode} ${r.body}`);
  const x = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/collection/execute`, headers: { authorization: k.staff }, payload: { reason: "Letter of direction countersigned (mock)" } });
  if (x.statusCode !== 200) throw new Error(`execute ${x.statusCode} ${x.body}`);
  return id;
}

export async function livePool(k: L2Kit, creator: { auth: string }, over: Record<string, unknown> = {}) {
  k.clock = new Date();
  const id = await approvedPool(k, creator, over);
  const l = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/launch`, headers: { authorization: creator.auth }, payload: ATTEST });
  if (l.statusCode !== 200) throw new Error(`launch ${l.statusCode} ${l.body}`);
  return id;
}

export const buy = (k: L2Kit, u: { auth: string }, poolId: string, units: number, key = `inv-${randomUUID()}`) =>
  k.app.inject({ method: "POST", url: `/api/v1/pools/${poolId}/investments`, headers: { authorization: u.auth, "idempotency-key": key }, payload: { units, riskAckVersion: ACK } });

export const cancel = (k: L2Kit, u: { auth: string }, investmentId: string) =>
  k.app.inject({ method: "POST", url: `/api/v1/investments/${investmentId}/cancel`, headers: { authorization: u.auth } });

export async function poolRow(sql: Sql, id: string) {
  const [p] = await asService(sql, (tx) => tx<{ status: string; raised_minor: bigint; units_committed: number; ends_at: Date; offering: string; collection: string; collection_state: string; closed_at: Date | null; matures_at: Date | null }[]>`
    select status::text, raised_minor, units_committed, ends_at, provider_offering_ref as offering, provider_collection_ref as collection, collection_state::text, closed_at, matures_at
      from public.pools where id = ${id}`);
  return p;
}

export async function invRow(sql: Sql, id: string) {
  const [i] = await asService(sql, (tx) => tx<{ status: string; status_reason: string | null; provider_fund_ref: string | null; provider_trade_ref: string | null; cancel_requested_at: Date | null; provider_call_started_at: Date | null; reserve_expires_at: Date }[]>`
    select status::text, status_reason, provider_fund_ref, provider_trade_ref, cancel_requested_at, provider_call_started_at, reserve_expires_at from public.investments where id = ${id}`);
  return i;
}

export async function poolLedger(sql: Sql, id: string) {
  const rows = await asService(sql, (tx) => tx<{ kind: string; b: bigint }[]>`
    select a.kind::text, coalesce(sum(e.amount_minor), 0) as b from public.ledger_accounts a left join public.ledger_entries e on e.account_id = a.id where a.pool_id = ${id} group by a.kind`);
  return Object.fromEntries(rows.map((r) => [r.kind, n(r.b)])) as Record<string, number>;
}

/** AC-E1 left side: Σ funded_received_minor of funded + refund_pending investments + open strays (design §3). */
export async function heldMinor(sql: Sql, id: string) {
  const [r] = await asService(sql, (tx) => tx<{ s: bigint }[]>`
    select coalesce((select sum(funded_received_minor) from public.investments where pool_id = ${id} and status in ('funded', 'refund_pending')), 0)
         + coalesce((select sum(amount_minor) from public.pool_stray_fund_moves where pool_id = ${id} and refunded_at is null), 0) as s`);
  return n(r.s);
}

export async function afterDeadline(sql: Sql, poolId: string, extraMs = 3_600_000) {
  return new Date((await poolRow(sql, poolId)).ends_at.getTime() + extraMs);
}

export async function openBreaks(sql: Sql, poolId: string) {
  return asService(sql, (tx) => tx<{ kind: string; amount_minor: bigint; dedupe_key: string }[]>`
    select kind, amount_minor, dedupe_key from public.pool_breaks where pool_id = ${poolId} and resolved_at is null order by kind`);
}

export async function fundMovesAtMock(k: L2Kit, investmentId: string) {
  return k.engine.list("fundMove", (f) => f.externalId === investmentId);
}
