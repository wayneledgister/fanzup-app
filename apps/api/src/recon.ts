/**
 * Reconciliation, processor slice (FR-PAY-007; design 02 §7).
 *
 * Expected provider balance per campaign = ledger escrow_cash + platform_funding postings on that campaign
 * (FanZuP covers the non-refundable fee on refunds; that cash never moved at the processor).
 * Provider balance per campaign = Σ balance transactions attributed to it (charges net of fee, −refunds, −transfers).
 * Every provider transaction must match a ledger transaction by reference and vice versa.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "./db";
import type { PaymentProvider } from "./provider/types";

export interface ReconResult {
  runId: string;
  ledgerTotalMinor: number;
  providerTotalMinor: number;
  diffMinor: number;
  campaigns: { campaignId: string; ledgerMinor: number; providerMinor: number; diffMinor: number }[];
  breaks: { kind: string; campaignId: string | null; amountMinor: number; refs: Record<string, unknown> }[];
  /** Provider movements whose confirmation is still on its way (op `sent`): reported, not counted as breaks. */
  inFlight: { ref: string; campaignId: string | null; netMinor: number }[];
}

const LEDGER_REF_KINDS = ["backing.captured", "backing.captured_unapplied", "backing.refunded", "tranche.released"];

export async function runReconciliation(sql: Sql, provider: PaymentProvider): Promise<ReconResult> {
  const [run] = await asService(sql, (tx) => tx<{ id: string }[]>`insert into public.recon_runs (provider) values (${provider.name}) returning id`);
  try {
    const allProviderTxns = await provider.listBalanceTransactions();
    const inFlightRefs = new Set(
      (await asService(sql, (tx) => tx<{ provider_ref: string }[]>`select provider_ref from public.outbound_ops where status = 'sent' and provider_ref is not null`)).map((r) => r.provider_ref),
    );
    const inFlight = allProviderTxns.filter((t) => inFlightRefs.has(t.ref)).map((t) => ({ ref: t.ref, campaignId: t.campaignId, netMinor: t.netMinor }));
    const providerTxns = allProviderTxns.filter((t) => !inFlightRefs.has(t.ref));
    const ledger = await asService(sql, (tx) => tx<{
      campaign_id: string; expected_minor: bigint; raised_minor: bigint; backers_count: number; ledger_raised_minor: bigint; ledger_backers: number;
    }[]>`select * from public.recon_ledger_by_campaign()`);
    const ledgerRefs = await asService(sql, (tx) => tx<{ external_ref: string; kind: string; campaign_id: string | null }[]>`
      select external_ref, kind, campaign_id from public.ledger_transactions where external_ref is not null and kind = any(${LEDGER_REF_KINDS})`);

    const breaks: ReconResult["breaks"] = [];
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
      // Public counters vs ledger (G2 condition 2). Not money, so it never pauses payouts.
      if (l && (n(l.raised_minor) !== n(l.ledger_raised_minor) || l.backers_count !== l.ledger_backers)) {
        breaks.push({ kind: "counter_mismatch", campaignId: id, amountMinor: n(l.raised_minor) - n(l.ledger_raised_minor),
          refs: { raised_minor: n(l.raised_minor), ledger_raised_minor: n(l.ledger_raised_minor), backers_count: l.backers_count, ledger_backers: l.ledger_backers } });
      }
    }
    const ledgerRefSet = new Set(ledgerRefs.map((r) => r.external_ref));
    const providerRefSet = new Set<string>();
    for (const t of providerTxns) {
      if (t.type === "adjustment") continue;
      providerRefSet.add(t.ref);
      if (!ledgerRefSet.has(t.ref)) breaks.push({ kind: "unmatched_provider_txn", campaignId: t.campaignId, amountMinor: t.netMinor, refs: { ref: t.ref, type: t.type } });
    }
    for (const r of ledgerRefs) {
      if (!providerRefSet.has(r.external_ref)) breaks.push({ kind: "unmatched_ledger_txn", campaignId: r.campaign_id, amountMinor: 0, refs: { ref: r.external_ref, kind: r.kind } });
    }

    const ledgerTotal = campaigns.reduce((s, c) => s + c.ledgerMinor, 0);
    const providerTotal = providerTxns.reduce((s, t) => s + t.netMinor, 0);
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
                where resolved_at is null and kind in ('campaign_diff', 'unmatched_provider_txn', 'unmatched_ledger_txn', 'counter_mismatch')
                  and not (dedupe_key = any(${seen}))`;
      await tx`update public.recon_runs set status = 'completed', finished_at = now(), ledger_total_minor = ${ledgerTotal},
                      provider_total_minor = ${providerTotal}, diff_minor = ${providerTotal - ledgerTotal}, campaigns = ${tx.json(campaigns as never)}
                where id = ${run.id}`;
    });
    return { runId: run.id, ledgerTotalMinor: ledgerTotal, providerTotalMinor: providerTotal, diffMinor: providerTotal - ledgerTotal, campaigns, breaks, inFlight };
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

/** Payouts pause on any open money break that is material or aged (refunds never pause). */
export async function isPayoutPaused(sql: Sql, now = new Date()): Promise<boolean> {
  const rows = await asService(sql, (tx) => tx<{ amount_minor: bigint; opened_at: Date; override_until: string | null }[]>`
    select b.amount_minor, b.opened_at,
           (select value #>> '{}' from public.platform_settings where key = 'recon_override_until') as override_until
      from public.recon_breaks b
     where b.resolved_at is null and b.kind <> 'counter_mismatch'`);
  if (!rows.length) return false;
  const override = rows[0].override_until ? new Date(rows[0].override_until) : null;
  if (override && override > now) return false;
  return rows.some((r) => Math.abs(n(r.amount_minor)) > POLICY.recon.materialityMinor || businessDaysSince(r.opened_at, now) > POLICY.recon.maxBreakAgeBusinessDays);
}
