/**
 * L2-T-016 (PR #10 review round 5, finding 6; D-2, D-4): render EVERY Layer 2 notice template (`L2_TEMPLATES` via
 * `renderL2`, apps/api/src/l2/notices.ts) in each of its variants, and the mock Form C (`buildFormC`,
 * apps/api/src/l2/formc.ts), then fail unless each one carries the D-2 sentence verbatim — "Demo — not an offer of
 * securities. Mock escrow and data." — and passes the Layer 2 copy rules (copy-rules.mjs). The Form C must also show
 * the intermediary as pending (L2-T-025). A self-test first proves the checker rejects a text without the D-2 line.
 * Run by `pnpm --filter @fanzup/web lint:copy` after check-copy.mjs.
 */
import { L2_DEMO_LINE, L2_TEMPLATES, renderL2, type L2TemplateId } from "../../api/src/l2/notices";
import { buildFormC, L2_INTERMEDIARY_LINE } from "../../api/src/l2/formc";
import { L2_BANNED } from "./copy-rules.mjs";

const D2 = "Demo — not an offer of securities. Mock escrow and data.";
type Vars = Record<string, string | number | boolean | null | undefined>;

const base: Vars = {
  pool: "Night Bloom", amount: "$500.00", units: 10, price: "$50.00", issuer: "Nova Reyes Music LLC (demo issuer)", cancelBy: "2027-01-28 17:00 UTC",
  refund: "$500.00", days: 5, date: "2027-01-30T17:00:00Z", unitsSold: 200, offeringPrice: "$50.00", capMultiple: 1.5, maturesAt: "2032-01-30T17:00:00Z",
  platformPct: 5, ref: "rfd_123", label: "Period 1", status: "approved", state: "COLLECTING", reason: "reservation_expired", nothingCharged: false,
};

/** Every branch a template has (status, flags, reasons, states), so a branch that drops the footer is caught. */
const VARIANTS: Partial<Record<L2TemplateId, Vars[]>> = {
  l2_kyc_result: ["approved", "manual_review", "rejected"].map((status) => ({ status })),
  l2_cancel_pending: [{ status: "funding" }, { status: "reserved" }],
  l2_investment_cancelled: [{ nothingCharged: true }, { nothingCharged: false }],
  l2_payment_refunded_unapplied: ["reservation_expired", "reservation_cancelled", "offering_closed", "amount_mismatch", "unknown_reason"].map((reason) => ({ reason })),
  l2_collection_state: ["COLLECTING", "AT_RISK", "DEFAULT", "REMEDIATION", "CHARGED_OFF"].map((state) => ({ state })),
};

const problems: string[] = [];

function check(name: string, text: string, opts: { needs?: string[] } = {}) {
  const found: string[] = [];
  if (!text.includes(D2)) found.push("missing the D-2 sentence");
  for (const n of opts.needs ?? []) if (!text.includes(n)) found.push(`missing "${n}"`);
  for (const [re, label] of L2_BANNED as [RegExp, string][]) if (re.test(text)) found.push(`[${label}]`);
  if (/\bundefined\b|\[object Object\]/.test(text)) found.push("unfilled variable");
  return found.map((f) => `${name}: ${f}`);
}

// Self-test: the checker must reject a text without the D-2 line (the rule this script exists for).
if (L2_DEMO_LINE !== D2) problems.push(`notices.ts L2_DEMO_LINE is not the D-2 sentence: ${JSON.stringify(L2_DEMO_LINE)}`);
if (check("self-test", "Your refund has started.").length === 0) problems.push("self-test: a text without the D-2 sentence passed");

let rendered = 0;
for (const t of Object.keys(L2_TEMPLATES) as L2TemplateId[]) {
  for (const v of VARIANTS[t] ?? [{}]) {
    const r = renderL2(t, { ...base, ...v });
    if (!r) {
      problems.push(`${t}: renderL2 returned nothing`);
      continue;
    }
    rendered++;
    problems.push(...check(`${t}${VARIANTS[t] ? ` ${JSON.stringify(v)}` : ""}`, `${r.subject}\n${r.text}`));
  }
}

const formC = buildFormC({
  poolId: "00000000-0000-4000-8000-000000000001", title: "Night Bloom", artistDisplay: "Nova Reyes", artistName: "Nova Reyes", tier: "Rising", releaseDate: "2027-03-01",
  tracklist: ["Opening", "Closing"], story: "An album.", risks: "The release could slip.", useOfFunds: [{ label: "Studio", amountMinor: 500_000 }],
  revenueTypes: ["master", "sync"], fansBps: 3000, creatorBps: 6500, platformBps: 500, unitsTotal: 200, unitPriceMinor: 5000, minUnits: 1, targetMinor: 500_000,
  durationDays: 21, returnCapBps: 15_000, maturityMonths: 60, collectionMechanism: "DISTRIBUTOR_REDIRECT",
  tranches: [{ seq: 1, pct: 50, milestone: null, targetDate: null }, { seq: 2, pct: 50, milestone: "Album mastered", targetDate: "2027-02-01" }],
});
const formCText = JSON.stringify(formC.body);
problems.push(...check("mock Form C", formCText, { needs: [L2_INTERMEDIARY_LINE, "Intermediary: pending — L2-Q3"] }));
if (!String((formC.body as { notice?: string }).notice ?? "").startsWith(D2)) problems.push("mock Form C: the notice doesn't open with the D-2 sentence");

if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  console.error(`\n${problems.length} Layer 2 render violation(s).`);
  process.exit(1);
}
console.log(`L2 render check: clean (${rendered} notice renderings across ${Object.keys(L2_TEMPLATES).length} templates, mock Form C)`);
