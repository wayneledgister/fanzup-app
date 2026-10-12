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
import { isPayoutPaused, runReconciliation, PAYOUT_PAUSING_KINDS, type ReconResult } from "../src/recon";
import { afterDeadline, back, createUser, ids, kit, one, pay, tick, type Kit } from "./helpers";

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
