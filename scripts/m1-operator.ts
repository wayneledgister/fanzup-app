/**
 * M1 operator script (T-024; design §12.6; exit test 8). M1 has no staff or artist UI, so this drives the non-fan
 * half of the journey against any FanZuP API: TOTP enrolment, an aal2 staff session, artist setup, publishing,
 * milestone evidence and the staff actions.
 *
 *   pnpm m1:operator --api https://<site>/api --supabase-url https://<ref>.supabase.co --anon-key <publishable key> \
 *     --email you@example.com [command …]
 *
 * With a command it runs that one command; without one it opens a prompt (`help` lists commands) and keeps the
 * session for the whole run. The email comes from a flag; the password and TOTP codes are always asked for at a
 * prompt (hidden on a terminal; read line by line from stdin otherwise), so nothing secret lands in the repo or in
 * shell history. Tokens live in this process's memory only — never written to disk, never printed or logged.
 * `--supabase-url`/`--anon-key` (public values) may also come from SUPABASE_URL / SUPABASE_ANON_KEY, and `--api`
 * from FANZUP_API.
 */
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Arguments ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, inline] = a.slice(2).split("=", 2);
    flags[k] = inline ?? argv[++i] ?? "";
  } else positional.push(a);
}
const API = (flags.api ?? process.env.FANZUP_API ?? "http://localhost:8787/api").replace(/\/$/, "");
const SUPABASE_URL = flags["supabase-url"] ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY = flags["anon-key"] ?? process.env.SUPABASE_ANON_KEY ?? "";
const EMAIL = flags.email ?? "";

const HELP = `Commands (design §12.6):
  totp-enrol                          add an authenticator app: prints the otpauth URI and secret, then verifies one code
  token                               sign in with password + current TOTP code → aal2 session (memory only)
  artist-setup                        artist profile → payout account (re-checks until verified) → campaign, perk,
                                      tranches → submit for review. Flags: --artist-slug --artist-name --slug --title
                                      --type --goal-minor --duration-days --perk-title --perk-price-minor --fulfill-by
  campaign <campaignId>               show one of your campaigns with its milestone (tranche) ids (artist)
  publish <campaignId>                publish an approved campaign (artist)
  evidence <trancheId> <https-link>   submit milestone evidence (artist; asks for notes)
  staff queue <type>                  review|verification|refunds|payouts|unmatched|dead_letters|breaks|failed_events|scheduled
  staff review <campaignId> [approved|revisions_requested]
  staff verify <trancheId>
  staff refund <backingId>
  staff recon run|latest
  staff trace <correlationId>
  help · exit
Every staff action asks for a typed reason (≥ 10 characters) and prints the correlation id to trace it.`;

// ── Prompts (one readline for commands and prompts; hidden input on a TTY) ──
const tty = !!process.stdin.isTTY;
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
const pending: string[] = [];
const waiters: ((line: string | null) => void)[] = [];
let closed = false;
let muted = false;
rl.on("line", (line) => (waiters.length ? waiters.shift()!(line) : pending.push(line)));
rl.on("close", () => {
  closed = true;
  while (waiters.length) waiters.shift()!(null);
});
if (tty) {
  // Hide what's typed at a secret prompt (the prompt text itself is written before muting).
  const out = rl as unknown as { _writeToOutput?: (s: string) => void };
  const write = out._writeToOutput?.bind(rl);
  out._writeToOutput = (s: string) => {
    if (!muted || s.includes("\n")) write?.(s);
  };
}
async function ask(question: string, secret = false): Promise<string> {
  process.stdout.write(question);
  muted = secret && tty;
  const line = pending.length ? pending.shift()! : closed ? null : await new Promise<string | null>((r) => waiters.push(r));
  muted = false;
  if (secret && tty) process.stdout.write("\n");
  if (line === null) throw new Error("input closed");
  return line.trim();
}

// ── Session (memory only) ───────────────────────────────────────────────
let sb: SupabaseClient | null = null;
let accessToken: string | null = null;
let aal: "aal1" | "aal2" | null = null;

function client(): SupabaseClient {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error("Set --supabase-url and --anon-key (or SUPABASE_URL / SUPABASE_ANON_KEY): the Supabase project URL and publishable key.");
  sb ??= createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
  return sb;
}

async function signIn() {
  if (!EMAIL) throw new Error("Pass --email <your account email>.");
  const c = client();
  const password = await ask(`Password for ${EMAIL}: `, true);
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password });
  if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message ?? "no session"}`);
  accessToken = data.session.access_token;
  aal = "aal1";
}

async function session(): Promise<string> {
  if (!accessToken) await signIn();
  const { data } = await client().auth.getSession();
  accessToken = data.session?.access_token ?? accessToken;
  return accessToken!;
}

async function stepUp() {
  const c = client();
  await session();
  const { data: factors, error } = await c.auth.mfa.listFactors();
  if (error) throw new Error(`Couldn't list your second factors: ${error.message}`);
  const totp = factors.totp.find((f) => f.status === "verified");
  if (!totp) throw new Error("No verified authenticator on this account yet. Run `totp-enrol` first.");
  const code = await ask("Current 6-digit code from your authenticator app: ", true);
  const v = await c.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (v.error) throw new Error(`That code didn't work: ${v.error.message}`);
  accessToken = (await c.auth.getSession()).data.session?.access_token ?? null;
  aal = "aal2";
  console.log("Signed in at aal2 (staff). The token stays in this process's memory only.");
}

async function staffSession() {
  if (aal !== "aal2") await stepUp();
  return session();
}

// ── API ─────────────────────────────────────────────────────────────────
async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { ...(opts.body === undefined ? {} : { "content-type": "application/json" }), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  const correlationId = res.headers.get("x-correlation-id");
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${body?.error ?? ""}: ${body?.message ?? text} (correlation id ${body?.correlationId ?? correlationId})`);
  return { body, correlationId };
}
const show = (label: string, r: { body: unknown; correlationId: string | null }) => {
  console.log(`${label} (correlation id ${r.correlationId}):`);
  console.log(JSON.stringify(r.body, null, 2));
};
async function reason(): Promise<string> {
  for (;;) {
    const r = await ask("Reason (at least 10 characters; it goes in the audit log and your weekly review): ");
    if (r.length >= 10) return r;
    console.log("Too short.");
  }
}
const need = (v: string | undefined, what: string) => {
  if (!v) throw new Error(`Missing ${what}. Type \`help\` for usage.`);
  return v;
};

// ── Commands ────────────────────────────────────────────────────────────
async function totpEnrol() {
  const c = client();
  await session();
  const { data: factors } = await c.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status !== "verified") await c.auth.mfa.unenroll({ factorId: f.id });
  if (factors?.totp.some((f) => f.status === "verified")) {
    console.log("This account already has a verified authenticator. Use `token` to sign in with it.");
    return;
  }
  const e = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: `FanZuP M1 operator ${new Date().toISOString().slice(0, 10)}` });
  if (e.error) throw new Error(`Enrolment failed: ${e.error.message}`);
  console.log("Add this to your authenticator app (scan the URI as a QR code, or type the secret):");
  console.log(`  otpauth URI: ${e.data.totp.uri}`);
  console.log(`  secret:      ${e.data.totp.secret}`);
  const code = await ask("Enter the 6-digit code your app now shows: ", true);
  const v = await c.auth.mfa.challengeAndVerify({ factorId: e.data.id, code });
  if (v.error) throw new Error(`That code didn't work (${v.error.message}). Run totp-enrol again.`);
  accessToken = (await c.auth.getSession()).data.session?.access_token ?? null;
  aal = "aal2";
  console.log("Authenticator verified; this session is now aal2.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function artistSetup() {
  const token = await session();
  let artist = await call("GET", "/artist", { token }).catch(() => null);
  if (!artist) {
    const slug = flags["artist-slug"] || (await ask("Artist URL name (lower-case, dashes): "));
    const name = flags["artist-name"] || (await ask("Artist name: "));
    show("Artist created", await call("POST", "/artist", { token, body: { slug, name } }));
    artist = await call("GET", "/artist", { token });
  }
  // Payout account: Stripe Connect Express onboarding in test mode (the sandbox is ready at once). Re-check until verified.
  for (let i = 0; ; i++) {
    const p = await call("POST", "/artist/payout-account", { token });
    if (p.body.status === "verified") {
      console.log("Payout account verified.");
      break;
    }
    if (i === 0) console.log(`Finish payout onboarding here, then come back:\n  ${p.body.onboardingUrl}`);
    if (tty) await ask("Press Enter once onboarding is finished (we'll re-check)… ");
    else await sleep(15_000);
  }
  const slug = flags.slug || (await ask("Campaign URL name (lower-case, dashes): "));
  const title = flags.title || (await ask("Campaign title: "));
  const campaign = await call("POST", "/artist/campaigns", {
    token,
    body: {
      slug, title, type: flags.type || "Show", story: flags.story || null,
      goalMinor: Number(flags["goal-minor"] || 50_000), durationDays: Number(flags["duration-days"] || 7), milestoneRelease: true,
    },
  });
  const id = campaign.body.id as string;
  show("Campaign created", campaign);
  const fulfillBy = flags["fulfill-by"] || new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  await call("PUT", `/artist/campaigns/${id}/perks`, {
    token, body: [{ title: flags["perk-title"] || "Digital thank-you", kind: "digital", priceMinor: Number(flags["perk-price-minor"] || 1_000), fulfillBy }],
  });
  await call("PUT", `/artist/campaigns/${id}/tranches`, {
    token, body: [{ seq: 1, pct: 50 }, { seq: 2, pct: 50, milestone: "Show played", evidenceRequired: "Venue settlement sheet", targetDate: fulfillBy }],
  });
  show("Submitted for review", await call("POST", `/artist/campaigns/${id}/submit`, { token }));
  console.log(`Next: as staff, \`staff review ${id}\`; then as this artist, \`publish ${id}\`.`);
}

async function staff(sub: string | undefined, args: string[]) {
  const token = await staffSession();
  switch (sub) {
    case "queue":
      return show(`Queue ${args[0] ?? "review"}`, await call("GET", `/staff/queue?type=${encodeURIComponent(args[0] ?? "review")}`, { token }));
    case "review": {
      const id = need(args[0], "campaign id");
      const decision = args[1] ?? "approved";
      return show("Review", await call("POST", `/staff/campaigns/${id}/review`, { token, body: { decision, reason: await reason() } }));
    }
    case "verify":
      return show("Verification", await call("POST", `/staff/tranches/${need(args[0], "tranche id")}/verify`, { token, body: { reason: await reason() } }));
    case "refund":
      return show("Refund", await call("POST", `/staff/backings/${need(args[0], "backing id")}/refund`, { token, body: { reason: await reason() } }));
    case "recon":
      if (args[0] === "run") return show("Reconciliation run", await call("POST", "/staff/recon/run", { token }));
      return show("Latest reconciliation", await call("GET", "/staff/recon/latest", { token }));
    case "trace":
      return show("Trace", await call("GET", `/staff/trace/${encodeURIComponent(need(args[0], "correlation id"))}`, { token }));
    default:
      throw new Error("Unknown staff command. Type `help`.");
  }
}

async function run(words: string[]) {
  const [cmd, ...rest] = words;
  switch (cmd) {
    case undefined:
    case "":
      return;
    case "help":
      return console.log(HELP);
    case "totp-enrol":
      return totpEnrol();
    case "token":
      accessToken = null;
      aal = null;
      await signIn();
      return stepUp();
    case "artist-setup":
      return artistSetup();
    case "campaign":
      return show("Campaign", await call("GET", `/artist/campaigns/${need(rest[0], "campaign id")}`, { token: await session() }));
    case "publish":
      return show("Published", await call("POST", `/artist/campaigns/${need(rest[0], "campaign id")}/publish`, { token: await session() }));
    case "evidence": {
      const notes = await ask("Evidence notes (at least 10 characters): ");
      const links = rest.slice(1);
      return show("Evidence submitted", await call("POST", `/artist/tranches/${need(rest[0], "tranche id")}/evidence`, { token: await session(), body: { notes, links } }));
    }
    case "staff":
      return staff(rest[0], rest.slice(1));
    default:
      throw new Error(`Unknown command "${cmd}". Type \`help\`.`);
  }
}

async function main() {
  console.log(`FanZuP M1 operator · API ${API}${EMAIL ? ` · ${EMAIL}` : ""}`);
  if (positional.length) {
    await run(positional);
    return;
  }
  console.log("Type `help` for commands, `exit` to quit.");
  for (;;) {
    let line: string;
    try {
      line = await ask("operator> ");
    } catch {
      return; // stdin closed
    }
    if (line === "exit" || line === "quit") return;
    try {
      await run(line.split(/\s+/).filter(Boolean));
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => {
    rl.close();
    process.exit(0);
  })
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    rl.close();
    process.exit(1);
  });
