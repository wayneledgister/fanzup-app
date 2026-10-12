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

export interface RegCfFundMove {
  id: string;
  tradeId: string;
  amount: number;
  /** pending | settled | returned */
  status: string;
  externalId?: string;
}
export interface RegCfOffering {
  id: string;
  /** open | closed */
  status: string;
  endDate: string;
  externalId: string;
}
export interface RegCfTrade {
  id: string;
  /** created | funding | funded | returned | refunding | refunded | cancelled */
  status: string;
  offeringId: string;
  amount: number;
  externalId: string;
  fundMoves: RegCfFundMove[];
}
export interface RegCfTransaction {
  id: string;
  kind: "fund_move" | "refund" | "disbursement" | "deposit" | "payout";
  status: string;
  amount: number;
  externalId: string | null;
  tradeId: string | null;
  returnCode: string | null;
  reference: string | null;
  at: string;
}

export type KycDecision = "approved" | "rejected";
export type PayoutRecipient = "investor" | "issuer" | "platform";

export interface RegCfProvider {
  readonly name: "mock-escrow";
  createIssuer(i: { name: string; entityType?: string; externalId: string }, idem: string): Promise<{ id: string }>;
  createOffering(i: { issuerId: string; name: string; targetAmount: number; maxAmount: number; unitPrice: number; endDate: string; externalId: string }, idem: string): Promise<{ id: string }>;
  closeOffering(offeringId: string, idem: string): Promise<{ id: string; status: string }>;
  /** Look an offering up by our Pool id (sent as externalId at createOffering). Never creates anything. Null: none. */
  findOffering(q: { externalId: string }): Promise<RegCfOffering | null>;
  /** Move an open offering's end date (a re-planned launch deadline, L2 design §5 "Launch"; key `offering_end:<pool>:<endDate>`). */
  updateOffering(offeringId: string, i: { endDate: string }, idem: string): Promise<RegCfOffering>;
  createParty(i: { firstName: string; lastName: string; state: string; externalId: string }, idem: string): Promise<{ id: string; kycStatus: string }>;
  setPartyKyc(partyId: string, decision: KycDecision, idem: string): Promise<{ id: string; kycStatus: string }>;
  createAccount(i: { partyId: string; externalId: string }, idem: string): Promise<{ id: string }>;
  createLink(i: { accountId: string; partyId: string }, idem: string): Promise<{ id: string }>;
  createTrade(i: { offeringId: string; accountId: string; units: number; unitPrice: number; amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
  fundTrade(tradeId: string, i: { amount: number; externalId: string }, idem: string): Promise<{ id: string; status: string }>;
  /** The trade and its fund moves (design §4.3, §5 resume guard (e)). */
  getTrade(tradeId: string): Promise<RegCfTrade>;
  /** Look a trade up by our investment id (sent as externalId at createTrade). Never creates anything. Null: no trade. */
  findTrade(q: { externalId: string }): Promise<RegCfTrade | null>;
  /** Void a trade with no fund move (key `cancel_trade:<investment_id>`). Refused `trade_funded` once a fund move exists. */
  cancelTrade(tradeId: string, idem: string): Promise<{ id: string; status: string }>;
  /** Every escrow (offering) or collection-account movement, for per-transaction ref matching (design §5.1). */
  listTransactions(q: { offeringId: string; since?: string } | { collectionAccountId: string; since?: string }): Promise<RegCfTransaction[]>;
  refundTrade(tradeId: string, i: { amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
  /** Refund one settled fund move in full, by its ref (design §3.1: stray fund moves are refunded by fund ref, key `refund:fund:<ref>`). */
  refundFundMove(fundMoveId: string, i: { amount: number; externalId: string }, idem: string): Promise<{ id: string }>;
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
