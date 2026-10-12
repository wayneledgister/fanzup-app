/**
 * Reconciliation: liability invariant, stray-capture ageing, in-flight allowance and the payout-pausing break kinds
 * (FR-PAY-007; design §3.5, §3.5.1, §7; T-009 a–e). Its own database, so every break here is one this file made.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY, processingFeeMinor } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { ingestEvent, processEventById, processPendingEvents } from "../src/inbox";
import { runDueOps } from "../src/outbound";
import { drainOutbox } from "../src/money";
import { ProviderError } from "../src/provider";
import { isPayoutPaused, runReconciliation, PAYOUT_PAUSING_KINDS, type ReconResult } from "../src/recon";
import { afterDeadline, back, createUser, ids, kit, one, pay, tick, tokenWith, type Kit } from "./helpers";

let k: Kit;
beforeAll(async () => {
  k = await kit();
  await asService(k.sql, async (tx) => {
    await tx`update public.artists set payout_account_ref = 'sbx_acct_' || id`;
    await tx`update public.campaigns set goal_minor = 50000 where id = ${ids.novaCampaign}`;
  });
});
afterAll(async () => k?.close());

const LOW_ENDS = "a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e";
const LOW_ENDS_LP = "378df26e-40c3-5fb4-8e8d-bea06ef84257"; // $12 digital album
const VELVET = "1e7625f2-4279-5070-9b54-c7539ac818a1";
const VELVET_PERK = "4fdbbe9d-386c-5c57-897f-5683787ffd53"; // $8
const of = (r: ReconResult, kind: string) => r.breaks.filter((b) => b.kind === kind);
const later = (days: number) => new Date(Date.now() + days * 86_400_000);

async function backAndPay(campaignId: string, perkId: string, quantity = 1, amountMinor?: number) {
  const f = await createUser(k.sql);
  const r = await back(k, f.auth, { campaignId, perkId, quantity });
  expect(r.statusCode).toBe(201);
  await pay(k, r.json().backingId, "succeed", amountMinor);
  return r.json().backingId as string;
}

describe("T-009 (a): clean journeys, including an unapplied amount-mismatch capture", () => {
  it("no liability or counter break while an over-captured payment (1500 for a 1200 perk) awaits its refund, nor after", async () => {
    await backAndPay(ids.novaCampaign, ids.novaPerkTickets, 4); // funded journey: $600 ≥ $500
    for (let i = 0; i < 2; i++) await backAndPay(ids.solCampaign, ids.solPerkGA); // failed journey
    const mismatch = await backAndPay(LOW_ENDS, LOW_ENDS_LP, 1, 1500); // perk is $12; captured $15
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${mismatch}`)).status).toBe("refund_pending");
    let r = await runReconciliation(k.sql, k.provider);
    expect(of(r, "liability_mismatch")).toEqual([]);
    expect(of(r, "counter_mismatch")).toEqual([]);
    expect(r.campaigns.every((c) => c.diffMinor === 0)).toBe(true);

    await tick(k, await afterDeadline(k.sql, ids.solCampaign)); // settles nova (funded) and sol (failed); refunds + payouts run
    r = await runReconciliation(k.sql, k.provider);
    console.log("recon run (T-009 a):", JSON.stringify({ diffMinor: r.diffMinor, campaigns: r.campaigns, breaks: r.breaks.map((b) => b.kind) }));
    expect(of(r, "liability_mismatch")).toEqual([]);
    expect(of(r, "counter_mismatch")).toEqual([]);
    expect(r.campaigns.every((c) => c.diffMinor === 0)).toBe(true);
    // The only open break is the amount_mismatch the capture itself raised (money path, staff resolve it).
    const open = await asService(k.sql, (tx) => tx<{ kind: string }[]>`select kind from public.recon_breaks where resolved_at is null`);
    expect(open.map((b) => b.kind)).toEqual(["amount_mismatch"]);
    await asService(k.sql, (tx) => tx`update public.recon_breaks set resolved_at = now(), resolution = 'test: reviewed' where resolved_at is null`);
  });
});

describe("T-009 (b): a ledger posting that moves backer_liability without a backing", () => {
  it("opens a liability_mismatch money break with the exact amount, pauses payouts, and clears once corrected", async () => {
    // ledger_post takes account ids; resolve them first.
    const [{ liab, fees }] = await asService(k.sql, (tx) => tx<{ liab: string; fees: string }[]>`
      select public.ledger_account('backer_liability', ${LOW_ENDS}) liab, public.ledger_account('processing_fees') fees`);
    const manual = (idem: string, amount: number) => asService(k.sql, (tx) => tx`
      select public.ledger_post('test.manual', ${idem}, ${tx.json([{ account: liab, amount: -amount }, { account: fees, amount }] as never)}, ${LOW_ENDS})`);
    await manual("test-liability-700", 700);
    let r = await runReconciliation(k.sql, k.provider);
    const brk = of(r, "liability_mismatch");
    expect(brk).toHaveLength(1);
    expect(brk[0]).toMatchObject({ campaignId: LOW_ENDS, amountMinor: 700 });
    expect(of(r, "campaign_diff")).toEqual([]); // the provider side is untouched
    expect(await isPayoutPaused(k.sql)).toBe(true);
    await manual("test-liability-700-reversal", -700);
    r = await runReconciliation(k.sql, k.provider);
    expect(of(r, "liability_mismatch")).toEqual([]);
    const row = await one(k.sql, (tx) => tx<{ resolution: string }[]>`select resolution from public.recon_breaks where kind = 'liability_mismatch'`);
    expect(row.resolution).toBe("cleared_by_run");
    expect(await isPayoutPaused(k.sql)).toBe(false);
  });
});

describe("T-009 (c)–(e): a stray capture resolves through its own refund op", () => {
  const ref = `sbx_pi_stray_${randomUUID()}`;
  let opId: string;
  it("(c) refund op `sent`, inside the age limit: no break, liability matches (stray counted as owed)", async () => {
    const { id } = await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_${randomUUID()}`, type: "payment.succeeded", livemode: false, account: null,
      objectRef: ref, paymentRef: ref, amountMinor: 2000, currency: "usd", feeMinor: processingFeeMinor(2000), metadata: { campaign_id: LOW_ENDS }, raw: {},
    });
    await processEventById(k.sql, k.provider, id);
    await runDueOps(k.sql, k.provider); // provider refunds; op → sent; the refund event is not processed yet
    const op = await one(k.sql, (tx) => tx<{ id: string; status: string }[]>`select id, status from public.outbound_ops where payment_ref = ${ref}`);
    expect(op.status).toBe("sent");
    opId = op.id;
    const r = await runReconciliation(k.sql, k.provider);
    expect(r.breaks).toEqual([]);
    expect(r.inFlight.map((t) => t.ref)).toContain(`sbx_re_${opId}`);
    expect(r.campaigns.find((c) => c.campaignId === LOW_ENDS)?.diffMinor).toBe(0);
  });

  it("(d) the same stray past recon.maxBreakAgeBusinessDays without a confirmed refund: stray_capture_aged money break", async () => {
    const r = await runReconciliation(k.sql, k.provider, later(POLICY.recon.maxBreakAgeBusinessDays + 4));
    const aged = of(r, "stray_capture_aged");
    expect(aged).toHaveLength(1);
    expect(aged[0]).toMatchObject({ campaignId: LOW_ENDS, amountMinor: 2000, refs: { ref, op_status: "sent" } });
    expect(of(r, "liability_mismatch")).toEqual([]);
    expect(await isPayoutPaused(k.sql)).toBe(true);
  });

  it("(e) once the stray refund confirms, liability still matches and the aged break auto-resolves", async () => {
    await processPendingEvents(k.sql, k.provider);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where id = ${opId}`)).status).toBe("confirmed");
    const r = await runReconciliation(k.sql, k.provider, later(POLICY.recon.maxBreakAgeBusinessDays + 4));
    expect(r.breaks).toEqual([]);
    const row = await one(k.sql, (tx) => tx<{ resolved_at: Date | null; resolution: string }[]>`select resolved_at, resolution from public.recon_breaks where kind = 'stray_capture_aged'`);
    expect(row.resolution).toBe("cleared_by_run");
    expect(await isPayoutPaused(k.sql)).toBe(false);
  });
});

describe("in-flight allowance (design §7)", () => {
  it("a capture the provider reported less than recon.inflightGraceMinutes ago, not processed yet, is expected; older, it is a break", async () => {
    const f = await createUser(k.sql);
    const r0 = await back(k, f.auth, { campaignId: VELVET, perkId: VELVET_PERK });
    const id = r0.json().backingId as string;
    const ref = `sbx_pi_${id}`;
    const { id: evt } = await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_${randomUUID()}`, type: "payment.succeeded", livemode: false, account: null,
      objectRef: ref, paymentRef: ref, amountMinor: 800, currency: "usd", feeMinor: processingFeeMinor(800), metadata: { backing_id: id, campaign_id: VELVET }, raw: {},
    });
    let r = await runReconciliation(k.sql, k.provider);
    expect(r.breaks).toEqual([]);
    expect(r.inFlight.map((t) => t.ref)).toEqual([ref]);
    await asService(k.sql, (tx) => tx`update public.provider_events set received_at = now() - make_interval(mins => ${POLICY.recon.inflightGraceMinutes + 1}) where id = ${evt}`);
    r = await runReconciliation(k.sql, k.provider);
    expect(r.breaks.map((b) => b.kind).sort()).toEqual(["campaign_diff", "unmatched_provider_txn"]);
    await processEventById(k.sql, k.provider, evt); // processed: the ledger catches up and both breaks clear
    r = await runReconciliation(k.sql, k.provider);
    expect(r.breaks).toEqual([]);
  });
});

describe("which breaks pause payouts (design §7)", () => {
  it("money kinds pause when material; counter_mismatch and waiting_funds never do", async () => {
    expect([...PAYOUT_PAUSING_KINDS].sort()).toEqual(
      ["amount_mismatch", "campaign_diff", "currency_mismatch", "liability_mismatch", "stray_capture_aged", "unmatched_ledger_txn", "unmatched_provider_txn"],
    );
    for (const kind of ["counter_mismatch", "waiting_funds"]) {
      await asService(k.sql, (tx) => tx`insert into public.recon_breaks (dedupe_key, kind, amount_minor, opened_at) values (${"test:" + kind}, ${kind}, 100000, now() - interval '30 days')`);
    }
    expect(await isPayoutPaused(k.sql)).toBe(false);
    await asService(k.sql, (tx) => tx`insert into public.recon_breaks (dedupe_key, kind, amount_minor) values ('test:liability', 'liability_mismatch', ${POLICY.recon.materialityMinor + 1})`);
    expect(await isPayoutPaused(k.sql)).toBe(true);
    await asService(k.sql, (tx) => tx`update public.recon_breaks set resolved_at = now(), resolution = 'test' where dedupe_key like 'test:%'`);
    expect(n((await one(k.sql, (tx) => tx<{ c: bigint }[]>`select count(*) c from public.recon_breaks where resolved_at is null`)).c)).toBe(0);
  });
});

describe("lost confirmation of a `sent` op (follow-up found in the PR #12 L2 review, round 3)", () => {
  const minutesLater = (m: number) => new Date(Date.now() + m * 60_000);
  async function sentStrayRefund() {
    const ref = `sbx_pi_lost_${randomUUID()}`;
    const { id } = await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_${randomUUID()}`, type: "payment.succeeded", livemode: false, account: null,
      objectRef: ref, paymentRef: ref, amountMinor: 1500, currency: "usd", feeMinor: processingFeeMinor(1500), metadata: { campaign_id: LOW_ENDS }, raw: {},
    });
    await processEventById(k.sql, k.provider, id);
    await runDueOps(k.sql, k.provider); // provider refunds (its refund.succeeded event is stored); op → sent
    const op = await one(k.sql, (tx) => tx<{ id: string; status: string; provider_ref: string }[]>`select id, status, provider_ref from public.outbound_ops where payment_ref = ${ref}`);
    expect(op.status).toBe("sent");
    return { ref, op };
  }

  const replay = async (opId: string, reason: string) =>
    k.app.inject({ method: "POST", url: `/api/v1/staff/outbound-ops/${opId}/replay`,
      headers: { authorization: `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}` }, payload: { reason } });
  const opStatus = async (id: string) =>
    one(k.sql, (tx) => tx<{ status: string; last_error: string | null }[]>`select status, last_error from public.outbound_ops where id = ${id}`);

  it("in flight inside recon.inflightGraceMinutes; after it, looked up with findRefund and confirmed through the SQL path", async () => {
    const { ref, op } = await sentStrayRefund();
    // The confirmation is lost: the event row is marked done without its effect (e.g. a processor bug or a dropped webhook).
    await asService(k.sql, (tx) => tx`update public.provider_events set status = 'processed' where object_ref = ${op.provider_ref} and type = 'refund.succeeded'`);
    let r = await runReconciliation(k.sql, k.provider);
    expect(r.inFlight.map((t) => t.ref)).toContain(op.provider_ref);
    expect(r.recovered).toEqual([]);
    expect(of(r, "op_unconfirmed")).toEqual([]);

    r = await runReconciliation(k.sql, k.provider, minutesLater(POLICY.recon.inflightGraceMinutes + 1));
    expect(r.recovered).toEqual([{ opId: op.id, ref: op.provider_ref }]);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where id = ${op.id}`)).status).toBe("confirmed");
    const posted = await one(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.ledger_transactions where idempotency_key = ${"refund:pay:" + ref}`);
    expect(posted.c).toBe(1);
    expect(r.breaks.filter((b) => b.campaignId === LOW_ENDS)).toEqual([]);
    expect(r.campaigns.find((c) => c.campaignId === LOW_ENDS)?.diffMinor).toBe(0);
  });

  it("a `sent` op the provider has no record of: op_unconfirmed break (non-pausing), cleared once the op confirms", async () => {
    const { op } = await sentStrayRefund();
    // The provider never kept the refund: its record is gone and the op points at a ref the provider doesn't know.
    await asService(k.sql, (tx) => tx`delete from public.provider_events where object_ref = ${op.provider_ref} and type = 'refund.succeeded'`);
    const r = await runReconciliation(k.sql, k.provider, minutesLater(POLICY.recon.inflightGraceMinutes + 1));
    const lost = of(r, "op_unconfirmed");
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ campaignId: LOW_ENDS, amountMinor: 1500, refs: { ref: op.id, provider_ref: op.provider_ref, provider_status: "not_found" } });
    expect((PAYOUT_PAUSING_KINDS as readonly string[]).includes("op_unconfirmed")).toBe(false);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where id = ${op.id}`)).status).toBe("sent");

    // Staff replay the `sent` op while its op_unconfirmed break is open (review round 4, PR #12): the runner looks the
    // refund up (nothing), sends it again and it confirms; the break clears.
    const res = await replay(op.id, "Provider has no record of this refund; send it again");
    expect(res.statusCode, res.body).toBe(200);
    await runDueOps(k.sql, k.provider);
    await processPendingEvents(k.sql, k.provider);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where id = ${op.id}`)).status).toBe("confirmed");
    const after = await runReconciliation(k.sql, k.provider, minutesLater(POLICY.recon.inflightGraceMinutes + 1));
    expect(of(after, "op_unconfirmed")).toEqual([]);
    const row = await one(k.sql, (tx) => tx<{ resolution: string }[]>`select resolution from public.recon_breaks where kind = 'op_unconfirmed'`);
    expect(row.resolution).toBe("cleared_by_run");
  });

  it("a `sent` op is not replayable without an open op_unconfirmed break (still in flight)", async () => {
    const { op } = await sentStrayRefund();
    const res = await replay(op.id, "Trying to replay a refund in flight");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("not_replayable");
    expect((await opStatus(op.id)).status).toBe("sent");
  });
});

/**
 * Attempt generations (PR #12 review round 5; design §5 "Attempt generations", §7). The sandbox plays Stripe: a refund
 * it accepts can later FAIL there, a lookup keeps reporting it `failed`, and a call with the same idempotency key returns
 * that same failed refund. A failed movement is never re-adopted; `outbound_op.replay` starts generation 1, whose key
 * `refund:<backing>:r1` makes exactly one new refund; the ledger posts once (keyed by the op).
 */
describe("a refund that fails at the provider: never re-adopted; replay sends one new refund under a fresh key (review round 5)", () => {
  const minutesLater = (m: number) => new Date(Date.now() + m * 60_000);
  const dueNow = () => asService(k.sql, (tx) => tx`update public.outbound_ops set next_attempt_at = now(), lease_until = null where status = 'initiated'`);
  type Op = { id: string; status: string; provider_ref: string | null; attempt_gen: number; idempotency_key: string; last_error: string | null;
    failed_refs: { gen: number; ref: string; status: string; via: string }[] };
  const opOf = (id: string) => one(k.sql, (tx) => tx<Op[]>`select id, status, provider_ref, attempt_gen, idempotency_key, last_error, failed_refs from public.outbound_ops where id = ${id}`);
  const replay = async (opId: string, reason: string) =>
    k.app.inject({ method: "POST", url: `/api/v1/staff/outbound-ops/${opId}/replay`,
      headers: { authorization: `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}` }, payload: { reason } });
  const refundCalls = (opId: string) =>
    k.provider.calls.filter((c) => c.op === "refund" && (c.input as { opId: string }).opId === opId)
      .map((c) => c.input as { idempotencyKey: string; attempt: number });
  const backingStatus = async (id: string) => (await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${id}`)).status;
  const postings = async (key: string) => (await one(k.sql, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.ledger_transactions where idempotency_key = ${key}`)).c;

  /** A backer's refund op, run once: the provider accepts the refund (op `sent`). */
  async function sentBackingRefund(): Promise<{ backingId: string; op: Op }> {
    const backingId = await backAndPay(VELVET, VELVET_PERK);
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'test: refund fails at the provider')`);
    await drainOutbox(k.sql, async () => undefined);
    const { id } = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.outbound_ops where kind = 'refund' and subject_id = ${backingId}`);
    await dueNow();
    await runDueOps(k.sql, k.provider);
    const op = await opOf(id);
    expect(op).toMatchObject({ status: "sent", attempt_gen: 0, provider_ref: `sbx_re_${id}`, idempotency_key: `refund:${backingId}` });
    return { backingId, op };
  }

  /** Replay → exactly one new refund call, key `<key>:r1` → confirmed; backer refunded; the ledger posts once. */
  async function replayRefundsOnce(backingId: string, op: Op) {
    const res = await replay(op.id, "Refund failed at the processor; send a new one");
    expect(res.statusCode, res.body).toBe(200);
    expect(await opOf(op.id)).toMatchObject({ status: "initiated", attempt_gen: 1, provider_ref: null });
    const before = refundCalls(op.id).length;
    await runDueOps(k.sql, k.provider);
    await processPendingEvents(k.sql, k.provider);
    const calls = refundCalls(op.id).slice(before);
    expect(calls).toEqual([expect.objectContaining({ idempotencyKey: `refund:${backingId}:r1`, attempt: 1 })]);
    const after = await opOf(op.id);
    expect(after).toMatchObject({ status: "confirmed", attempt_gen: 1, provider_ref: `sbx_re_${op.id}_r1` });
    expect(after.failed_refs).toEqual([expect.objectContaining({ gen: 0, ref: `sbx_re_${op.id}`, status: "failed" })]);
    expect(await backingStatus(backingId)).toBe("refunded");
    expect(await postings(`refund:${backingId}`)).toBe(1);
    // More runs, events and recon change nothing: no second refund, no second posting, no break about the op.
    await dueNow();
    await runDueOps(k.sql, k.provider);
    await processPendingEvents(k.sql, k.provider);
    const r = await runReconciliation(k.sql, k.provider, minutesLater(POLICY.recon.inflightGraceMinutes + 1));
    expect(r.breaks.filter((b) => b.refs.ref === op.id || b.refs.op_id === op.id)).toEqual([]);
    expect(refundCalls(op.id)).toHaveLength(before + 1);
    expect(await postings(`refund:${backingId}`)).toBe(1);
  }

  it("recon's lookup finds the refund failed (webhook lost): op failed, ref kept; replay → one new refund `…:r1` → refunded, posted once", async () => {
    k.provider.failNextRefundAtProvider({ webhook: false });
    const { backingId, op } = await sentBackingRefund();
    // The provider keeps reporting the failed refund (as Stripe would): a lookup of generation 0 says `failed`, and the
    // same key returns the same failed object.
    const lookup = await k.provider.findRefund({ paymentRef: `sbx_pi_${backingId}`, opId: op.id, attempt: 0 });
    expect(lookup).toMatchObject({ refundRef: op.provider_ref, status: "failed" });

    const r = await runReconciliation(k.sql, k.provider, minutesLater(POLICY.recon.inflightGraceMinutes + 1));
    expect(r.recovered.filter((x) => x.opId === op.id)).toEqual([]);
    expect(of(r, "op_unconfirmed").filter((b) => b.refs.ref === op.id)).toEqual([]);
    const failed = await opOf(op.id);
    expect(failed).toMatchObject({ status: "failed", attempt_gen: 0, last_error: "refund failed: failed" });
    expect(failed.failed_refs).toEqual([expect.objectContaining({ gen: 0, ref: op.provider_ref, status: "failed", via: "recon_lookup" })]);
    expect(await backingStatus(backingId)).toBe("refund_pending");
    expect(await postings(`refund:${backingId}`)).toBe(0);
    // A failed op is not run again by itself.
    await dueNow();
    await runDueOps(k.sql, k.provider);
    expect(refundCalls(op.id)).toHaveLength(1);

    await replayRefundsOnce(backingId, op);
    // Generation 0 is still failed at the provider and was never re-adopted.
    expect(await k.provider.findRefund({ paymentRef: `sbx_pi_${backingId}`, opId: op.id, attempt: 0 })).toMatchObject({ status: "failed" });
  });

  it("the refund.failed webhook: op failed; a late duplicate about generation 0 can't fail generation 1; replay → refunded once", async () => {
    k.provider.failNextRefundAtProvider({ failureCode: "expired_or_canceled_card" });
    const { backingId, op } = await sentBackingRefund();
    await processPendingEvents(k.sql, k.provider); // the refund.failed webhook
    const failed = await opOf(op.id);
    expect(failed).toMatchObject({ status: "failed", attempt_gen: 0, last_error: "refund failed: expired_or_canceled_card" });
    expect(failed.failed_refs).toEqual([expect.objectContaining({ gen: 0, ref: op.provider_ref, via: "webhook" })]);

    const res = await replay(op.id, "Refund failed at the processor; send a new one");
    expect(res.statusCode, res.body).toBe(200);
    // The provider re-sends its refund.failed about generation 0 (a new delivery) before the runner picks the op up.
    await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_${randomUUID()}`, type: "refund.failed", livemode: false, account: null, objectRef: op.provider_ref,
      paymentRef: `sbx_pi_${backingId}`, amountMinor: 800, currency: "usd", failureCode: "expired_or_canceled_card",
      metadata: { outbound_op_id: op.id, outbound_attempt: "0", backing_id: backingId, campaign_id: VELVET }, raw: {},
    });
    await processPendingEvents(k.sql, k.provider);
    expect(await opOf(op.id)).toMatchObject({ status: "initiated", attempt_gen: 1 });
    // replayRefundsOnce replays again only if needed: the op is already on generation 1 and initiated.
    const before = refundCalls(op.id).length;
    await runDueOps(k.sql, k.provider);
    await processPendingEvents(k.sql, k.provider);
    expect(refundCalls(op.id).slice(before)).toEqual([expect.objectContaining({ idempotencyKey: `refund:${backingId}:r1`, attempt: 1 })]);
    expect(await opOf(op.id)).toMatchObject({ status: "confirmed", attempt_gen: 1 });
    expect(await backingStatus(backingId)).toBe("refunded");
    expect(await postings(`refund:${backingId}`)).toBe(1);
  });

  it("the runner's own lookup finds the refund failed: op failed, never re-adopted as `sent`; replay → refunded once", async () => {
    // The provider accepts the refund but the call's response is lost (timeout after it acted) — and the refund then fails.
    k.provider.failNextRefundAtProvider({ webhook: false });
    const backingId = await backAndPay(VELVET, VELVET_PERK);
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'test: refund fails at the provider')`);
    await drainOutbox(k.sql, async () => undefined);
    const { id } = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.outbound_ops where kind = 'refund' and subject_id = ${backingId}`);
    const orig = k.provider.refund.bind(k.provider);
    k.provider.refund = async (input) => {
      await orig(input);
      throw new ProviderError("retry", "timeout", "response lost");
    };
    try {
      await dueNow();
      await runDueOps(k.sql, k.provider);
    } finally {
      k.provider.refund = orig;
    }
    expect(await opOf(id)).toMatchObject({ status: "initiated", attempt_gen: 0 });
    await dueNow();
    await runDueOps(k.sql, k.provider); // lookup (generation 0) → failed → op failed, no call
    const op = await opOf(id);
    expect(op).toMatchObject({ status: "failed", attempt_gen: 0, last_error: "refund failed: failed" });
    expect(op.failed_refs).toEqual([expect.objectContaining({ gen: 0, ref: `sbx_re_${id}`, via: "runner" })]);
    expect(refundCalls(id)).toHaveLength(1);
    await replayRefundsOnce(backingId, { ...op, provider_ref: `sbx_re_${id}` });
  });

  it("a crash within a generation: lookup-before-call still prevents a second refund (generation 1)", async () => {
    k.provider.failNextRefundAtProvider();
    const { backingId, op } = await sentBackingRefund();
    await processPendingEvents(k.sql, k.provider); // refund.failed → op failed
    expect((await replay(op.id, "Refund failed at the processor; send a new one")).statusCode).toBe(200);
    // Generation 1: the provider refunds, then the call times out (the case FR-PAY-004 exists for).
    k.provider.failNext("refund", "retry", "timeout", { after: true });
    await runDueOps(k.sql, k.provider);
    expect(await opOf(op.id)).toMatchObject({ status: "initiated", attempt_gen: 1 });
    expect(refundCalls(op.id)).toHaveLength(2);
    // The retry asks the provider first (generation 1) and finds the refund: no new call, no second movement.
    await dueNow();
    await runDueOps(k.sql, k.provider);
    expect(refundCalls(op.id)).toHaveLength(2);
    expect(await opOf(op.id)).toMatchObject({ status: "sent", attempt_gen: 1, provider_ref: `sbx_re_${op.id}_r1` });
    await processPendingEvents(k.sql, k.provider);
    expect(await opOf(op.id)).toMatchObject({ status: "confirmed" });
    const moved = await one(k.sql, (tx) => tx<{ c: number }[]>`
      select count(*)::int as c from public.provider_events where type = 'refund.succeeded' and payload -> 'metadata' ->> 'outbound_op_id' = ${op.id}`);
    expect(moved.c).toBe(1);
    expect(await backingStatus(backingId)).toBe("refunded");
    expect(await postings(`refund:${backingId}`)).toBe(1);
  });

  it("a replay of an op whose generation did NOT fail at the provider (dead-letter) keeps the generation: the lookup finds the earlier refund", async () => {
    const backingId = await backAndPay(VELVET, VELVET_PERK);
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'test: dead-letter')`);
    await drainOutbox(k.sql, async () => undefined);
    const { id } = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.outbound_ops where kind = 'refund' and subject_id = ${backingId}`);
    // The provider refunded, the response was lost, and the op was dead-lettered before a retry looked it up.
    k.provider.failNext("refund", "retry", "timeout", { after: true });
    await dueNow();
    await runDueOps(k.sql, k.provider);
    await asService(k.sql, (tx) => tx`update public.outbound_ops set status = 'dead' where id = ${id}`);
    expect((await replay(id, "Dead-lettered; retry")).statusCode).toBe(200);
    expect(await opOf(id)).toMatchObject({ status: "initiated", attempt_gen: 0 });
    await runDueOps(k.sql, k.provider);
    await processPendingEvents(k.sql, k.provider);
    expect(refundCalls(id)).toHaveLength(1);
    expect(await opOf(id)).toMatchObject({ status: "confirmed", attempt_gen: 0, provider_ref: `sbx_re_${id}` });
    expect(await postings(`refund:${backingId}`)).toBe(1);
  });
});
