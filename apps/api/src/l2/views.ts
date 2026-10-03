/**
 * Layer 2 read models. All reads run as the service role with explicit scoping (clients have no grants on Layer 2
 * tables): public Pool views never include investor identities; portfolio rows are the caller's own; staff views are
 * behind requireStaff. Never ordered by money raised or anything return-like (PRD 02 §8).
 */
import type { InvestmentView, PoolCardView, PoolDetailView } from "@fanzup/shared/l2schemas";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "../db";
import { HttpError } from "../lib/auth";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

type CardRow = {
  id: string; slug: string; title: string; artist_display: string; status: string; revenue_types: string[]; risk_badge: string | null; fans_bps: number;
  unit_price_minor: bigint; units_total: number; units_committed: number; target_minor: bigint; max_minor: bigint; raised_minor: bigint; investors_count: number;
  return_cap_bps: number; maturity_months: number; ends_at: Date | null; release_date: Date | null; artist_id: string; artist_slug: string; artist_name: string;
  genre: string | null; city: string | null; tier: string; created_at: Date;
};
const CARD_COLS = `p.id, p.slug::text, p.title, p.artist_display, p.status::text, p.revenue_types::text[] as revenue_types, p.risk_badge::text, p.fans_bps,
  p.unit_price_minor, p.units_total, p.units_committed, p.target_minor, p.max_minor, p.raised_minor, p.investors_count, p.return_cap_bps, p.maturity_months,
  p.ends_at, p.release_date, a.id as artist_id, a.slug::text as artist_slug, a.name as artist_name, coalesce(p.genre, a.genre) as genre, a.city, a.tier::text, p.created_at`;
const PUBLIC = ["live", "funded", "failed", "refunded", "matured"];

const card = (r: CardRow): PoolCardView => ({
  id: r.id, slug: r.slug, title: r.title, artistDisplay: r.artist_display,
  artist: { id: r.artist_id, slug: r.artist_slug, name: r.artist_name, genre: r.genre, city: r.city, tier: r.tier },
  status: r.status as never, revenueTypes: r.revenue_types as never, riskBadge: r.risk_badge as never, fansBps: r.fans_bps,
  unitPriceMinor: n(r.unit_price_minor), unitsTotal: r.units_total, unitsLeft: Math.max(0, r.units_total - r.units_committed),
  targetMinor: n(r.target_minor), maxMinor: n(r.max_minor), raisedMinor: n(r.raised_minor), investors: r.investors_count,
  returnCapBps: r.return_cap_bps, maturityMonths: r.maturity_months, endsAt: iso(r.ends_at), releaseDate: day(r.release_date),
});

export async function listPools(sql: Sql, q: { tab: "live" | "closed"; revenueType?: string; badge?: string; genre?: string; sort: "ending" | "newest" }) {
  const statuses = q.tab === "live" ? ["live"] : ["funded", "failed", "refunded", "matured"];
  const rows = await asService(sql, (tx) => tx<CardRow[]>`
    select ${tx.unsafe(CARD_COLS)} from public.pools p join public.artists a on a.id = p.artist_id
     where p.status::text = any(${statuses})
       and (${q.revenueType ?? null}::text is null or ${q.revenueType ?? null}::public.revenue_type = any(p.revenue_types))
       and (${q.badge ?? null}::text is null or p.risk_badge::text = ${q.badge ?? null})
       and (${q.genre ?? null}::text is null or lower(coalesce(p.genre, a.genre)) = lower(${q.genre ?? null}))
     order by case when ${q.sort} = 'ending' then p.ends_at end asc nulls last,
              case when ${q.sort} = 'newest' then p.created_at end desc, p.id
     limit 60`);
  return { pools: rows.map(card) };
}

export async function poolDetail(sql: Sql, slugOrId: string): Promise<PoolDetailView> {
  const isId = /^[0-9a-f-]{36}$/.test(slugOrId);
  const [r] = await asService(sql, (tx) => tx<(CardRow & {
    story: string | null; risks: string | null; tracklist: string[]; use_of_funds: { label: string; amountMinor: number }[]; creator_bps: number; platform_bps: number;
    min_units: number; distribution_frequency: string; collection_mechanism: string; collection_state: string; closed_at: Date | null; matures_at: Date | null;
    form_c_version: number | null; form_c_sha: string | null; collected: bigint; distributed: bigint; periods: number;
  })[]>`
    select ${tx.unsafe(CARD_COLS)}, p.story, p.risks, p.tracklist, p.use_of_funds, p.creator_bps, p.platform_bps, p.min_units, p.distribution_frequency,
           p.collection_mechanism::text, p.collection_state::text, p.closed_at, p.matures_at, d.version as form_c_version, d.sha256 as form_c_sha,
           coalesce((select sum(collected_minor) from public.revenue_statements s where s.pool_id = p.id), 0) as collected,
           coalesce((select sum(amount_minor) from public.distribution_payouts x where x.pool_id = p.id and x.kind = 'investor' and x.status = 'paid'), 0) as distributed,
           (select count(*)::int from public.distribution_runs r where r.pool_id = p.id) as periods
      from public.pools p join public.artists a on a.id = p.artist_id left join public.pool_documents d on d.id = p.form_c_document_id
     where (${isId} and p.id::text = ${slugOrId}) or (not ${isId} and p.slug = ${slugOrId})`);
  if (!r || !PUBLIC.includes(r.status)) throw new HttpError(404, "pool_not_found", "We couldn't find that Pool.");
  const tranches = await asService(sql, (tx) => tx<{ seq: number; pct: number; milestone: string | null; status: string; target_date: Date | null; released_at: Date | null }[]>`
    select seq, pct, milestone, status::text, target_date, released_at from public.pool_tranches where pool_id = ${r.id} order by seq`);
  return {
    ...card(r), story: r.story, risks: r.risks, tracklist: r.tracklist, useOfFunds: r.use_of_funds, creatorBps: r.creator_bps, platformBps: r.platform_bps,
    minUnits: r.min_units, distributionFrequency: r.distribution_frequency, collectionMechanism: r.collection_mechanism, collectionState: r.collection_state as never,
    tranches: tranches.map((t) => ({ seq: t.seq, pct: t.pct, milestone: t.milestone, status: t.status, targetDate: day(t.target_date), releasedAt: iso(t.released_at) })),
    formC: r.form_c_sha ? { version: r.form_c_version ?? 1, sha256: r.form_c_sha } : null,
    closedAt: iso(r.closed_at), maturesAt: iso(r.matures_at), lockupMonths: POLICY.l2.lockupMonths, cancelCutoffHours: POLICY.l2.cancelCutoffHours,
    riskAckVersion: POLICY.l2.riskAckVersion,
    revenue: { collectedMinor: n(r.collected), distributedToFansMinor: n(r.distributed), periods: r.periods },
  };
}

export async function formCDocument(sql: Sql, slugOrId: string) {
  const p = await poolDetail(sql, slugOrId);
  const [d] = await asService(sql, (tx) => tx<{ body: unknown; sha256: string; version: number; created_at: Date }[]>`
    select d.body, d.sha256, d.version, d.created_at from public.pools p join public.pool_documents d on d.id = p.form_c_document_id where p.id = ${p.id}`);
  if (!d) throw new HttpError(404, "form_c_not_found", "This Pool has no Form C yet.");
  return { poolId: p.id, slug: p.slug, title: p.title, version: d.version, sha256: d.sha256, createdAt: d.created_at.toISOString(), body: d.body };
}

type InvRow = {
  id: string; pool_id: string; slug: string; title: string; artist_display: string; units: number; unit_price_minor: bigint; amount_minor: bigint; status: string;
  status_reason: string | null; created_at: Date; funded_at: Date | null; issued_at: Date | null; lockup_ends_at: Date | null; cap_minor: bigint; distributed_minor: bigint;
  received: bigint; refunded_at: Date | null; pool_status: string; ends_at: Date | null; matures_at: Date | null; collection_state: string; risk_badge: string | null;
};

export async function investmentsFor(sql: Sql, userId: string, investmentId?: string): Promise<InvestmentView[]> {
  const rows = await asService(sql, (tx) => tx<InvRow[]>`
    select i.id, i.pool_id, p.slug::text, p.title, p.artist_display, i.units, i.unit_price_minor, i.amount_minor, i.status::text, i.status_reason, i.created_at,
           i.funded_at, i.issued_at, i.lockup_ends_at, i.cap_minor, i.distributed_minor,
           coalesce((select sum(amount_minor) from public.distribution_payouts d where d.investment_id = i.id and d.status = 'paid'), 0) as received,
           i.refunded_at, p.status::text as pool_status, p.ends_at, p.matures_at, p.collection_state::text, p.risk_badge::text
      from public.investments i join public.pools p on p.id = i.pool_id
     where i.investor_id = ${userId} and (${investmentId ?? null}::uuid is null or i.id = ${investmentId ?? null}::uuid)
       and (i.status not in ('expired', 'cancelled') or ${investmentId ?? null}::uuid is not null)
     order by i.created_at desc`);
  const payouts = rows.length
    ? await asService(sql, (tx) => tx<{ investment_id: string; label: string; amount_minor: bigint; status: string; paid_at: Date | null; tax_form: string | null }[]>`
        select d.investment_id, r.label, d.amount_minor, d.status, d.paid_at, d.tax_form from public.distribution_payouts d join public.distribution_runs r on r.id = d.run_id
         where d.investment_id = any(${rows.map((r) => r.id)}::uuid[]) order by r.committed_at`)
    : [];
  const cutoffMs = POLICY.l2.cancelCutoffHours * 3_600_000;
  return rows.map((r) => ({
    id: r.id, poolId: r.pool_id, poolSlug: r.slug, poolTitle: r.title, artistDisplay: r.artist_display, units: r.units, unitPriceMinor: n(r.unit_price_minor),
    amountMinor: n(r.amount_minor), status: r.status as never, statusReason: r.status_reason, createdAt: r.created_at.toISOString(), fundedAt: iso(r.funded_at),
    issuedAt: iso(r.issued_at), lockupEndsAt: iso(r.lockup_ends_at), capMinor: n(r.cap_minor), distributedMinor: n(r.distributed_minor), receivedMinor: n(r.received),
    refundedAt: iso(r.refunded_at), poolStatus: r.pool_status as never, poolEndsAt: iso(r.ends_at), maturesAt: iso(r.matures_at),
    collectionState: r.collection_state as never, riskBadge: r.risk_badge as never,
    canCancelUntil: r.pool_status === "live" && r.ends_at && ["reserved", "funded"].includes(r.status) ? new Date(r.ends_at.getTime() - cutoffMs).toISOString() : null,
    payouts: payouts.filter((x) => x.investment_id === r.id).map((x) => ({ label: x.label, amountMinor: n(x.amount_minor), status: x.status, paidAt: iso(x.paid_at), taxForm: x.tax_form })),
  }));
}

export async function creatorPools(sql: Sql, userId: string) {
  const rows = await asService(sql, (tx) => tx<CardRow[]>`
    select ${tx.unsafe(CARD_COLS)} from public.pools p join public.artists a on a.id = p.artist_id where a.owner_id = ${userId} order by p.created_at desc`);
  return { pools: rows.map(card) };
}

export async function creatorPool(sql: Sql, userId: string, poolId: string) {
  const [r] = await asService(sql, (tx) => tx<(CardRow & Record<string, unknown>)[]>`
    select ${tx.unsafe(CARD_COLS)}, p.story, p.risks, p.tracklist, p.use_of_funds, p.creator_bps, p.platform_bps, p.min_units, p.duration_days, p.collection_mechanism::text,
           p.collection_state::text, p.closed_at, p.matures_at, p.genre as pool_genre
      from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId} and a.owner_id = ${userId}`);
  if (!r) throw new HttpError(404, "pool_not_found", "We couldn't find that Pool.");
  const [mech] = await asService(sql, (tx) => tx`select mechanism::text, badge::text, status, details, executed_at from public.collection_mechanisms where pool_id = ${poolId}`);
  const tranches = await asService(sql, (tx) => tx<{ id: string; seq: number; pct: number; milestone: string | null; evidence_required: string | null; target_date: Date | null; status: string; released_minor: bigint | null }[]>`
    select id, seq, pct, milestone, evidence_required, target_date, status::text, released_minor from public.pool_tranches where pool_id = ${poolId} order by seq`);
  const reviews = await asService(sql, (tx) => tx`select decision, notes, created_at from public.pool_reviews where pool_id = ${poolId} order by created_at desc`);
  const statements = await asService(sql, (tx) => tx<{ id: string; period_label: string; covered_minor: bigint; collected_minor: bigint; status: string; verification: string; created_at: Date }[]>`
    select id, period_label, covered_minor, collected_minor, status, verification, created_at from public.revenue_statements where pool_id = ${poolId} order by period_start`);
  const [money] = await asService(sql, (tx) => tx<{ escrow: bigint; issuer_payable: bigint; released: bigint; unalloc: bigint; creator_paid: bigint }[]>`
    select public.pool_balance('pool_escrow', ${poolId}) as escrow, -public.pool_balance('pool_issuer_payable', ${poolId}) as issuer_payable,
           coalesce((select sum(released_minor) from public.pool_tranches where pool_id = ${poolId}), 0) as released,
           -public.pool_balance('pool_revenue_unallocated', ${poolId}) as unalloc,
           coalesce((select sum(amount_minor) from public.distribution_payouts where pool_id = ${poolId} and kind = 'creator' and status = 'paid'), 0) as creator_paid`);
  return {
    ...card(r as CardRow), story: r.story, risks: r.risks, tracklist: r.tracklist, useOfFunds: r.use_of_funds, creatorBps: r.creator_bps, platformBps: r.platform_bps,
    minUnits: r.min_units, durationDays: r.duration_days, collectionMechanism: r.collection_mechanism, collectionState: r.collection_state, genre: r.pool_genre,
    closedAt: iso(r.closed_at as Date | null), maturesAt: iso(r.matures_at as Date | null),
    collection: mech ?? null, reviews,
    tranches: tranches.map((t) => ({ id: t.id, seq: t.seq, pct: t.pct, milestone: t.milestone, evidenceRequired: t.evidence_required, targetDate: day(t.target_date), status: t.status, releasedMinor: t.released_minor == null ? null : n(t.released_minor) })),
    statements: statements.map((s) => ({ id: s.id, periodLabel: s.period_label, coveredMinor: n(s.covered_minor), collectedMinor: n(s.collected_minor), status: s.status, verification: s.verification, createdAt: s.created_at.toISOString() })),
    money: { escrowMinor: n(money.escrow), issuerPayableMinor: n(money.issuer_payable), releasedMinor: n(money.released), unallocatedMinor: n(money.unalloc), creatorRoyaltiesPaidMinor: n(money.creator_paid) },
  };
}

export async function staffQueue(sql: Sql) {
  const items = await asService(sql, (tx) => tx<{ type: string; id: string; pool_id: string | null; summary: string; created: Date }[]>`
    select * from (
      select 'form_c_review' as type, p.id, p.id as pool_id, p.title || ' — ' || p.artist_display as summary, p.updated_at as created from public.pools p where p.status = 'in_review'
      union all
      select 'collection_execute', m.pool_id, m.pool_id, p.title || ': ' || m.mechanism::text, m.submitted_at
        from public.collection_mechanisms m join public.pools p on p.id = m.pool_id where m.status = 'submitted' and p.status in ('in_review', 'approved')
      union all
      select 'kyc_review', ip.user_id, null, coalesce(pr.display_name, 'Investor') || ' (' || coalesce(ip.state, '??') || ')', coalesce(ip.kyc_updated_at, ip.created_at)
        from public.investor_profiles ip join public.profiles pr on pr.id = ip.user_id where ip.kyc_status = 'manual_review'
      union all
      select 'milestone_verification', t.id, t.pool_id, 'Milestone ' || t.seq || ' of ' || p.title, now() from public.pool_tranches t join public.pools p on p.id = t.pool_id where t.status = 'evidence_submitted'
      union all
      select 'distribution_due', p.id, p.id, p.title || ': ' || (-public.pool_balance('pool_revenue_unallocated', p.id))::text || ' cents collected, not yet distributed', now()
        from public.pools p where p.status = 'funded' and public.pool_balance('pool_revenue_unallocated', p.id) < 0
      union all
      select 'break', b.id, b.pool_id, b.kind || ' ' || b.amount_minor, b.opened_at from public.pool_breaks b where b.resolved_at is null
      union all
      select 'op_failed', o.id, o.pool_id, o.kind || ' ' || o.status || ': ' || coalesce(o.last_error, ''), o.updated_at from public.pool_ops o where o.status in ('failed', 'dead')
    ) q order by created limit 200`);
  return { items: items.map((i) => ({ type: i.type, id: i.id, poolId: i.pool_id, summary: i.summary, createdAt: i.created.toISOString() })) };
}

export async function staffPools(sql: Sql) {
  const rows = await asService(sql, (tx) => tx<CardRow[]>`select ${tx.unsafe(CARD_COLS)} from public.pools p join public.artists a on a.id = p.artist_id order by p.created_at desc limit 200`);
  return { pools: rows.map(card) };
}

export async function staffMoney(sql: Sql, poolId: string) {
  const detailRows = await asService(sql, (tx) => tx<CardRow[]>`select ${tx.unsafe(CARD_COLS)} from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId}`);
  if (!detailRows.length) throw new HttpError(404, "pool_not_found", "We couldn't find that Pool.");
  const [extra] = await asService(sql, (tx) => tx`
    select p.collection_state::text as "collectionState", p.collection_mechanism::text as "collectionMechanism", p.provider_offering_ref as "offeringRef",
           p.provider_collection_ref as "collectionRef", p.closed_at as "closedAt", p.matures_at as "maturesAt", p.fans_bps as "fansBps", p.creator_bps as "creatorBps", p.platform_bps as "platformBps",
           (select d.sha256 from public.pool_documents d where d.id = p.form_c_document_id) as "formCSha256",
           (select row_to_json(m) from (select mechanism, badge, status, details, executed_at from public.collection_mechanisms where pool_id = p.id) m) as collection
      from public.pools p where p.id = ${poolId}`);
  const ledger = await asService(sql, (tx) => tx<{ kind: string; balance: bigint }[]>`
    select a.kind::text, coalesce(sum(e.amount_minor), 0) as balance from public.ledger_accounts a left join public.ledger_entries e on e.account_id = a.id
     where a.pool_id = ${poolId} group by a.kind order by a.kind`);
  const investments = await asService(sql, (tx) => tx<{ id: string; investor: string; units: number; amount: bigint; status: string; distributed: bigint; cap: bigint; created_at: Date }[]>`
    select i.id, coalesce(nullif(pr.display_name, ''), 'Investor') as investor, i.units, i.amount_minor as amount, i.status::text, i.distributed_minor as distributed, i.cap_minor as cap, i.created_at
      from public.investments i join public.profiles pr on pr.id = i.investor_id where i.pool_id = ${poolId} order by i.created_at`);
  const runs = await asService(sql, (tx) => tx`select id, label, run_total_minor::text, fans_minor::text, creator_minor::text, platform_minor::text, cap_overflow_minor::text, input_hash, status, committed_at from public.distribution_runs where pool_id = ${poolId} order by committed_at`);
  const statements = await asService(sql, (tx) => tx`select id, period_label, covered_minor::text, collected_minor::text, status, verification from public.revenue_statements where pool_id = ${poolId} order by period_start`);
  const settlements = await asService(sql, (tx) => tx`select provider_ref, amount_minor::text, reference, settled_at, statement_id from public.settlement_lines where pool_id = ${poolId} order by settled_at`);
  const tranches = await asService(sql, (tx) => tx`select id, seq, pct, milestone, status::text, released_minor::text from public.pool_tranches where pool_id = ${poolId} order by seq`);
  const breaks = await asService(sql, (tx) => tx`select id, kind, amount_minor::text, refs, opened_at from public.pool_breaks where pool_id = ${poolId} and resolved_at is null`);
  const ops = await asService(sql, (tx) => tx`select id, kind, amount_minor::text, status, provider_ref, attempts, last_error from public.pool_ops where pool_id = ${poolId} order by created_at`);
  return {
    pool: { ...card(detailRows[0]), ...extra },
    ledger: Object.fromEntries(ledger.map((l) => [l.kind, n(l.balance)])),
    investments: investments.map((i) => ({ id: i.id, investor: i.investor, units: i.units, amountMinor: n(i.amount), status: i.status, distributedMinor: n(i.distributed), capMinor: n(i.cap), createdAt: i.created_at.toISOString() })),
    runs, statements, settlements, tranches, breaks, ops,
  };
}
