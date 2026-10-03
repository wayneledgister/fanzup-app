/**
 * Checkout holds and backing creation under concurrency (FR-PAY-001, FR-PAY-006, FR-BCK-004, FR-TAX-004 cap,
 * NFR-QA-01). Written before the implementation; each test names the acceptance criterion it proves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { back, createUser, ids, kit, one, pay, tick, type Kit } from "./helpers";

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

  it("a rejected request releases its key so the fan can retry after fixing the problem", async () => {
    const f = await createUser(k.sql);
    const bad = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.solPerkGA }, "k-fixable-001");
    expect(bad.statusCode).toBe(404);
    const good = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA }, "k-fixable-002");
    expect(good.statusCode).toBe(201);
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

  it("captured amount differs from the backing: refunded in full and a reconciliation break is opened", async () => {
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    const backingId = r.json().backingId as string;
    await pay(k, backingId, "succeed", 1500); // perk is $10
    await tick(k);
    const b = await one(k.sql, (tx) => tx<{ status: string; captured_minor: bigint }[]>`select status::text, captured_minor from public.backings where id = ${backingId}`);
    expect(b.status).toBe("refunded");
    expect(n(b.captured_minor)).toBe(1500);
    const brk = await one(k.sql, (tx) => tx<{ kind: string; amount_minor: bigint }[]>`select kind, amount_minor from public.recon_breaks where refs ->> 'backing_id' = ${backingId}`);
    expect(brk.kind).toBe("amount_mismatch");
    expect(n(brk.amount_minor)).toBe(500);
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
