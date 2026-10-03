/**
 * Backing creation (FR-PAY-001, FR-PAY-006; design 02 §4.4). Claim-first idempotency:
 *   1. claim the Idempotency-Key (insert … on conflict do nothing) before doing anything;
 *   2. hold stock + create the backing in one transaction (no lock held past it);
 *   3. create the provider payment with an idempotency key derived from the backing;
 *   4. store the response. A failure after (2) leaves the claim in progress with the backing, so a retry with
 *      the same key resumes at (3) and the provider returns the same payment.
 */
import { createHash } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "./db";
import { currentCtx } from "./context";
import { HttpError } from "./lib/auth";
import type { PaymentProvider } from "./provider/types";

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

type Claim = { request_hash: string; response: BackingResponse | null; status_code: number | null; state: string; resource_id: string | null };

export async function createBacking(sql: Sql, provider: PaymentProvider, userId: string, key: string, body: BackingRequest) {
  const hash = createHash("sha256").update(JSON.stringify({ u: userId, body })).digest("hex");
  const scopedKey = `backings:${userId}:${key}`;

  const [mine] = await asService(sql, (tx) => tx<{ key: string }[]>`
    insert into public.api_idempotency (key, user_id, request_hash, state) values (${scopedKey}, ${userId}, ${hash}, 'in_progress')
    on conflict (key) do nothing returning key`);
  let backingId: string | null = null;
  if (!mine) {
    const [prior] = await asService(sql, (tx) => tx<Claim[]>`
      select request_hash, response, status_code, state, resource_id from public.api_idempotency where key = ${scopedKey}`);
    if (prior.request_hash !== hash) throw new HttpError(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
    if (prior.state === "done" && prior.response) return { status: prior.status_code ?? 201, body: prior.response };
    if (!prior.resource_id) throw new HttpError(409, "in_progress", "This checkout is already being processed. Wait a moment and try again.");
    backingId = prior.resource_id; // resume after a provider failure
  }

  let hold: { backing_id: string; amount_minor: bigint; hold_expires_at: Date; description: string };
  if (!backingId) {
    try {
      [hold] = await asService(sql, async (tx) => {
        const rows = await tx<typeof hold[]>`
          select * from public.create_backing_hold(${userId}, ${body.campaignId}, ${body.perkId}, ${body.quantity}, ${body.source ?? null},
                                                    ${POLICY.checkout.holdMinutes}, ${POLICY.checkout.maxUnconfirmedPerUser})`;
        await tx`update public.api_idempotency set resource_id = ${rows[0].backing_id} where key = ${scopedKey}`;
        return rows;
      });
    } catch (e) {
      // Nothing was created: release the claim so the same key can be retried after the fan fixes the problem.
      await asService(sql, (tx) => tx`delete from public.api_idempotency where key = ${scopedKey} and resource_id is null`);
      throw e;
    }
    backingId = hold.backing_id;
  } else {
    const [b] = await asService(sql, (tx) => tx<{ amount_minor: bigint; hold_expires_at: Date | null; status: string; title: string }[]>`
      select b.amount_minor, b.hold_expires_at, b.status, c.title || ' — ' || p.title as title
        from public.backings b join public.campaigns c on c.id = b.campaign_id join public.perks p on p.id = b.perk_id where b.id = ${backingId}`);
    if (b.status !== "pending_payment" || !b.hold_expires_at) throw new HttpError(409, "checkout_expired", "This checkout expired. Start again from the campaign page.");
    hold = { backing_id: backingId, amount_minor: b.amount_minor, hold_expires_at: b.hold_expires_at, description: b.title };
  }

  let pay: { paymentRef: string; clientSecret: string };
  try {
    pay = await provider.createPayment({
      backingId,
      campaignId: body.campaignId,
      amountMinor: n(hold.amount_minor),
      description: hold.description,
      idempotencyKey: `payment:${backingId}`,
      correlationId: currentCtx()?.correlationId ?? "",
    });
  } catch {
    throw new HttpError(502, "provider_unavailable", "We couldn't reach the payment processor. Nothing was charged — try again.");
  }
  const response: BackingResponse = {
    backingId,
    amountMinor: n(hold.amount_minor),
    holdExpiresAt: hold.hold_expires_at.toISOString(),
    clientSecret: pay.clientSecret,
    provider: provider.name,
  };
  await asService(sql, async (tx) => {
    await tx`update public.backings set payment_ref = ${pay.paymentRef} where id = ${backingId} and (payment_ref is null or payment_ref = ${pay.paymentRef})`;
    await tx`update public.api_idempotency set response = ${tx.json(response as never)}, status_code = 201, state = 'done' where key = ${scopedKey}`;
  });
  return { status: 201, body: response };
}
