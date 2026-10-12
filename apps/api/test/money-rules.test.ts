/**
 * PR #6 design rules and PR #7 review fixes on the money path (design §3.5, §3.5.1, §5; T-005, T-007, T-008):
 * the counter rule, settlement with a refund in flight, capture matching and stray captures, the inbox claim,
 * outbound lookups and failure guards, and the deploy detection rule. Real Postgres, sandbox provider.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { processingFeeMinor } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { ingestEvent, processEventById, processPendingEvents } from "../src/inbox";
import { runDueOps, type OpRow } from "../src/outbound";
import { drainOutbox } from "../src/money";
import { runReconciliation } from "../src/recon";
import { isDeployed, loadEnv } from "../src/env";
import type { PaymentProvider } from "../src/provider";
import { afterDeadline, back, balances, createUser, ids, JWT_SECRET, kit, one, pay, tick, type Kit } from "./helpers";

let k: Kit;
const LOW_ENDS = "a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e";
const LOW_ENDS_VINYL = "b6658093-c8cb-5edd-b884-e7f4b3f55fb8"; // $35, 500 units
const VELVET = "1e7625f2-4279-5070-9b54-c7539ac818a1";
const VELVET_PERK = "4fdbbe9d-386c-5c57-897f-5683787ffd53"; // $8, unlimited
const VELVET_EXTRA = "f40d629b-6dac-5cd6-81ff-3b16a74e08ac"; // $120, 25 units

beforeAll(async () => {
  k = await kit();
  await asService(k.sql, (tx) => tx`update public.artists set payout_account_ref = 'sbx_acct_' || id`);
  // Platform money for the fees FanZuP absorbs on refunds, so payouts here never wait for funds.
  await k.provider.topUp(100_000);
  await processPendingEvents(k.sql, k.provider);
});
afterAll(async () => k?.close());

async function backAndPay(campaignId: string, perkId: string, quantity = 1) {
  const f = await createUser(k.sql);
  const r = await back(k, f.auth, { campaignId, perkId, quantity });
  expect(r.statusCode).toBe(201);
  expect((await pay(k, r.json().backingId)).json().status).toBe("succeeded");
  return r.json().backingId as string;
}
const campaign = (id: string) =>
  one(k.sql, (tx) => tx<{ status: string; raised_minor: bigint; backers_count: number; settled_raised_minor: bigint | null; settled_backers_count: number | null }[]>`
    select status::text, raised_minor, backers_count, settled_raised_minor, settled_backers_count from public.campaigns where id = ${id}`);
const backing = (id: string) =>
  one(k.sql, (tx) => tx<{ status: string; payment_ref: string | null; captured_minor: bigint | null; captured_currency: string | null; processing_fee_minor: bigint; units_held: boolean }[]>`
    select status::text, payment_ref, captured_minor, captured_currency, processing_fee_minor, units_held from public.backings where id = ${id}`);
const claimed = async (perkId: string) => n((await one(k.sql, (tx) => tx<{ claimed: number }[]>`select claimed from public.perks where id = ${perkId}`)).claimed);
const everyTransactionBalances = async () =>
  (await asService(k.sql, (tx) => tx<{ s: bigint }[]>`select sum(amount_minor) s from public.ledger_entries group by transaction_id`)).every((r) => n(r.s) === 0);
const dueNow = () => asService(k.sql, (tx) => tx`update public.outbound_ops set next_attempt_at = now(), lease_until = null where status = 'initiated'`);
const captureEvent = (o: { ref: string; backingId?: string; campaignId: string; amount: number; currency?: string; eventId?: string }) => ({
  provider: "sandbox", eventId: o.eventId ?? `evt_${randomUUID()}`, type: "payment.succeeded" as const, livemode: false, account: null,
  objectRef: o.ref, paymentRef: o.ref, amountMinor: o.amount, currency: o.currency ?? "usd", feeMinor: processingFeeMinor(o.amount),
  metadata: { ...(o.backingId ? { backing_id: o.backingId } : {}), campaign_id: o.campaignId }, raw: {},
});

describe("counter rule (design §3.5, T-007)", () => {
  it("a staff refund drops raised/backers and returns perk units when the backing leaves `held`; confirmation changes no counters", async () => {
    const before = await campaign(VELVET);
    const unitsBefore = await claimed(VELVET_EXTRA);
    const id = await backAndPay(VELVET, VELVET_EXTRA);
    expect(await claimed(VELVET_EXTRA)).toBe(unitsBefore + 1);
    // record_refund_confirmed requires refund_pending: a held backing can't be "confirmed refunded".
    await expect(asService(k.sql, (tx) => tx`select public.record_refund_confirmed(${id}, 're_x', 12000, 'test-held-confirm')`)).rejects.toThrow(/refund_state/);
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${id}, 'fan changed their mind')`);
    const mid = await campaign(VELVET);
    expect(n(mid.raised_minor)).toBe(n(before.raised_minor));
    expect(mid.backers_count).toBe(before.backers_count);
    expect(await claimed(VELVET_EXTRA)).toBe(unitsBefore);
    expect((await backing(id)).status).toBe("refund_pending");
    await tick(k);
    expect((await backing(id)).status).toBe("refunded");
    const after = await campaign(VELVET);
    expect(n(after.raised_minor)).toBe(n(before.raised_minor));
    expect(after.backers_count).toBe(before.backers_count);
    expect(await claimed(VELVET_EXTRA)).toBe(unitsBefore);
  });
});

describe("settlement with a refund still pending at the deadline (T-008)", () => {
  let refundedId: string;
  let keptId: string;
  it("funded branch pays the artist only from `held` backings; the pending refund finishes from backer liability", async () => {
    await asService(k.sql, (tx) => tx`update public.campaigns set goal_minor = 50000 where id = ${LOW_ENDS}`);
    refundedId = await backAndPay(LOW_ENDS, LOW_ENDS_VINYL, 2); // $70
    keptId = await backAndPay(LOW_ENDS, LOW_ENDS_VINYL, 10); // $350
    const kept2 = await backAndPay(LOW_ENDS, LOW_ENDS_VINYL, 5); // $175
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${refundedId}, 'fan asked before the deadline')`);
    // The deadline passes before the refund confirms: settle without running the refund op.
    const at = await afterDeadline(k.sql, LOW_ENDS);
    const [{ outcome }] = await asService(k.sql, (tx) => tx<{ outcome: string }[]>`select public.settle_campaign(${LOW_ENDS}, ${at})::text as outcome`);
    expect(outcome).toBe("funded");
    const c = await campaign(LOW_ENDS);
    expect(n(c.settled_raised_minor)).toBe(52500);
    expect(c.settled_backers_count).toBe(2);
    const feeKept = processingFeeMinor(35000) + processingFeeMinor(17500);
    let b = await balances(k.sql, LOW_ENDS);
    expect(b.artist_payable).toBe(-(52500 - feeKept)); // none of the refunded backing's cents
    expect(b.backer_liability).toBe(-7000); // still owed to the refunding backer
    expect((await backing(refundedId)).status).toBe("refund_pending");
    expect((await backing(keptId)).status).toBe("released");
    expect((await backing(kept2)).status).toBe("released");

    await tick(k); // refund op runs and confirms; the single tranche pays out
    expect((await backing(refundedId)).status).toBe("refunded");
    b = await balances(k.sql, LOW_ENDS);
    expect(b.backer_liability).toBe(0);
    expect(b.artist_payable).toBe(0);
    expect(b.escrow_cash).toBe(0);
    const payout = await one(k.sql, (tx) => tx<{ amount_minor: bigint; status: string }[]>`select amount_minor, status from public.outbound_ops where kind = 'payout' and campaign_id = ${LOW_ENDS}`);
    expect(payout).toMatchObject({ status: "confirmed" });
    expect(n(payout.amount_minor)).toBe(52500 - feeKept);
    expect(await everyTransactionBalances()).toBe(true);
    const r = await runReconciliation(k.sql, k.provider);
    expect(r.campaigns.find((x) => x.campaignId === LOW_ENDS)?.diffMinor).toBe(0);
    expect(r.breaks.filter((x) => x.campaignId === LOW_ENDS)).toEqual([]);
  });

  it("failed branch moves held → refund_pending (counters fall at once) and closes `refunded` only after the last refund", async () => {
    const solBefore = await campaign(ids.solCampaign);
    expect(solBefore.status).toBe("live");
    const units = await claimed(ids.solPerkGA);
    const a = await backAndPay(ids.solCampaign, ids.solPerkGA);
    const b2 = await backAndPay(ids.solCampaign, ids.solPerkGA);
    const at = await afterDeadline(k.sql, ids.solCampaign);
    await asService(k.sql, (tx) => tx`select public.settle_campaign(${ids.solCampaign}, ${at})`);
    const c = await campaign(ids.solCampaign);
    expect(c.status).toBe("failed");
    expect(n(c.raised_minor)).toBe(0);
    expect(c.backers_count).toBe(0);
    expect(n(c.settled_raised_minor)).toBe(n(solBefore.raised_minor) + 6000);
    expect(await claimed(ids.solPerkGA)).toBe(units);
    expect((await backing(a)).status).toBe("refund_pending");
    await tick(k);
    expect((await backing(a)).status).toBe("refunded");
    expect((await backing(b2)).status).toBe("refunded");
    expect((await campaign(ids.solCampaign)).status).toBe("refunded");
  });
});

describe("capture matching and stray captures (design §3.5.1, T-005)", () => {
  it("a second, different PaymentIntent for a held backing is refunded in full by its own op; the backing is untouched", async () => {
    const id = await backAndPay(ids.novaCampaign, ids.novaPerkDiary);
    const before = await campaign(ids.novaCampaign);
    const secondRef = `sbx_pi_second_${id}`;
    const { id: evt } = await ingestEvent(k.sql, captureEvent({ ref: secondRef, backingId: id, campaignId: ids.novaCampaign, amount: 1000 }));
    await processEventById(k.sql, k.provider, evt);
    const b = await backing(id);
    expect(b.status).toBe("held");
    expect(b.payment_ref).toBe(`sbx_pi_${id}`);
    const op = await one(k.sql, (tx) => tx<OpRow[]>`select * from public.outbound_ops where payment_ref = ${secondRef}`);
    expect(op).toMatchObject({ kind: "refund", subject_id: evt, idempotency_key: `refund:pay:${secondRef}` });
    expect(n(op.amount_minor)).toBe(1000);
    await tick(k);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where id = ${op.id}`)).status).toBe("confirmed");
    const kinds = (await asService(k.sql, (tx) => tx<{ kind: string }[]>`
      select kind from public.ledger_transactions where external_ref = ${secondRef} or idempotency_key = ${"refund:pay:" + secondRef} order by created_at`)).map((t) => t.kind);
    expect(kinds).toEqual(["payment.captured_stray", "payment.stray_refunded"]);
    const refundCall = k.provider.calls.find((c) => c.op === "refund" && (c.input as { paymentRef: string }).paymentRef === secondRef);
    expect((refundCall?.input as { amountMinor: number; backingId: string | null }).amountMinor).toBe(1000);
    expect((refundCall?.input as { backingId: string | null }).backingId).toBeNull();
    const after = await campaign(ids.novaCampaign);
    expect(n(after.raised_minor)).toBe(n(before.raised_minor));
    expect(after.backers_count).toBe(before.backers_count);
    expect(await everyTransactionBalances()).toBe(true);
    const r = await runReconciliation(k.sql, k.provider);
    expect(r.campaigns.find((x) => x.campaignId === ids.novaCampaign)?.diffMinor).toBe(0);
    expect(r.breaks.filter((x) => x.campaignId === ids.novaCampaign && x.kind !== "counter_mismatch")).toEqual([]);
  });

  it("the same stray payment delivered twice, and replayed, posts once and refunds once", async () => {
    const ref = `sbx_pi_stray_${randomUUID()}`;
    const a = await ingestEvent(k.sql, captureEvent({ ref, campaignId: ids.novaCampaign, amount: 2500 }));
    const b = await ingestEvent(k.sql, captureEvent({ ref, campaignId: ids.novaCampaign, amount: 2500 }));
    await processEventById(k.sql, k.provider, a.id);
    await processEventById(k.sql, k.provider, b.id);
    await asService(k.sql, (tx) => tx`update public.provider_events set status = 'received' where id = ${a.id}`); // staff replay
    await processEventById(k.sql, k.provider, a.id);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.ledger_transactions where idempotency_key = ${"capture:" + ref}`)).toHaveLength(1);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.outbound_ops where payment_ref = ${ref}`)).toHaveLength(1);
    await tick(k);
    expect(k.provider.calls.filter((c) => c.op === "refund" && (c.input as { paymentRef: string }).paymentRef === ref)).toHaveLength(1);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.ledger_transactions where kind = 'payment.stray_refunded' and idempotency_key = ${"refund:pay:" + ref}`)).toHaveLength(1);
  });

  it("a currency mismatch is refunded in full from what was captured and opens a currency_mismatch break", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const id = r.json().backingId as string;
    const { id: evt } = await ingestEvent(k.sql, captureEvent({ ref: `sbx_pi_${id}`, backingId: id, campaignId: ids.novaCampaign, amount: 1000, currency: "eur" }));
    await processEventById(k.sql, k.provider, evt);
    const b = await backing(id);
    expect(b).toMatchObject({ status: "refund_pending", captured_currency: "eur" });
    const brk = await one(k.sql, (tx) => tx<{ kind: string; refs: Record<string, unknown> }[]>`select kind, refs from public.recon_breaks where refs ->> 'backing_id' = ${id}`);
    expect(brk.kind).toBe("currency_mismatch");
    expect(brk.refs).toMatchObject({ expected_currency: "usd", captured_currency: "eur" });
    await asService(k.sql, (tx) => tx`update public.recon_breaks set resolved_at = now(), resolution = 'test' where refs ->> 'backing_id' = ${id}`);
  });

  it("two processors racing on one capture post it once and the backing stays held (inbox claim + lock-then-check)", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const id = r.json().backingId as string;
    const ref = `sbx_pi_${id}`;
    const { id: evt } = await ingestEvent(k.sql, captureEvent({ ref, backingId: id, campaignId: ids.novaCampaign, amount: 1000 }));
    const claims = await Promise.all([processEventById(k.sql, k.provider, evt), processEventById(k.sql, k.provider, evt), processPendingEvents(k.sql, k.provider)]);
    expect(claims.filter((c) => c === true).length).toBeLessThanOrEqual(1);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.ledger_transactions where idempotency_key = ${"capture:" + ref}`)).toHaveLength(1);
    expect((await backing(id)).status).toBe("held");
    const row = await one(k.sql, (tx) => tx<{ status: string; attempts: number; lease_until: Date | null }[]>`select status, attempts, lease_until from public.provider_events where id = ${evt}`);
    expect(row).toMatchObject({ status: "processed", attempts: 1, lease_until: null });

    // The SQL alone serialises too: the backing is locked before the idempotency check.
    const g = await createUser(k.sql);
    const r2 = await back(k, g.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const id2 = r2.json().backingId as string;
    const ref2 = `sbx_pi_${id2}`;
    const call = () => asService(k.sql, (tx) => tx<{ r: string }[]>`select public.apply_payment_captured(${id2}, ${ref2}, 1000, 'usd', 59, ${"capture:" + ref2}) as r`);
    const results = (await Promise.all([call(), call(), call()])).map((x) => x[0].r).sort();
    expect(results).toEqual(["applied", "duplicate", "duplicate"]);
    expect((await backing(id2)).status).toBe("held");
  });

  it("lock order: a capture waits on the campaign before touching the backing, so settlement can't deadlock with it", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const id = r.json().backingId as string;
    const ref = `sbx_pi_${id}`;
    let capture: Promise<string> | undefined;
    await k.sql.begin(async (tx) => {
      // settle_campaign's first two steps: lock the campaign, then its backings.
      await tx`select 1 from public.campaigns where id = ${ids.novaCampaign} for update`;
      capture = asService(k.sql, (t2) => t2<{ r: string }[]>`select public.apply_payment_captured(${id}, ${ref}, 1000, 'usd', 59, ${"capture:" + ref}) as r`).then((x) => x[0].r);
      await new Promise((res) => setTimeout(res, 300)); // the capture is now queued on the campaign lock
      // With the old order (backing → campaign) the capture would hold this row and NOWAIT would fail (55P03).
      await tx`select 1 from public.backings where campaign_id = ${ids.novaCampaign} for update nowait`;
    });
    expect(await capture).toBe("applied");
    expect((await backing(id)).status).toBe("held");
  });

  it("a processor that lost its claim (lease expired, row re-claimed) doesn't overwrite the new claimant's state", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const id = r.json().backingId as string;
    const ref = `sbx_pi_${id}`;
    const { feeMinor: _fee, ...noFee } = captureEvent({ ref, backingId: id, campaignId: ids.novaCampaign, amount: 1000 });
    const { id: evt } = await ingestEvent(k.sql, noFee);
    const newToken = randomUUID();
    const slow: PaymentProvider = Object.create(k.provider);
    // While the first processor is mid-work, its lease runs out and a second processor claims the row.
    slow.paymentFee = async () => {
      await asService(k.sql, (tx) => tx`
        update public.provider_events set status = 'processing', lease_until = now() + interval '5 minutes', claim_token = ${newToken} where id = ${evt}`);
      return processingFeeMinor(1000);
    };
    expect(await processEventById(k.sql, slow, evt)).toBe(true);
    const row = await one(k.sql, (tx) => tx<{ status: string; attempts: number; claim_token: string | null }[]>`
      select status, attempts, claim_token from public.provider_events where id = ${evt}`);
    expect(row).toMatchObject({ status: "processing", attempts: 0, claim_token: newToken });
    expect((await backing(id)).status).toBe("held"); // the money still moved exactly once
    // Let the new claimant's lease lapse; the next processor finishes the row (the capture is a duplicate).
    await asService(k.sql, (tx) => tx`update public.provider_events set lease_until = now() - interval '1 second' where id = ${evt}`);
    expect(await processEventById(k.sql, k.provider, evt)).toBe(true);
    expect(await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where id = ${evt}`)).toMatchObject({ status: "processed" });
  });
});

describe("outbound ops (FR-PAY-004 review fixes)", () => {
  async function refundOpFor(backingId: string) {
    await asService(k.sql, (tx) => tx`select public.request_backing_refund(${backingId}, 'test: outbound lookup')`);
    await drainOutbox(k.sql, async () => undefined);
    return one(k.sql, (tx) => tx<OpRow[]>`select * from public.outbound_ops where subject_id = ${backingId}`);
  }

  it("looks the provider up before the first call: a refund the provider already made is never sent twice", async () => {
    const id = await backAndPay(ids.novaCampaign, ids.novaPerkDiary);
    const op = await refundOpFor(id);
    expect(op.attempts).toBe(0);
    // The provider acted (e.g. a previous worker crashed right after the call) before anything was recorded.
    await k.provider.refund({ paymentRef: `sbx_pi_${id}`, amountMinor: 1000, idempotencyKey: op.idempotency_key, opId: op.id, attempt: 0, backingId: id, campaignId: op.campaign_id });
    await dueNow();
    await runDueOps(k.sql, k.provider);
    expect(k.provider.calls.filter((c) => c.op === "refund" && (c.input as { backingId: string }).backingId === id)).toHaveLength(1);
    const after = await one(k.sql, (tx) => tx<{ status: string; provider_ref: string }[]>`select status, provider_ref from public.outbound_ops where id = ${op.id}`);
    expect(after).toMatchObject({ status: "sent", provider_ref: `sbx_re_${op.id}` });
    await processPendingEvents(k.sql, k.provider);
  });

  it("a provider refund of a different amount fails the op, keeps the provider's ref and opens an amount_mismatch break", async () => {
    const id = await backAndPay(ids.novaCampaign, ids.novaPerkDiary);
    const op = await refundOpFor(id);
    await k.provider.refund({ paymentRef: `sbx_pi_${id}`, amountMinor: 400, idempotencyKey: op.idempotency_key, opId: op.id, attempt: 0, backingId: id, campaignId: op.campaign_id });
    await dueNow();
    await runDueOps(k.sql, k.provider);
    const after = await one(k.sql, (tx) => tx<{ status: string; provider_ref: string }[]>`select status, provider_ref from public.outbound_ops where id = ${op.id}`);
    expect(after).toMatchObject({ status: "failed", provider_ref: `sbx_re_${op.id}` });
    const brk = await one(k.sql, (tx) => tx<{ kind: string; amount_minor: bigint }[]>`select kind, amount_minor from public.recon_breaks where dedupe_key = ${"op_amount:" + op.id}`);
    expect(brk.kind).toBe("amount_mismatch");
    expect(n(brk.amount_minor)).toBe(-600);
    // The refund event for that partial refund: refund_amount_mismatch is caught — op stays failed, event processed.
    await processPendingEvents(k.sql, k.provider);
    const evt = await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where object_ref = ${`sbx_re_${op.id}`}`);
    expect(evt.status).toBe("processed");
    expect((await backing(id)).status).toBe("refund_pending");
    await asService(k.sql, (tx) => tx`update public.recon_breaks set resolved_at = now(), resolution = 'test' where dedupe_key = ${"op_amount:" + op.id}`);
  });

  it("a refund event reporting a different amount than a `sent` op fails the op and opens a break", async () => {
    const id = await backAndPay(ids.novaCampaign, ids.novaPerkDiary);
    const op = await refundOpFor(id);
    await asService(k.sql, (tx) => tx`update public.outbound_ops set status = 'sent', provider_ref = 'sbx_re_manual' where id = ${op.id}`);
    const { id: evt } = await ingestEvent(k.sql, {
      provider: "sandbox", eventId: `evt_${randomUUID()}`, type: "refund.succeeded", livemode: false, account: null,
      objectRef: "sbx_re_manual", paymentRef: `sbx_pi_${id}`, amountMinor: 900, currency: "usd", metadata: { outbound_op_id: op.id }, raw: {},
    });
    await processEventById(k.sql, k.provider, evt);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where id = ${op.id}`)).status).toBe("failed");
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.provider_events where id = ${evt}`)).status).toBe("processed");
    expect(await asService(k.sql, (tx) => tx`select 1 from public.recon_breaks where dedupe_key = ${"op_amount:" + op.id} and kind = 'amount_mismatch' and resolved_at is null`)).toHaveLength(1);
    await asService(k.sql, (tx) => tx`update public.recon_breaks set resolved_at = now(), resolution = 'test' where dedupe_key = ${"op_amount:" + op.id}`);
  });

  it("a payout confirmed by `transfer.created` while the transfer call still fails stays confirmed", async () => {
    // Velvet: fund it, settle, and let the payout op run against a provider whose transfer call acts, lets the
    // transfer.created event confirm the op, and then times out.
    await asService(k.sql, (tx) => tx`update public.campaigns set goal_minor = 50000 where id = ${VELVET}`);
    await backAndPay(VELVET, VELVET_EXTRA, 5); // $600
    const at = await afterDeadline(k.sql, VELVET);
    await asService(k.sql, (tx) => tx`select public.settle_campaign(${VELVET}, ${at})`);
    await drainOutbox(k.sql, async () => undefined);
    const racing: PaymentProvider = Object.create(k.provider);
    racing.findTransfer = async () => null;
    racing.transfer = async (input) => {
      await k.provider.transfer(input);
      await processPendingEvents(k.sql, k.provider); // transfer.created confirms the op
      throw Object.assign(new Error("socket hang up"), { cls: "retry" });
    };
    await runDueOps(k.sql, racing);
    const op = await one(k.sql, (tx) => tx<{ status: string; attempts: number }[]>`select status, attempts from public.outbound_ops where kind = 'payout' and campaign_id = ${VELVET}`);
    expect(op.status).toBe("confirmed");
    expect((await campaign(VELVET)).status).toBe("released");
  });
});

describe("deploy detection (NFR-SEC-04, FR-PAY-008)", () => {
  it("platform signals mark a deployment whatever DEPLOY_ENV says", () => {
    expect(isDeployed({ VERCEL_ENV: "preview" } as NodeJS.ProcessEnv, "ci")).toBe(true);
    expect(isDeployed({ RENDER: "true" } as NodeJS.ProcessEnv, "local")).toBe(true);
    expect(isDeployed({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "local")).toBe(true);
    expect(isDeployed({} as NodeJS.ProcessEnv, "staging")).toBe(true);
    expect(isDeployed({ NODE_ENV: "test" } as NodeJS.ProcessEnv, "ci")).toBe(false);
    expect(isDeployed({} as NodeJS.ProcessEnv, undefined)).toBe(false);
    const base = { DATABASE_URL: k.db.url, SUPABASE_JWT_SECRET: JWT_SECRET, ESCROW_PROVIDER: "sandbox" };
    expect(() => loadEnv({ ...base, DEPLOY_ENV: "local", VERCEL_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/sandbox provider can't run/);
  });

  it("vercel dev (VERCEL_ENV=development) is not a deployment; preview and production are", () => {
    expect(isDeployed({ VERCEL_ENV: "development" } as NodeJS.ProcessEnv, "local")).toBe(false);
    expect(isDeployed({ VERCEL_ENV: "development" } as NodeJS.ProcessEnv, undefined)).toBe(false);
    expect(isDeployed({ VERCEL_ENV: "preview" } as NodeJS.ProcessEnv, undefined)).toBe(true);
    expect(isDeployed({ VERCEL_ENV: "production" } as NodeJS.ProcessEnv, undefined)).toBe(true);
    const base = { DATABASE_URL: k.db.url, SUPABASE_JWT_SECRET: JWT_SECRET, ESCROW_PROVIDER: "sandbox" };
    expect(loadEnv({ ...base, VERCEL_ENV: "development", DEPLOY_ENV: "local" } as NodeJS.ProcessEnv).deployed).toBe(false);
  });

  // Exactly the variables render.yaml + docs/SETUP.md D2 give the worker (plus RENDER, which Render injects).
  const renderWorkerEnv = {
    RENDER: "true",
    NODE_VERSION: "22",
    NODE_ENV: "production",
    DATABASE_URL: "postgres://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    SUPABASE_URL: "https://abc.supabase.co",
    STRIPE_SECRET_KEY: "sk_test_abc",
    ESCROW_PROVIDER: "stripe-test",
    DEPLOY_ENV: "staging",
    DB_POOL_MAX: "5",
  };

  it("the Render worker env (no STRIPE_WEBHOOK_SECRET) loads for the worker", () => {
    const env = loadEnv(renderWorkerEnv as NodeJS.ProcessEnv, { requireWebhookSecret: false });
    expect(env.deployed).toBe(true);
    expect(env.ESCROW_PROVIDER).toBe("stripe-test");
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(loadEnv(renderWorkerEnv as NodeJS.ProcessEnv).deployed).toBe(true); // default = worker behaviour
  });

  it("the deployed API env still fails closed without STRIPE_WEBHOOK_SECRET", () => {
    const apiEnv = { ...renderWorkerEnv, RENDER: undefined, VERCEL_ENV: "production" };
    expect(() => loadEnv(apiEnv as NodeJS.ProcessEnv, { requireWebhookSecret: true })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    const ok = loadEnv({ ...apiEnv, STRIPE_WEBHOOK_SECRET: "whsec_x" } as NodeJS.ProcessEnv, { requireWebhookSecret: true });
    expect(ok.STRIPE_WEBHOOK_SECRET).toBe("whsec_x");
  });
});

describe("record_tranche_released under concurrency (review round 2, item 6)", () => {
  let k2: Kit;
  beforeAll(async () => {
    k2 = await kit();
    await k2.sql`update public.campaigns set goal_minor = 50000 where id = ${ids.novaCampaign}`; // $500, so $600 funds it
  });
  afterAll(async () => k2?.close());

  it("concurrent duplicate confirmations of one payout post once and all return the amount", async () => {
    const f = await createUser(k2.sql);
    const r = await back(k2, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkTickets, quantity: 4 }); // $600 ≥ goal
    expect((await pay(k2, r.json().backingId)).json().status).toBe("succeeded");
    await processPendingEvents(k2.sql, k2.provider);
    const at = await afterDeadline(k2.sql, ids.novaCampaign);
    await asService(k2.sql, (tx) => tx`select public.settle_campaign(${ids.novaCampaign}, ${at})`);
    const t1 = await one(k2.sql, (tx) => tx<{ id: string; owed: bigint }[]>`
      select id, public.tranche_release_amount(id) as owed from public.campaign_tranches where campaign_id = ${ids.novaCampaign} and seq = 1`);
    const owed = n(t1.owed);
    const call = () => asService(k2.sql, (tx) => tx<{ v: bigint }[]>`select public.record_tranche_released(${t1.id}, 'tr_dup_test', ${owed}, 'payout:dup-test') as v`).then((x) => n(x[0].v));
    expect(await Promise.all([call(), call(), call()])).toEqual([owed, owed, owed]);
    const posts = await asService(k2.sql, (tx) => tx`select 1 from public.ledger_transactions where idempotency_key = 'payout:dup-test'`);
    expect(posts).toHaveLength(1);
  });
});
