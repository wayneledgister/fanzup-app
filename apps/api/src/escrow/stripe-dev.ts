import Stripe from "stripe";
import type { EscrowProvider } from "./provider";

/**
 * DEVELOPMENT ONLY. Stripe test mode, used to exercise checkout, webhooks and refunds end to end.
 * Stripe states it does not provide escrow services — this is NOT the production custody model.
 * Funds sit in the platform's Stripe test balance and are moved with separate charges and transfers.
 */
export class StripeDevEscrow implements EscrowProvider {
  readonly name = "stripe-dev";
  readonly confirmsImmediately = false;
  constructor(private stripe: Stripe) {}

  async createPayment(input: Parameters<EscrowProvider["createPayment"]>[0]) {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: "usd",
        description: input.description,
        transfer_group: `campaign_${input.campaignId}`,
        automatic_payment_methods: { enabled: true },
        metadata: { backing_id: input.backingId, campaign_id: input.campaignId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { paymentRef: pi.id, clientSecret: pi.client_secret! };
  }

  async refund(input: Parameters<EscrowProvider["refund"]>[0]) {
    const r = await this.stripe.refunds.create({ payment_intent: input.paymentRef, amount: input.amountMinor }, { idempotencyKey: input.idempotencyKey });
    return { refundRef: r.id };
  }

  async releaseToArtist(input: Parameters<EscrowProvider["releaseToArtist"]>[0]) {
    if (!input.payoutAccountRef) throw new Error("Artist has no verified payout account");
    const t = await this.stripe.transfers.create(
      { amount: input.amountMinor, currency: "usd", destination: input.payoutAccountRef, transfer_group: `campaign_${input.campaignId}` },
      { idempotencyKey: input.idempotencyKey },
    );
    return { payoutRef: t.id };
  }
}
