import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { processingFeeMinor } from "@fanzup/shared/policy";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import { SandboxEscrow } from "../src/escrow";
import { createVerifier } from "../src/lib/auth";
import { asService, n, type Sql } from "../src/db";
import { releaseVerifiedTranches } from "../src/money";
import { freshDb, ids, JWT_SECRET, tokenFor } from "./helpers";

let db: Awaited<ReturnType<typeof freshDb>>;
let sql: Sql;
let app: FastifyInstance;
let escrow: SandboxEscrow;
let fanAuth: string;

const balances = (campaignId: string) =>
  asService(sql, (tx) => tx<{ kind: string; balance_minor: bigint }[]>`
    select kind::text, balance_minor from public.ledger_balances where campaign_id = ${campaignId} or campaign_id is null order by kind`);
const bal = async (campaignId: string) => Object.fromEntries((await balances(campaignId)).map((r) => [r.kind, n(r.balance_minor)]));

async function back(campaignId: string, perkId: string, quantity: number, key: string, auth = fanAuth) {
  return app.inject({ method: "POST", url: "/api/v1/backings", headers: { authorization: auth, "idempotency-key": key }, payload: { campaignId, perkId, quantity } });
}
const deadlinePlus1h = async (campaignId: string) => {
  const [c] = await asService(sql, (tx) => tx<{ ends_at: Date }[]>`select ends_at from public.campaigns where id = ${campaignId}`);
  return new Date(c.ends_at.getTime() + 3_600_000).toISOString();
};

beforeAll(async () => {
  db = await freshDb();
  sql = db.sql;
  escrow = new SandboxEscrow();
  const env = loadEnv({ DATABASE_URL: db.url, SUPABASE_JWT_SECRET: JWT_SECRET, ESCROW_PROVIDER: "sandbox", NODE_ENV: "test" } as NodeJS.ProcessEnv);
  app = await buildApp({ env, sql, escrow, stripe: null, verify: createVerifier(env) });
  fanAuth = `Bearer ${await tokenFor(ids.fan)}`;
  // Small goal so the test can fund it: $500.
  await asService(sql, (tx) => tx`update public.campaigns set goal_minor = 50000 where id = ${ids.novaCampaign}`);
});
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe("public reads", () => {
  it("lists live campaigns without signing in", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    expect(r.statusCode).toBe(200);
    expect(r.json().campaigns.map((c: { slug: string }) => c.slug)).toContain("nova-live-band-tour");
  });
  it("returns perks with remaining counts", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/campaigns/nova-live-band-tour" });
    expect(r.json().perks.find((p: { id: string }) => p.id === ids.novaPerkTickets).remaining).toBe(60);
  });
});

describe("backing rules", () => {
  it("requires sign-in", async () => {
    expect((await back(ids.novaCampaign, ids.novaPerkTickets, 1, "k-noauth-1", "")).statusCode).toBe(401);
  });
  it("blocks artists backing their own campaign", async () => {
    const r = await back(ids.novaCampaign, ids.novaPerkTickets, 1, "k-self-0001", `Bearer ${await tokenFor(ids.nova)}`);
    expect(r.statusCode).toBe(403);
  });
  it("is idempotent on Idempotency-Key and rejects key reuse with a different body", async () => {
    const a = await back(ids.novaCampaign, ids.novaPerkDiary, 1, "k-idem-0001");
    const b = await back(ids.novaCampaign, ids.novaPerkDiary, 1, "k-idem-0001");
    expect(a.statusCode).toBe(201);
    expect(b.json().backingId).toBe(a.json().backingId);
    const [{ count }] = await asService(sql, (tx) => tx<{ count: bigint }[]>`select count(*) from public.backings where backer_id = ${ids.fan}`);
    expect(n(count)).toBe(1);
    expect((await back(ids.novaCampaign, ids.novaPerkDiary, 2, "k-idem-0001")).statusCode).toBe(422);
  });
});

describe("funded campaign: capture → settle → milestone releases", () => {
  it("moves every cent from backers to the artist and leaves escrow at zero", async () => {
    const r = await back(ids.novaCampaign, ids.novaPerkTickets, 4, "k-fund-0001"); // 4 × $150 = $600 ≥ $500 goal
    expect(r.statusCode).toBe(201);
    const backingId = r.json().backingId as string;

    await app.inject({ method: "POST", url: `/api/v1/dev/sandbox/confirm-payment/${backingId}` });
    // Confirming twice must not double-count (idempotent capture).
    await app.inject({ method: "POST", url: `/api/v1/dev/sandbox/confirm-payment/${backingId}` });
    const fee = processingFeeMinor(60000);
    let b = await bal(ids.novaCampaign);
    expect(b.escrow_cash).toBe(60000 - fee);
    expect(b.backer_liability).toBe(-60000);

    const tick = await app.inject({ method: "POST", url: `/api/v1/dev/sandbox/tick?now=${await deadlinePlus1h(ids.novaCampaign)}` });
    expect(tick.json().settled).toContainEqual({ id: ids.novaCampaign, outcome: "funded" });

    const net = 60000 - fee;
    const tranche1 = Math.floor((net * 50) / 100);
    b = await bal(ids.novaCampaign);
    expect(b.backer_liability).toBe(0);
    expect(b.escrow_cash).toBe(net - tranche1); // tranche 2 still held until its milestone is verified
    expect(escrow.calls.filter((c) => c.op === "releaseToArtist")).toHaveLength(1);

    const [t2] = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches where campaign_id = ${ids.novaCampaign} and seq = 2`);
    await asService(sql, (tx) => tx`select public.verify_tranche(${t2.id}, ${ids.reviewer})`);
    const released = await releaseVerifiedTranches(sql, escrow, ids.novaCampaign);
    expect(released[0].amountMinor).toBe(net - tranche1);

    b = await bal(ids.novaCampaign);
    expect(b.escrow_cash).toBe(0);
    expect(b.artist_payable).toBe(0);
    expect(b.processing_fees).toBe(0); // artist bore the fee
    const [c] = await asService(sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${ids.novaCampaign}`);
    expect(c.status).toBe("released");
  });
});

describe("failed campaign: target-or-refund", () => {
  it("refunds every backer in full and FanZuP absorbs the processing fee", async () => {
    const r = await back(ids.solCampaign, ids.solPerkGA, 1, "k-fail-0001"); // $30 of a $6,000 goal
    await app.inject({ method: "POST", url: `/api/v1/dev/sandbox/confirm-payment/${r.json().backingId}` });
    const tick = await app.inject({ method: "POST", url: `/api/v1/dev/sandbox/tick?now=${await deadlinePlus1h(ids.solCampaign)}` });
    expect(tick.json().settled).toContainEqual({ id: ids.solCampaign, outcome: "failed" });

    const refunds = escrow.calls.filter((c) => c.op === "refund");
    expect(refunds).toHaveLength(1);
    expect((refunds[0].input as { amountMinor: number }).amountMinor).toBe(3000); // full amount, not net of fees

    const b = await bal(ids.solCampaign);
    expect(b.escrow_cash).toBe(0);
    expect(b.backer_liability).toBe(0);
    expect(b.platform_absorbed_fees).toBe(processingFeeMinor(3000));
    const [c] = await asService(sql, (tx) => tx<{ status: string; raised_minor: bigint }[]>`select status::text, raised_minor from public.campaigns where id = ${ids.solCampaign}`);
    expect(c.status).toBe("refunded");
  });
});

describe("routing and scheduled work", () => {
  it("serves everything under /api (Vercel passes /api/* through unchanged)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/campaigns" })).statusCode).toBe(404);
  });
  it("cron tick is hidden without CRON_SECRET and rejects a wrong secret", async () => {
    expect((await app.inject({ method: "GET", url: "/api/internal/tick" })).statusCode).toBe(404);
    const env = loadEnv({ DATABASE_URL: db.url, SUPABASE_JWT_SECRET: JWT_SECRET, ESCROW_PROVIDER: "sandbox", NODE_ENV: "test", CRON_SECRET: "cron-secret-0123456789" } as NodeJS.ProcessEnv);
    const cronApp = await buildApp({ env, sql, escrow, stripe: null, verify: createVerifier(env) });
    expect((await cronApp.inject({ method: "GET", url: "/api/internal/tick", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const ok = await cronApp.inject({ method: "GET", url: "/api/internal/tick", headers: { authorization: "Bearer cron-secret-0123456789" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("processed");
    await cronApp.close();
  });
});

describe("edge cases", () => {
  it("a failed campaign with no backers closes out as refunded", async () => {
    const [v] = await asService(sql, (tx) => tx<{ id: string; ends_at: Date }[]>`select id, ends_at from public.campaigns where slug = 'velvet-circuit-video'`);
    await app.inject({ method: "POST", url: `/api/v1/dev/sandbox/tick?now=${new Date(v.ends_at.getTime() + 3_600_000).toISOString()}` });
    const [c] = await asService(sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${v.id}`);
    expect(c.status).toBe("refunded");
  });
});

describe("ledger invariants", () => {
  it("every transaction balances", async () => {
    const rows = await asService(sql, (tx) => tx<{ s: bigint }[]>`select sum(amount_minor) s from public.ledger_entries group by transaction_id`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => n(r.s) === 0)).toBe(true);
  });
  it("rejects an unbalanced posting", async () => {
    await expect(
      asService(sql, (tx) => tx`select public.ledger_post('bad', 'bad-1', ${tx.json([{ account: null, amount: 1 }] as never)})`),
    ).rejects.toThrow();
    await expect(
      asService(sql, async (tx) => {
        const [{ a }] = await tx<{ a: string }[]>`select public.ledger_account('platform_funding') a`;
        await tx`select public.ledger_post('bad', 'bad-2', ${tx.json([{ account: a, amount: 100 }] as never)})`;
      }),
    ).rejects.toThrow(/does not balance/);
  });
  it("is append-only", async () => {
    await expect(asService(sql, (tx) => tx`update public.ledger_entries set amount_minor = 1`)).rejects.toThrow(/append-only/);
    await expect(asService(sql, (tx) => tx`delete from public.ledger_transactions`)).rejects.toThrow(/append-only/);
  });
});
