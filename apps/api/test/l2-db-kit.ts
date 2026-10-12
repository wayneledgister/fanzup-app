/**
 * Layer 2 money tests against the SQL directly (PR #11 — DB + mock rails). Every call runs as service_role through
 * asService, exactly as the API will; every money function gets an explicit clock (`now`), as the design requires.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql, type Tx } from "../src/db";
import { createUser, freshDb, ids } from "./helpers";

export const ACK = POLICY.l2.riskAckVersion;
export const T0 = new Date("2027-02-01T12:00:00Z");
export const at = (base: Date, { days = 0, hours = 0, minutes = 0, seconds = 0 } = {}) =>
  new Date(base.getTime() + (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000);
export const STAFF = ids.reviewer;

export type Db = Awaited<ReturnType<typeof freshDb>>;

export async function l2Db(): Promise<Db> {
  const db = await freshDb();
  await setFlag(db.sql, true);
  return db;
}
export const setFlag = (sql: Sql, on: boolean) => sql`update public.platform_settings set value = ${on ? "true" : "false"}::jsonb where key = 'flag.layer2'`;

export const svc = <T>(sql: Sql, fn: (tx: Tx) => Promise<T>) => asService(sql, fn);
/** Call `select <expr>` as the service role and return the single value. */
export async function val<T = unknown>(sql: Sql, q: (tx: Tx) => Promise<Record<string, unknown>[]>): Promise<T> {
  const rows = await asService(sql, q);
  return Object.values(rows[0] ?? {})[0] as T;
}

/** Expect a rule refusal: message = rule code (M1 convention). */
export async function refused(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ message: code });
}

export async function mkCreator(sql: Sql, tier: "Rising" | "Established" | "Pro" = "Pro", owner?: string) {
  const ownerId = owner ?? (await createUser(sql, { name: "Creator" })).id;
  const slug = `art-${randomUUID().slice(0, 8)}`;
  const [a] = await sql<{ id: string }[]>`
    insert into public.artists (owner_id, slug, name, tier, identity_status) values (${ownerId}, ${slug}, 'Test Artist', ${tier}, 'verified') returning id`;
  return { owner: ownerId, artist: a.id };
}

export async function mkInvestor(sql: Sql, o: { incomeMinor?: number; netWorthMinor?: number; accredited?: boolean; elsewhereMinor?: number } = {}) {
  const u = await createUser(sql, { name: "Investor" });
  await sql`insert into public.investor_profiles (user_id, kyc_status, state, annual_income_minor, net_worth_minor, accredited, elsewhere_12m_minor, certified_at)
            values (${u.id}, 'approved', 'AR', ${o.incomeMinor ?? 3_000_000}, ${o.netWorthMinor ?? 2_000_000}, ${o.accredited ?? false}, ${o.elsewhereMinor ?? 0}, now())`;
  return u.id;
}

export interface PoolOpts {
  unitsTotal?: number;
  unitPriceMinor?: number;
  targetMinor?: number;
  durationDays?: number;
  fansBps?: number;
  platformBps?: number;
  returnCapBps?: number;
  maturityMonths?: number;
  tranches?: number[];
  other?: number;
  launch?: boolean;
  now?: Date;
}

/** Draft → submitted → approved → collection executed → live (unless launch: false / stops earlier). */
export async function mkPool(sql: Sql, c: { owner: string; artist: string }, o: PoolOpts = {}) {
  const now = o.now ?? T0;
  const unitsTotal = o.unitsTotal ?? 100;
  const price = o.unitPriceMinor ?? 10_000;
  const target = o.targetMinor ?? Math.max(100_000, Math.floor((unitsTotal * price) / 2));
  const fans = o.fansBps ?? 3000;
  const platform = o.platformBps ?? 500;
  const slug = `pool-${randomUUID().slice(0, 8)}`;
  const [p] = await sql<{ id: string }[]>`
    insert into public.pools (artist_id, slug, title, artist_display, tracklist, use_of_funds, revenue_types, fans_bps, creator_bps, platform_bps,
                              units_total, unit_price_minor, target_minor, duration_days, return_cap_bps, maturity_months)
    values (${c.artist}, ${slug}, 'Album', 'Test Artist', ${sql.json(["Track one"])}, ${sql.json([{ label: "Recording", amountMinor: target }])},
            '{master}', ${fans}, ${10_000 - fans - platform}, ${platform}, ${unitsTotal}, ${price}, ${target}, ${o.durationDays ?? 30},
            ${o.returnCapBps ?? 15_000}, ${o.maturityMonths ?? 60})
    returning id`;
  const tr = o.tranches ?? [50, 50];
  for (let i = 0; i < tr.length; i++) await sql`insert into public.pool_tranches (pool_id, seq, pct, milestone) values (${p.id}, ${i + 1}, ${tr[i]}, ${`Milestone ${i + 1}`})`;
  await sql`insert into public.collection_mechanisms (pool_id, mechanism, revenue_types, badge) values (${p.id}, 'DISTRIBUTOR_REDIRECT', '{master}', 'SECURED_ISH')`;
  if (o.launch === false) return { id: p.id, endsAt: null as Date | null };
  await submit(sql, p.id, c.owner, o.other ?? 0, now);
  await svc(sql, (tx) => tx`select public.review_pool(${p.id}, ${STAFF}, 'approved', null, ${now})`);
  await svc(sql, (tx) => tx`select public.execute_collection_mechanism(${p.id}, ${STAFF}, ${tx.json({ counterparty: "Distributor" })}, ${now})`);
  const endsAt = await launch(sql, p.id, c.owner, o.other ?? 0, now);
  return { id: p.id, endsAt };
}
export const submit = (sql: Sql, pool: string, owner: string, other: number, now = T0) =>
  svc(sql, (tx) => tx`select public.submit_pool(${pool}, ${owner}, ${tx.json({ formC: "mock" })}, ${"a".repeat(64)}, ${other}, ${now})`);
export async function launch(sql: Sql, pool: string, owner: string, other: number, now = T0) {
  const r = await val<Date>(sql, (tx) => tx`select public.launch_pool(${pool}, ${owner}, ${`iss-${pool}`}, ${`off-${pool}`}, ${`col-${pool}`}, 'Test Artist LLC', ${other}, ${now})`);
  return new Date(r);
}

export async function reserve(sql: Sql, user: string, pool: string, units: number, now = T0) {
  const [r] = await svc(sql, (tx) => tx<{ investment_id: string; amount_minor: bigint }[]>`select * from public.reserve_investment(${user}, ${pool}, ${units}, ${ACK}, ${now})`);
  return { id: r.investment_id, amount: n(r.amount_minor) };
}
/** The API's conditional update before the first provider call (design §5 (c)). */
export const callStarted = (sql: Sql, inv: string, now = T0) =>
  svc(sql, (tx) => tx`update public.investments set provider_call_started_at = ${now} where id = ${inv} and status = 'reserved' and cancel_requested_at is null and reserve_expires_at > ${now}`);
export const markFunding = (sql: Sql, inv: string, now = T0, fundRef = `fm-${inv}`) =>
  val<string>(sql, (tx) => tx`select public.mark_investment_funding(${inv}, ${`tr-${inv}`}, ${fundRef}, ${now})`);
export const funded = (sql: Sql, inv: string, amount: number, now = T0, fundRef = `fm-${inv}`) =>
  val<string>(sql, (tx) => tx`select public.record_investment_funded(${inv}, ${fundRef}, ${amount}, ${`fund:${fundRef}`}, ${now})`);
/** Reserve → call started → funding → fund move settled. */
export async function invest(sql: Sql, user: string, pool: string, units: number, now = T0) {
  const r = await reserve(sql, user, pool, units, now);
  await callStarted(sql, r.id, now);
  expect(await markFunding(sql, r.id, now)).toBe("funding");
  expect(await funded(sql, r.id, r.amount, at(now, { seconds: 3 }))).toBe("applied");
  return r;
}
export const refundConfirmed = (sql: Sql, inv: string, amount: number, now = T0, ref = `rf-${inv}`) =>
  val<string>(sql, (tx) => tx`select public.record_investment_refunded(${inv}, ${ref}, ${amount}, ${`refund:${ref}`}, ${now})`);
export const settle = (sql: Sql, pool: string, now: Date) => val<string>(sql, (tx) => tx`select public.settle_pool(${pool}, ${now})`);
export const usage = (sql: Sql, user: string, now = T0) => val<bigint>(sql, (tx) => tx`select public.regcf_usage(${user}, ${now})`).then(n);
export const limit = (sql: Sql, user: string) => val<bigint | null>(sql, (tx) => tx`select public.regcf_investor_limit(${user})`).then((v) => (v == null ? null : n(v)));
export const bal = (sql: Sql, kind: string, pool: string) => val<bigint>(sql, (tx) => tx`select public.pool_balance(${kind}::public.ledger_account_kind, ${pool})`).then(n);

export async function pool(sql: Sql, id: string) {
  const [p] = await svc(sql, (tx) => tx<Record<string, unknown>[]>`select * from public.pools where id = ${id}`);
  return p as { status: string; raised_minor: bigint; investors_count: number; units_committed: number; units_issued: number; ends_at: Date;
                closed_at: Date | null; matures_at: Date | null; collection_state: string; issuer_cap_remaining_minor: bigint | null; [k: string]: unknown };
}
export async function inv(sql: Sql, id: string) {
  const [i] = await svc(sql, (tx) => tx<Record<string, unknown>[]>`select * from public.investments where id = ${id}`);
  return i as { status: string; status_reason: string | null; funded_received_minor: bigint | null; units: number; amount_minor: bigint;
                provider_fund_ref: string | null; cancel_requested_at: Date | null; [k: string]: unknown };
}
export const ops = (sql: Sql, poolId: string) =>
  svc(sql, (tx) => tx<{ id: string; kind: string; subject_id: string; amount_minor: bigint; idempotency_key: string; status: string; fund_ref: string | null }[]>`
    select id, kind, subject_id, amount_minor, idempotency_key, status, fund_ref from public.pool_ops where pool_id = ${poolId} order by created_at, idempotency_key`);
export const notices = (sql: Sql, template?: string) =>
  svc(sql, (tx) => tx<{ payload: Record<string, unknown> }[]>`
    select payload from public.outbox where topic = 'l2.notify' and (${template ?? null}::text is null or payload ->> 'template' = ${template ?? null}) order by id`)
    .then((r) => r.map((x) => x.payload));

/**
 * AC-E1 (pre-close) and the liability invariant (design §3): escrow == liability == Σ funded_received of funded +
 * refund_pending investments + Σ open stray fund moves. After close only the liability equality holds this way.
 */
export async function expectEscrowInvariant(sql: Sql, poolId: string, opts: { closed?: boolean } = {}) {
  const expected = n(await val<bigint>(sql, (tx) => tx`
    select coalesce((select sum(funded_received_minor) from public.investments where pool_id = ${poolId} and status in ('funded', 'refund_pending')), 0)
         + coalesce((select sum(amount_minor) from public.pool_stray_fund_moves where pool_id = ${poolId} and refunded_at is null), 0)`));
  expect(0 - (await bal(sql, "pool_investor_liability", poolId)) || 0, "liability").toBe(expected);
  if (!opts.closed) expect(await bal(sql, "pool_escrow", poolId), "escrow (AC-E1)").toBe(expected);
  expect(await bal(sql, "pool_escrow", poolId), "escrow never negative (AC-E5)").toBeGreaterThanOrEqual(0);
}

/** units_committed == Σ Units of counted reservations + funding + funded + issued (design §5.1 counter check). */
export async function expectCounters(sql: Sql, poolId: string, now: Date) {
  const [r] = await svc(sql, (tx) => tx<{ committed: number; expected_units: bigint; raised: bigint; expected_raised: bigint; investors: number; expected_investors: bigint }[]>`
    select p.units_committed as committed,
           coalesce((select sum(units) from public.investments i where i.pool_id = p.id
                      and (i.status in ('funding', 'funded', 'issued') or public.l2_counted_reservation(i.status, i.reserve_expires_at, i.provider_call_started_at, ${now}))), 0) as expected_units,
           p.raised_minor as raised,
           coalesce((select sum(amount_minor) from public.investments i where i.pool_id = p.id and i.status in ('funded', 'issued')), 0) as expected_raised,
           p.investors_count as investors,
           (select count(distinct investor_id) from public.investments i where i.pool_id = p.id and i.status in ('funded', 'issued')) as expected_investors
      from public.pools p where p.id = ${poolId}`);
  expect({ units: r.committed, raised: n(r.raised), investors: r.investors })
    .toEqual({ units: n(r.expected_units), raised: n(r.expected_raised), investors: n(r.expected_investors) });
}
