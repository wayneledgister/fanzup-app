/**
 * Money orchestration. All state changes + ledger postings happen inside the SQL functions
 * (supabase/migrations/…_ledger_and_money.sql); this file only sequences them with the escrow partner.
 * Idempotency keys are derived from business ids so retries can never double-post.
 */
import { asService, n, type Sql } from "./db";
import type { EscrowProvider } from "./escrow";

export const keys = {
  capture: (backingId: string) => `capture:${backingId}`,
  refund: (backingId: string) => `refund:${backingId}`,
  release: (trancheId: string) => `release:${trancheId}`,
};

export async function recordCaptured(sql: Sql, backingId: string, paymentRef: string, feeMinor: number) {
  return asService(sql, (tx) => tx`select public.record_backing_captured(${backingId}, ${paymentRef}, ${feeMinor}, ${keys.capture(backingId)}) as tx`);
}

export async function recordRefunded(sql: Sql, backingId: string, refundRef: string) {
  return asService(sql, (tx) => tx`select public.record_backing_refunded(${backingId}, ${refundRef}, ${keys.refund(backingId)}) as tx`);
}

/** Settle every live campaign whose deadline has passed. Safe to run on any schedule. */
export async function settleDueCampaigns(sql: Sql, now = new Date()) {
  const due = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.campaigns where status = 'live' and ends_at <= ${now}`);
  const results: { id: string; outcome: string }[] = [];
  for (const { id } of due) {
    const [r] = await asService(sql, (tx) => tx<{ outcome: string }[]>`select public.settle_campaign(${id}, ${now})::text as outcome`);
    results.push({ id, outcome: r.outcome });
  }
  return results;
}

/** Release every verified, unreleased tranche of a funded campaign, in order. */
export async function releaseVerifiedTranches(sql: Sql, escrow: EscrowProvider, campaignId: string) {
  const tranches = await asService(
    sql,
    (tx) => tx<{ id: string; seq: number; status: string; payout_account_ref: string | null }[]>`
      select t.id, t.seq, t.status, a.payout_account_ref
      from public.campaign_tranches t
      join public.campaigns c on c.id = t.campaign_id
      join public.artists a on a.id = c.artist_id
      where t.campaign_id = ${campaignId} and c.status = 'funded' and t.status in ('verified', 'pending', 'evidence_submitted')
      order by t.seq`,
  );
  const released: { trancheId: string; amountMinor: number }[] = [];
  for (const t of tranches) {
    if (t.status !== "verified") break; // later tranches wait for milestone evidence
    // The DB decides the amount (single source); the partner pays it; then we record it.
    const [{ amount }] = await asService(sql, (tx) => tx<{ amount: bigint }[]>`select public.tranche_release_amount(${t.id}) as amount`);
    const { payoutRef } = await escrow.releaseToArtist({
      campaignId,
      payoutAccountRef: t.payout_account_ref,
      amountMinor: n(amount),
      idempotencyKey: keys.release(t.id),
    });
    const [r] = await asService(sql, (tx) => tx<{ amt: bigint }[]>`select public.record_tranche_released(${t.id}, ${payoutRef}, ${keys.release(t.id)}) as amt`);
    released.push({ trancheId: t.id, amountMinor: n(r.amt) });
  }
  return released;
}

type OutboxRow = { id: number; topic: string; payload: Record<string, unknown>; attempts: number };

/** Drain the transactional outbox. Each event is processed at-least-once; handlers are idempotent. */
export async function drainOutbox(sql: Sql, escrow: EscrowProvider, limit = 25) {
  let processed = 0;
  for (;;) {
    const handled = await sql.begin(async (tx) => {
      const [ev] = await tx<OutboxRow[]>`
        select id, topic, payload, attempts from public.outbox
        where processed_at is null and available_at <= now()
        order by id limit 1 for update skip locked`;
      if (!ev) return false;
      try {
        await handle(ev);
        await tx`update public.outbox set processed_at = now(), attempts = attempts + 1, last_error = null where id = ${ev.id}`;
      } catch (e) {
        const backoff = Math.min(3600, 2 ** ev.attempts * 15);
        await tx`update public.outbox set attempts = attempts + 1, last_error = ${String(e)}, available_at = now() + make_interval(secs => ${backoff}) where id = ${ev.id}`;
      }
      return true;
    });
    if (!handled || ++processed >= limit) break;
  }
  return processed;

  async function handle(ev: OutboxRow) {
    switch (ev.topic) {
      case "backing.refund": {
        const p = ev.payload as { backing_id: string; payment_ref: string; amount_minor: number };
        const { refundRef } = await escrow.refund({ paymentRef: p.payment_ref, amountMinor: p.amount_minor, idempotencyKey: keys.refund(p.backing_id) });
        if (escrow.confirmsImmediately) await recordRefunded(sql, p.backing_id, refundRef);
        return;
      }
      case "campaign.funded":
        await releaseVerifiedTranches(sql, escrow, String(ev.payload.campaign_id));
        return;
      case "campaign.failed":
        return; // notifications go here later
      default:
        throw new Error(`unknown outbox topic ${ev.topic}`);
    }
  }
}
