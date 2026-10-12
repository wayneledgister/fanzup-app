/**
 * Reconciliation, processor slice (FR-PAY-007; design 02 §7).
 *
 * Expected provider balance per campaign = ledger escrow_cash + platform_funding postings on that campaign
 * (FanZuP covers the non-refundable fee on refunds; that cash never moved at the processor).
 * Provider balance per campaign = Σ balance transactions attributed to it (charges net of fee, −refunds, −transfers).
 * Every provider transaction must match a ledger transaction by reference and vice versa.
 * Per campaign the run also checks the public counters and the liability invariant (design §3.5): the ledger's
 * backer_liability = Σ coalesce(captured_minor, amount_minor) over held + refund_pending backings + Σ open strays.
 * In-flight allowance: provider movements tied to an op `sent` less than `recon.inflightGraceMinutes` ago (its
 * `updated_at`: nothing else writes a `sent` op until its confirmation), or to a provider event received less than that
 * ago and not processed yet, are expected state — reported, not breaks. A `sent` op past the grace with no young event
 * about it is a lost confirmation (follow-up to merged M1 code, found in the PR #12 L2 review round 3): before the
 * ledger is read it is looked up at the provider (`findRefund` / `findTransfer`) — confirmed there → recorded through
 * the webhook's SQL path (`confirmRefundOrFlag` / `confirmPayout`, amount asserted); pending there → still in flight;
 * a refund failed or canceled there → op `failed` + alert, as the `refund.failed` webhook does (staff retry it with
 * `outbound_op.replay`; review round 4); not found → an `op_unconfirmed` break (non-pausing; cleared by the run once the
 * op confirms; staff may replay the `sent` op while it is open). Its ref is counted in matching either way.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "./db";
import { log } from "./log";
import { confirmPayout, confirmRefundOrFlag, failOpOnAmountMismatch, type OpRow } from "./outbound";
import type { PaymentProvider } from "./provider/types";

export interface ReconResult {
  runId: string;
  ledgerTotalMinor: number;
  providerTotalMinor: number;
  diffMinor: number;
  /** FanZuP's float at the processor (`platform_topup` only); excluded from the totals and the diff, persisted on the run. */
  platformAdjustmentsMinor: number;
  campaigns: { campaignId: string; ledgerMinor: number; providerMinor: number; diffMinor: number }[];
  breaks: { kind: string; campaignId: string | null; amountMinor: number; refs: Record<string, unknown> }[];
  /** Provider movements whose confirmation is still on its way (op `sent`, or a young unprocessed event): reported, not breaks. */
  inFlight: { ref: string; campaignId: string | null; netMinor: number }[];
  /** `sent` ops past the grace that the run looked up and confirmed (their confirmation event never came). */
  recovered: { opId: string; ref: string }[];
}

const LEDGER_REF_KINDS = ["backing.captured", "backing.captured_unapplied", "backing.refunded", "tranche.released", "payment.captured_stray", "payment.stray_refunded"];

/**
 * Break kinds that pause payouts (design §7 pause rule, when material or aged). Money kinds only: `counter_mismatch`
 * (public counters, not money) and `waiting_funds` (a payout waiting for the processor's available balance) never do.
 */
export const PAYOUT_PAUSING_KINDS = [
  "campaign_diff", "unmatched_provider_txn", "unmatched_ledger_txn", "amount_mismatch", "currency_mismatch",
  "liability_mismatch", "stray_capture_aged",
] as const;
/** Kinds a run derives itself and clears (`cleared_by_run`) when a later run no longer finds them. */
const RUN_DERIVED_KINDS = ["campaign_diff", "unmatched_provider_txn", "unmatched_ledger_txn", "counter_mismatch", "liability_mismatch", "stray_capture_aged", "op_unconfirmed"];

export async function runReconciliation(sql: Sql, provider: PaymentProvider, now = new Date()): Promise<ReconResult> {
  const [run] = await asService(sql, (tx) => tx<{ id: string }[]>`insert into public.recon_runs (provider) values (${provider.name}) returning id`);
  try {
    const graceStart = new Date(now.getTime() - POLICY.recon.inflightGraceMinutes * 60_000);
    const inFlightRefs = new Set(
      (await asService(sql, (tx) => tx<{ ref: string }[]>`
        select provider_ref as ref from public.outbound_ops where status = 'sent' and provider_ref is not null and updated_at > ${graceStart}
        union
        select object_ref from public.provider_events
         where status in ('received', 'processing', 'failed') and object_ref is not null
           and received_at > now() - make_interval(mins => ${POLICY.recon.inflightGraceMinutes})`)).map((r) => r.ref),
    );
    // Lost confirmations: look up each `sent` op past the grace BEFORE reading the ledger, so a recovered confirmation is
    // in the ledger this run compares.
    const breaks: ReconResult["breaks"] = [];
    const recovered: ReconResult["recovered"] = [];
    const stale = await asService(sql, (tx) => tx<(OpRow & { backing_payment_ref: string | null })[]>`
      select o.*, b.payment_ref as backing_payment_ref from public.outbound_ops o left join public.backings b on b.id = o.subject_id and o.kind = 'refund'
       where o.status = 'sent' and o.updated_at <= ${graceStart} order by o.updated_at`);
    for (const op of stale) {
      if (op.provider_ref && inFlightRefs.has(op.provider_ref)) continue; // its event arrived and is still being processed
      if (op.kind === "refund") {
        const paymentRef = op.payment_ref ?? op.backing_payment_ref;
        const found = paymentRef ? await provider.findRefund({ paymentRef, opId: op.id }) : null;
        if (found?.status === "succeeded") {
          await confirmRefundOrFlag(sql, op, found.refundRef, found.amountMinor);
          recovered.push({ opId: op.id, ref: found.refundRef });
          log("warn", "outbound.confirmation_recovered", { opId: op.id, kind: op.kind, providerRef: found.refundRef });
          continue;
        }
        if (found && found.status !== "failed" && found.status !== "canceled") {
          inFlightRefs.add(found.refundRef); // still pending at the provider
          continue;
        }
        if (found) {
          // Failed or canceled at the provider: the same transition as the `refund.failed` webhook (inbox.ts) — op
          // `failed` + alert — so staff can retry it with `outbound_op.replay` (review round 4, PR #12). No break.
          const [failed] = await asService(sql, (tx) => tx<{ id: string }[]>`
            update public.outbound_ops set status = 'failed', last_error = ${"refund failed: " + found.status}
             where id = ${op.id} and status = 'sent' returning id`);
          if (failed) log("alert", "refund.failed", { opId: op.id, code: found.status, via: "recon_lookup" });
          continue;
        }
      } else {
        const found = await provider.findTransfer({ campaignId: op.campaign_id, opId: op.id });
        if (found) {
          if (found.amountMinor !== n(op.amount_minor)) await failOpOnAmountMismatch(sql, op, found.transferRef, found.amountMinor);
          else await confirmPayout(sql, op, found.transferRef, found.amountMinor);
          recovered.push({ opId: op.id, ref: found.transferRef });
          continue;
        }
      }
      breaks.push({ kind: "op_unconfirmed", campaignId: op.campaign_id, amountMinor: n(op.amount_minor),
        refs: { ref: op.id, op_kind: op.kind, provider_ref: op.provider_ref, provider_status: "not_found" } });
    }
    const allProviderTxns = await provider.listBalanceTransactions();
    const inFlight = allProviderTxns.filter((t) => inFlightRefs.has(t.ref)).map((t) => ({ ref: t.ref, campaignId: t.campaignId, netMinor: t.netMinor }));
    const providerTxns = allProviderTxns.filter((t) => !inFlightRefs.has(t.ref));
    const ledger = await asService(sql, (tx) => tx<{
      campaign_id: string; expected_minor: bigint; raised_minor: bigint; backers_count: number; ledger_raised_minor: bigint; ledger_backers: number;
      liability_minor: bigint; expected_liability_minor: bigint;
    }[]>`select * from public.recon_ledger_by_campaign()`);
    // Open stray captures and their refund ops, for the age rule (design §3.5.1).
    const strays = await asService(sql, (tx) => tx<{ payment_ref: string; campaign_id: string; amount_minor: bigint; captured_at: Date; op_status: string | null }[]>`
      select t.external_ref as payment_ref, t.campaign_id, (select -sum(e.amount_minor) from public.ledger_entries e
               join public.ledger_accounts a on a.id = e.account_id and a.kind = 'backer_liability' where e.transaction_id = t.id) as amount_minor,
             t.created_at as captured_at, o.status as op_status
        from public.ledger_transactions t
        left join public.outbound_ops o on o.idempotency_key = 'refund:pay:' || t.external_ref
       where t.kind = 'payment.captured_stray'
         and not exists (select 1 from public.ledger_transactions x where x.idempotency_key = 'refund:pay:' || t.external_ref)`);
    const ledgerRefs = await asService(sql, (tx) => tx<{ external_ref: string; kind: string; campaign_id: string | null }[]>`
      select external_ref, kind, campaign_id from public.ledger_transactions where external_ref is not null and kind = any(${LEDGER_REF_KINDS})`);

    const providerByCampaign = new Map<string, number>();
    for (const t of providerTxns) {
      if (t.campaignId) providerByCampaign.set(t.campaignId, (providerByCampaign.get(t.campaignId) ?? 0) + t.netMinor);
    }
    const campaignIds = new Set<string>([...ledger.map((r) => r.campaign_id), ...providerByCampaign.keys()]);
    const campaigns: ReconResult["campaigns"] = [];
    for (const id of campaignIds) {
      const l = ledger.find((r) => r.campaign_id === id);
      const ledgerMinor = n(l?.expected_minor);
      const providerMinor = providerByCampaign.get(id) ?? 0;
      const diff = providerMinor - ledgerMinor;
      campaigns.push({ campaignId: id, ledgerMinor, providerMinor, diffMinor: diff });
      if (diff !== 0) breaks.push({ kind: "campaign_diff", campaignId: id, amountMinor: diff, refs: { ledger_minor: ledgerMinor, provider_minor: providerMinor } });
      // Public counters vs held + released backings (G2 condition 2). Not money, so it never pauses payouts.
      if (l && (n(l.raised_minor) !== n(l.ledger_raised_minor) || l.backers_count !== l.ledger_backers)) {
        breaks.push({ kind: "counter_mismatch", campaignId: id, amountMinor: n(l.raised_minor) - n(l.ledger_raised_minor),
          refs: { raised_minor: n(l.raised_minor), ledger_raised_minor: n(l.ledger_raised_minor), backers_count: l.backers_count, ledger_backers: l.ledger_backers } });
      }
      // Liability invariant (design §3.5): what the ledger says we owe backers vs what the backings + open strays say.
      if (l && n(l.liability_minor) !== n(l.expected_liability_minor)) {
        breaks.push({ kind: "liability_mismatch", campaignId: id, amountMinor: n(l.liability_minor) - n(l.expected_liability_minor),
          refs: { ledger_liability_minor: n(l.liability_minor), expected_liability_minor: n(l.expected_liability_minor) } });
      }
    }
    // A stray capture resolves through its own refund op; only one unconfirmed past the age limit is a break.
    for (const st of strays) {
      if (businessDaysSince(st.captured_at, now) > POLICY.recon.maxBreakAgeBusinessDays) {
        breaks.push({ kind: "stray_capture_aged", campaignId: st.campaign_id, amountMinor: n(st.amount_minor),
          refs: { ref: st.payment_ref, op_status: st.op_status, captured_at: st.captured_at.toISOString() } });
      }
    }
    const ledgerRefSet = new Set(ledgerRefs.map((r) => r.external_ref));
    const providerRefSet = new Set<string>();
    for (const t of providerTxns) {
      // Only the float is exempt. Any other movement with no ledger posting (a Stripe payout, stripe_fee, dispute, fee
      // correction) is money entering or leaving the balance: it is a break (campaign null when unattributed).
      if (t.type === "platform_topup") continue;
      providerRefSet.add(t.ref);
      if (!ledgerRefSet.has(t.ref)) breaks.push({ kind: "unmatched_provider_txn", campaignId: t.campaignId, amountMinor: t.netMinor, refs: { ref: t.ref, type: t.type } });
    }
    for (const r of ledgerRefs) {
      if (!providerRefSet.has(r.external_ref) && !inFlightRefs.has(r.external_ref)) breaks.push({ kind: "unmatched_ledger_txn", campaignId: r.campaign_id, amountMinor: 0, refs: { ref: r.external_ref, kind: r.kind } });
    }

    const ledgerTotal = campaigns.reduce((s, c) => s + c.ledgerMinor, 0);
    // Top-ups (FanZuP's own float for the fees it absorbs on refunds, design §12.1) are not backers' or artists' money and
    // have no ledger posting, so they're reported separately, not counted as a diff. Nothing else is excluded.
    const platformAdjustmentsMinor = allProviderTxns.filter((t) => t.type === "platform_topup").reduce((s, t) => s + t.netMinor, 0);
    const providerTotal = providerTxns.filter((t) => t.type !== "platform_topup").reduce((s, t) => s + t.netMinor, 0);
    await asService(sql, async (tx) => {
      const seen: string[] = [];
      for (const b of breaks) {
        const key = `${b.kind}:${b.campaignId ?? "-"}:${(b.refs.ref as string) ?? ""}`;
        seen.push(key);
        const [upd] = await tx<{ id: string }[]>`
          update public.recon_breaks set amount_minor = ${b.amountMinor}, refs = ${tx.json(b.refs as never)}, last_run_id = ${run.id}
           where dedupe_key = ${key} and resolved_at is null returning id`;
        if (!upd) {
          await tx`insert into public.recon_breaks (dedupe_key, kind, campaign_id, amount_minor, refs, first_run_id, last_run_id)
                   values (${key}, ${b.kind}, ${b.campaignId}, ${b.amountMinor}, ${tx.json(b.refs as never)}, ${run.id}, ${run.id})`;
        }
      }
      // Run-derived breaks that didn't recur are cleared; breaks raised by the money path stay until staff resolve them.
      await tx`update public.recon_breaks set resolved_at = now(), resolution = 'cleared_by_run'
                where resolved_at is null and kind = any(${RUN_DERIVED_KINDS}) and not (dedupe_key = any(${seen}))`;
      await tx`update public.recon_runs set status = 'completed', finished_at = now(), ledger_total_minor = ${ledgerTotal},
                      provider_total_minor = ${providerTotal}, diff_minor = ${providerTotal - ledgerTotal},
                      platform_adjustments_minor = ${platformAdjustmentsMinor}, campaigns = ${tx.json(campaigns as never)}
                where id = ${run.id}`;
    });
    return { runId: run.id, ledgerTotalMinor: ledgerTotal, providerTotalMinor: providerTotal, diffMinor: providerTotal - ledgerTotal, platformAdjustmentsMinor, campaigns, breaks, inFlight, recovered };
  } catch (e) {
    await asService(sql, (tx) => tx`update public.recon_runs set status = 'failed', finished_at = now(), error = ${String((e as Error).message ?? e).slice(0, 500)} where id = ${run.id}`);
    throw e;
  }
}

/** Weekdays elapsed since `from` (approximate business days; holidays ignored at M1). */
export function businessDaysSince(from: Date, now = new Date()): number {
  let days = 0;
  const d = new Date(from);
  while (d < now) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d > now) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

/**
 * Layer 2 pause rule (L2 design §5.1; kept apart from M1's list so Layer 2 activity can't pause an M1 payout — gate
 * condition 1). An open one of these on a Pool, material or aged, pauses THAT Pool's `disburse` and `payout` ops;
 * refunds never pause. `counter_mismatch`, `revenue_shortfall`, `revenue_overage` and `refund_overdue` never pause.
 */
export const L2_PAYOUT_PAUSING_KINDS = [
  "escrow_diff", "collection_diff", "unmatched_provider_txn", "unmatched_ledger_txn", "unapplied_funding",
  "liability_mismatch", "amount_mismatch", "stray_fund_move_aged",
] as const;

/** Is this Pool's money out (disbursements, distribution payouts) paused by an open material or aged L2 break? */
export async function isPoolPayoutPaused(sql: Sql, poolId: string, now = new Date()): Promise<boolean> {
  const rows = await asService(sql, (tx) => tx<{ amount_minor: bigint; opened_at: Date }[]>`
    select amount_minor, opened_at from public.pool_breaks
     where pool_id = ${poolId} and resolved_at is null and kind = any(${L2_PAYOUT_PAUSING_KINDS as unknown as string[]})`);
  return rows.some((r) => Math.abs(n(r.amount_minor)) > POLICY.recon.materialityMinor || businessDaysSince(r.opened_at, now) > POLICY.recon.maxBreakAgeBusinessDays);
}

/** Payouts pause on any open money break (PAYOUT_PAUSING_KINDS) that is material or aged; refunds never pause. */
export async function isPayoutPaused(sql: Sql, now = new Date()): Promise<boolean> {
  const rows = await asService(sql, (tx) => tx<{ amount_minor: bigint; opened_at: Date; override_until: string | null }[]>`
    select b.amount_minor, b.opened_at,
           (select value #>> '{}' from public.platform_settings where key = 'recon_override_until') as override_until
      from public.recon_breaks b
     where b.resolved_at is null and b.kind = any(${PAYOUT_PAUSING_KINDS as unknown as string[]})`);
  if (!rows.length) return false;
  const override = rows[0].override_until ? new Date(rows[0].override_until) : null;
  if (override && override > now) return false;
  return rows.some((r) => Math.abs(n(r.amount_minor)) > POLICY.recon.materialityMinor || businessDaysSince(r.opened_at, now) > POLICY.recon.maxBreakAgeBusinessDays);
}
