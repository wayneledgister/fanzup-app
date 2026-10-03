/**
 * Escrow partner boundary (Mechanism 05 §2-3, Mechanism 02).
 *
 * FanZuP never holds cash. A third-party escrow / FBO partner does. The partner isn't chosen yet
 * (candidates: North Capital, or a bank FBO via Column / Increase / Treasury Prime + Modern Treasury),
 * so every money movement goes through this interface. Swap the implementation; nothing else changes.
 */
export interface CreatePaymentInput {
  backingId: string;
  campaignId: string;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
}

export interface EscrowProvider {
  readonly name: string;
  /** true when refunds/payments settle instantly (sandbox); false when a webhook confirms them later. */
  readonly confirmsImmediately: boolean;
  /** Start collecting a backer's payment into escrow. Returns what the web checkout needs. */
  createPayment(input: CreatePaymentInput): Promise<{ paymentRef: string; clientSecret: string }>;
  /** Return a backer's money in full (failed campaign). Confirmation arrives via webhook/poll. */
  refund(input: { paymentRef: string; amountMinor: number; idempotencyKey: string }): Promise<{ refundRef: string }>;
  /** Pay a released tranche from escrow to the artist's verified payout account. */
  releaseToArtist(input: { campaignId: string; payoutAccountRef: string | null; amountMinor: number; idempotencyKey: string }): Promise<{ payoutRef: string }>;
}
