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

// The rendered Layer 2 notices and mock Form C are checked by scripts/check-l2-render.ts (run after this file by
// `lint:copy`): every one must carry the D-2 sentence and pass the rules above.
if (bad) { console.error(`\n${bad} copy violation(s).`); process.exit(1); }
console.log("copy check: clean");
