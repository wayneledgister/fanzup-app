/**
 * Provider event inbox (FR-PAY-002; ADR-003). Every provider event is stored (unique per provider event id) and
 * acknowledged before any business processing; processing is idempotent, retried with bounded attempts, and
 * replayable by staff. Each event is processed under the correlation id of the backing or op it belongs to.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "./db";
import { runWithCtx } from "./context";
import type { NormalizedEvent, PaymentProvider } from "./provider/types";
import { confirmPayout, confirmRefund, type OpRow } from "./outbound";
import { log, redact } from "./log";

/** How long an event for an object we can't see yet keeps retrying before it's "unmatched" (design §5). */
const GRACE_MS = 10 * 60_000;

interface EventPayload {
  type: NormalizedEvent["type"];
  paymentRef?: string | null;
  amountMinor?: number;
  currency?: string;
  feeMinor?: number | null;
  failureCode?: string | null;
  metadata: Record<string, string>;
  raw?: unknown;
}
export interface EventRow {
  id: string;
  provider: string;
  event_id: string;
  type: string;
  object_ref: string | null;
  payload: EventPayload;
  attempts: number;
  received_at: Date;
  correlation_id: string | null;
}

export async function ingestEvent(sql: Sql, evt: NormalizedEvent): Promise<{ id: string; inserted: boolean }> {
  const payload: EventPayload = {
    type: evt.type, paymentRef: evt.paymentRef ?? null, amountMinor: evt.amountMinor, currency: evt.currency,
    feeMinor: evt.feeMinor ?? null, failureCode: evt.failureCode ?? null, metadata: evt.metadata, raw: evt.raw,
  };
  return asService(sql, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.provider_events (provider, event_id, type, livemode, account, object_ref, payload)
      values (${evt.provider}, ${evt.eventId}, ${evt.type}, ${evt.livemode}, ${evt.account}, ${evt.objectRef}, ${tx.json(payload as never)})
      on conflict (provider, event_id) do nothing returning id`;
    if (row) return { id: row.id, inserted: true };
    const [old] = await tx<{ id: string }[]>`select id from public.provider_events where provider = ${evt.provider} and event_id = ${evt.eventId}`;
    return { id: old.id, inserted: false };
  });
}

/** Mark a stored event ignored (e.g. a Connect event for an account that isn't ours). */
export async function ignoreEvent(sql: Sql, id: string, why: string) {
  await asService(sql, (tx) => tx`update public.provider_events set status = 'ignored', last_error = ${why}, processed_at = now() where id = ${id} and status = 'received'`);
}

/** Worker step: process pending events oldest first. */
export async function processPendingEvents(sql: Sql, provider: PaymentProvider, limit = 100) {
  let done = 0;
  for (; done < limit; done++) {
    const [row] = await asService(sql, (tx) => tx<EventRow[]>`
      update public.provider_events set next_attempt_at = now() + interval '5 minutes'
       where id = (select id from public.provider_events
                    where status in ('received', 'failed') and next_attempt_at <= now()
                    order by received_at limit 1 for update skip locked)
      returning id, provider, event_id, type, object_ref, payload, attempts, received_at, correlation_id`);
    if (!row) break;
    await processEventRow(sql, provider, row);
  }
  return done;
}

/** Process one stored event now (webhook inline attempt, dev route, staff replay). */
export async function processEventById(sql: Sql, provider: PaymentProvider, id: string) {
  const [row] = await asService(sql, (tx) => tx<EventRow[]>`
    select id, provider, event_id, type, object_ref, payload, attempts, received_at, correlation_id
      from public.provider_events where id = ${id} and status in ('received', 'failed')`);
  if (row) await processEventRow(sql, provider, row);
}

type Outcome = "processed" | "ignored" | "unmatched" | "wait";

async function processEventRow(sql: Sql, provider: PaymentProvider, row: EventRow) {
  let outcome: Outcome;
  try {
    outcome = await handle(sql, provider, row);
  } catch (e) {
    const attempts = row.attempts + 1;
    const dead = attempts >= POLICY.outbound.maxAttempts;
    const msg = redact(`${(e as { message?: string }).message ?? e}${(e as { detail?: string }).detail ? ` — ${(e as { detail: string }).detail}` : ""}`);
    await asService(sql, (tx) => tx`
      update public.provider_events
         set status = ${dead ? "dead" : "failed"}, attempts = ${attempts}, last_error = ${msg},
             next_attempt_at = now() + make_interval(secs => ${Math.min(3600, 15 * 2 ** row.attempts)})
       where id = ${row.id}`);
    log(dead ? "alert" : "warn", dead ? "provider_event.dead_letter" : "provider_event.failed", { eventId: row.id, type: row.type, error: msg });
    return;
  }
  if (outcome === "wait") {
    if (Date.now() - row.received_at.getTime() < GRACE_MS) {
      await asService(sql, (tx) => tx`update public.provider_events set status = 'received', next_attempt_at = now() + interval '30 seconds' where id = ${row.id}`);
      return;
    }
    outcome = "unmatched";
  }
  await asService(sql, (tx) => tx`
    update public.provider_events set status = ${outcome}, attempts = attempts + 1, last_error = null, processed_at = now() where id = ${row.id}`);
}

async function opFor(sql: Sql, kind: "refund" | "payout", p: EventPayload, objectRef: string | null) {
  const opId = p.metadata?.outbound_op_id ?? null;
  const [op] = await asService(sql, (tx) => tx<OpRow[]>`
    select * from public.outbound_ops
     where kind = ${kind} and ((${opId}::text is not null and id::text = ${opId}) or (${objectRef}::text is not null and provider_ref = ${objectRef}))
     limit 1`);
  return op ?? null;
}

async function handle(sql: Sql, provider: PaymentProvider, row: EventRow): Promise<Outcome> {
  const p = row.payload;
  switch (p.type) {
    case "payment.succeeded": {
      const backingId = p.metadata?.backing_id ?? null;
      const [b] = await asService(sql, (tx) => tx<{ id: string; correlation_id: string | null }[]>`
        select id, correlation_id from public.backings
         where (${backingId}::text is not null and id::text = ${backingId}) or payment_ref = ${p.paymentRef ?? row.object_ref}
         limit 1`);
      if (!b) return "wait";
      const ref = p.paymentRef ?? row.object_ref!;
      const fee = p.feeMinor ?? (await provider.paymentFee(ref));
      await runWithCtx({ correlationId: b.correlation_id ?? row.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, () =>
        asService(sql, (tx) => tx`select public.apply_payment_captured(${b.id}, ${ref}, ${n(p.amountMinor)}, ${p.currency ?? "usd"}, ${fee}, ${"capture:" + b.id})`),
      );
      return "processed";
    }
    case "payment.failed": {
      const backingId = p.metadata?.backing_id ?? null;
      const [b] = await asService(sql, (tx) => tx<{ id: string; correlation_id: string | null }[]>`
        select id, correlation_id from public.backings where (${backingId}::text is not null and id::text = ${backingId}) or payment_ref = ${row.object_ref} limit 1`);
      if (!b) return "unmatched";
      // The payment attempt stays usable (the fan can retry the card); the hold expiry cleans up if they don't.
      await runWithCtx({ correlationId: b.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, () =>
        asService(sql, (tx) => tx`insert into public.audit_events (action, entity, entity_id, data)
                                  values ('payment.failed', 'backing', ${b.id}, ${tx.json({ failure_code: p.failureCode ?? null })})`),
      );
      return "processed";
    }
    case "payment.canceled":
      return "processed";
    case "refund.succeeded": {
      const op = await opFor(sql, "refund", p, row.object_ref);
      if (!op) return "wait";
      await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, () =>
        confirmRefund(sql, op, row.object_ref!, n(p.amountMinor)),
      );
      return "processed";
    }
    case "refund.failed": {
      const op = await opFor(sql, "refund", p, row.object_ref);
      if (!op) return "unmatched";
      await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, () =>
        asService(sql, (tx) => tx`update public.outbound_ops set status = 'failed', last_error = ${"refund failed: " + (p.failureCode ?? "unknown")} where id = ${op.id} and status <> 'confirmed'`),
      );
      log("alert", "refund.failed", { opId: op.id, code: p.failureCode });
      return "processed";
    }
    case "transfer.created": {
      const op = await opFor(sql, "payout", p, row.object_ref);
      if (!op) return "wait";
      if (op.status !== "confirmed") {
        await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, () =>
          confirmPayout(sql, op, row.object_ref!, n(p.amountMinor)),
        );
      }
      return "processed";
    }
    default:
      return "ignored";
  }
}
