/** Helpers for the golden journey: API calls as artist/staff, Mailpit, TOTP. No secrets: local/CI seed accounts only. */
import { createClient } from "@supabase/supabase-js";
import { authenticator } from "otplib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";

export const WEB = process.env.WEB_URL ?? "http://localhost:4173";
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:55321";
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";
/**
 * Seed accounts (supabase/seed.sql — local/CI only; never loaded into a hosted project). The shared dev password is
 * read from the seed file's header so it lives in one place.
 */
export const SEED_PASSWORD = (() => {
  const m = /Password for all users: (\S+)/.exec(readFileSync(join(__dirname, "..", "supabase", "seed.sql"), "utf8"));
  if (!m) throw new Error("seed.sql header no longer names the dev password");
  return m[1];
})();

export async function api<T = unknown>(path: string, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T; correlationId: string | null }> {
  const res = await fetch(`${WEB}/api/v1${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { ...(opts.body === undefined ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, correlationId: res.headers.get("x-correlation-id") };
}

const client = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export async function seedSignIn(email: string, credential = SEED_PASSWORD) { // ggignore
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password: credential }); // ggignore
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

/** TOTP secrets enrolled during this test run, shared across spec files (a verified factor's secret can't be read back). */
const totpCache = (email: string) => join(tmpdir(), `fanzup-e2e-totp-${email.replace(/[^a-z0-9]/gi, "_")}.json`);

/** Staff session at aal2: enrol a TOTP factor (first run) and verify a code — the real Supabase MFA flow. */
export async function staffToken(email: string) {
  const sb = client();
  const { error } = await sb.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`staff sign-in failed: ${error.message}`);
  const { data: existing } = await sb.auth.mfa.listFactors();
  const known = existing?.totp.find((f) => f.status === "verified");
  if (known && existsSync(totpCache(email))) {
    const { factorId, secret } = JSON.parse(readFileSync(totpCache(email), "utf8"));
    if (factorId === known.id) {
      // A code can't be reused within its 30-second step; wait for the next one if needed.
      const v = await sb.auth.mfa.challengeAndVerify({ factorId, code: authenticator.generate(secret) });
      if (v.error) {
        await new Promise((r) => setTimeout(r, authenticator.timeRemaining() * 1000 + 500));
        const v2 = await sb.auth.mfa.challengeAndVerify({ factorId, code: authenticator.generate(secret) });
        if (v2.error) throw new Error(`TOTP verify failed: ${v2.error.message}`);
      }
      return (await sb.auth.getSession()).data.session!.access_token;
    }
  }
  for (const f of existing?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  if (existing?.totp.some((f) => f.status === "verified")) throw new Error("the staff seed user already has a verified TOTP factor from an earlier run — reset the local database (CI starts fresh)");
  const enrolled = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `e2e-${Date.now()}` });
  if (enrolled.error) throw new Error(`TOTP enrol failed: ${enrolled.error.message}`);
  const secret = enrolled.data.totp.secret;
  const v = await sb.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: authenticator.generate(secret) });
  if (v.error) throw new Error(`TOTP verify failed: ${v.error.message}`);
  writeFileSync(totpCache(email), JSON.stringify({ factorId: enrolled.data.id, secret }));
  const { data } = await sb.auth.getSession();
  return data.session!.access_token;
}

/** The newest email to `to` in Mailpit, as text + html. */
export async function latestEmail(to: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (r.ok) {
      const list = (await r.json()) as { messages?: { ID: string }[] };
      if (list.messages?.length) {
        const m = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
        return { text: String(m.Text ?? ""), html: String(m.HTML ?? "") };
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no email for ${to}`);
}

export function confirmationLink(mail: { text: string; html: string }) {
  const href = /href="([^"]*verify[^"]*)"/.exec(mail.html)?.[1] ?? /(https?:\/\/\S*verify\S*)/.exec(mail.text)?.[1];
  expect(href, "confirmation link in the email").toBeTruthy();
  return href!.replace(/&amp;/g, "&");
}

export async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    last = await fn();
  }
  return last;
}
