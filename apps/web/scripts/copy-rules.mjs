// Copy rules shared by check-copy.mjs (source files) and check-l2-render.ts (rendered Layer 2 notices + mock Form C).
// Brand §7.4 / PRD 01 §11; D-4 and L2-T-025 for the intermediary rules.
export const BANNED = [
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
// D-4 / L2-T-025: no SEC-registered intermediary is engaged (L2-Q3), so no screen may say or imply one exists.
// Applies to every file, compliance.tsx included (the disclosure blocks are where this wording used to live).
export const INTERMEDIARY = [
  [/\bour\s+(FINRA[- ])?registered\s+intermediary\b/i, "claims an intermediary (L2-Q3 pending)"],
  [/\bFINRA[- ]registered\s+intermediary\b/i, "claims an intermediary (L2-Q3 pending)"],
  [/\bthe\s+intermediary['’]s\b/i, "implies an intermediary exists (L2-Q3 pending)"],
  [/\b(registered\s+)?funding[- ]portal\s+partner\b/i, "implies a funding portal partner (L2-Q3 pending)"],
  [/\bthrough\s+(our|the)\s+(FINRA[- ]|SEC[- ])?registered\s+(intermediary|funding portal)\b/i, "says an offering runs through an intermediary (L2-Q3 pending)"],
];
export const L2_BANNED = [...BANNED, ...INTERMEDIARY, [/\bguarantee(d|s)?\b(?!d? returns)/i, "guarantee (Layer 2: payouts are potential)"], [/\bwill (receive|earn|get) (a )?(payout|return|distribution)/i, "promised payout"]];
