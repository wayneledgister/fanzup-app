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
if (bad) { console.error(`\n${bad} copy violation(s).`); process.exit(1); }
console.log("copy check: clean");
