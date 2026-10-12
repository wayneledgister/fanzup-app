/**
 * Checkout holds and backing creation under concurrency (FR-PAY-001, FR-PAY-006, FR-BCK-004, FR-TAX-004 cap,
 * NFR-QA-01). Written before the implementation; each test names the acceptance criterion it proves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY, processingFeeMinor } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { requestHash, scopedKey } from "../src/checkout";
import { buildApp } from "../src/app";
import type { PaymentProvider } from "../src/provider";
import { back, balances, createUser, ids, kit, one, pay, tick, type Kit } from "./helpers";

let k: Kit;
let lastUnitPerk: string;
const VELVET = "1e7625f2-4279-5070-9b54-c7539ac818a1";
const VELVET_PERK = "4fdbbe9d-386c-5c57-897f-5683787ffd53";

beforeAll(async () => {
  k = await kit();
  lastUnitPerk = randomUUID();
  await asService(k.sql, (tx) => tx`
    insert into public.perks (id, campaign_id, title, kind, price_minor, quantity_limit, fulfill_by)
    values (${lastUnitPerk}, ${ids.solCampaign}, 'Front-row seat', 'experience', 5000, 1, '2027-01-23')`);
});
afterAll(async () => k?.close());

const perkClaimed = async (perkId: string) =>
  n((await one(k.sql, (tx) => tx<{ claimed: number }[]>`select claimed from public.perks where id = ${perkId}`)).claimed);

describe("FR-PAY-001: stock is held at checkout", () => {
  it("the held unit comes off the remaining count immediately", async () => {
    const f = await createUser(k.sql);
    const before = (await k.app.inject({ method: "GET", url: "/api/v1/campaigns/sol-amara-first-headline" })).json().perks.find((p: { id: string }) => p.id === ids.solPerkGA).remaining;
    const r = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA, quantity: 2 });
    expect(r.statusCode).toBe(201);
    expect(r.json().holdExpiresAt).toBeTruthy();
    const after = (await k.app.inject({ method: "GET", url: "/api/v1/campaigns/sol-amara-first-headline" })).json().perks.find((p: { id: string }) => p.id === ids.solPerkGA).remaining;
    expect(after).toBe(before - 2);
  });

  it("N fans racing for the last unit: exactly one reservation succeeds, the rest see sold out before any payment", async () => {
    const fans = await Promise.all(Array.from({ length: 6 }, () => createUser(k.sql)));
    const results = await Promise.all(fans.map((f) => back(k, f.auth, { campaignId: ids.solCampaign, perkId: lastUnitPerk })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error === "perk_sold_out")).toBe(true);
    expect(await perkClaimed(lastUnitPerk)).toBe(1);
    const createPayments = k.provider.calls.filter((c) => c.op === "createPayment" && (c.input as { campaignId: string }).campaignId === ids.solCampaign);
    expect(new Set(createPayments.map((c) => (c.input as { backingId: string }).backingId)).size).toBeLessThanOrEqual(2); // GA hold above + the winner
  });

  it("an expired hold returns its units and cancels the payment attempt, which can then no longer be paid", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA });
    const backingId = r.json().backingId as string;
    const claimed = await perkClaimed(ids.solPerkGA);
    await tick(k, new Date(Date.now() + (POLICY.checkout.holdMinutes + 1) * 60_000));
    const b = await one(k.sql, (tx) => tx<{ status: string; units_held: boolean }[]>`select status::text, units_held from public.backings where id = ${backingId}`);
    expect(b.status).toBe("canceled");
    expect(b.units_held).toBe(false);
    expect(await perkClaimed(ids.solPerkGA)).toBeLessThan(claimed);
    expect(k.provider.calls.some((c) => c.op === "cancelPayment")).toBe(true);
    const late = await pay(k, backingId);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe("checkout_expired");
  });
});

describe("FR-PAY-006: atomic, retry-safe backing creation", () => {
  it("the same key sent 5 times in parallel creates one backing and one payment attempt", async () => {
    const f = await createUser(k.sql);
    const key = `k-par-${randomUUID()}`;
    const rs = await Promise.all(Array.from({ length: 5 }, () => back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary }, key)));
    const ok = rs.filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.json().backingId)).size).toBe(1);
    expect(rs.every((r) => r.statusCode === 201 || (r.statusCode === 409 && r.json().error === "in_progress"))).toBe(true);
    const { count } = await one(k.sql, (tx) => tx<{ count: bigint }[]>`select count(*) from public.backings where backer_id = ${f.id}`);
    expect(n(count)).toBe(1);
    const payments = k.provider.calls.filter((c) => c.op === "createPayment" && (c.input as { backingId: string }).backingId === ok[0].json().backingId);
    expect(new Set(payments.map((c) => (c.input as { idempotencyKey: string }).idempotencyKey)).size).toBe(1);
  });

  it("when the provider call fails, a retry with the same key reuses the same backing", async () => {
    const f = await createUser(k.sql);
    k.provider.failNext("createPayment", "retry");
    const first = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary }, "k-resume-0001");
    expect(first.statusCode).toBe(502);
    expect(first.json().error).toBe("provider_unavailable");
    const second = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary }, "k-resume-0001");
    expect(second.statusCode).toBe(201);
    const rows = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.backings where backer_id = ${f.id}`);
    expect(rows).toHaveLength(1);
    expect(second.json().backingId).toBe(rows[0].id);
  });

  it("a rejected request stores its error on the key (same key → same error); a new key can succeed", async () => {
    const f = await createUser(k.sql);
    const bad = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.solPerkGA }, "k-fixable-001");
    expect(bad.statusCode).toBe(404);
    const again = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.solPerkGA }, "k-fixable-001");
    expect(again.statusCode).toBe(404);
    expect(again.json().error).toBe("perk_not_found");
    const good = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA }, "k-fixable-002");
    expect(good.statusCode).toBe(201);
  });

  it("a rule violation is replayed for its key even after the cause goes away (design §4.4 step 2d)", async () => {
    const perk = randomUUID();
    await asService(k.sql, (tx) => tx`
      insert into public.perks (id, campaign_id, title, kind, price_minor, quantity_limit, fulfill_by)
      values (${perk}, ${ids.solCampaign}, 'Soundcheck pass', 'experience', 2000, 1, '2027-01-23')`);
    const [a, b] = [await createUser(k.sql), await createUser(k.sql)];
    const first = await back(k, a.auth, { campaignId: ids.solCampaign, perkId: perk });
    expect(first.statusCode).toBe(201);
    const sold = await back(k, b.auth, { campaignId: ids.solCampaign, perkId: perk }, "k-sold-out-01");
    expect(sold.json().error).toBe("perk_sold_out");
    await asService(k.sql, (tx) => tx`select public.release_backing_hold(${first.json().backingId}, 'test')`);
    const replayed = await back(k, b.auth, { campaignId: ids.solCampaign, perkId: perk }, "k-sold-out-01");
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json().error).toBe("perk_sold_out");
    expect((await back(k, b.auth, { campaignId: ids.solCampaign, perkId: perk }, "k-sold-out-02")).statusCode).toBe(201);
  });
});

describe("FR-PAY-006: crash between steps (design §4.4, T-006 a–f)", () => {
  const body = (perkId = ids.novaPerkDiary) => ({ campaignId: ids.novaCampaign, perkId, quantity: 1 });
  const createCalls = (backingId: string) => k.provider.calls.filter((c) => c.op === "createPayment" && (c.input as { backingId: string }).backingId === backingId);

  it("(a) a failure after the claim but before the hold commits persists nothing; the same key then creates one backing", async () => {
    const f = await createUser(k.sql);
    await k.sql.unsafe(`
      create function public.test_crash() returns trigger language plpgsql as $$
      begin if new.backer_id = '${f.id}' then raise exception 'simulated crash' using errcode = 'XX000'; end if; return new; end $$;
      create trigger test_crash before insert on public.backings for each row execute function public.test_crash();`);
    const crashed = await back(k, f.auth, body(), "k-crash-a-0001");
    await k.sql.unsafe(`drop trigger test_crash on public.backings; drop function public.test_crash();`);
    expect(crashed.statusCode).toBe(500);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.api_idempotency where key = ${scopedKey(f.id, "k-crash-a-0001")}`)).toHaveLength(0);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.backings where backer_id = ${f.id}`)).toHaveLength(0);
    const retry = await back(k, f.auth, body(), "k-crash-a-0001");
    expect(retry.statusCode).toBe(201);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.backings where backer_id = ${f.id}`)).toHaveLength(1);
  });

  it("(b) stopped after the hold committed, before the provider call: a retry resumes the stored backing with one payment", async () => {
    const f = await createUser(k.sql);
    const [hold] = await asService(k.sql, (tx) => tx<{ backing_id: string }[]>`
      select backing_id from public.create_backing_hold(${f.id}, ${ids.novaCampaign}, ${ids.novaPerkDiary}, 1, null, ${POLICY.checkout.holdMinutes}, ${POLICY.checkout.maxUnconfirmedPerUser})`);
    await asService(k.sql, (tx) => tx`
      insert into public.api_idempotency (key, user_id, request_hash, state, claimed_at, resource_id)
      values (${scopedKey(f.id, "k-crash-b-0001")}, ${f.id}, ${requestHash(f.id, body())}, 'in_progress', now(), ${hold.backing_id})`);
    const r = await back(k, f.auth, body(), "k-crash-b-0001");
    expect(r.statusCode).toBe(201);
    expect(r.json().backingId).toBe(hold.backing_id);
    expect(createCalls(hold.backing_id)).toHaveLength(1);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.backings where backer_id = ${f.id}`)).toHaveLength(1);
  });

  it(`(c) an in_progress claim with no backing is re-claimed after ${POLICY.checkout.abandonedClaimMinutes} minutes; a younger one is 409 in_progress`, async () => {
    const f = await createUser(k.sql);
    const claim = (key: string, age: string) => asService(k.sql, (tx) => tx`
      insert into public.api_idempotency (key, user_id, request_hash, state, claimed_at)
      values (${scopedKey(f.id, key)}, ${f.id}, ${requestHash(f.id, body())}, 'in_progress', now() - ${age}::interval)`);
    await claim("k-crash-c-young", "30 seconds");
    await claim("k-crash-c-old01", `${POLICY.checkout.abandonedClaimMinutes + 1} minutes`);
    const young = await back(k, f.auth, body(), "k-crash-c-young");
    expect(young.statusCode).toBe(409);
    expect(young.json().error).toBe("in_progress");
    const old = await back(k, f.auth, body(), "k-crash-c-old01");
    expect(old.statusCode).toBe(201);
  });

  it("(d) resuming a checkout whose hold expired returns a stored 409 checkout_expired and creates no payment", async () => {
    const f = await createUser(k.sql);
    k.provider.failNext("createPayment", "retry");
    const first = await back(k, f.auth, body(), "k-expired-d-01");
    expect(first.statusCode).toBe(502);
    const [b] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.backings where backer_id = ${f.id}`);
    const callsBefore = createCalls(b.id).length;
    await asService(k.sql, (tx) => tx`update public.backings set hold_expires_at = now() - interval '1 second' where id = ${b.id}`);
    const resumed = await back(k, f.auth, body(), "k-expired-d-01");
    expect(resumed.statusCode).toBe(409);
    expect(resumed.json().error).toBe("checkout_expired");
    expect(createCalls(b.id)).toHaveLength(callsBefore);
    const claim = await one(k.sql, (tx) => tx<{ state: string; status_code: number }[]>`select state, status_code from public.api_idempotency where key = ${scopedKey(f.id, "k-expired-d-01")}`);
    expect(claim).toMatchObject({ state: "done", status_code: 409 });
    // Even if the hold were somehow live again, the stored outcome is what the key replays.
    await asService(k.sql, (tx) => tx`update public.backings set hold_expires_at = now() + interval '5 minutes' where id = ${b.id}`);
    expect((await back(k, f.auth, body(), "k-expired-d-01")).json().error).toBe("checkout_expired");
    expect(createCalls(b.id)).toHaveLength(callsBefore);
  });

  it("(d') a hold that dies while the provider call is in flight is not given the payment: 409 and the payment is cancelled", async () => {
    const f = await createUser(k.sql);
    const dying: PaymentProvider = Object.create(k.provider);
    dying.createPayment = async (input) => {
      const r = await k.provider.createPayment(input);
      await asService(k.sql, (tx) => tx`select public.release_backing_hold(${input.backingId}, 'test: expired during provider call')`);
      return r;
    };
    const app = await buildApp({ ...k.deps, provider: dying });
    const r = await app.inject({ method: "POST", url: "/api/v1/backings", headers: { authorization: f.auth, "idempotency-key": "k-dying-hold-01" }, payload: body() });
    await app.close();
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("checkout_expired");
    const [b] = await asService(k.sql, (tx) => tx<{ id: string; payment_ref: string | null }[]>`select id, payment_ref from public.backings where backer_id = ${f.id}`);
    expect(b.payment_ref).toBeNull();
    expect(k.provider.calls.some((c) => c.op === "cancelPayment" && c.input === `sbx_pi_${b.id}`)).toBe(true);
  });

  it("(e) a hold whose payment ref was never stored is looked up at the provider and cancelled before its units return", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA });
    const id = r.json().backingId as string;
    await asService(k.sql, (tx) => tx`update public.backings set payment_ref = null where id = ${id}`); // the crash: ref never stored
    const finds = () => k.provider.calls.filter((c) => c.op === "findPayment" && (c.input as { backingId: string }).backingId === id).length;
    // Just expired: not searched yet (the provider's search index may lag).
    await tick(k, new Date(Date.now() + (POLICY.checkout.holdMinutes + 1) * 60_000));
    expect(finds()).toBe(0);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${id}`)).status).toBe("pending_payment");
    const units = await perkClaimed(ids.solPerkGA);
    await tick(k, new Date(Date.now() + (POLICY.checkout.holdMinutes + POLICY.checkout.expiryLookupGraceMinutes + 1) * 60_000));
    expect(finds()).toBe(1);
    expect(k.provider.calls.some((c) => c.op === "cancelPayment" && c.input === `sbx_pi_${id}`)).toBe(true);
    const b = await one(k.sql, (tx) => tx<{ status: string; payment_ref: string }[]>`select status::text, payment_ref from public.backings where id = ${id}`);
    expect(b).toEqual({ status: "canceled", payment_ref: `sbx_pi_${id}` });
    expect(await perkClaimed(ids.solPerkGA)).toBe(units - 1);
  });

  it("(f) a resumed checkout sends the provider exactly the same parameters, whatever the retry's correlation id", async () => {
    const f = await createUser(k.sql);
    const send = (corr: string) => k.app.inject({
      method: "POST", url: "/api/v1/backings",
      headers: { authorization: f.auth, "idempotency-key": "k-determ-f-01", "x-correlation-id": corr }, payload: body(),
    });
    k.provider.failNext("createPayment", "retry");
    expect((await send("corr-first-request-01")).statusCode).toBe(502);
    const second = await send("corr-second-request-02");
    expect(second.statusCode).toBe(201);
    const calls = createCalls(second.json().backingId);
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toEqual(calls[0].input);
    expect(calls[0].input).toMatchObject({
      backingId: second.json().backingId, campaignId: ids.novaCampaign, amountMinor: 1000,
      idempotencyKey: `payment:${second.json().backingId}`, correlationId: "corr-first-request-01",
      description: "Take the band on the road — Digital thank-you + tour diary",
    });
  });
});

describe("FR-TAX-004 (M1 slice): open-checkout cap", () => {
  it(`refuses a fan's ${POLICY.checkout.maxUnconfirmedPerUser + 1}th unconfirmed checkout`, async () => {
    const f = await createUser(k.sql);
    for (let i = 0; i < POLICY.checkout.maxUnconfirmedPerUser; i++) {
      expect((await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary })).statusCode).toBe(201);
    }
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("too_many_open_checkouts");
  });
});

describe("FR-PAY-003: a capture the platform can't accept is refunded in full", () => {
  it("payment completes after the deadline passed: money in and money out in the ledger, counters untouched", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: VELVET, perkId: VELVET_PERK });
    const backingId = r.json().backingId as string;
    const before = await one(k.sql, (tx) => tx<{ raised_minor: bigint; ends_at: Date }[]>`select raised_minor, ends_at from public.campaigns where id = ${VELVET}`);
    const claimedBefore = await perkClaimed(VELVET_PERK);
    // The deadline passes while the fan is on the card form.
    await asService(k.sql, (tx) => tx`update public.campaigns set ends_at = now() - interval '1 second' where id = ${VELVET}`);
    await pay(k, backingId);
    await tick(k);
    const b = await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${backingId}`);
    expect(b.status).toBe("refunded");
    const kinds = (await asService(k.sql, (tx) => tx<{ kind: string }[]>`select kind from public.ledger_transactions where backing_id = ${backingId} order by created_at`)).map((t) => t.kind);
    expect(kinds).toEqual(["backing.captured_unapplied", "backing.refunded"]);
    const refund = k.provider.calls.find((c) => c.op === "refund" && (c.input as { backingId: string }).backingId === backingId);
    expect((refund?.input as { amountMinor: number }).amountMinor).toBe(800);
    const after = await one(k.sql, (tx) => tx<{ raised_minor: bigint }[]>`select raised_minor from public.campaigns where id = ${VELVET}`);
    expect(n(after.raised_minor)).toBe(n(before.raised_minor));
    expect(await perkClaimed(VELVET_PERK)).toBe(claimedBefore - 1);
    const audit = await one(k.sql, (tx) => tx<{ data: { reason: string } }[]>`select data from public.audit_events where action = 'backing.capture_unapplied' and entity_id = ${backingId}`);
    expect(audit.data.reason).toBe("campaign_closed");
    await asService(k.sql, (tx) => tx`update public.campaigns set ends_at = ${before.ends_at} where id = ${VELVET}`);
  });

  it("captured amount differs from the backing: refunded in full from what was captured and a reconciliation break is opened", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const backingId = r.json().backingId as string;
    const liabilityBefore = (await balances(k.sql, ids.novaCampaign)).backer_liability ?? 0;
    await pay(k, backingId, "succeed", 1500); // perk is $10
    const pending = await one(k.sql, (tx) => tx<{ status: string; captured_minor: bigint; captured_currency: string; processing_fee_minor: bigint }[]>`
      select status::text, captured_minor, captured_currency, processing_fee_minor from public.backings where id = ${backingId}`);
    expect(pending.status).toBe("refund_pending");
    expect(n(pending.captured_minor)).toBe(1500);
    expect(pending.captured_currency).toBe("usd");
    expect(n(pending.processing_fee_minor)).toBe(processingFeeMinor(1500));
    expect((await balances(k.sql, ids.novaCampaign)).backer_liability).toBe(liabilityBefore - 1500);
    // A confirmation of the expected amount (1000) is refused: the backer is owed what was captured.
    await expect(asService(k.sql, (tx) => tx`select public.record_refund_confirmed(${backingId}, 're_test', 1000, 'test-refund-1000')`)).rejects.toThrow(/refund_amount_mismatch/);
    await tick(k);
    const b = await one(k.sql, (tx) => tx<{ status: string; captured_minor: bigint }[]>`select status::text, captured_minor from public.backings where id = ${backingId}`);
    expect(b.status).toBe("refunded");
    expect(n(b.captured_minor)).toBe(1500);
    const refund = k.provider.calls.find((c) => c.op === "refund" && (c.input as { backingId: string }).backingId === backingId);
    expect((refund?.input as { amountMinor: number }).amountMinor).toBe(1500);
    const leg = await one(k.sql, (tx) => tx<{ amount_minor: bigint }[]>`
      select e.amount_minor from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id
        join public.ledger_accounts a on a.id = e.account_id and a.kind = 'backer_liability'
       where t.backing_id = ${backingId} and t.kind = 'backing.refunded'`);
    expect(n(leg.amount_minor)).toBe(1500); // debits backer_liability by what was captured
    expect((await balances(k.sql, ids.novaCampaign)).backer_liability).toBe(liabilityBefore);
    const brk = await one(k.sql, (tx) => tx<{ kind: string; amount_minor: bigint }[]>`select kind, amount_minor from public.recon_breaks where refs ->> 'backing_id' = ${backingId}`);
    expect(brk.kind).toBe("amount_mismatch");
    expect(n(brk.amount_minor)).toBe(500);
  });
});

describe("FR-PAY-001 bullet 4: the deadline releases open holds", () => {
  it("an unpaid hold on a campaign whose deadline passed is cancelled with the provider and its units return", async () => {
    const LOW_ENDS = "a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e";
    const VINYL = "b6658093-c8cb-5edd-b884-e7f4b3f55fb8";
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: LOW_ENDS, perkId: VINYL, quantity: 2 });
    const id = r.json().backingId as string;
    const units = await perkClaimed(VINYL);
    await asService(k.sql, (tx) => tx`update public.campaigns set ends_at = now() - interval '1 second' where id = ${LOW_ENDS}`);
    await tick(k); // the hold itself is still unexpired; the deadline releases it
    const b = await one(k.sql, (tx) => tx<{ status: string; units_held: boolean }[]>`select status::text, units_held from public.backings where id = ${id}`);
    expect(b).toEqual({ status: "canceled", units_held: false });
    expect(await perkClaimed(VINYL)).toBe(units - 2);
    expect(k.provider.calls.some((c) => c.op === "cancelPayment" && c.input === `sbx_pi_${id}`)).toBe(true);
    expect((await pay(k, id)).json().error).toBe("checkout_expired");
  });
});

describe("FR-PAY-009: public counters", () => {
  it("a fan who backs twice counts as one backer", async () => {
    const f = await createUser(k.sql);
    const before = (await one(k.sql, (tx) => tx<{ backers_count: number }[]>`select backers_count from public.campaigns where id = ${ids.novaCampaign}`)).backers_count;
    for (let i = 0; i < 2; i++) {
      const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
      await pay(k, r.json().backingId);
    }
    const after = (await one(k.sql, (tx) => tx<{ backers_count: number }[]>`select backers_count from public.campaigns where id = ${ids.novaCampaign}`)).backers_count;
    expect(after).toBe(before + 1);
  });
});

describe("NFR-OPS-04: one correlation id from checkout to capture", () => {
  it("the checkout request's id is on the hold, the capture audit and the capture posting", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const id = r.headers["x-correlation-id"] as string;
    await pay(k, r.json().backingId);
    const actions = (await asService(k.sql, (tx) => tx<{ action: string }[]>`select action from public.audit_events where correlation_id = ${id} order by id`)).map((a) => a.action);
    expect(actions).toEqual(["backing.hold_created", "backing.captured"]);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.ledger_transactions where correlation_id = ${id} and kind = 'backing.captured'`)).toHaveLength(1);
  });
});
