/**
 * Provider event inbox (FR-PAY-002; ADR-003). Every provider event is stored (unique per provider event id) and
 * acknowledged before any business processing; processing is idempotent, retried with bounded attempts, and
 * replayable by staff. Each event is processed under the correlation id of the backing or op it belongs to.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "./db";
import { runWithCtx } from "./context";
import type { NormalizedEvent, PaymentProvider } from "./provider/types";
import { confirmPayout, confirmRefundOrFlag, type OpRow } from "./outbound";
import { log, redact } from "./log";
import { handleRegCfEvent } from "./l2/events";

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
  /** Set by the claim; outcome updates only apply while the row still carries it. */
  claim_token: string;
}

/**
 * Store an event. With `ignored`, the row is inserted already `ignored` (with the reason and processed_at) in the
 * same statement — used for Connect events of accounts that aren't ours, so no processor can ever pick them up
 * (design §5; a crash can't leave them `received`).
 */
export async function ingestEvent(sql: Sql, evt: NormalizedEvent, opts: { ignored?: string } = {}): Promise<{ id: string; inserted: boolean }> {
  const payload: EventPayload = {
    type: evt.type, paymentRef: evt.paymentRef ?? null, amountMinor: evt.amountMinor, currency: evt.currency,
    feeMinor: evt.feeMinor ?? null, failureCode: evt.failureCode ?? null, metadata: evt.metadata, raw: evt.raw,
  };
  const ignored = opts.ignored ?? null;
  return asService(sql, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.provider_events (provider, event_id, type, livemode, account, object_ref, payload, status, last_error, processed_at)
      values (${evt.provider}, ${evt.eventId}, ${evt.type}, ${evt.livemode}, ${evt.account}, ${evt.objectRef}, ${tx.json(payload as never)},
              ${ignored ? "ignored" : "received"}, ${ignored}, ${ignored ? tx`now()` : null})
      on conflict (provider, event_id) do nothing returning id`;
    if (row) return { id: row.id, inserted: true };
    const [old] = await tx<{ id: string }[]>`select id from public.provider_events where provider = ${evt.provider} and event_id = ${evt.eventId}`;
    return { id: old.id, inserted: false };
  });
}

/** Worker step: process pending events oldest first. Each row is claimed (status 'processing') before work starts. */
export async function processPendingEvents(sql: Sql, provider: PaymentProvider, limit = 100) {
  let done = 0;
  for (; done < limit; done++) {
    const [row] = await asService(sql, (tx) => tx<EventRow[]>`
      update public.provider_events set status = 'processing', lease_until = now() + interval '5 minutes', claim_token = gen_random_uuid()
       where id = (select id from public.provider_events
                    where (status in ('received', 'failed') and next_attempt_at <= now())
                       or (status = 'processing' and lease_until < now())
                    order by received_at limit 1 for update skip locked)
      returning id, provider, event_id, type, object_ref, payload, attempts, received_at, correlation_id, claim_token`);
    if (!row) break;
    await processEventRow(sql, provider, row);
  }
  return done;
}

/**
 * Process one stored event now (webhook inline attempt, dev route, staff replay). The row is claimed atomically
 * (status 'processing' with a 5-minute lease), so an inline attempt and the worker never process one event at once.
 */
export async function processEventById(sql: Sql, provider: PaymentProvider, id: string) {
  const [row] = await asService(sql, (tx) => tx<EventRow[]>`
    update public.provider_events set status = 'processing', lease_until = now() + interval '5 minutes', claim_token = gen_random_uuid()
     where id = ${id}
       and (status in ('received', 'failed') or (status = 'processing' and lease_until < now()))
    returning id, provider, event_id, type, object_ref, payload, attempts, received_at, correlation_id, claim_token`);
  if (row) await processEventRow(sql, provider, row);
  return !!row;
}

type Outcome = "processed" | "ignored" | "unmatched" | "wait";

async function processEventRow(sql: Sql, provider: PaymentProvider, row: EventRow) {
  // Every outcome write is conditional on still holding the claim: if this processor outlived its lease and another
  // one re-claimed the row, the newer claimant's result stands (the money functions are idempotent either way).
  const lostClaim = (n: number) => {
    if (n === 0) log("warn", "provider_event.claim_lost", { eventId: row.id, type: row.type });
  };
  let outcome: Outcome;
  try {
    outcome = await handle(sql, provider, row);
  } catch (e) {
    const attempts = row.attempts + 1;
    const dead = attempts >= POLICY.outbound.maxAttempts;
    const msg = redact(`${(e as { message?: string }).message ?? e}${(e as { detail?: string }).detail ? ` — ${(e as { detail: string }).detail}` : ""}`);
    await asService(sql, (tx) => tx`
      update public.provider_events
         set status = ${dead ? "dead" : "failed"}, attempts = ${attempts}, last_error = ${msg}, lease_until = null,
             next_attempt_at = now() + make_interval(secs => ${Math.min(3600, 15 * 2 ** row.attempts)}), claim_token = null
       where id = ${row.id} and status = 'processing' and claim_token = ${row.claim_token}`).then((r) => lostClaim(r.count));
    log(dead ? "alert" : "warn", dead ? "provider_event.dead_letter" : "provider_event.failed", { eventId: row.id, type: row.type, error: msg });
    return;
  }
  if (outcome === "wait") {
    if (Date.now() - row.received_at.getTime() < GRACE_MS) {
      await asService(sql, (tx) => tx`
        update public.provider_events set status = 'received', lease_until = null, claim_token = null, next_attempt_at = now() + interval '30 seconds'
         where id = ${row.id} and status = 'processing' and claim_token = ${row.claim_token}`).then((r) => lostClaim(r.count));
      return;
    }
    outcome = "unmatched";
  }
  await asService(sql, (tx) => tx`
    update public.provider_events
       set status = ${outcome}, attempts = attempts + 1, last_error = null, lease_until = null, claim_token = null, processed_at = now()
     where id = ${row.id} and status = 'processing' and claim_token = ${row.claim_token}`).then((r) => lostClaim(r.count));
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
  if (row.type.startsWith("regcf.")) return handleRegCfEvent(sql, row);
  switch (p.type) {
    case "payment.succeeded":
      return handleCapture(sql, provider, row);
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
      // A different amount than the op fails the op and opens a break, never "fixed" (design §5).
      await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, () =>
        confirmRefundOrFlag(sql, op, row.object_ref!, n(p.amountMinor)));
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

/**
 * A succeeded payment (design §3.5.1): match the backing by payment_ref first, then by metadata.backing_id only
 * when that backing has no payment_ref yet (or the same one). A payment that belongs to no backing but names one
 * of our campaigns — or a second payment for a backing that already has one — is a stray capture: posted and
 * refunded by its own op. Idempotency is keyed by the payment: `capture:<payment_ref>`.
 */
async function handleCapture(sql: Sql, provider: PaymentProvider, row: EventRow): Promise<Outcome> {
  const p = row.payload;
  const ref = p.paymentRef ?? row.object_ref;
  if (!ref) return "unmatched";
  const backingId = p.metadata?.backing_id || null;
  const campaignId = p.metadata?.campaign_id || null;
  type B = { id: string; payment_ref: string | null; correlation_id: string | null; campaign_id: string };
  let [b] = await asService(sql, (tx) => tx<B[]>`select id, payment_ref, correlation_id, campaign_id from public.backings where payment_ref = ${ref} limit 1`);
  if (!b && backingId && UUID_RE.test(backingId)) {
    [b] = await asService(sql, (tx) => tx<B[]>`select id, payment_ref, correlation_id, campaign_id from public.backings where id = ${backingId}`);
  }
  let campaign: string | null = b?.campaign_id ?? null;
  if (!b) {
    // Names a backing we can't see (yet): retry within the grace period, then unmatched. Names only a campaign: stray.
    if (backingId || !campaignId || !UUID_RE.test(campaignId)) return "wait";
    const [c] = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.campaigns where id = ${campaignId}`);
    if (!c) return "wait";
    campaign = c.id;
  }
  const fee = p.feeMinor ?? (await provider.paymentFee(ref));
  return runWithCtx({ correlationId: b?.correlation_id ?? row.correlation_id, actorId: null, actorKind: "system:webhook", aal: null }, async () => {
    if (b) {
      // apply_payment_captured locks the backing, then decides: applied, duplicate, refund:<reason>, or stray
      // (the backing already has a different payment — re-checked under the lock).
      const [r] = await asService(sql, (tx) => tx<{ result: string }[]>`
        select public.apply_payment_captured(${b.id}, ${ref}, ${n(p.amountMinor)}, ${p.currency ?? "usd"}, ${fee}, ${"capture:" + ref}) as result`);
      if (r.result !== "stray") return "processed" as const;
    }
    const [r] = await asService(sql, (tx) => tx<{ result: string }[]>`
      select public.apply_stray_capture(${campaign}, ${ref}, ${n(p.amountMinor)}, ${p.currency ?? "usd"}, ${fee}, ${row.id}) as result`);
    if (r.result === "stray") log("alert", "capture.stray", { eventId: row.id, paymentRef: ref, campaignId: campaign, backingId: b?.id ?? null });
    return "processed" as const;
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
