/**
 * Payment-provider boundary (ADR-003; design 02 §5). The only code that talks to the processor.
 *
 * FanZuP never holds cash. Until a custodian is chosen (E1 card B), Stripe TEST mode plays the provider;
 * the sandbox plays it locally and in CI by emitting events into the same inbox. Swapping in the custodian
 * means a new implementation of this interface, not new money rules (FR-PAY-010).
 */

/** Provider-neutral event, as stored in provider_events and processed by inbox.ts. */
export interface NormalizedEvent {
  provider: string;
  eventId: string;
  type:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.canceled"
    | "refund.succeeded"
    | "refund.failed"
    | "transfer.created"
    | "other";
  livemode: boolean;
  /** Connected account the event belongs to (Stripe Connect); null for platform events. */
  account: string | null;
  /** The provider object the event is about (payment, refund or transfer ref). */
  objectRef: string | null;
  paymentRef?: string | null;
  amountMinor?: number;
  currency?: string;
  /** Processing fee, when the event already carries it (sandbox). Stripe's is looked up at processing time. */
  feeMinor?: number | null;
  failureCode?: string | null;
  metadata: Record<string, string>;
  raw: unknown;
}

/** How an outbound failure is treated (design §5 "Provider error classes", G2 blocker 1). */
export type ProviderErrorClass = "retry" | "wait_funds" | "permanent";

export class ProviderError extends Error {
  constructor(
    public readonly cls: ProviderErrorClass,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface BalanceTxn {
  /** Ref matched against ledger_transactions.external_ref: payment ref (charges), refund id, transfer id. */
  ref: string;
  type: "charge" | "refund" | "transfer" | "adjustment";
  /** Net effect on the platform balance, in cents (charge: amount − fee; refund/transfer: −amount). */
  netMinor: number;
  feeMinor: number;
  campaignId: string | null;
}

export interface CreatePaymentInput {
  backingId: string;
  campaignId: string;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface PaymentProvider {
  readonly name: "sandbox" | "stripe-test";
  /** Always true in M1: live mode is refused at startup (FR-PAY-008). */
  readonly testMode: boolean;
  readonly publishableKey: string | null;

  createPayment(input: CreatePaymentInput): Promise<{ paymentRef: string; clientSecret: string }>;
  /** Cancel an unpaid payment attempt so it can no longer succeed. */
  cancelPayment(paymentRef: string): Promise<"canceled" | "already_succeeded" | "already_canceled">;
  /** Processing fee for a succeeded payment (Stripe: from the charge's balance transaction). */
  paymentFee(paymentRef: string): Promise<number>;

  refund(input: { paymentRef: string; amountMinor: number; idempotencyKey: string; opId: string; backingId: string; campaignId: string }): Promise<{ refundRef: string; amountMinor: number }>;
  findRefund(input: { paymentRef: string; opId: string }): Promise<{ refundRef: string; amountMinor: number; status: string } | null>;

  transfer(input: { campaignId: string; trancheId: string; destination: string; amountMinor: number; idempotencyKey: string; opId: string }): Promise<{ transferRef: string; amountMinor: number }>;
  findTransfer(input: { campaignId: string; opId: string }): Promise<{ transferRef: string; amountMinor: number } | null>;

  /** Verify a webhook delivery and normalise it. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedEvent;

  listBalanceTransactions(): Promise<BalanceTxn[]>;

  /** Artist payout onboarding (FR-ID-004): returns the account ref and, for Stripe, a hosted onboarding link. */
  payoutOnboarding(input: { artistId: string; existingRef: string | null; returnUrl: string; refreshUrl: string }): Promise<{ accountRef: string; onboardingUrl: string | null }>;
  payoutAccountReady(accountRef: string): Promise<boolean>;
}
