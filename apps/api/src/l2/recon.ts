/**
 * Layer 2 reconciliation, ledger ⇄ provider (design §5.1; AC-E1). Per Pool, at one clock `now`:
 *  - balances: ledger `pool_escrow` vs the provider's settled escrow, ledger `pool_collection` vs the provider's settled
 *    collection account, both computed from `listTransactions` minus what is IN FLIGHT (the ref of a `pool_ops` row still
 *    `sent`, or the object of a `regcf.*` event received less than `recon.inflightGraceMinutes` ago and not processed yet)
 *    → `escrow_diff`, `collection_diff`;
 *  - per-transaction refs: every settled provider transaction must match one Pool ledger transaction with that
 *    `external_ref` and the same amount, and every ledger transaction with an `external_ref` must match a provider
 *    transaction (in-flight refs left out); a returned fund move matches an investment `returned` with that fund ref
 *    → `unmatched_provider_txn`, `unmatched_ledger_txn`;
 *  - counters: `raised_minor`, `investors_count`, `units_committed` (counted reservations + funding + funded + issued; a
 *    `reserved` row that is no longer counted but not yet expired by the expiry step is listed in `inFlight`)
 *    → `counter_mismatch` (not money, never pauses);
 *  - liability: credit balance of `pool_investor_liability` == Σ `funded_received_minor` of funded + refund_pending
 *    + Σ open stray fund moves → `liability_mismatch`;
 *  - open strays unconfirmed past `recon.maxBreakAgeBusinessDays` → `stray_fund_move_aged`;
 *  - refund ops not yet `sent` more than `l2.refundDirectBusinessDays` after they were owed → `refund_overdue`
 *    (non-pausing; alert `refund.overdue`).
 * Breaks live in `pool_breaks` (never `recon_breaks`); the derived kinds above auto-resolve `cleared_by_run`; money-path
 * breaks (`unapplied_funding`, `amount_mismatch`) and the revenue kinds are left to their owners. `platform_adjustments`
 * (M1's float) never appear here: Layer 2 has its own accounts and transactions. Flag-independent (completion path).
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "../db";
import { log, redact } from "../log";
import { businessDaysSince } from "../recon";
import type { RegCfProvider, RegCfTransaction } from "../regcf";

const DERIVED = ["escrow_diff", "collection_diff", "unmatched_provider_txn", "unmatched_ledger_txn", "counter_mismatch", "liability_mismatch", "stray_fund_move_aged", "refund_overdue"];
/** Ledger kinds that carry the provider's ref of a movement in or out of a Pool's escrow or collection account. */
const LEDGER_REF_KINDS = ["investment.funded", "investment.funded_stray", "investment.refunded", "investment.stray_refunded", "pool_tranche.released", "revenue.deposit", "distribution.paid"];

export interface L2Break { kind: string; dedupeKey: string; amountMinor: number; refs: Record<string, unknown> }
export interface L2PoolRecon {
  poolId: string;
  escrow: { ledgerMinor: number; providerMinor: number; diffMinor: number };
  collection: { ledgerMinor: number; providerMinor: number; diffMinor: number };
  breaks: L2Break[];
}
export interface L2ReconResult {
  pools: L2PoolRecon[];
  inFlight: { poolId: string; ref: string; kind: string; amountMinor: number }[];
  diffMinor: number;
  breaks: (L2Break & { poolId: string })[];
}

const signed = (t: RegCfTransaction) => (t.kind === "fund_move" || t.kind === "deposit" ? t.amount : -t.amount);

export async function reconcileL2Ledger(d: { sql: Sql; regcf: RegCfProvider }, opts: { poolId?: string; now?: Date } = {}): Promise<L2ReconResult> {
  const now = opts.now ?? new Date();
  const { sql, regcf } = d;
  const pools = await asService(sql, (tx) => tx<{ id: string; offering: string; collection: string | null; escrow: bigint; coll: bigint; liability: bigint; raised: bigint; investors: number; units: number }[]>`
    select id, provider_offering_ref as offering, provider_collection_ref as collection,
           public.pool_balance('pool_escrow', id) as escrow, public.pool_balance('pool_collection', id) as coll,
           -public.pool_balance('pool_investor_liability', id) as liability, raised_minor as raised, investors_count as investors, units_committed as units
      from public.pools where provider_offering_ref is not null and (${opts.poolId ?? null}::uuid is null or id = ${opts.poolId ?? null}::uuid)
     order by id`);
  const inFlightRefs = new Set(
    (await asService(sql, (tx) => tx<{ ref: string }[]>`
      select provider_ref as ref from public.pool_ops where status = 'sent' and provider_ref is not null
      union
      select object_ref from public.provider_events
       where provider = 'mock-escrow' and status in ('received', 'processing', 'failed') and object_ref is not null
         and received_at > ${now}::timestamptz - make_interval(mins => ${POLICY.recon.inflightGraceMinutes})`)).map((r) => r.ref),
  );
  const out: L2PoolRecon[] = [];
  const inFlight: L2ReconResult["inFlight"] = [];
  for (const p of pools) {
    let txns: RegCfTransaction[];
    try {
      txns = [...(await regcf.listTransactions({ offeringId: p.offering })), ...(p.collection ? await regcf.listTransactions({ collectionAccountId: p.collection }) : [])];
    } catch (e) {
      log("warn", "l2_recon.provider_unavailable", { poolId: p.id, error: redact(String((e as Error).message ?? e)) });
      continue;
    }
    const breaks: L2Break[] = [];
    const settled = txns.filter((t) => t.status === "settled");
    for (const t of settled.filter((x) => inFlightRefs.has(x.id))) inFlight.push({ poolId: p.id, ref: t.id, kind: t.kind, amountMinor: signed(t) });
    const counted = settled.filter((t) => !inFlightRefs.has(t.id));

    // Balances, in-flight amounts left out.
    const escrowSide = (t: RegCfTransaction) => t.kind === "fund_move" || t.kind === "refund" || t.kind === "disbursement";
    const providerEscrow = counted.filter(escrowSide).reduce((s, t) => s + signed(t), 0);
    const providerColl = counted.filter((t) => !escrowSide(t)).reduce((s, t) => s + signed(t), 0);
    const row: L2PoolRecon = {
      poolId: p.id,
      escrow: { ledgerMinor: n(p.escrow), providerMinor: providerEscrow, diffMinor: providerEscrow - n(p.escrow) },
      collection: { ledgerMinor: n(p.coll), providerMinor: providerColl, diffMinor: providerColl - n(p.coll) },
      breaks,
    };
    if (row.escrow.diffMinor !== 0) breaks.push({ kind: "escrow_diff", dedupeKey: `escrow_diff:${p.id}`, amountMinor: row.escrow.diffMinor, refs: { ...row.escrow } });
    if (row.collection.diffMinor !== 0) breaks.push({ kind: "collection_diff", dedupeKey: `collection_diff:${p.id}`, amountMinor: row.collection.diffMinor, refs: { ...row.collection } });

    // Per-transaction refs, both ways.
    const ledger = await asService(sql, (tx) => tx<{ ref: string; kind: string; amount: bigint }[]>`
      select t.external_ref as ref, t.kind, (select coalesce(sum(e.amount_minor), 0) from public.ledger_entries e where e.transaction_id = t.id and e.amount_minor > 0) as amount
        from public.ledger_transactions t where t.pool_id = ${p.id} and t.external_ref is not null and t.kind = any(${LEDGER_REF_KINDS})`);
    const ledgerByRef = new Map(ledger.map((l) => [l.ref, l]));
    const returnedRefs = new Set((await asService(sql, (tx) => tx<{ ref: string }[]>`
      select provider_fund_ref as ref from public.investments where pool_id = ${p.id} and status = 'returned' and provider_fund_ref is not null`)).map((r) => r.ref));
    const providerRefs = new Set<string>();
    for (const t of txns) {
      if (inFlightRefs.has(t.id)) continue;
      if (t.kind === "fund_move" && t.status === "returned") {
        if (!returnedRefs.has(t.id)) breaks.push({ kind: "unmatched_provider_txn", dedupeKey: `unmatched_provider_txn:${p.id}:${t.id}`, amountMinor: 0, refs: { ref: t.id, kind: "fund_move_returned", amount_minor: t.amount } });
        continue;
      }
      if (t.status !== "settled") continue;
      providerRefs.add(t.id);
      const l = ledgerByRef.get(t.id);
      if (!l || n(l.amount) !== t.amount) {
        breaks.push({ kind: "unmatched_provider_txn", dedupeKey: `unmatched_provider_txn:${p.id}:${t.id}`, amountMinor: signed(t), refs: { ref: t.id, kind: t.kind, amount_minor: t.amount, ledger_minor: l ? n(l.amount) : null } });
      }
    }
    for (const l of ledger) {
      if (inFlightRefs.has(l.ref)) continue;
      const t = settled.find((x) => x.id === l.ref);
      if (!providerRefs.has(l.ref) || !t || t.amount !== n(l.amount)) {
        breaks.push({ kind: "unmatched_ledger_txn", dedupeKey: `unmatched_ledger_txn:${p.id}:${l.ref}`, amountMinor: n(l.amount), refs: { ref: l.ref, kind: l.kind, amount_minor: n(l.amount) } });
      }
    }

    // Counters (counted reservations; uncounted-but-unexpired reservations listed in flight) and the liability.
    const [c] = await asService(sql, (tx) => tx<{ raised: bigint; investors: number; units_all: number; uncounted: { id: string; units: number }[]; expected_liability: bigint }[]>`
      select coalesce(sum(i.amount_minor) filter (where i.status in ('funded', 'issued')), 0) as raised,
             count(distinct i.investor_id) filter (where i.status in ('funded', 'issued'))::int as investors,
             coalesce(sum(i.units) filter (where i.status in ('reserved', 'funding', 'funded', 'issued')), 0)::int as units_all,
             coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'units', i.units)) filter (
               where i.status = 'reserved' and not public.l2_counted_reservation(i.status, i.reserve_expires_at, i.provider_call_started_at, ${now})), '[]') as uncounted,
             coalesce(sum(i.funded_received_minor) filter (where i.status in ('funded', 'refund_pending')), 0)
               + coalesce((select sum(s.amount_minor) from public.pool_stray_fund_moves s where s.pool_id = ${p.id} and s.refunded_at is null), 0) as expected_liability
        from public.investments i where i.pool_id = ${p.id}`);
    for (const u of c.uncounted) inFlight.push({ poolId: p.id, ref: `reservation:${u.id}`, kind: "uncounted_reservation", amountMinor: 0 });
    if (n(c.raised) !== n(p.raised) || c.investors !== p.investors || c.units_all !== p.units) {
      breaks.push({ kind: "counter_mismatch", dedupeKey: `counter_mismatch:${p.id}`, amountMinor: n(p.raised) - n(c.raised), refs: {
        raised_minor: n(p.raised), expected_raised_minor: n(c.raised), investors_count: p.investors, expected_investors: c.investors,
        units_committed: p.units, expected_units: c.units_all,
      } });
    }
    if (n(p.liability) !== n(c.expected_liability)) {
      breaks.push({ kind: "liability_mismatch", dedupeKey: `liability_mismatch:${p.id}`, amountMinor: n(p.liability) - n(c.expected_liability), refs: { ledger_liability_minor: n(p.liability), expected_liability_minor: n(c.expected_liability) } });
    }

    // Aged strays and overdue refunds.
    const strays = await asService(sql, (tx) => tx<{ fund_ref: string; amount: bigint; received_at: Date }[]>`
      select fund_ref, amount_minor as amount, received_at from public.pool_stray_fund_moves where pool_id = ${p.id} and refunded_at is null`);
    for (const s of strays) {
      if (businessDaysSince(s.received_at, now) > POLICY.recon.maxBreakAgeBusinessDays) {
        breaks.push({ kind: "stray_fund_move_aged", dedupeKey: `stray_fund_move_aged:${s.fund_ref}`, amountMinor: n(s.amount), refs: { fund_ref: s.fund_ref, received_at: s.received_at.toISOString() } });
      }
    }
    const refunds = await asService(sql, (tx) => tx<{ id: string; amount: bigint; status: string; created_at: Date }[]>`
      select id, amount_minor as amount, status, created_at from public.pool_ops where pool_id = ${p.id} and kind = 'refund' and status in ('initiated', 'failed', 'dead')`);
    for (const r of refunds) {
      if (businessDaysSince(r.created_at, now) > POLICY.l2.refundDirectBusinessDays) {
        breaks.push({ kind: "refund_overdue", dedupeKey: `refund_overdue:${r.id}`, amountMinor: n(r.amount), refs: { op_id: r.id, status: r.status, owed_since: r.created_at.toISOString() } });
        log("alert", "refund.overdue", { poolId: p.id, opId: r.id, status: r.status });
      }
    }

    await asService(sql, async (tx) => {
      for (const b of breaks) {
        await tx`insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs, opened_at)
                 values (${p.id}, ${b.kind}, ${b.dedupeKey}, ${b.amountMinor}, ${tx.json(b.refs as never)}, ${now})
                 on conflict (dedupe_key) where resolved_at is null do update set amount_minor = excluded.amount_minor, refs = excluded.refs`;
      }
      await tx`update public.pool_breaks set resolved_at = ${now}, resolution = 'cleared_by_run'
                where pool_id = ${p.id} and resolved_at is null and kind = any(${DERIVED}) and not (dedupe_key = any(${breaks.map((b) => b.dedupeKey)}))`;
    });
    out.push(row);
  }
  const breaks = out.flatMap((r) => r.breaks.map((b) => ({ ...b, poolId: r.poolId })));
  return { pools: out, inFlight, diffMinor: out.reduce((s, r) => s + Math.abs(r.escrow.diffMinor) + Math.abs(r.collection.diffMinor), 0), breaks };
}
