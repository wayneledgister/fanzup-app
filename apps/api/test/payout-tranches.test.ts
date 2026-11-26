/**
 * PR #7 review round 3, finding 1: a payout op's amount must equal what the ledger accepts at confirmation.
 * `tranche_release_amount` gives the LAST tranche whatever `artist_payable` still holds, so an op created for
 * tranche 2 while tranche 1 was still waiting used to be sized t1 + t2 and, after t1 paid, sent the stale larger
 * amount (overpaying from other campaigns' balance, then `payout_amount_mismatch` after the money left).
 * Fix (design §3.5, §5): a later tranche's op is created only once every earlier tranche is released, and the amount
 * is re-derived right before the first provider call and frozen from then on.
 */
import { afterEach, describe, expect, it } from "vitest";
import { asService, n } from "../src/db";
import { drainOutbox } from "../src/money";
import { runDueOps } from "../src/outbound";
import { afterDeadline, back, balances, createUser, ids, kit, one, pay, type Kit } from "./helpers";

let k: Kit | undefined;
afterEach(async () => {
  await k?.close();
  k = undefined;
});

const campaignId = ids.novaCampaign;

async function backAndPay(kk: Kit, cId: string, perkId: string, quantity: number) {
  const f = await createUser(kk.sql);
  const r = await back(kk, f.auth, { campaignId: cId, perkId, quantity });
  expect(r.statusCode).toBe(201);
  await pay(kk, r.json().backingId);
}

/** Drain the outbox and run every due op, a few rounds (a release queues the next tranche's op). */
async function work(kk: Kit) {
  for (let i = 0; i < 4; i++) {
    await drainOutbox(kk.sql, async () => undefined);
    await asService(kk.sql, (tx) => tx`update public.outbound_ops set next_attempt_at = now(), lease_until = null where status = 'initiated'`);
    await runDueOps(kk.sql, kk.provider);
  }
}

const tranches = (kk: Kit) => asService(kk.sql, (tx) => tx<{ id: string; seq: number; status: string; released_minor: bigint | null }[]>`
  select id, seq, status::text, released_minor from public.campaign_tranches where campaign_id = ${campaignId} order by seq`);
const payoutOps = (kk: Kit) => asService(kk.sql, (tx) => tx<{ subject_id: string; status: string; amount_minor: bigint; waiting: string | null; last_error: string | null }[]>`
  select subject_id, status, amount_minor, waiting, last_error from public.outbound_ops where kind = 'payout' and campaign_id = ${campaignId}`);
async function transfersOut(kk: Kit) {
  const bt = await kk.provider.listBalanceTransactions();
  return bt.filter((t) => t.type === "transfer" && t.campaignId === campaignId).map((t) => -t.netMinor);
}

/**
 * Funded two-tranche campaign whose artist has no payout account; tranche 1's op waits for it. Tranche 2's evidence
 * is submitted and verified while tranche 1 is still waiting. Another campaign's money sits in the same balance.
 */
async function setup(): Promise<{ kk: Kit; t1: string; t2: string; owed1: number; owed2: number }> {
  const kk = await kit();
  k = kk;
  await asService(kk.sql, (tx) => tx`update public.artists set payout_account_ref = null`);
  await asService(kk.sql, (tx) => tx`update public.campaigns set goal_minor = 50000 where id = ${campaignId}`);
  await backAndPay(kk, campaignId, ids.novaPerkTickets, 4);
  await backAndPay(kk, ids.solCampaign, ids.solPerkGA, 3); // other campaigns' money in the platform balance
  const at = await afterDeadline(kk.sql, campaignId);
  await asService(kk.sql, (tx) => tx`select public.settle_campaign(${campaignId}, ${at})`);
  const payable = -(await balances(kk.sql, campaignId)).artist_payable;
  const [t1, t2] = await tranches(kk);
  const net = n((await one(kk.sql, (tx) => tx<{ v: bigint }[]>`
    select c.settled_raised_minor - (select coalesce(sum(processing_fee_minor), 0) from public.backings where campaign_id = c.id and status = 'released') as v
      from public.campaigns c where c.id = ${campaignId}`)).v);
  const owed1 = Math.floor((net * 50) / 100);
  expect(payable).toBe(net);

  await work(kk);
  expect(await payoutOps(kk)).toMatchObject([{ subject_id: t1.id, status: "initiated", waiting: "payout_account", amount_minor: BigInt(owed1) }]);

  await asService(kk.sql, (tx) => tx`select public.submit_tranche_evidence(${t2.id}, ${ids.nova}, 'First show played, settlement attached', ${[]})`);
  await asService(kk.sql, (tx) => tx`select public.verify_tranche(${t2.id}, ${ids.reviewer})`);
  return { kk, t1: t1.id, t2: t2.id, owed1, owed2: payable - owed1 };
}

async function addAccountAndTopUp(kk: Kit) {
  await asService(kk.sql, (tx) => tx`update public.artists set payout_account_ref = 'sbx_acct_' || id where id = ${ids.novaArtist}`);
  await kk.provider.topUp(1_000_000);
}

describe("payout ops never send a stale amount (PR #7 review round 3, finding 1)", () => {
  it("tranche 2 verified while tranche 1 waits: transfers equal the per-tranche amounts, both release, artist_payable ends at 0", async () => {
    const { kk, t1, t2, owed1, owed2 } = await setup();
    await work(kk);
    // No op for tranche 2 while tranche 1 is unreleased (its amount depends on tranche 1's release).
    expect((await payoutOps(kk)).map((o) => o.subject_id)).toEqual([t1]);

    await addAccountAndTopUp(kk);
    await work(kk);

    expect(await transfersOut(kk)).toEqual([owed1, owed2]);
    expect((await tranches(kk)).map((t) => [t.status, n(t.released_minor)])).toEqual([["released", owed1], ["released", owed2]]);
    const ops = await payoutOps(kk);
    expect(ops.map((o) => [o.subject_id, o.status, n(o.amount_minor)]).sort()).toEqual([[t1, "confirmed", owed1], [t2, "confirmed", owed2]].sort());
    expect((await balances(kk.sql, campaignId)).artist_payable).toBe(0);
    const open = await asService(kk.sql, (tx) => tx`select kind from public.recon_breaks where resolved_at is null`);
    expect(open).toEqual([]);
    expect((await one(kk.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${campaignId}`)).status).toBe("released");
  });

  it("an op created early with a stale amount is re-sized from the ledger before its first provider call", async () => {
    const { kk, t1, t2, owed1, owed2 } = await setup();
    // What the old ensurePayoutOp did: tranche 2's op sized at t1 + t2 while tranche 1 still waits.
    await asService(kk.sql, (tx) => tx`insert into public.outbound_ops (kind, subject_id, campaign_id, amount_minor, idempotency_key)
                                       values ('payout', ${t2}, ${campaignId}, ${owed1 + owed2}, ${"release:" + t2})`);
    await work(kk);
    expect((await payoutOps(kk)).find((o) => o.subject_id === t2)).toMatchObject({ status: "initiated", waiting: "earlier_tranche" });

    await addAccountAndTopUp(kk);
    await work(kk);

    expect(await transfersOut(kk)).toEqual([owed1, owed2]);
    const ops = await payoutOps(kk);
    expect(ops.map((o) => [o.subject_id, o.status, n(o.amount_minor)]).sort()).toEqual([[t1, "confirmed", owed1], [t2, "confirmed", owed2]].sort());
    expect((await balances(kk.sql, campaignId)).artist_payable).toBe(0);
    expect(await asService(kk.sql, (tx) => tx`select kind from public.recon_breaks where resolved_at is null`)).toEqual([]);
  });

  it("once a provider call has started, a changed amount fails the op instead of sending it", async () => {
    const { kk, t2, owed1, owed2 } = await setup();
    await asService(kk.sql, (tx) => tx`insert into public.outbound_ops (kind, subject_id, campaign_id, amount_minor, idempotency_key, call_started_at)
                                       values ('payout', ${t2}, ${campaignId}, ${owed1 + owed2}, ${"release:" + t2}, now())`);
    await addAccountAndTopUp(kk);
    await work(kk);

    expect(await transfersOut(kk)).toEqual([owed1]);
    expect((await payoutOps(kk)).find((o) => o.subject_id === t2)).toMatchObject({ status: "failed", amount_minor: BigInt(owed1 + owed2) });
    expect((await payoutOps(kk)).find((o) => o.subject_id === t2)?.last_error).toMatch(/payout_amount_changed/);
    expect((await balances(kk.sql, campaignId)).artist_payable).toBe(-owed2);
  });
});
