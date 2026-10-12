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

/**
 * The provider idempotency key of an op's attempt generation (design §5 "Attempt generations"): the op's own key for
 * generation 0, `<key>:r<gen>` after. A failed movement's key is never reused (a provider returns the original object).
 */
export const attemptKey = (key: string, gen: number) => (gen > 0 ? `${key}:r${gen}` : key);
/** The generation a provider object's metadata names (`outbound_attempt`; absent = 0, objects made before generations). */
export const attemptOf = (metadata: Record<string, string> | null | undefined) => Number(metadata?.outbound_attempt ?? 0) || 0;
/** Provider statuses of a movement that did NOT move money (never re-adopted, never "sent", never posted). */
export const FAILED_MOVEMENT_STATUSES = ["failed", "canceled", "cancelled", "returned"] as const;
export const isFailedMovement = (status: string | null | undefined) => (FAILED_MOVEMENT_STATUSES as readonly string[]).includes(String(status));

export interface BalanceTxn {
  /** Ref matched against ledger_transactions.external_ref: payment ref (charges), refund id, transfer id. */
  ref: string;
  /**
   * `platform_topup`: FanZuP's own float added to the processor balance (Stripe `topup`, sandbox top-up), the only type
   * recon excludes from the total diff. Everything else Stripe reports (payout, stripe_fee, dispute, fee corrections…)
   * maps to `adjustment` and stays in the totals; with no ledger posting it is an `unmatched_provider_txn` break (design §7).
   */
  type: "charge" | "refund" | "transfer" | "platform_topup" | "adjustment";
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
  /**
   * Find the payment attempt created for a backing whose ref we never stored (crash between createPayment and
   * storing the ref, design §5). Stripe: `paymentIntents.search` on `metadata['backing_id']`. Null when none exists.
   */
  findPayment(input: { backingId: string }): Promise<{ paymentRef: string; status: string } | null>;
  /** Cancel an unpaid payment attempt so it can no longer succeed. */
  cancelPayment(paymentRef: string): Promise<"canceled" | "already_succeeded" | "already_canceled">;
  /** Processing fee for a succeeded payment (Stripe: from the charge's balance transaction). */
  paymentFee(paymentRef: string): Promise<number>;

  /**
   * `backingId` is null for a stray-capture refund (design §3.5.1), which is keyed by the payment. `attempt` is the op's
   * attempt generation (design §5 "Attempt generations"): sent as metadata `outbound_attempt`; `idempotencyKey` is the
   * generation's key (`attemptKey`). A reused key returns the ORIGINAL object, whatever its status — hence `status`.
   */
  refund(input: { paymentRef: string; amountMinor: number; idempotencyKey: string; opId: string; attempt: number; backingId: string | null; campaignId: string }): Promise<{ refundRef: string; amountMinor: number; status?: string }>;
  /** The refund of this op's CURRENT generation only (metadata `outbound_op_id` + `outbound_attempt`, absent = 0). */
  findRefund(input: { paymentRef: string; opId: string; attempt: number }): Promise<{ refundRef: string; amountMinor: number; status: string } | null>;

  transfer(input: { campaignId: string; trancheId: string; destination: string; amountMinor: number; idempotencyKey: string; opId: string; attempt: number }): Promise<{ transferRef: string; amountMinor: number }>;
  /** The transfer of this op's CURRENT generation only (metadata `outbound_op_id` + `outbound_attempt`, absent = 0). */
  findTransfer(input: { campaignId: string; opId: string; attempt: number }): Promise<{ transferRef: string; amountMinor: number } | null>;

  /** Verify a webhook delivery and normalise it. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedEvent;

  listBalanceTransactions(): Promise<BalanceTxn[]>;

  /** Artist payout onboarding (FR-ID-004): returns the account ref and, for Stripe, a hosted onboarding link. */
  payoutOnboarding(input: { artistId: string; existingRef: string | null; returnUrl: string; refreshUrl: string }): Promise<{ accountRef: string; onboardingUrl: string | null }>;
  payoutAccountReady(accountRef: string): Promise<boolean>;
}
