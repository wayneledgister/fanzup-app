import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { SignJWT } from "jose";
import { createDb, type Sql } from "../src/db";

const ROOT = join(import.meta.dirname, "../../..");
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres";
export const JWT_SECRET = "test-secret-test-secret-test-secret-0123456789";

/** Fresh database: Supabase shim + every migration + seed. Mirrors `supabase db reset`. */
export async function freshDb(): Promise<{ sql: Sql; url: string; drop: () => Promise<void> }> {
  const name = `fz_test_${randomBytes(4).toString("hex")}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const boot = postgres(url, { max: 1, onnotice: () => {} });
  await boot.unsafe(readFileSync(join(ROOT, "apps/api/test/supabase-shim.sql"), "utf8"));
  const dir = join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await boot.unsafe(readFileSync(join(dir, f), "utf8"));
  await boot.unsafe(readFileSync(join(ROOT, "supabase/seed.sql"), "utf8"));
  await boot.end();
  const sql = createDb(url);
  return {
    sql,
    url,
    drop: async () => {
      await sql.end({ timeout: 2 });
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export async function tokenFor(sub: string) {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Seed ids (uuid v5 of "fanzup:<name>", see supabase/seed.sql). */
export const ids = {
  fan: "daba7ea1-c397-554c-87d4-ab17c5c4669e",
  novaCampaign: "ec7b0895-db3e-52a7-8e7e-56ef4dbfa145",
  nova: "7219e6d0-7ffb-51d4-b758-fa8d97b279f4",
  reviewer: "b40e0a39-c7ef-5798-91f3-504e09b530f4",
  solCampaign: "dbe19d49-d0c5-54da-b4bf-0ff0c03d5e27",
  novaPerkDiary: "47db82e3-deff-5150-8234-7b4d94f0cc7e",
  novaPerkTickets: "75ce90f1-b040-59ba-b134-e2c350d59a68",
  solPerkGA: "3835231c-7f19-5da7-88f7-02e8a3f255b6",
  novaArtist: "c36385da-a6c6-532b-a362-360bfbe4b9f7",
  sol: "f147ba23-d0a1-562d-9140-267bc300c8c2",
};

// ── M1 test kit ─────────────────────────────────────────────────────────
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp, jobDeps, type Deps } from "../src/app";
import { loadEnv } from "../src/env";
import { createVerifier } from "../src/lib/auth";
import { SandboxProvider } from "../src/provider";
import { asService, n } from "../src/db";
import { runWorkerTick } from "../src/jobs";

export async function tokenWith(sub: string, extra: Record<string, unknown> = {}) {
  return new SignJWT({ role: "authenticated", aal: "aal1", ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

export interface Kit {
  db: Awaited<ReturnType<typeof freshDb>>;
  sql: Sql;
  app: FastifyInstance;
  provider: SandboxProvider;
  deps: Deps;
  close: () => Promise<void>;
}

export async function kit(extra: Partial<Deps> = {}, envOverrides: Record<string, string> = {}): Promise<Kit> {
  const db = await freshDb();
  const provider = new SandboxProvider(db.sql);
  const env = loadEnv({ DATABASE_URL: db.url, SUPABASE_JWT_SECRET: JWT_SECRET, ESCROW_PROVIDER: "sandbox", NODE_ENV: "test", DEPLOY_ENV: "ci", ...envOverrides } as NodeJS.ProcessEnv);
  const deps: Deps = { env, sql: db.sql, provider, verify: createVerifier(env), ...extra };
  const app = await buildApp(deps);
  return { db, sql: db.sql, app, provider, deps, close: async () => { await app.close(); await db.drop(); } };
}

/** Create a confirmed (or unconfirmed) auth user; the new-user trigger creates the profile. */
export async function createUser(sql: Sql, opts: { confirmed?: boolean; name?: string } = {}) {
  const id = randomUUID();
  const meta = { display_name: opts.name ?? "Test Fan", adult_attested: true, terms_version: "2026-10-03-beta", privacy_version: "2026-10-03-beta" };
  await sql.begin((tx) => tx`
    insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${`fan-${id.slice(0, 8)}@fanzup.test`},
            ${opts.confirmed === false ? null : new Date()}, ${tx.json({ provider: "email" })}, ${tx.json(meta)}, now(), now())`);
  return { id, auth: `Bearer ${await tokenWith(id)}` };
}

export async function back(k: Kit, auth: string, body: { campaignId: string; perkId: string; quantity?: number; source?: string }, key = `k-${randomUUID()}`) {
  return k.app.inject({ method: "POST", url: "/api/v1/backings", headers: { authorization: auth, "idempotency-key": key }, payload: { quantity: 1, ...body } });
}

export async function pay(k: Kit, backingId: string, outcome: "succeed" | "decline" = "succeed", amountMinor?: number) {
  return k.app.inject({ method: "POST", url: `/api/v1/dev/sandbox/pay/${backingId}`, payload: { outcome, amountMinor } });
}

/** One worker tick at `now` (defaults to real now). */
export const tick = (k: Kit, now?: Date, recon = false) => runWorkerTick(jobDeps(k.deps), now ?? new Date(), { recon });

export async function campaignEnds(sql: Sql, campaignId: string) {
  const [c] = await asService(sql, (tx) => tx<{ ends_at: Date }[]>`select ends_at from public.campaigns where id = ${campaignId}`);
  return c.ends_at;
}
export const afterDeadline = async (sql: Sql, campaignId: string) => new Date((await campaignEnds(sql, campaignId)).getTime() + 3_600_000);

export async function balances(sql: Sql, campaignId: string) {
  const rows = await asService(sql, (tx) => tx<{ kind: string; balance_minor: bigint }[]>`
    select kind::text, balance_minor from public.ledger_balances where campaign_id = ${campaignId} or campaign_id is null`);
  return Object.fromEntries(rows.map((r) => [r.kind, n(r.balance_minor)])) as Record<string, number>;
}

export async function one<T>(sql: Sql, q: (tx: import("../src/db").Tx) => Promise<T[]>): Promise<T> {
  const rows = await asService(sql, q);
  return rows[0];
}
