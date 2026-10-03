/**
 * Time-based and queued money work (design 02 §6). All state changes and ledger postings happen inside the SQL
 * functions; this file sequences them with the provider. Every step is idempotent and bounded.
 */
import { asService, type Sql } from "./db";
import { newCorrelationId, runWithCtx } from "./context";
import type { PaymentProvider } from "./provider/types";
import { ensurePayoutOp, ensureRefundOp } from "./outbound";
import { log, redact } from "./log";
import type { NotifyHandler } from "./notify";
import { handleL2Notify } from "./l2/notices";

const SYSTEM = { actorId: null, actorKind: "system:worker", aal: null } as const;

/**
 * Settle every live campaign whose deadline has passed — one transaction per campaign, each under its own
 * correlation id, so one failing campaign never stops the others (NFR-OPS-05).
 */
export async function settleDueCampaigns(sql: Sql, now = new Date()) {
  const due = await asService(sql, (tx) => tx<{ id: string }[]>`
    select id from public.campaigns where status = 'live' and ends_at <= ${now} order by ends_at limit 50`);
  const results: { id: string; outcome: string; correlationId: string }[] = [];
  for (const { id } of due) {
    const correlationId = newCorrelationId();
    try {
      const [r] = await runWithCtx({ ...SYSTEM, correlationId }, () =>
        asService(sql, (tx) => tx<{ outcome: string }[]>`select public.settle_campaign(${id}, ${now})::text as outcome`),
      );
      results.push({ id, outcome: r.outcome, correlationId });
    } catch (e) {
      log("alert", "settlement.failed", { campaignId: id, error: redact(String((e as Error).message ?? e)) });
      results.push({ id, outcome: "error", correlationId });
    }
  }
  return results;
}

/**
 * FR-PAY-001: expired checkout holds (and holds on campaigns past their deadline) are cancelled with the provider,
 * then their units go back. A payment that already succeeded is left for the inbox (late-capture refund path).
 */
export async function expireHolds(sql: Sql, provider: PaymentProvider, now = new Date(), limit = 100) {
  const rows = await asService(sql, (tx) => tx<{ id: string; payment_ref: string | null; correlation_id: string | null }[]>`
    select b.id, b.payment_ref, b.correlation_id
      from public.backings b join public.campaigns c on c.id = b.campaign_id
     where b.status = 'pending_payment' and (b.hold_expires_at <= ${now} or c.ends_at <= ${now} or c.status <> 'live')
     order by b.hold_expires_at limit ${limit}`);
  let released = 0;
  for (const b of rows) {
    await runWithCtx({ ...SYSTEM, correlationId: b.correlation_id }, async () => {
      try {
        if (b.payment_ref) {
          const r = await provider.cancelPayment(b.payment_ref);
          if (r === "already_succeeded") return; // the capture event will arrive and be refunded if late
        }
        const [{ ok }] = await asService(sql, (tx) => tx<{ ok: boolean }[]>`select public.release_backing_hold(${b.id}, 'expired') as ok`);
        if (ok) released++;
      } catch (e) {
        log("warn", "hold.expire_failed", { backingId: b.id, error: redact(String((e as Error).message ?? e)) });
      }
    });
  }
  return released;
}

type OutboxRow = { id: number; topic: string; payload: Record<string, unknown>; attempts: number; correlation_id: string | null };

/** Drain the transactional outbox. Each row is handled at least once; handlers are idempotent. */
export async function drainOutbox(sql: Sql, notify: NotifyHandler, limit = 100) {
  let processed = 0;
  for (; processed < limit; processed++) {
    const [ev] = await asService(sql, (tx) => tx<OutboxRow[]>`
      update public.outbox set available_at = now() + interval '5 minutes'
       where id = (select id from public.outbox where processed_at is null and available_at <= now()
                    order by id limit 1 for update skip locked)
      returning id, topic, payload, attempts, correlation_id`);
    if (!ev) break;
    await runWithCtx({ ...SYSTEM, correlationId: ev.correlation_id }, async () => {
      try {
        await handle(ev);
        await asService(sql, (tx) => tx`update public.outbox set processed_at = now(), attempts = attempts + 1, last_error = null where id = ${ev.id}`);
      } catch (e) {
        const backoff = Math.min(3600, 2 ** ev.attempts * 15);
        await asService(sql, (tx) => tx`
          update public.outbox set attempts = attempts + 1, last_error = ${redact(String((e as Error).message ?? e))},
                 available_at = now() + make_interval(secs => ${backoff}) where id = ${ev.id}`);
        log("warn", "outbox.failed", { outboxId: ev.id, topic: ev.topic });
      }
    });
  }
  return processed;

  async function handle(ev: OutboxRow) {
    if (ev.topic === "backing.refund") {
      await asService(sql, (tx) => ensureRefundOp(tx, String(ev.payload.backing_id), (ev.payload.reason as string) ?? null));
      return;
    }
    if (ev.topic === "tranche.release") {
      await asService(sql, (tx) => ensurePayoutOp(tx, String(ev.payload.tranche_id)));
      return;
    }
    if (ev.topic === "campaign.funded") return notify(sql, "notify.campaign_funded", ev.payload);
    if (ev.topic === "campaign.failed") return notify(sql, "notify.campaign_failed", ev.payload);
    if (ev.topic.startsWith("notify.")) return notify(sql, ev.topic, ev.payload);
    if (ev.topic === "l2.notify") return handleL2Notify(sql, ev.payload);
    throw new Error(`unknown outbox topic ${ev.topic}`);
  }
}
