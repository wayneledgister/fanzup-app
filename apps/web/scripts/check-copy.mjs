// Brand §7.4 / PRD 01 §11 copy guard. Fails on banned investment language in src/.
// Allowed exceptions: this list's own file, and compliance.tsx (which states the negatives).
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "src");
import { BANNED, INTERMEDIARY, L2_BANNED } from "./copy-rules.mjs";
const ALLOW = new Set(["components/brand/compliance.tsx", "components/brand/Logo.tsx"]);
let bad = 0;
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "ui") walk(p); continue; }
    if (!/\.(tsx?|css)$/.test(f)) continue;
    const rel = path.relative(root, p);
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const rules = ALLOW.has(rel) ? INTERMEDIARY : [...BANNED, ...INTERMEDIARY];
      for (const [re, name] of rules) if (re.test(line)) { bad++; console.log(`${rel}:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
    });
  }
}
walk(root);

// Transactional email templates (apps/api/src/notify.ts) — FR-NTF-001, FR-PLT-006: Layer 1 never says invest,
// returns or ownership, and no message says "escrow" or names a custodian while none exists.
const TEMPLATE_FILE = path.resolve(root, "..", "..", "api", "src", "notify.ts");
const TEMPLATE_BANNED = [
  ...BANNED,
  [/\bescrow\b/i, "escrow (FR-PLT-006: no custodian yet)"],
  [/\binvest(ment|ing|or|s)?\b/i, "invest (Layer 1)"],
  [/\breturns?\b(?!\s*(policy|label))/i, "returns (Layer 1)"],
  [/\bownership\b/i, "ownership (Layer 1)"],
];
if (fs.existsSync(TEMPLATE_FILE)) {
  fs.readFileSync(TEMPLATE_FILE, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // Only user-facing text: string and template literals on the line.
    const text = (line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []).join(" ");
    for (const [re, name] of TEMPLATE_BANNED) if (re.test(text)) { bad++; console.log(`api/src/notify.ts:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
  });
}
// Layer 2 notices and the mock Form C (CR-002, D-4): Layer 2 wording is allowed ("invest", "Units"), the Brand §7.4
// banned list still applies, and payouts must never be promised.
const L2_FILES = ["l2/notices.ts", "l2/formc.ts"].map((f) => path.resolve(root, "..", "..", "api", "src", f));
// L2_BANNED: Brand §7.4 list + intermediary rules + no guarantees or promised payouts (copy-rules.mjs).
for (const file of L2_FILES) {
  if (!fs.existsSync(file)) continue;
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const text = (line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []).join(" ");
    for (const [re, name] of L2_BANNED) if (re.test(text)) { bad++; console.log(`api/src/${path.relative(path.resolve(root, "..", "..", "api", "src"), file)}:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
  });
}

// Mobile app (CR-004, NFR-MOB-03): Layer 1 only — no securities wording at all, no "escrow" while no custodian exists.
// Whole non-comment lines are checked (JSX text isn't quoted). Shared copy both clients render is checked too; it may
// state the negatives ("it is not an investment"), so only the Brand §7.4 list, intermediary and escrow rules apply.
const MOBILE_BANNED = [...BANNED, ...INTERMEDIARY, ...TEMPLATE_BANNED.slice(BANNED.length)];
const mobileRoot = path.resolve(root, "..", "..", "mobile");
function walkMobile(d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { walkMobile(p); continue; }
    if (!/\.tsx?$/.test(f)) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // Brand list on the whole line (as for web src); Layer 1 extras on user-facing text only: string literals and JSX text.
      const text = [...(line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []), ...[...line.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]), /^[^<>{}=;()]*$/.test(line) ? line : ""].join(" ");
      const hits = [...[...BANNED, ...INTERMEDIARY].filter(([re]) => re.test(line)), ...MOBILE_BANNED.slice(BANNED.length + INTERMEDIARY.length).filter(([re]) => re.test(text))];
      for (const [, name] of hits) { bad++; console.log(`mobile/${path.relative(mobileRoot, p)}:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
    });
  }
}
walkMobile(path.join(mobileRoot, "app"));
walkMobile(path.join(mobileRoot, "src"));
const SHARED_COPY = path.resolve(root, "..", "..", "..", "packages", "shared", "src", "backing-copy.ts");
if (fs.existsSync(SHARED_COPY)) {
  fs.readFileSync(SHARED_COPY, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const text = (line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []).join(" ");
    for (const [re, name] of [...BANNED, ...INTERMEDIARY, TEMPLATE_BANNED[BANNED.length]]) if (re.test(text)) { bad++; console.log(`shared/src/backing-copy.ts:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
  });
}

// The rendered Layer 2 notices and mock Form C are checked by scripts/check-l2-render.ts (run after this file by
// `lint:copy`): every one must carry the D-2 sentence and pass the rules above.
if (bad) { console.error(`\n${bad} copy violation(s).`); process.exit(1); }
console.log("copy check: clean");
