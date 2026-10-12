/**
 * Backing creation (FR-PAY-001, FR-PAY-006; design 02 §4.4). Claim-first idempotency:
 *   2. ONE transaction: claim the Idempotency-Key (insert … on conflict do nothing — a concurrent request with the
 *      same key blocks on the unique index until this commits) and, under a savepoint, hold stock + create the
 *      backing. A rule violation rolls back to the savepoint and is stored on the claim as the outcome (`done`),
 *      so a retry with the key gets the same error. A crash before commit leaves neither claim nor hold.
 *   3. Resume guard, then create the provider payment. Every parameter comes from the stored backing (one helper,
 *      first pass and resume alike), so the provider's idempotent replay always sees identical parameters.
 *   4. Store the payment ref — only while the backing is still `pending_payment` — and the response.
 * A failure after (2) leaves the claim `in_progress` with the backing, so a retry with the same key resumes at (3).
 */
import { createHash } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql, type Tx } from "./db";
import { HttpError } from "./lib/auth";
import { RULE_STATUS } from "./lib/errors";
import { log, redact } from "./log";
import type { CreatePaymentInput, PaymentProvider } from "./provider/types";

export interface BackingRequest {
  campaignId: string;
  perkId: string;
  quantity: number;
  source?: string | null;
}
export interface BackingResponse {
  backingId: string;
  amountMinor: number;
  holdExpiresAt: string;
  clientSecret: string;
  provider: string;
}
/** A stored error outcome (design §4.4 step 2d / step 3): replayed as the same status and error code. */
interface StoredError {
  error: string;
  message: string;
}

type Claim = { request_hash: string; response: BackingResponse | StoredError | null; status_code: number | null; state: string; resource_id: string | null };

const EXPIRED: StoredError = { error: "checkout_expired", message: "This checkout expired. Start again from the campaign page." };

/** Hash of the request a key was first used for (exported for the crash-between-steps tests). */
export const requestHash = (userId: string, body: BackingRequest) => createHash("sha256").update(JSON.stringify({ u: userId, body })).digest("hex");
export const scopedKey = (userId: string, key: string) => `backings:${userId}:${key}`;

function replay(status: number, body: BackingResponse | StoredError) {
  if (status >= 400) throw new HttpError(status, (body as StoredError).error, (body as StoredError).message);
  return { status, body: body as BackingResponse };
}

async function storeOutcome(tx: Tx, key: string, status: number, body: BackingResponse | StoredError) {
  await tx`update public.api_idempotency set response = ${tx.json(body as never)}, status_code = ${status}, state = 'done'
           where key = ${key} and state = 'in_progress'`;
}

/**
 * The provider payment for a backing, built only from the stored row (design §4.4 step 3, ADR-005): amount,
 * campaign, description from the database titles, and the correlation id of the request that CREATED the backing.
 */
export async function paymentParamsFor(sql: Sql, backingId: string): Promise<CreatePaymentInput> {
  const [b] = await asService(sql, (tx) => tx<{ campaign_id: string; amount_minor: bigint; correlation_id: string | null; description: string }[]>`
    select b.campaign_id, b.amount_minor, b.correlation_id, c.title || ' — ' || p.title as description
      from public.backings b join public.campaigns c on c.id = b.campaign_id join public.perks p on p.id = b.perk_id
     where b.id = ${backingId}`);
  return {
    backingId,
    campaignId: b.campaign_id,
    amountMinor: n(b.amount_minor),
    description: b.description,
    idempotencyKey: `payment:${backingId}`,
    correlationId: b.correlation_id ?? "",
  };
}

export async function createBacking(sql: Sql, provider: PaymentProvider, userId: string, key: string, body: BackingRequest) {
  const hash = requestHash(userId, body);
  const k = scopedKey(userId, key);

  // ── Step 2: claim + hold in one transaction ───────────────────────────
  const step2 = await asService(sql, async (tx): Promise<{ replay: { status: number; body: BackingResponse | StoredError } } | { backingId: string }> => {
    const [mine] = await tx<{ key: string }[]>`
      insert into public.api_idempotency (key, user_id, request_hash, state, claimed_at) values (${k}, ${userId}, ${hash}, 'in_progress', now())
      on conflict (key) do nothing returning key`;
    if (!mine) {
      const [prior] = await tx<Claim[]>`
        select request_hash, response, status_code, state, resource_id from public.api_idempotency where key = ${k} for update`;
      if (prior.request_hash !== hash) throw new HttpError(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
      if (prior.state === "done" && prior.response) return { replay: { status: prior.status_code ?? 201, body: prior.response } };
      if (prior.resource_id) return { backingId: prior.resource_id }; // resume at step 3
      // in_progress with no backing: abandoned only once it is older than abandonedClaimMinutes (backstop for rows
      // from an older code path; with claim + hold in one transaction this state shouldn't arise).
      const [reclaimed] = await tx<{ key: string }[]>`
        update public.api_idempotency set claimed_at = now()
         where key = ${k} and state = 'in_progress' and resource_id is null
           and coalesce(claimed_at, created_at) < now() - make_interval(mins => ${POLICY.checkout.abandonedClaimMinutes})
        returning key`;
      if (!reclaimed) throw new HttpError(409, "in_progress", "This checkout is already being processed. Wait a moment and try again.");
    }
    try {
      const [hold] = await tx.savepoint((sp) => sp<{ backing_id: string }[]>`
        select backing_id from public.create_backing_hold(${userId}, ${body.campaignId}, ${body.perkId}, ${body.quantity}, ${body.source ?? null},
                                                          ${POLICY.checkout.holdMinutes}, ${POLICY.checkout.maxUnconfirmedPerUser})`);
      await tx`update public.api_idempotency set resource_id = ${hold.backing_id} where key = ${k}`;
      return { backingId: hold.backing_id };
    } catch (e) {
      const err = e as { code?: string; message?: string; detail?: string };
      const status = err.code === "P0001" && err.message ? RULE_STATUS[err.message] : undefined;
      if (!status) throw e; // not a business rule: roll everything back (no claim, no hold)
      const stored: StoredError = { error: err.message!, message: err.detail ?? "That isn't allowed." };
      await storeOutcome(tx, k, status, stored);
      return { replay: { status, body: stored } };
    }
  });
  if ("replay" in step2) return replay(step2.replay.status, step2.replay.body);
  const backingId = step2.backingId;

  // ── Step 3: resume guard, then the provider call ──────────────────────
  const [b] = await asService(sql, (tx) => tx<{ status: string; hold_expires_at: Date | null; payment_ref: string | null; live: boolean }[]>`
    select b.status::text, b.hold_expires_at, b.payment_ref, (c.status = 'live' and now() < c.ends_at) as live
      from public.backings b join public.campaigns c on c.id = b.campaign_id where b.id = ${backingId}`);
  if (b.status !== "pending_payment" || !b.hold_expires_at || b.hold_expires_at.getTime() <= Date.now() || !b.live) {
    // Terminal: stored so every later retry with this key replays it, and no payment is created for a dead hold.
    await asService(sql, (tx) => storeOutcome(tx, k, 409, EXPIRED));
    return replay(409, EXPIRED);
  }

  const params = await paymentParamsFor(sql, backingId);
  let pay: { paymentRef: string; clientSecret: string };
  try {
    pay = await provider.createPayment(params);
  } catch {
    throw new HttpError(502, "provider_unavailable", "We couldn't reach the payment processor. Nothing was charged — try again.");
  }

  // ── Step 4: store the payment ref (only on a live hold) and the response ──
  const response: BackingResponse = {
    backingId,
    amountMinor: params.amountMinor,
    holdExpiresAt: b.hold_expires_at.toISOString(),
    clientSecret: pay.clientSecret,
    provider: provider.name,
  };
  const stored = await asService(sql, async (tx) => {
    const [ok] = await tx<{ id: string }[]>`
      update public.backings set payment_ref = ${pay.paymentRef}
       where id = ${backingId} and status = 'pending_payment' and (payment_ref is null or payment_ref = ${pay.paymentRef})
      returning id`;
    // The capture webhook can beat this step and already have applied this very payment: that's success too.
    const [already] = ok ? [ok] : await tx<{ id: string }[]>`select id from public.backings where id = ${backingId} and payment_ref = ${pay.paymentRef}`;
    if (!already) {
      await storeOutcome(tx, k, 409, EXPIRED);
      return false;
    }
    await storeOutcome(tx, k, 201, response);
    return true;
  });
  if (!stored) {
    // The hold died between the guard and here: make sure the payment can't succeed for nobody.
    await provider.cancelPayment(pay.paymentRef).catch((e) =>
      log("warn", "checkout.cancel_failed", { backingId, error: redact(String((e as Error).message ?? e)) }),
    );
    return replay(409, EXPIRED);
  }
  return { status: 201, body: response };
}
