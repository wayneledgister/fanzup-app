/**
 * Sandbox provider — local development and CI only (never in a deployed environment; env.ts refuses it).
 *
 * It behaves like a processor that talks back through webhooks: every money movement it "performs" is
 * emitted as a provider event into provider_events (the same inbox Stripe events use), and its balance
 * list is derived from those events. Nothing here touches the ledger directly (ADR-003).
 */
import { randomUUID } from "node:crypto";
import { processingFeeMinor } from "@fanzup/shared/policy";
import type { Sql } from "../db";
import { asService, n } from "../db";
import { ingestEvent } from "../inbox";
import { ProviderError, type BalanceTxn, type NormalizedEvent, type PaymentProvider, type ProviderErrorClass } from "./types";

/**
 * FanZuP's own money sitting in the processor account (not attributed to any campaign). It covers the processing
 * fees FanZuP absorbs on refunds (E1 card C default), which otherwise leave the platform balance short of what
 * artists are owed. On Stripe, Wayne must keep an equivalent float in the platform balance (design §12.1).
 */
export const SANDBOX_PLATFORM_FLOAT_MINOR = 10_000_00;

type Row = { type: string; object_ref: string | null; payload: { amountMinor?: number; feeMinor?: number; paymentRef?: string; metadata?: Record<string, string> } };

export class SandboxProvider implements PaymentProvider {
  readonly name = "sandbox" as const;
  readonly testMode = true;
  readonly publishableKey = null;
  /** Calls made, for tests. */
  readonly calls: { op: string; input: unknown }[] = [];
  private failures: { op: string; cls: ProviderErrorClass; code: string; after: boolean }[] = [];

  constructor(private sql: Sql) {}

  /**
   * Test hook: make the next call of `op` fail with this class. With `after: true` the provider performs the
   * movement and then the call fails (a timeout after the processor acted — the case FR-PAY-004 exists for).
   */
  failNext(op: "createPayment" | "refund" | "transfer" | "cancelPayment", cls: ProviderErrorClass, code = `sandbox_${cls}`, opts: { after?: boolean } = {}) {
    this.failures.push({ op, cls, code, after: !!opts.after });
  }
  private maybeFail(op: string, after = false) {
    const i = this.failures.findIndex((f) => f.op === op && f.after === after);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      throw new ProviderError(f.cls, f.code, `sandbox ${op} failed (${f.code})`);
    }
  }

  private async events(where: { type?: string; objectRef?: string; opId?: string }): Promise<Row[]> {
    return asService(this.sql, (tx) => tx<Row[]>`
      select type, object_ref, payload from public.provider_events
      where provider = 'sandbox'
        and (${where.type ?? null}::text is null or type = ${where.type ?? null})
        and (${where.objectRef ?? null}::text is null or object_ref = ${where.objectRef ?? null})
        and (${where.opId ?? null}::text is null or payload -> 'metadata' ->> 'outbound_op_id' = ${where.opId ?? null})
      order by received_at`);
  }

  private emit(e: Omit<NormalizedEvent, "provider" | "eventId" | "livemode" | "account" | "raw">) {
    const evt: NormalizedEvent = { ...e, provider: "sandbox", eventId: `sbx_evt_${randomUUID()}`, livemode: false, account: null, raw: null };
    return ingestEvent(this.sql, { ...evt, raw: { ...e } });
  }

  async createPayment(input: Parameters<PaymentProvider["createPayment"]>[0]) {
    this.calls.push({ op: "createPayment", input });
    this.maybeFail("createPayment");
    const paymentRef = `sbx_pi_${input.backingId}`;
    return { paymentRef, clientSecret: `${paymentRef}_secret_${randomUUID().slice(0, 8)}` };
  }

  /** What the browser's card form does in the sandbox (via the dev route): the processor reports the outcome. */
  async simulatePayment(input: { paymentRef: string; amountMinor: number; metadata: Record<string, string>; outcome: "succeed" | "decline" }) {
    const prior = await this.events({ objectRef: input.paymentRef });
    if (prior.some((r) => r.type === "payment.canceled")) throw new ProviderError("permanent", "payment_canceled", "This payment attempt was cancelled.");
    if (prior.some((r) => r.type === "payment.succeeded")) return { status: "already_succeeded" as const };
    if (input.outcome === "decline") {
      await this.emit({ type: "payment.failed", objectRef: input.paymentRef, paymentRef: input.paymentRef, amountMinor: input.amountMinor, currency: "usd", failureCode: "card_declined", metadata: input.metadata });
      return { status: "declined" as const };
    }
    const r = await this.emit({
      type: "payment.succeeded", objectRef: input.paymentRef, paymentRef: input.paymentRef, amountMinor: input.amountMinor, currency: "usd",
      feeMinor: processingFeeMinor(input.amountMinor), metadata: input.metadata,
    });
    return { status: "succeeded" as const, eventRowId: r.id };
  }

  async cancelPayment(paymentRef: string) {
    this.calls.push({ op: "cancelPayment", input: paymentRef });
    this.maybeFail("cancelPayment");
    const prior = await this.events({ objectRef: paymentRef });
    if (prior.some((r) => r.type === "payment.succeeded")) return "already_succeeded" as const;
    if (prior.some((r) => r.type === "payment.canceled")) return "already_canceled" as const;
    await this.emit({ type: "payment.canceled", objectRef: paymentRef, paymentRef, metadata: {} });
    return "canceled" as const;
  }

  async paymentFee(paymentRef: string) {
    const [p] = await this.events({ type: "payment.succeeded", objectRef: paymentRef });
    if (!p) throw new ProviderError("retry", "payment_not_found", "No succeeded payment yet");
    return p.payload.feeMinor ?? 0;
  }

  async refund(input: Parameters<PaymentProvider["refund"]>[0]) {
    this.calls.push({ op: "refund", input });
    this.maybeFail("refund");
    const existing = await this.findRefund({ paymentRef: input.paymentRef, opId: input.opId });
    if (existing) return { refundRef: existing.refundRef, amountMinor: existing.amountMinor };
    const [paid] = await this.events({ type: "payment.succeeded", objectRef: input.paymentRef });
    if (!paid) throw new ProviderError("permanent", "charge_not_found", "Nothing to refund for this payment");
    if ((paid.payload.amountMinor ?? 0) < input.amountMinor) throw new ProviderError("permanent", "amount_too_large", "Refund exceeds the payment");
    const refundRef = `sbx_re_${input.opId}`;
    await this.emit({
      type: "refund.succeeded", objectRef: refundRef, paymentRef: input.paymentRef, amountMinor: input.amountMinor, currency: "usd",
      metadata: { outbound_op_id: input.opId, backing_id: input.backingId, campaign_id: input.campaignId },
    });
    this.maybeFail("refund", true);
    return { refundRef, amountMinor: input.amountMinor };
  }

  async findRefund(input: { paymentRef: string; opId: string }) {
    const [r] = (await this.events({ type: "refund.succeeded", opId: input.opId })).filter((x) => x.payload.paymentRef === input.paymentRef);
    return r ? { refundRef: r.object_ref!, amountMinor: r.payload.amountMinor ?? 0, status: "succeeded" } : null;
  }

  async transfer(input: Parameters<PaymentProvider["transfer"]>[0]) {
    this.calls.push({ op: "transfer", input });
    this.maybeFail("transfer");
    const existing = await this.findTransfer({ campaignId: input.campaignId, opId: input.opId });
    if (existing) return existing;
    if (!input.destination.startsWith("sbx_acct_")) throw new ProviderError("permanent", "invalid_destination", "Unknown payout account");
    const available = SANDBOX_PLATFORM_FLOAT_MINOR + (await this.listBalanceTransactions()).reduce((s, t) => s + t.netMinor, 0);
    if (available < input.amountMinor) throw new ProviderError("wait_funds", "balance_insufficient", "Not enough available balance");
    const transferRef = `sbx_tr_${input.opId}`;
    await this.emit({
      type: "transfer.created", objectRef: transferRef, amountMinor: input.amountMinor, currency: "usd",
      metadata: { outbound_op_id: input.opId, campaign_id: input.campaignId, tranche_id: input.trancheId },
    });
    this.maybeFail("transfer", true);
    return { transferRef, amountMinor: input.amountMinor };
  }

  async findTransfer(input: { campaignId: string; opId: string }) {
    const [t] = await this.events({ type: "transfer.created", opId: input.opId });
    return t ? { transferRef: t.object_ref!, amountMinor: t.payload.amountMinor ?? 0 } : null;
  }

  parseWebhook(): NormalizedEvent {
    throw new ProviderError("permanent", "no_webhooks", "The sandbox writes events directly; it has no webhook endpoint");
  }

  async listBalanceTransactions(): Promise<BalanceTxn[]> {
    const rows = await this.events({});
    const out: BalanceTxn[] = [];
    for (const r of rows) {
      const amt = n(r.payload.amountMinor);
      const campaignId = r.payload.metadata?.campaign_id ?? null;
      if (r.type === "payment.succeeded") out.push({ ref: r.object_ref!, type: "charge", netMinor: amt - n(r.payload.feeMinor), feeMinor: n(r.payload.feeMinor), campaignId });
      else if (r.type === "refund.succeeded") out.push({ ref: r.object_ref!, type: "refund", netMinor: -amt, feeMinor: 0, campaignId });
      else if (r.type === "transfer.created") out.push({ ref: r.object_ref!, type: "transfer", netMinor: -amt, feeMinor: 0, campaignId });
    }
    return out;
  }

  async payoutOnboarding(input: { artistId: string; existingRef: string | null }) {
    return { accountRef: input.existingRef ?? `sbx_acct_${input.artistId}`, onboardingUrl: null };
  }
  async payoutAccountReady(accountRef: string) {
    return accountRef.startsWith("sbx_acct_");
  }
}
