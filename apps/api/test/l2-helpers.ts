/** Layer 2 test kit: the in-process mock escrow engine wired to the API's real webhook route (ADR-007 §3). */
import { randomUUID } from "node:crypto";
import { MockEscrowEngine } from "@fanzup/mock-escrow/engine";
import { POLICY } from "@fanzup/shared/policy";
import { InProcessRegCf } from "../src/regcf/inprocess";
import { asService, n, type Sql } from "../src/db";
import { createUser, ids, kit, tick, tokenWith, type Kit } from "./helpers";

export const WEBHOOK_SECRET = "test_regcf_webhook_secret_123";
export const ACK = POLICY.l2.riskAckVersion;

export interface L2Kit extends Kit {
  engine: MockEscrowEngine;
  regcf: InProcessRegCf;
  staff: string;
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
  return { ...k, engine, regcf, staff: `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}` };
}

export const setFlag = (sql: Sql, on: boolean) =>
  asService(sql, (tx) => tx`update public.platform_settings set value = ${tx.json(on)} where key = 'flag.layer2'`);

/** Worker tick, provider clock forward (KYC decisions, settlements → webhooks), worker tick again (at `at`, default now). */
export async function advance(k: L2Kit, seconds = 5, at?: Date) {
  await tick(k, at); // run queued ops first so the provider has something to settle
  await k.engine.advance(seconds);
  return tick(k, at);
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

/** Draft → submit → staff approves Form C + executes collection → creator launches. Returns the live Pool id. */
export async function livePool(k: L2Kit, creator: { auth: string }, over: Record<string, unknown> = {}) {
  const c = await k.app.inject({ method: "POST", url: "/api/v1/creator/pools", headers: { authorization: creator.auth }, payload: draft(over) });
  if (c.statusCode !== 201) throw new Error(`create ${c.statusCode} ${c.body}`);
  const id = c.json().id as string;
  const s = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/submit`, headers: { authorization: creator.auth } });
  if (s.statusCode !== 200) throw new Error(`submit ${s.statusCode} ${s.body}`);
  const r = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/review`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Form C matches the Pool data" } });
  if (r.statusCode !== 200 || r.json().action.status !== "executed") throw new Error(`review ${r.statusCode} ${r.body}`);
  const x = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pools/${id}/collection/execute`, headers: { authorization: k.staff }, payload: { reason: "Letter of direction countersigned (mock)" } });
  if (x.statusCode !== 200) throw new Error(`execute ${x.statusCode} ${x.body}`);
  const l = await k.app.inject({ method: "POST", url: `/api/v1/creator/pools/${id}/launch`, headers: { authorization: creator.auth } });
  if (l.statusCode !== 200) throw new Error(`launch ${l.statusCode} ${l.body}`);
  return id;
}

export const buy = (k: L2Kit, u: { auth: string }, poolId: string, units: number, key = `inv-${randomUUID()}`) =>
  k.app.inject({ method: "POST", url: `/api/v1/pools/${poolId}/investments`, headers: { authorization: u.auth, "idempotency-key": key }, payload: { units, riskAckVersion: ACK } });

export async function poolRow(sql: Sql, id: string) {
  const [p] = await asService(sql, (tx) => tx<{ status: string; raised_minor: bigint; units_committed: number; ends_at: Date; offering: string; collection: string; collection_state: string }[]>`
    select status::text, raised_minor, units_committed, ends_at, provider_offering_ref as offering, provider_collection_ref as collection, collection_state::text from public.pools where id = ${id}`);
  return p;
}

export async function poolLedger(sql: Sql, id: string) {
  const rows = await asService(sql, (tx) => tx<{ kind: string; b: bigint }[]>`
    select a.kind::text, coalesce(sum(e.amount_minor), 0) as b from public.ledger_accounts a left join public.ledger_entries e on e.account_id = a.id where a.pool_id = ${id} group by a.kind`);
  return Object.fromEntries(rows.map((r) => [r.kind, n(r.b)])) as Record<string, number>;
}

/** Σ funded-and-held investments of a Pool (AC-E1 left side). */
export async function heldMinor(sql: Sql, id: string) {
  const [r] = await asService(sql, (tx) => tx<{ s: bigint }[]>`select coalesce(sum(amount_minor), 0) as s from public.investments where pool_id = ${id} and status in ('funded', 'refund_pending')`);
  return n(r.s);
}

export async function afterDeadline(sql: Sql, poolId: string, extraMs = 3_600_000) {
  return new Date((await poolRow(sql, poolId)).ends_at.getTime() + extraMs);
}
