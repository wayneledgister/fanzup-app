/**
 * Two-phase outbound money movements (FR-PAY-004; design 02 §5; ADR-003).
 *
 *   initiated ──provider ok──► sent ──confirmation──► confirmed        (refunds: confirmed by the provider's event)
 *   initiated ──provider ok──────────────────────────► confirmed        (payouts: the transfer response confirms)
 *   any error → classified: retry (counted, backoff, dead at max) · wait_funds (not counted) · permanent (failed)
 *
 * The op row is committed before the provider is called; a retry asks the provider for the original attempt first;
 * the ledger posts only on confirmation and only the exact amount. No DB lock is held across a provider call.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql, type Tx } from "./db";
import { runWithCtx } from "./context";
import { ProviderError, type PaymentProvider } from "./provider";
import { log, redact } from "./log";
import { isPayoutPaused } from "./recon";

export interface OpRow {
  id: string;
  kind: "refund" | "payout";
  subject_id: string;
  campaign_id: string;
  amount_minor: bigint;
  idempotency_key: string;
  status: string;
  provider_ref: string | null;
  attempts: number;
  correlation_id: string | null;
  created_at: Date;
}

/** Create (once) the refund op for a backing. Amount = what was actually captured. */
export async function ensureRefundOp(tx: Tx, backingId: string, reason: string | null) {
  await tx`
    insert into public.outbound_ops (kind, subject_id, campaign_id, amount_minor, idempotency_key, reason)
    select 'refund', b.id, b.campaign_id, b.captured_minor, 'refund:' || b.id, ${reason}
      from public.backings b
     where b.id = ${backingId} and b.status in ('held', 'refund_pending') and b.captured_minor is not null
    on conflict (kind, subject_id) do nothing`;
}

/** Create (once) the payout op for a verified tranche. Amount = what the rules say is owed now. */
export async function ensurePayoutOp(tx: Tx, trancheId: string) {
  await tx`
    insert into public.outbound_ops (kind, subject_id, campaign_id, amount_minor, idempotency_key)
    select 'payout', t.id, t.campaign_id, public.tranche_release_amount(t.id), 'release:' || t.id
      from public.campaign_tranches t
     where t.id = ${trancheId} and t.status = 'verified' and public.tranche_release_amount(t.id) > 0
    on conflict (kind, subject_id) do nothing`;
}

/** Run due ops one at a time. Each op is leased for 5 minutes so two workers never run the same op. */
export async function runDueOps(sql: Sql, provider: PaymentProvider, limit = 100) {
  let done = 0;
  for (; done < limit; done++) {
    const [op] = await asService(sql, (tx) => tx<OpRow[]>`
      update public.outbound_ops set lease_until = now() + interval '5 minutes'
       where id = (select id from public.outbound_ops
                    where status = 'initiated' and next_attempt_at <= now() and (lease_until is null or lease_until < now())
                    order by next_attempt_at limit 1 for update skip locked)
      returning *`);
    if (!op) break;
    await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:worker", aal: null }, () => runOp(sql, provider, op));
  }
  return done;
}

async function defer(sql: Sql, op: OpRow, waiting: string, seconds: number) {
  await asService(sql, (tx) => tx`
    update public.outbound_ops set waiting = ${waiting}, lease_until = null, next_attempt_at = now() + make_interval(secs => ${seconds})
     where id = ${op.id}`);
}

export async function runOp(sql: Sql, provider: PaymentProvider, op: OpRow) {
  const amount = n(op.amount_minor);
  try {
    if (op.kind === "refund") {
      const [b] = await asService(sql, (tx) => tx<{ payment_ref: string | null }[]>`select payment_ref from public.backings where id = ${op.subject_id}`);
      if (!b?.payment_ref) throw new ProviderError("permanent", "no_payment_ref", "Backing has no payment to refund");
      const prior = op.attempts > 0 || op.provider_ref ? await provider.findRefund({ paymentRef: b.payment_ref, opId: op.id }) : null;
      const res = prior ?? (await provider.refund({ paymentRef: b.payment_ref, amountMinor: amount, idempotencyKey: op.idempotency_key, opId: op.id, backingId: op.subject_id, campaignId: op.campaign_id }));
      if (res.amountMinor !== amount) throw new ProviderError("permanent", "amount_mismatch", `provider refunded ${res.amountMinor}, op is ${amount}`);
      // Only move initiated → sent: the confirmation event may already have marked it confirmed.
      await asService(sql, (tx) => tx`
        update public.outbound_ops set status = 'sent', provider_ref = ${res.refundRef}, attempts = attempts + 1, waiting = null, lease_until = null, last_error = null
         where id = ${op.id} and status = 'initiated'`);
      return;
    }

    // payout
    if (await isPayoutPaused(sql)) return defer(sql, op, "recon_pause", 15 * 60);
    const [t] = await asService(sql, (tx) => tx<{ earlier_pending: boolean; payout_ref: string | null }[]>`
      select exists (select 1 from public.campaign_tranches x where x.campaign_id = t.campaign_id and x.seq < t.seq and x.status <> 'released') as earlier_pending,
             a.payout_account_ref as payout_ref
        from public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id join public.artists a on a.id = c.artist_id
       where t.id = ${op.subject_id}`);
    if (t.earlier_pending) return defer(sql, op, "earlier_tranche", 30);
    if (!t.payout_ref) return defer(sql, op, "payout_account", 15 * 60);
    const prior = op.attempts > 0 || op.provider_ref ? await provider.findTransfer({ campaignId: op.campaign_id, opId: op.id }) : null;
    const res = prior ?? (await provider.transfer({ campaignId: op.campaign_id, trancheId: op.subject_id, destination: t.payout_ref, amountMinor: amount, idempotencyKey: op.idempotency_key, opId: op.id }));
    await confirmPayout(sql, op, res.transferRef, res.amountMinor);
  } catch (e) {
    await recordFailure(sql, op, e);
  }
}

async function recordFailure(sql: Sql, op: OpRow, e: unknown) {
  const err = e instanceof ProviderError ? e : new ProviderError(isRuleViolation(e) ? "permanent" : "retry", errCode(e), String((e as Error)?.message ?? e));
  const msg = redact(`${err.code}: ${err.message}`);
  if (err.cls === "wait_funds") {
    // Waiting for available balance doesn't consume attempts (G2 blocker 1). After a week it becomes a recon break.
    await asService(sql, async (tx) => {
      await tx`update public.outbound_ops set waiting = 'funds', last_error = ${msg}, lease_until = null, next_attempt_at = now() + interval '15 minutes' where id = ${op.id}`;
      if (Date.now() - op.created_at.getTime() > POLICY.outbound.waitFundsBreakDays * 86_400_000) {
        await tx`insert into public.recon_breaks (dedupe_key, kind, campaign_id, amount_minor, refs)
                 values (${"waiting_funds:" + op.id}, 'waiting_funds', ${op.campaign_id}, ${n(op.amount_minor)}, ${tx.json({ op_id: op.id })})
                 on conflict do nothing`;
      }
    });
    return;
  }
  if (err.cls === "permanent") {
    await asService(sql, async (tx) => {
      await tx`update public.outbound_ops set status = 'failed', last_error = ${msg}, lease_until = null where id = ${op.id}`;
      if (err.code === "amount_mismatch" || err.code === "payout_amount_mismatch") {
        await tx`insert into public.recon_breaks (dedupe_key, kind, campaign_id, amount_minor, refs)
                 values (${"op_amount:" + op.id}, 'amount_mismatch', ${op.campaign_id}, ${n(op.amount_minor)}, ${tx.json({ op_id: op.id, error: msg })})
                 on conflict do nothing`;
      }
    });
    log("alert", "outbound.failed", { opId: op.id, kind: op.kind, code: err.code });
    return;
  }
  const attempts = op.attempts + 1;
  const dead = attempts >= POLICY.outbound.maxAttempts;
  const backoff = Math.min(3600, 15 * 2 ** op.attempts);
  await asService(sql, (tx) => tx`
    update public.outbound_ops
       set attempts = ${attempts}, status = ${dead ? "dead" : "initiated"}, last_error = ${msg}, lease_until = null,
           next_attempt_at = now() + make_interval(secs => ${backoff})
     where id = ${op.id}`);
  if (dead) log("alert", "outbound.dead_letter", { opId: op.id, kind: op.kind, attempts }); // pages on-call once alerting exists (design §12)
}

/** Payout confirmed by the provider: post exactly that amount (the SQL asserts it equals what is owed). */
export async function confirmPayout(sql: Sql, op: Pick<OpRow, "id" | "subject_id" | "idempotency_key">, transferRef: string, amountMinor: number) {
  await asService(sql, async (tx) => {
    await tx`select public.record_tranche_released(${op.subject_id}, ${transferRef}, ${amountMinor}, ${op.idempotency_key})`;
    await tx`update public.outbound_ops set status = 'confirmed', provider_ref = ${transferRef}, waiting = null, lease_until = null, last_error = null
             where id = ${op.id}`;
  });
}

/** Refund confirmed by the provider's event; applies whatever state the op is in (the event can beat our own commit). */
export async function confirmRefund(sql: Sql, op: Pick<OpRow, "id" | "subject_id" | "idempotency_key">, refundRef: string, amountMinor: number) {
  await asService(sql, async (tx) => {
    await tx`select public.record_refund_confirmed(${op.subject_id}, ${refundRef}, ${amountMinor}, ${op.idempotency_key})`;
    await tx`update public.outbound_ops set status = 'confirmed', provider_ref = ${refundRef}, waiting = null, lease_until = null, last_error = null
             where id = ${op.id}`;
  });
}

const isRuleViolation = (e: unknown) => (e as { code?: string })?.code === "P0001";
const errCode = (e: unknown) => (e as { message?: string; code?: string })?.code === "P0001" ? String((e as { message: string }).message) : "error";
