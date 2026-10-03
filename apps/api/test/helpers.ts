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
};
