/**
 * End-to-end money flows through the API, worker and sandbox provider (M1 exit tests 1–4).
 * FR-PAY-001..007, FR-PAY-009, FR-BCK-004, NFR-OPS-04/05, NFR-COMP-12, NFR-QA-01.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingFeeMinor } from "@fanzup/shared/policy";
import { loadEnv } from "../src/env";
import { buildApp } from "../src/app";
import { createVerifier } from "../src/lib/auth";
import { asService, n } from "../src/db";
import { runReconciliation } from "../src/recon";
import { afterDeadline, back, balances, createUser, ids, JWT_SECRET, kit, one, pay, tick, tokenFor, type Kit } from "./helpers";

let k: Kit;
let fanAuth: string;

beforeAll(async () => {
  k = await kit();
  fanAuth = `Bearer ${await tokenFor(ids.fan)}`;
  // Small goal so the test can fund it ($500), and a sandbox payout account for the artist.
  await asService(k.sql, async (tx) => {
    await tx`update public.campaigns set goal_minor = 50000 where id = ${ids.novaCampaign}`;
    await tx`update public.artists set payout_account_ref = 'sbx_acct_' || id`;
  });
});
afterAll(async () => k?.close());

describe("public reads", () => {
  it("lists live campaigns without signing in", async () => {
    const r = await k.app.inject({ method: "GET", url: "/api/v1/campaigns" });
    expect(r.statusCode).toBe(200);
    expect(r.json().campaigns.map((c: { slug: string }) => c.slug)).toContain("nova-live-band-tour");
  });
  it("returns perks with remaining counts", async () => {
    const r = await k.app.inject({ method: "GET", url: "/api/v1/campaigns/nova-live-band-tour" });
    expect(r.json().perks.find((p: { id: string }) => p.id === ids.novaPerkTickets).remaining).toBe(60);
  });
  it("reports the provider in test mode and echoes a correlation id", async () => {
    const r = await k.app.inject({ method: "GET", url: "/api/v1/config", headers: { "x-correlation-id": "test-corr-0001" } });
    expect(r.json()).toMatchObject({ provider: "sandbox", testMode: true });
    expect(r.headers["x-correlation-id"]).toBe("test-corr-0001");
    const bad = await k.app.inject({ method: "GET", url: "/api/v1/config", headers: { "x-correlation-id": "no spaces allowed!" } });
    expect(bad.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("backing rules", () => {
  it("requires sign-in", async () => {
    expect((await back(k, "", { campaignId: ids.novaCampaign, perkId: ids.novaPerkTickets })).statusCode).toBe(401);
  });
  it("requires a verified email before the first backing (FR-ID-001, card G1-B option 3)", async () => {
    const u = await createUser(k.sql, { confirmed: false });
    const r = await back(k, u.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("email_unverified");
  });
  it("blocks artists backing their own campaign", async () => {
    const r = await back(k, `Bearer ${await tokenFor(ids.nova)}`, { campaignId: ids.novaCampaign, perkId: ids.novaPerkTickets });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("self_backing");
  });
  it("is idempotent on Idempotency-Key and rejects key reuse with a different body", async () => {
    const u = await createUser(k.sql);
    const a = await back(k, u.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary }, "k-idem-0001");
    const b = await back(k, u.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary }, "k-idem-0001");
    expect(a.statusCode).toBe(201);
    expect(b.json().backingId).toBe(a.json().backingId);
    const { count } = await one(k.sql, (tx) => tx<{ count: bigint }[]>`select count(*) from public.backings where backer_id = ${u.id}`);
    expect(n(count)).toBe(1);
    expect((await back(k, u.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary, quantity: 2 }, "k-idem-0001")).statusCode).toBe(422);
  });
});

describe("funded campaign: capture → settle → both tranches released (exit test 1)", () => {
  let backingId: string;
  it("captures once, even when the payment is confirmed twice", async () => {
    const r = await back(k, fanAuth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkTickets, quantity: 4 }); // 4 × $150 = $600 ≥ $500
    expect(r.statusCode).toBe(201);
    backingId = r.json().backingId;
    expect((await pay(k, backingId)).json().status).toBe("succeeded");
    expect((await pay(k, backingId)).json().status).toBe("already_succeeded");
    const fee = processingFeeMinor(60000);
    const b = await balances(k.sql, ids.novaCampaign);
    expect(b.escrow_cash).toBe(60000 - fee);
    expect(b.backer_liability).toBe(-60000);
    const c = await one(k.sql, (tx) => tx<{ raised_minor: bigint; backers_count: number }[]>`select raised_minor, backers_count from public.campaigns where id = ${ids.novaCampaign}`);
    expect(n(c.raised_minor)).toBe(60000);
    expect(c.backers_count).toBe(1);
  });

  it("settles funded at the deadline and pays tranche 1 through a payout op", async () => {
    const r = await tick(k, await afterDeadline(k.sql, ids.novaCampaign));
    expect(r.settled).toContainEqual(expect.objectContaining({ id: ids.novaCampaign, outcome: "funded" }));
    const fee = processingFeeMinor(60000);
    const net = 60000 - fee;
    const tranche1 = Math.floor((net * 50) / 100);
    const b = await balances(k.sql, ids.novaCampaign);
    expect(b.backer_liability).toBe(0);
    expect(b.escrow_cash).toBe(net - tranche1); // tranche 2 still held until its milestone is verified
    expect(k.provider.calls.filter((c) => c.op === "transfer")).toHaveLength(1);
    const op = await one(k.sql, (tx) => tx<{ status: string; amount_minor: bigint }[]>`select status, amount_minor from public.outbound_ops where kind = 'payout'`);
    expect(op.status).toBe("confirmed");
    expect(n(op.amount_minor)).toBe(tranche1);
  });

  it("refuses verification without evidence, and by the campaign's owner", async () => {
    const t2 = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches where campaign_id = ${ids.novaCampaign} and seq = 2`);
    await expect(asService(k.sql, (tx) => tx`select public.verify_tranche(${t2.id}, ${ids.reviewer})`)).rejects.toThrow(/evidence_required/);
    await asService(k.sql, (tx) => tx`select public.submit_tranche_evidence(${t2.id}, ${ids.nova}, 'Venue settlement sheet for night one', ${["https://example.com/settlement.pdf"]})`);
    await expect(asService(k.sql, (tx) => tx`select public.verify_tranche(${t2.id}, ${ids.nova})`)).rejects.toThrow(/reviewer_is_owner/);
  });

  it("releases tranche 2 after verification and ends with the campaign released and escrow at zero", async () => {
    const t2 = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches where campaign_id = ${ids.novaCampaign} and seq = 2`);
    await asService(k.sql, (tx) => tx`select public.verify_tranche(${t2.id}, ${ids.reviewer})`);
    await tick(k);
    const b = await balances(k.sql, ids.novaCampaign);
    expect(b.escrow_cash).toBe(0);
    expect(b.artist_payable).toBe(0);
    const c = await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${ids.novaCampaign}`);
    expect(c.status).toBe("released");
    const tranches = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaign_tranches where campaign_id = ${ids.novaCampaign} order by seq`);
    expect(tranches.map((t) => t.status)).toEqual(["released", "released"]);
  });
});

describe("failed campaign: target-or-refund (exit test 2)", () => {
  it("refunds every backer in full through refund ops; FanZuP absorbs the processing fee", async () => {
    const fans = [await createUser(k.sql), await createUser(k.sql), await createUser(k.sql)];
    for (const f of fans) {
      const r = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA });
      expect(r.statusCode).toBe(201);
      await pay(k, r.json().backingId);
    }
    const r = await tick(k, await afterDeadline(k.sql, ids.solCampaign));
    expect(r.settled).toContainEqual(expect.objectContaining({ id: ids.solCampaign, outcome: "failed" }));

    const refunds = k.provider.calls.filter((c) => c.op === "refund");
    expect(refunds).toHaveLength(3);
    expect(refunds.every((c) => (c.input as { amountMinor: number }).amountMinor === 3000)).toBe(true); // full amount, not net of fees

    const b = await balances(k.sql, ids.solCampaign);
    expect(b.escrow_cash).toBe(0);
    expect(b.backer_liability).toBe(0);
    const ops = await asService(k.sql, (tx) => tx<{ status: string }[]>`select status from public.outbound_ops where kind = 'refund' and campaign_id = ${ids.solCampaign}`);
    expect(ops.map((o) => o.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    const c = await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${ids.solCampaign}`);
    expect(c.status).toBe("refunded");
  });
});

describe("reconciliation (exit test 3)", () => {
  it("ledger ↔ provider diffs to zero per campaign and in total after both journeys", async () => {
    const r = await runReconciliation(k.sql, k.provider);
    expect(r.diffMinor).toBe(0);
    expect(r.campaigns.every((c) => c.diffMinor === 0)).toBe(true);
    expect(r.breaks).toEqual([]);
    expect(r.campaigns.map((c) => c.campaignId)).toEqual(expect.arrayContaining([ids.novaCampaign, ids.solCampaign]));
  });
});

describe("correlation ids (exit test 4)", () => {
  it("one id traces a failed campaign's settlement through every refund op and posting", async () => {
    const audit = await one(k.sql, (tx) => tx<{ correlation_id: string }[]>`
      select correlation_id from public.audit_events where action = 'campaign.settled' and entity_id = ${ids.solCampaign}`);
    const id = audit.correlation_id;
    expect(id).toBeTruthy();
    const ops = await asService(k.sql, (tx) => tx`select 1 from public.outbound_ops where correlation_id = ${id} and kind = 'refund'`);
    const posts = await asService(k.sql, (tx) => tx`select 1 from public.ledger_transactions where correlation_id = ${id} and kind = 'backing.refunded'`);
    const refundAudit = await asService(k.sql, (tx) => tx`select 1 from public.audit_events where correlation_id = ${id} and action = 'backing.refunded'`);
    expect(ops).toHaveLength(3);
    expect(posts).toHaveLength(3);
    expect(refundAudit).toHaveLength(3);
  });
});

describe("routing, scheduled work and fail-closed configuration", () => {
  it("serves everything under /api (Vercel passes /api/* through unchanged)", async () => {
    expect((await k.app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await k.app.inject({ method: "GET", url: "/v1/campaigns" })).statusCode).toBe(404);
  });
  it("health reports the worker heartbeat age (NFR-OPS-06)", async () => {
    const h = (await k.app.inject({ method: "GET", url: "/api/health" })).json();
    expect(h.worker.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(h.provider).toBe("sandbox");
  });
  it("cron tick is hidden without CRON_SECRET and rejects a wrong secret", async () => {
    expect((await k.app.inject({ method: "GET", url: "/api/internal/tick" })).statusCode).toBe(404);
    const env = loadEnv({ DATABASE_URL: k.db.url, SUPABASE_JWT_SECRET: JWT_SECRET, ESCROW_PROVIDER: "sandbox", NODE_ENV: "test", DEPLOY_ENV: "ci", CRON_SECRET: "cron-secret-0123456789" } as NodeJS.ProcessEnv);
    const cronApp = await buildApp({ ...k.deps, env, verify: createVerifier(env) });
    expect((await cronApp.inject({ method: "GET", url: "/api/internal/tick", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const ok = await cronApp.inject({ method: "GET", url: "/api/internal/tick", headers: { authorization: "Bearer cron-secret-0123456789" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("processed");
    await cronApp.close();
  });
  it("deployed environments refuse the sandbox and live keys (FR-PAY-008, NFR-SEC-04)", () => {
    const base = { DATABASE_URL: k.db.url, SUPABASE_JWT_SECRET: JWT_SECRET };
    expect(() => loadEnv({ ...base, VERCEL_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/sandbox provider can't run/);
    expect(() => loadEnv({ ...base, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/sandbox provider can't run/);
    expect(() => loadEnv({ ...base, ESCROW_PROVIDER: "stripe-test", STRIPE_SECRET_KEY: "sk_live_abc" } as NodeJS.ProcessEnv)).toThrow(/only Stripe TEST keys/);
    expect(() => loadEnv({ ...base, ESCROW_PROVIDER: "stripe-test", STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PUBLISHABLE_KEY: "pk_live_x" } as NodeJS.ProcessEnv)).toThrow(/pk_test_/);
    expect(loadEnv({ ...base, ESCROW_PROVIDER: "stripe-dev", STRIPE_SECRET_KEY: "sk_test_abc" } as NodeJS.ProcessEnv).ESCROW_PROVIDER).toBe("stripe-test");
  });
  it("dev routes don't exist in a deployed environment", async () => {
    const env = { ...k.deps.env, deployed: true };
    const prodApp = await buildApp({ ...k.deps, env });
    expect((await prodApp.inject({ method: "POST", url: "/api/v1/dev/sandbox/tick" })).statusCode).toBe(404);
    await prodApp.close();
  });
});

describe("Supabase ↔ Vercel integration env names", () => {
  it("uses POSTGRES_URL when DATABASE_URL is absent and strips non-Postgres params", () => {
    const env = loadEnv({ POSTGRES_URL: "postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", DEPLOY_ENV: "local" } as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toBe("postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(env.SUPABASE_URL).toBe("https://abc.supabase.co");
  });
});

describe("edge cases", () => {
  it("a failed campaign with no backers closes out as refunded", async () => {
    const v = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaigns where slug = 'velvet-circuit-video'`);
    await tick(k, await afterDeadline(k.sql, v.id));
    const c = await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${v.id}`);
    expect(c.status).toBe("refunded");
  });
});

describe("ledger invariants", () => {
  it("every transaction balances", async () => {
    const rows = await asService(k.sql, (tx) => tx<{ s: bigint }[]>`select sum(amount_minor) s from public.ledger_entries group by transaction_id`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => n(r.s) === 0)).toBe(true);
  });
  it("rejects an unbalanced posting", async () => {
    await expect(
      asService(k.sql, async (tx) => {
        const [{ a }] = await tx<{ a: string }[]>`select public.ledger_account('platform_funding') a`;
        await tx`select public.ledger_post('bad', 'bad-2', ${tx.json([{ account: a, amount: 100 }] as never)})`;
      }),
    ).rejects.toThrow(/does not balance/);
  });
  it("is append-only, including TRUNCATE (NFR-COMP-12)", async () => {
    await expect(asService(k.sql, (tx) => tx`update public.ledger_entries set amount_minor = 1`)).rejects.toThrow(/append-only/);
    await expect(asService(k.sql, (tx) => tx`delete from public.ledger_transactions`)).rejects.toThrow(/append-only/);
    await expect(k.sql`truncate public.ledger_entries cascade`).rejects.toThrow(/append-only/);
    await expect(k.sql`truncate public.audit_events`).rejects.toThrow(/append-only/);
  });
});
