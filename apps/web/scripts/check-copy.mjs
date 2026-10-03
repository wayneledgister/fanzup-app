// Brand §7.4 / PRD 01 §11 copy guard. Fails on banned investment language in src/.
// Allowed exceptions: this list's own file, and compliance.tsx (which states the negatives).
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "src");
const BANNED = [
  [/\byield(s|ed)?\b/i, "yield"],
  [/\bAPY\b/, "APY"],
  [/\bROI\b/, "ROI"],
  [/\bstak(e|es|ed|ing|ers?)\b/i, "stake/staking"],
  [/guarantee(d)?\s+(return|payout|profit|income)/i, "guaranteed returns"],
  [/\bearn(s|ing)?\s+(returns?|profits?|income)\b/i, "earn returns"],
  [/\b(safe|risk-free)\s+investment\b/i, "safe investment"],
  [/\b(tradeable|tradable|liquidity)\b/i, "liquidity/tradeable"],
  [/\bon-chain\b|\bmultisig\b|\bUSDC\b|\bETH\b|\b0x[0-9a-f]{2,}/i, "crypto"],
  [/\bSEC[- ](compliant|approved|registered)\b/i, "SEC-approved claim"],
  [/\bFanzup\b|\bFan Zup\b/, "brand casing (use FanZuP)"],
  [/text-white[^"']*bg-gold|bg-gold[^"']*text-white/, "white text on gold"],
];
const ALLOW = new Set(["components/brand/compliance.tsx", "components/brand/Logo.tsx"]);
let bad = 0;
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== "ui") walk(p); continue; }
    if (!/\.(tsx?|css)$/.test(f)) continue;
    const rel = path.relative(root, p);
    if (ALLOW.has(rel)) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const [re, name] of BANNED) if (re.test(line)) { bad++; console.log(`${rel}:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
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
const L2_BANNED = [...BANNED, [/\bguarantee(d|s)?\b(?!d? returns)/i, "guarantee (Layer 2: payouts are potential)"], [/\bwill (receive|earn|get) (a )?(payout|return|distribution)/i, "promised payout"]];
for (const file of L2_FILES) {
  if (!fs.existsSync(file)) continue;
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const text = (line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []).join(" ");
    for (const [re, name] of L2_BANNED) if (re.test(text)) { bad++; console.log(`api/src/${path.relative(path.resolve(root, "..", "..", "api", "src"), file)}:${i + 1}  [${name}]  ${line.trim().slice(0, 110)}`); }
  });
}

if (bad) { console.error(`\n${bad} copy violation(s).`); process.exit(1); }
console.log("copy check: clean");
