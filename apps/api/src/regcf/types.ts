/**
 * Reg CF provider boundary (ADR-007; design §5). Shaped after North Capital TransactAPI's documented workflow:
 * issuer → offering → party (KYC/AML) → account → link → trade → fund move into escrow → close → disburse; refunds;
 * a collection account for royalty deposits and distribution payouts. Domain code depends only on this interface.
 * Every mutating call takes an idempotency key derived from our row id: a retry returns the original object.
 */
export type RegCfErrorClass = "retry" | "permanent";

export class RegCfError extends Error {
  constructor(public readonly cls: RegCfErrorClass, public readonly code: string, message: string, public readonly status = 0) {
    super(message);
    this.name = "RegCfError";
  }
}

export interface RegCfEvent {
  eventId: string;
  /** Provider event type, e.g. "fund_move.settled". Stored as "regcf.<type>" in provider_events. */
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export type KycDecision = "approved" | "rejected";
export type PayoutRecipient = "investor" | "issuer" | "platform";

export interface RegCfProvider {
  readonly name: "mock-escrow";
  createIssuer(i: { name: string; entityType?: string; externalId: string }, idem: string): Promise<{ id: string }>;
  createOffering(i: { issuerId: string; name: string; targetAmount: number; maxAmount: number; unitPrice: number; endDate: string; externalId: string }, idem: string): Promise<{ id: string }>;
  closeOffering(offeringId: string, idem: string): Promise<{ id: string; status: string }>;
  createParty(i: { firstName: string; lastName: string; state: string; externalId: string }, idem: string): Promise<{ id: string; kycStatus: string }>;
  setPartyKyc(partyId: string, decision: KycDecision, idem: string): Promise<{ id: string; kycStatus: string }>;
  createAccount(i: { partyId: string; externalId: string }, idem: string): Promise<{ id: string }>;
  createLink(i: { accountId: string; partyId: string }, idem: string): Promise<{ id: string }>;
  createTrade(i: { offeringId: string; accountId: string; units: number; unitPrice: number; amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
  fundTrade(tradeId: string, i: { amount: number; externalId: string }, idem: string): Promise<{ id: string; status: string }>;
  refundTrade(tradeId: string, i: { amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
  disburseToIssuer(offeringId: string, i: { amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
  getEscrow(offeringId: string): Promise<{ balance: number; status: string }>;
  createCollectionAccount(i: { offeringId: string; externalId: string }, idem: string): Promise<{ id: string }>;
  getCollectionAccount(id: string): Promise<{ balance: number }>;
  payoutFromCollection(collectionAccountId: string, i: { recipientType: PayoutRecipient; recipientRef: string; amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
  /** Mock-only test trigger: a royalty settlement arrives in the collection account. */
  simulateDeposit?(collectionAccountId: string, i: { amount: number; reference: string; externalId: string }, idem: string): Promise<{ id: string }>;
  /** Mock-only: move the provider's clock forward (settlements, KYC decisions). */
  advance?(seconds: number): Promise<unknown>;
  /** Verify a webhook delivery and parse it. Throws RegCfError("permanent", "bad_signature") on a bad signature. */
  parseWebhook(rawBody: string, signature: string | undefined): RegCfEvent;
}
