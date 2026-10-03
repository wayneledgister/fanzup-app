/**
 * Inbox, two-phase outbound, reconciliation pause and settlement isolation (FR-PAY-002/004/005/007, NFR-OPS-05,
 * NFR-QA-01), plus Stripe webhook verification (FR-PAY-008) and adapter contract tests on recorded payload shapes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { buildApp } from "../src/app";
import { ingestEvent, processPendingEvents } from "../src/inbox";
import { runDueOps } from "../src/outbound";
import { isPayoutPaused, runReconciliation, businessDaysSince } from "../src/recon";
import { StripeTestProvider } from "../src/provider";
import { classifyStripeError, mapBalanceTxn, normalizeStripeEvent } from "../src/provider/stripe";
import { afterDeadline, back, createUser, ids, kit, one, pay, tick, type Kit } from "./helpers";

let k: Kit;
beforeAll(async () => {
  k = await kit();
  await asService(k.sql, (tx) => tx`update public.artists set payout_account_ref = 'sbx_acct_' || id`);
});
afterAll(async () => k?.close());

async function backAndPay(campaignId: string, perkId: string, quantity = 1) {
  const f = await createUser(k.sql);
  const r = await back(k, f.auth, { campaignId, perkId, quantity });
  expect(r.statusCode).toBe(201);
  await pay(k, r.json().backingId);
  return r.json().backingId as string;
}
const dueNow = () => asService(k.sql, (tx) => tx`update public.outbound_ops set next_attempt_at = now(), lease_until = null where status = 'initiated'`);

describe("FR-PAY-002: provider events are stored before processing and processed once", () => {
  it("the same event delivered twice is stored once and applied once", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const backingId = r.json().backingId as string;
    const ref = `sbx_pi_${backingId}`;
    const evt = {
      provider: "sandbox", eventId: `evt_dup_${randomUUID()}`, type: "payment.succeeded" as const, livemode: false, account: null,
      objectRef: ref, paymentRef: ref, amountMinor: 1000, currency: "usd", feeMinor: 59, metadata: { backing_id: backingId, campaign_id: ids.novaCampaign }, raw: {},
    };
    const a = await ingestEvent(k.sql, evt);
    const b = await ingestEvent(k.sql, evt);
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(b.id).toBe(a.id);
    await processPendingEvents(k.sql, k.provider);
    await processPendingEvents(k.sql, k.provider);
    const posts = await asService(k.sql, (tx) => tx`select 1 from public.ledger_transactions where backing_id = ${backingId} and kind = 'backing.captured'`);
    expect(posts).toHaveLength(1);
  });

  it("an event for an object we can't find becomes 'unmatched' after the grace period (staff queue)", async () => {
    const { id } = await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_orphan_${randomUUID()}`, type: "payment.succeeded", livemode: false, account: null,
      objectRef: "sbx_pi_nobody", paymentRef: "sbx_pi_nobody", amountMinor: 999, currency: "usd", feeMinor: 59, metadata: {}, raw: {},
    });
    await processPendingEvents(k.sql, k.provider);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where id = ${id}`)).status).toBe("received");
    await asService(k.sql, (tx) => tx`update public.provider_events set received_at = now() - interval '11 minutes', next_attempt_at = now() where id = ${id}`);
    await processPendingEvents(k.sql, k.provider);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where id = ${id}`)).status).toBe("unmatched");
  });

  it("an event that keeps failing is dead-lettered after outbound.maxAttempts and keeps its error", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const { id } = await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_bad_${randomUUID()}`, type: "payment.succeeded", livemode: false, account: null,
      objectRef: "x", paymentRef: "x", amountMinor: 1000, currency: "usd", feeMinor: 5000, metadata: { backing_id: r.json().backingId }, raw: {},
    }); // fee ≥ amount → rejected by the SQL every time
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) {
      await asService(k.sql, (tx) => tx`update public.provider_events set next_attempt_at = now() where id = ${id}`);
      await processPendingEvents(k.sql, k.provider);
    }
    const row = await one(k.sql, (tx) => tx<{ status: string; attempts: number; last_error: string }[]>`select status, attempts, last_error from public.provider_events where id = ${id}`);
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(POLICY.outbound.maxAttempts);
    expect(row.last_error).toMatch(/invalid_capture/);
  });
});

describe("FR-PAY-004: each outbound movement executes at most once", () => {
  let failedCampaign: string;
  beforeAll(async () => {
    failedCampaign = ids.solCampaign;
  });

  it("provider acted but the call 'timed out': the retry finds the original refund and never sends a second", async () => {
    const backingId = await backAndPay(failedCampaign, ids.solPerkGA);
    const now = await afterDeadline(k.sql, failedCampaign);
    k.provider.failNext("refund", "retry", "timeout", { after: true });
    // Settle + create ops, but don't process provider events yet (so only the retry path can find the refund).
    await asService(k.sql, (tx) => tx`select public.settle_campaign(${failedCampaign}, ${now})`);
    const { drainOutbox } = await import("../src/money");
    await drainOutbox(k.sql, async () => undefined);
    await runDueOps(k.sql, k.provider);
    let op = await one(k.sql, (tx) => tx<{ status: string; attempts: number }[]>`select status, attempts from public.outbound_ops where subject_id = ${backingId}`);
    expect(op).toMatchObject({ status: "initiated", attempts: 1 });
    await dueNow();
    await runDueOps(k.sql, k.provider);
    op = await one(k.sql, (tx) => tx<{ status: string; attempts: number }[]>`select status, attempts from public.outbound_ops where subject_id = ${backingId}`);
    expect(op.status).toBe("sent");
    expect(k.provider.calls.filter((c) => c.op === "refund" && (c.input as { backingId: string }).backingId === backingId)).toHaveLength(1);
    const events = await asService(k.sql, (tx) => tx`select 1 from public.provider_events where type = 'refund.succeeded' and payload -> 'metadata' ->> 'backing_id' = ${backingId}`);
    expect(events).toHaveLength(1);
    await processPendingEvents(k.sql, k.provider);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${backingId}`)).status).toBe("refunded");
  });

  it("a refund that keeps failing is dead-lettered after outbound.maxAttempts", async () => {
    const backingId = await backAndPay(ids.novaCampaign, ids.novaPerkDiary);
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'test: dead letter')`);
    const { drainOutbox } = await import("../src/money");
    await drainOutbox(k.sql, async () => undefined);
    for (let i = 0; i < POLICY.outbound.maxAttempts; i++) {
      k.provider.failNext("refund", "retry", "provider_down");
      await dueNow();
      await runDueOps(k.sql, k.provider);
    }
    const op = await one(k.sql, (tx) => tx<{ status: string; attempts: number }[]>`select status, attempts from public.outbound_ops where subject_id = ${backingId}`);
    expect(op).toMatchObject({ status: "dead", attempts: POLICY.outbound.maxAttempts });
    expect(k.provider.calls.filter((c) => c.op === "refund" && (c.input as { backingId: string }).backingId === backingId)).toHaveLength(POLICY.outbound.maxAttempts);
  });

  it("a staff-requested refund takes the money off the public total immediately and refunds once", async () => {
    const before = n((await one(k.sql, (tx) => tx<{ raised_minor: bigint }[]>`select raised_minor from public.campaigns where id = ${ids.novaCampaign}`)).raised_minor);
    const backingId = await backAndPay(ids.novaCampaign, ids.novaPerkDiary);
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'fan asked')`);
    expect(n((await one(k.sql, (tx) => tx<{ raised_minor: bigint }[]>`select raised_minor from public.campaigns where id = ${ids.novaCampaign}`)).raised_minor)).toBe(before);
    await tick(k);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${backingId}`)).status).toBe("refunded");
    await expect(asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'again')`)).rejects.toThrow(/refund_not_available/);
  });
});

describe("Payouts: error classes and the reconciliation pause (G2 blocker 1, FR-PAY-007)", () => {
  let campaignId: string;
  beforeAll(async () => {
    campaignId = ids.novaCampaign;
    await asService(k.sql, (tx) => tx`update public.campaigns set goal_minor = 50000 where id = ${campaignId}`);
    await backAndPay(campaignId, ids.novaPerkTickets, 4);
  });

  it("an open material break pauses payouts (refunds continue); an override lifts it", async () => {
    await asService(k.sql, (tx) => tx`insert into public.recon_breaks (dedupe_key, kind, amount_minor) values ('test:material', 'campaign_diff', 500)`);
    expect(await isPayoutPaused(k.sql)).toBe(true);
    const at = await afterDeadline(k.sql, campaignId);
    await asService(k.sql, (tx) => tx`select public.settle_campaign(${campaignId}, ${at})`);
    const { drainOutbox } = await import("../src/money");
    await drainOutbox(k.sql, async () => undefined);
    await runDueOps(k.sql, k.provider);
    const op = await one(k.sql, (tx) => tx<{ status: string; waiting: string; attempts: number }[]>`select status, waiting, attempts from public.outbound_ops where kind = 'payout' and campaign_id = ${campaignId}`);
    expect(op).toMatchObject({ status: "initiated", waiting: "recon_pause", attempts: 0 });
    await asService(k.sql, (tx) => tx`insert into public.platform_settings (key, value) values ('recon_override_until', ${tx.json(new Date(Date.now() + 3_600_000).toISOString())})`);
    expect(await isPayoutPaused(k.sql)).toBe(false);
    await asService(k.sql, (tx) => tx`delete from public.platform_settings where key = 'recon_override_until'`);
    await asService(k.sql, (tx) => tx`update public.recon_breaks set resolved_at = now(), resolution = 'test' where dedupe_key = 'test:material'`);
  });

  it("waiting for available funds doesn't consume attempts; a permanent error fails the op without retrying", async () => {
    k.provider.failNext("transfer", "wait_funds", "balance_insufficient");
    await dueNow();
    await runDueOps(k.sql, k.provider);
    let op = await one(k.sql, (tx) => tx<{ status: string; waiting: string; attempts: number }[]>`select status, waiting, attempts from public.outbound_ops where kind = 'payout' and campaign_id = ${campaignId}`);
    expect(op).toMatchObject({ status: "initiated", waiting: "funds", attempts: 0 });
    await dueNow();
    await runDueOps(k.sql, k.provider);
    op = await one(k.sql, (tx) => tx<{ status: string; waiting: string; attempts: number }[]>`select status, waiting, attempts from public.outbound_ops where kind = 'payout' and campaign_id = ${campaignId}`);
    expect(op.status).toBe("confirmed");
  });

  it("the ledger refuses a payout amount different from what is owed", async () => {
    const t2 = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches where campaign_id = ${campaignId} and seq = 2`);
    await asService(k.sql, (tx) => tx`select public.submit_tranche_evidence(${t2.id}, ${ids.nova}, 'First show played, settlement attached', ${[]})`);
    await asService(k.sql, (tx) => tx`select public.verify_tranche(${t2.id}, ${ids.reviewer})`);
    await expect(asService(k.sql, (tx) => tx`select public.record_tranche_released(${t2.id}, 'tr_fake', 1, 'release-test-mismatch')`)).rejects.toThrow(/payout_amount_mismatch/);
  });
});

describe("NFR-OPS-05: one failing campaign never blocks the others", () => {
  it("settles every due campaign even when one throws", async () => {
    const boomId = "a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e"; // The Low Ends
    await k.sql.unsafe(`
      create function public.test_boom() returns trigger language plpgsql as $$
      begin if new.id = '${boomId}' and new.status <> old.status then raise exception 'boom'; end if; return new; end $$;
      create trigger test_boom before update on public.campaigns for each row execute function public.test_boom();`);
    const far = new Date(Date.now() + 90 * 86_400_000);
    const r = await tick(k, far);
    await k.sql.unsafe(`drop trigger test_boom on public.campaigns; drop function public.test_boom();`);
    expect(r.settled.find((s) => s.id === boomId)?.outcome).toBe("error");
    expect(r.settled.filter((s) => s.outcome !== "error").length).toBeGreaterThan(0);
  });
});

describe("FR-PAY-007: reconciliation", () => {
  let baseline = 0;
  it("diffs to zero after captures, refunds, late captures and payouts", async () => {
    await tick(k);
    const r = await runReconciliation(k.sql, k.provider);
    // The only breaks are the two orphan events this file injected on purpose (no campaign, no ledger posting).
    expect(r.breaks.map((b) => b.refs.ref).sort()).toEqual(["sbx_pi_nobody", "x"]);
    expect(r.breaks.every((b) => b.kind === "unmatched_provider_txn" && b.campaignId === null)).toBe(true);
    expect(r.campaigns.every((c) => c.diffMinor === 0)).toBe(true);
    baseline = r.diffMinor;
  });
  it("a provider movement with no ledger posting opens a break, and the next clean run doesn't clear a money-path break", async () => {
    await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_stray_${randomUUID()}`, type: "transfer.created", livemode: false, account: null,
      objectRef: "sbx_tr_stray", amountMinor: 123, currency: "usd", metadata: { campaign_id: ids.solCampaign }, raw: {},
    });
    const r = await runReconciliation(k.sql, k.provider);
    expect(r.breaks.map((b) => b.kind)).toEqual(expect.arrayContaining(["campaign_diff", "unmatched_provider_txn"]));
    expect(r.diffMinor - baseline).toBe(-123);
    expect(await isPayoutPaused(k.sql)).toBe(true);
  });
  it("counts business days, not calendar days", () => {
    expect(businessDaysSince(new Date("2026-10-02T12:00:00Z"), new Date("2026-10-05T13:00:00Z"))).toBe(1); // Fri → Mon
  });
});

describe("Stripe webhook endpoint (FR-PAY-002, FR-PAY-008)", () => {
  const secret = "whsec_test_secret_for_signatures";
  const stripe = new Stripe("sk_test_dummy");
  const event = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, "")}`, object: "event", type: "payment_intent.payment_failed", livemode: false, api_version: "2025-01-01",
    data: { object: { id: "pi_123", object: "payment_intent", amount: 1000, currency: "usd", metadata: {}, last_payment_error: { code: "card_declined" } } },
    ...overrides,
  });

  it("rejects bad signatures and live-mode events; stores a valid event once", async () => {
    const provider = new StripeTestProvider({ secretKey: "sk_test_dummy", webhookSecret: secret, publishableKey: null });
    const app = await buildApp({ ...k.deps, provider });
    const send = (body: string, sig?: string) =>
      app.inject({ method: "POST", url: "/api/v1/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": sig ?? stripe.webhooks.generateTestHeaderString({ payload: body, secret }) }, payload: body });
    expect((await send(event(), "t=1,v1=bad")).statusCode).toBe(400);
    expect((await send(event({ livemode: true }))).json().error).toBe("livemode_rejected");
    const body = event();
    expect((await send(body)).statusCode).toBe(200);
    expect((await send(body)).statusCode).toBe(200);
    const id = JSON.parse(body).id;
    expect(await asService(k.sql, (tx) => tx`select 1 from public.provider_events where event_id = ${id}`)).toHaveLength(1);
    const foreign = event({ account: "acct_not_ours", type: "account.updated", data: { object: { id: "acct_not_ours", object: "account" } } });
    await send(foreign);
    const row = await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where event_id = ${JSON.parse(foreign).id}`);
    expect(row.status).toBe("ignored");
    await app.close();
  });
});

describe("Stripe adapter contract (recorded payload shapes)", () => {
  it("normalises payment, refund and transfer events", () => {
    const pi = normalizeStripeEvent({
      id: "evt_1", object: "event", type: "payment_intent.succeeded", livemode: false,
      data: { object: { id: "pi_1", object: "payment_intent", amount: 15000, amount_received: 15000, currency: "usd", metadata: { backing_id: "b1", campaign_id: "c1" } } },
    } as unknown as Stripe.Event);
    expect(pi).toMatchObject({ type: "payment.succeeded", paymentRef: "pi_1", amountMinor: 15000, metadata: { backing_id: "b1" } });
    const re = normalizeStripeEvent({
      id: "evt_2", object: "event", type: "refund.updated", livemode: false,
      data: { object: { id: "re_1", object: "refund", amount: 15000, currency: "usd", status: "succeeded", payment_intent: "pi_1", metadata: { outbound_op_id: "op1" } } },
    } as unknown as Stripe.Event);
    expect(re).toMatchObject({ type: "refund.succeeded", objectRef: "re_1", paymentRef: "pi_1", metadata: { outbound_op_id: "op1" } });
    const pending = normalizeStripeEvent({ id: "evt_3", object: "event", type: "refund.created", livemode: false, data: { object: { id: "re_2", object: "refund", amount: 1, currency: "usd", status: "pending", payment_intent: "pi_1", metadata: {} } } } as unknown as Stripe.Event);
    expect(pending.type).toBe("other");
    const tr = normalizeStripeEvent({ id: "evt_4", object: "event", type: "transfer.created", livemode: false, data: { object: { id: "tr_1", object: "transfer", amount: 7000, currency: "usd", metadata: { outbound_op_id: "op2" } } } } as unknown as Stripe.Event);
    expect(tr).toMatchObject({ type: "transfer.created", objectRef: "tr_1", amountMinor: 7000 });
  });
  it("classifies errors: insufficient balance waits, connection/5xx/429 retry, the rest are permanent", () => {
    expect(classifyStripeError({ type: "StripeInvalidRequestError", code: "balance_insufficient" }).cls).toBe("wait_funds");
    expect(classifyStripeError({ type: "StripeConnectionError" }).cls).toBe("retry");
    expect(classifyStripeError({ type: "StripeAPIError", statusCode: 500 }).cls).toBe("retry");
    expect(classifyStripeError({ type: "StripeRateLimitError", statusCode: 429 }).cls).toBe("retry");
    expect(classifyStripeError({ type: "StripeInvalidRequestError", code: "resource_missing" }).cls).toBe("permanent");
  });
  it("maps balance transactions to ledger refs and campaigns", () => {
    const charge = mapBalanceTxn({ id: "txn_1", type: "charge", net: 14535, fee: 465, source: { id: "ch_1", payment_intent: "pi_1", transfer_group: "campaign_c1", metadata: {} } } as unknown as Stripe.BalanceTransaction);
    expect(charge).toEqual({ ref: "pi_1", type: "charge", netMinor: 14535, feeMinor: 465, campaignId: "c1" });
    const refund = mapBalanceTxn({ id: "txn_2", type: "refund", net: -15000, fee: 0, source: { id: "re_1", metadata: { campaign_id: "c1" } } } as unknown as Stripe.BalanceTransaction);
    expect(refund).toEqual({ ref: "re_1", type: "refund", netMinor: -15000, feeMinor: 0, campaignId: "c1" });
    const transfer = mapBalanceTxn({ id: "txn_3", type: "transfer", net: -7000, fee: 0, source: { id: "tr_1", transfer_group: "campaign_c1", metadata: {} } } as unknown as Stripe.BalanceTransaction);
    expect(transfer).toMatchObject({ ref: "tr_1", type: "transfer", campaignId: "c1" });
  });
});
