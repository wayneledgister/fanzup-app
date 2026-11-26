/**
 * CI smoke for the M1 operator script (T-024): drives `pnpm m1:operator` the way a person would — through its
 * prompts, on stdin — against the local stack with the seed reviewer (local/CI only; never a hosted project):
 * `totp-enrol` → one staff read → `token` (fresh password + TOTP sign-in) → another staff read → `exit`.
 * Answers come from the seed file (dev password) and from the secret the script prints at enrolment.
 *
 *   FANZUP_API=http://localhost:4173/api SUPABASE_URL=… SUPABASE_ANON_KEY=… pnpm exec tsx e2e/operator-smoke.ts
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authenticator } from "otplib";

const ROOT = join(__dirname, "..");
const seedCredential = /Password for all users: (\S+)/.exec(readFileSync(join(ROOT, "supabase", "seed.sql"), "utf8"))?.[1]; // ggignore
if (!seedCredential) throw new Error("seed.sql header no longer names the dev password");

const child = spawn("pnpm", ["--silent", "m1:operator", "--email", "reviewer@fanzup.test"], { cwd: ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
let out = "";
let answered = 0; // prompts answered so far, by position in `out`
let secret: string | null = null;
let lastCodeWindow = -1;
const send = (line: string) => child.stdin.write(`${line}\n`);

/** A TOTP code from a 30-second window not used before (Auth may refuse a code it has already accepted). */
async function freshCode() {
  for (;;) {
    const w = Math.floor(Date.now() / 30_000);
    if (w !== lastCodeWindow) {
      lastCodeWindow = w;
      return authenticator.generate(secret!);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const script = ["totp-enrol", "staff queue review", "token", "staff recon latest", "exit"];
let step = 0;
let busy = false;

async function react() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const rest = out.slice(answered);
      const m = /(Password for [^:]+: |Enter the 6-digit code your app now shows: |Current 6-digit code from your authenticator app: |operator> )/.exec(rest);
      if (!m) return;
      answered += m.index + m[0].length;
      if (m[0].startsWith("Password")) send(seedCredential!);
      else if (m[0].startsWith("Enter the 6-digit")) {
        secret = /secret:\s+(\S+)/.exec(out)?.[1] ?? null;
        if (!secret) throw new Error("the script didn't print the TOTP secret");
        send(await freshCode());
      } else if (m[0].startsWith("Current 6-digit")) send(await freshCode());
      else send(script[step++] ?? "exit");
    }
  } finally {
    busy = false;
  }
}

child.stdout.on("data", (d: Buffer) => {
  out += d.toString();
  void react().catch((e) => {
    console.error(e);
    child.kill();
  });
});
let err = "";
child.stderr.on("data", (d: Buffer) => {
  err += d.toString();
  process.stderr.write(d);
});

const timer = setTimeout(() => {
  console.error("operator smoke timed out\n", out);
  child.kill();
  process.exit(1);
}, 150_000);

child.on("exit", (code) => {
  clearTimeout(timer);
  // Never echo secrets: print the transcript with the TOTP secret/URI masked.
  console.log(out.replace(/(secret:\s+)\S+/g, "$1<hidden>").replace(/otpauth:\/\/\S+/g, "otpauth://<hidden>"));
  const checks: [string, boolean][] = [
    ["exit code 0", code === 0],
    ["no errors", !/^Error:/m.test(out + err)],
    ["enrolment verified (aal2)", out.includes("Authenticator verified; this session is now aal2.")],
    ["staff queue read", /Queue review \(correlation id [0-9a-f-]{36}\)/.test(out) && out.includes("singleOperatorMode")],
    ["token: password + TOTP sign-in", out.includes("Signed in at aal2 (staff).")],
    ["staff recon read after token", /Latest reconciliation \(correlation id [0-9a-f-]{36}\)/.test(out)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
});
