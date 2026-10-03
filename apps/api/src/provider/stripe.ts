/**
 * Stripe TEST mode (ADR-003). Stripe states it does not provide escrow services — this is the test-money
 * stand-in until a custodian is chosen (E1 card B; FR-PAY-008/010). Funds sit in the platform's Stripe test
 * balance and move with "separate charges and transfers" to Connect Express accounts.
 *
 * Use test card 4000 0000 0000 0077 so charges land in the AVAILABLE balance immediately; otherwise
 * transfers wait for funds (classified `wait_funds`, design §5).
 */
import Stripe from "stripe";
import { ProviderError, type BalanceTxn, type NormalizedEvent, type PaymentProvider } from "./types";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string | null;
  publishableKey: string | null;
}

/** Map a Stripe SDK error to an outbound error class (design §5). Exported for contract tests. */
export function classifyStripeError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { type?: string; code?: string; statusCode?: number; message?: string };
  const code = err.code ?? err.type ?? "unknown";
  const msg = err.message ?? String(e);
  if (err.code === "balance_insufficient") return new ProviderError("wait_funds", code, msg);
  if (
    err.type === "StripeConnectionError" || err.type === "StripeAPIError" || err.type === "StripeRateLimitError" ||
    err.statusCode === 429 || (err.statusCode ?? 0) >= 500 || err.code === "lock_timeout"
  ) return new ProviderError("retry", code, msg);
  return new ProviderError("permanent", code, msg);
}

const meta = (m: Stripe.Metadata | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, String(v)]));

/** Normalise a verified Stripe event (exported for contract tests on recorded payloads). */
export function normalizeStripeEvent(event: Stripe.Event): NormalizedEvent {
  const base = {
    provider: "stripe-test",
    eventId: event.id,
    livemode: event.livemode,
    account: event.account ?? null,
    metadata: {} as Record<string, string>,
    raw: event,
  };
  const obj = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const type = event.type === "payment_intent.succeeded" ? "payment.succeeded" : event.type === "payment_intent.canceled" ? "payment.canceled" : "payment.failed";
      return {
        ...base, type, objectRef: pi.id, paymentRef: pi.id,
        amountMinor: type === "payment.succeeded" ? pi.amount_received : pi.amount, currency: pi.currency,
        failureCode: pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? null,
        metadata: meta(pi.metadata),
      };
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const r = event.data.object as Stripe.Refund;
      const status = r.status ?? "pending";
      const type = status === "succeeded" ? "refund.succeeded" : status === "failed" || status === "canceled" ? "refund.failed" : "other";
      return {
        ...base, type, objectRef: r.id, paymentRef: typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id ?? null,
        amountMinor: r.amount, currency: r.currency, failureCode: r.failure_reason ?? null, metadata: meta(r.metadata),
      };
    }
    case "transfer.created": {
      const t = event.data.object as Stripe.Transfer;
      return { ...base, type: "transfer.created", objectRef: t.id, amountMinor: t.amount, currency: t.currency, metadata: meta(t.metadata) };
    }
    default:
      return { ...base, type: "other", objectRef: typeof obj?.id === "string" ? obj.id : null };
  }
}

export class StripeTestProvider implements PaymentProvider {
  readonly name = "stripe-test" as const;
  readonly testMode = true;
  readonly publishableKey: string | null;
  private stripe: Stripe;

  constructor(private cfg: StripeConfig, client?: Stripe) {
    this.stripe = client ?? new Stripe(cfg.secretKey);
    this.publishableKey = cfg.publishableKey;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw classifyStripeError(e);
    }
  }

  createPayment(input: Parameters<PaymentProvider["createPayment"]>[0]) {
    return this.call(async () => {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: "usd",
          description: input.description,
          transfer_group: `campaign_${input.campaignId}`,
          automatic_payment_methods: { enabled: true },
          metadata: { backing_id: input.backingId, campaign_id: input.campaignId, correlation_id: input.correlationId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { paymentRef: pi.id, clientSecret: pi.client_secret! };
    });
  }

  async cancelPayment(paymentRef: string) {
    try {
      await this.stripe.paymentIntents.cancel(paymentRef);
      return "canceled" as const;
    } catch (e) {
      const pi = await this.call(() => this.stripe.paymentIntents.retrieve(paymentRef));
      if (pi.status === "succeeded") return "already_succeeded" as const;
      if (pi.status === "canceled") return "already_canceled" as const;
      throw classifyStripeError(e);
    }
  }

  paymentFee(paymentRef: string) {
    return this.call(async () => {
      const pi = await this.stripe.paymentIntents.retrieve(paymentRef, { expand: ["latest_charge.balance_transaction"] });
      const bt = (pi.latest_charge as Stripe.Charge | null)?.balance_transaction as Stripe.BalanceTransaction | null;
      if (!bt) throw new ProviderError("retry", "fee_not_ready", "Balance transaction not available yet");
      return bt.fee;
    });
  }

  refund(input: Parameters<PaymentProvider["refund"]>[0]) {
    return this.call(async () => {
      const r = await this.stripe.refunds.create(
        { payment_intent: input.paymentRef, amount: input.amountMinor, metadata: { outbound_op_id: input.opId, backing_id: input.backingId, campaign_id: input.campaignId } },
        { idempotencyKey: input.idempotencyKey },
      );
      return { refundRef: r.id, amountMinor: r.amount };
    });
  }

  findRefund(input: { paymentRef: string; opId: string }) {
    return this.call(async () => {
      const list = await this.stripe.refunds.list({ payment_intent: input.paymentRef, limit: 100 });
      const r = list.data.find((x) => x.metadata?.outbound_op_id === input.opId);
      return r ? { refundRef: r.id, amountMinor: r.amount, status: r.status ?? "pending" } : null;
    });
  }

  transfer(input: Parameters<PaymentProvider["transfer"]>[0]) {
    return this.call(async () => {
      const t = await this.stripe.transfers.create(
        {
          amount: input.amountMinor, currency: "usd", destination: input.destination, transfer_group: `campaign_${input.campaignId}`,
          metadata: { outbound_op_id: input.opId, campaign_id: input.campaignId, tranche_id: input.trancheId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { transferRef: t.id, amountMinor: t.amount };
    });
  }

  findTransfer(input: { campaignId: string; opId: string }) {
    return this.call(async () => {
      const list = await this.stripe.transfers.list({ transfer_group: `campaign_${input.campaignId}`, limit: 100 });
      const t = list.data.find((x) => x.metadata?.outbound_op_id === input.opId);
      return t ? { transferRef: t.id, amountMinor: t.amount } : null;
    });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedEvent {
    if (!this.cfg.webhookSecret) throw new ProviderError("permanent", "webhook_not_configured", "STRIPE_WEBHOOK_SECRET is not set");
    const event = this.stripe.webhooks.constructEvent(rawBody, String(signature ?? ""), this.cfg.webhookSecret);
    return normalizeStripeEvent(event);
  }

  async listBalanceTransactions(): Promise<BalanceTxn[]> {
    const out: BalanceTxn[] = [];
    await this.call(async () => {
      for await (const bt of this.stripe.balanceTransactions.list({ limit: 100, expand: ["data.source"] })) {
        out.push(mapBalanceTxn(bt));
      }
    });
    return out;
  }

  payoutOnboarding(input: { artistId: string; existingRef: string | null; returnUrl: string; refreshUrl: string }) {
    return this.call(async () => {
      const accountRef =
        input.existingRef ??
        (await this.stripe.accounts.create({ type: "express", country: "US", capabilities: { transfers: { requested: true } }, metadata: { artist_id: input.artistId } })).id;
      const link = await this.stripe.accountLinks.create({ account: accountRef, type: "account_onboarding", return_url: input.returnUrl, refresh_url: input.refreshUrl });
      return { accountRef, onboardingUrl: link.url };
    });
  }

  payoutAccountReady(accountRef: string) {
    return this.call(async () => (await this.stripe.accounts.retrieve(accountRef)).payouts_enabled === true);
  }
}

/** Exported for contract tests. */
export function mapBalanceTxn(bt: Stripe.BalanceTransaction): BalanceTxn {
  const src = bt.source as unknown as Record<string, unknown> | string | null;
  const s = typeof src === "object" && src ? src : {};
  const group = typeof s.transfer_group === "string" ? s.transfer_group : null;
  const md = (s.metadata ?? {}) as Record<string, string>;
  const campaignId = md.campaign_id ?? (group?.startsWith("campaign_") ? group.slice(9) : null);
  if (bt.type === "charge" || bt.type === "payment") {
    const ref = typeof s.payment_intent === "string" ? s.payment_intent : String(s.id ?? bt.id);
    return { ref, type: "charge", netMinor: bt.net, feeMinor: bt.fee, campaignId };
  }
  if (bt.type === "refund" || bt.type === "payment_refund") return { ref: String(s.id ?? bt.id), type: "refund", netMinor: bt.net, feeMinor: bt.fee, campaignId };
  if (bt.type === "transfer") return { ref: String(s.id ?? bt.id), type: "transfer", netMinor: bt.net, feeMinor: bt.fee, campaignId };
  return { ref: bt.id, type: "adjustment", netMinor: bt.net, feeMinor: bt.fee, campaignId };
}
