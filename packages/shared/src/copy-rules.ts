/**
 * Banned copy (Brand §7.4 / PRD 01 §11), the same list `pnpm lint:copy` enforces on source files
 * (`apps/web/scripts/copy-rules.mjs`). Kept here so the API's agents check campaign text against it.
 * `packages/shared/test/agents.test.ts` fails if the two lists drift.
 */
export const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
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
