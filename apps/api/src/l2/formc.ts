/**
 * Mock Form C (FR-L2-CR-005; L2-T-009). Generated deterministically from the Pool's own data, so the same Pool yields
 * the same SHA-256. It is a demo document: it is never filed and says so on its first line.
 * Copy is product guidance pending counsel review — not legal advice.
 */
import { createHash } from "node:crypto";
import { canonicalJson, REVENUE_TYPE_COPY, RISK_BADGE_COPY, riskBadge, type CollectionMechanism, type RevenueType } from "@fanzup/shared/l2";
import { POLICY } from "@fanzup/shared/policy";

export interface FormCInput {
  poolId: string;
  title: string;
  artistDisplay: string;
  artistName: string;
  tier: string;
  releaseDate: string | null;
  tracklist: string[];
  story: string | null;
  risks: string | null;
  useOfFunds: { label: string; amountMinor: number }[];
  revenueTypes: RevenueType[];
  fansBps: number;
  creatorBps: number;
  platformBps: number;
  unitsTotal: number;
  unitPriceMinor: number;
  minUnits: number;
  targetMinor: number;
  durationDays: number;
  returnCapBps: number;
  maturityMonths: number;
  collectionMechanism: CollectionMechanism;
  tranches: { seq: number; pct: number; milestone: string | null; targetDate: string | null }[];
}

const STANDARD_RISKS = [
  "You could lose all of the money you invest. Potential payouts depend entirely on royalties the album actually earns and that are actually collected.",
  "Your claim is an unsecured contractual right to a share of collected royalties. There is no collateral.",
  "Units can't be resold for 12 months, and there is no marketplace to sell them afterwards. Plan to hold them until the Pool ends.",
  "Total payouts are capped. The cap is a ceiling, not a forecast; total payouts may be lower than what you invested, or zero.",
  "The album may be delayed, change, or not be released. Streaming income for independent releases is uncertain and often small.",
  "If the artist changes distributors, stops reporting, or doesn't pay, collection may stop; the default process may not recover your money.",
  "Fees disclosed in this Form C reduce the royalties available to the Pool.",
];

export function buildFormC(p: FormCInput) {
  const badge = riskBadge(p.collectionMechanism, p.revenueTypes);
  const body = {
    notice: "DEMO — mock Form C generated from the Pool's data. Not filed with the SEC. Not an offer of securities.",
    form: "Form C (mock)",
    issuer: { name: `${p.artistName} (issuer entity pending — L2-Q2)`, creatorTier: p.tier },
    intermediary: "To be named (L2-Q3). FanZuP provides technology only.",
    offering: {
      securityType: "Revenue-share Units (contractual right to a share of collected royalties)",
      units: p.unitsTotal,
      unitPriceMinor: p.unitPriceMinor,
      minimumUnitsPerInvestor: p.minUnits,
      targetMinor: p.targetMinor,
      maximumMinor: p.unitsTotal * p.unitPriceMinor,
      deadlineDays: p.durationDays,
      targetOrRefund: "If the target isn't reached by the deadline, every investor is refunded in full.",
      cancellation: `Investors may cancel until ${POLICY.l2.cancelCutoffHours} hours before the deadline.`,
      resale: `Units can't be transferred for ${POLICY.l2.lockupMonths} months except to the issuer, an accredited investor, or a family member.`,
    },
    project: { album: p.title, artist: p.artistDisplay, plannedRelease: p.releaseDate, tracklist: p.tracklist, story: p.story ?? "" },
    useOfFunds: p.useOfFunds,
    milestones: p.tranches.map((t) => ({ seq: t.seq, pct: t.pct, milestone: t.seq === 1 ? "Released when the offering closes" : t.milestone, targetDate: t.targetDate })),
    revenueShare: {
      revenueTypes: p.revenueTypes.map((t) => ({ type: t, label: REVENUE_TYPE_COPY[t].label, note: REVENUE_TYPE_COPY[t].note ?? null })),
      split: { fansBps: p.fansBps, creatorBps: p.creatorBps, platformBps: p.platformBps, platformNote: "Platform share pending the fee schedule (L2-Q7)." },
      returnCapMultiple: p.returnCapBps / 10_000,
      maturityMonths: p.maturityMonths,
      distributions: "Quarterly, from collected royalties only, pro rata by Units.",
    },
    collection: { mechanism: p.collectionMechanism, badge, explanation: RISK_BADGE_COPY[badge].short },
    tax: { characterization: "Distributions reported as dividends on Form 1099-DIV (C-corp-taxed issuer default) — pending counsel (L2-Q6)." },
    riskFactors: [...STANDARD_RISKS, ...(p.risks ? [p.risks] : [])],
  };
  const sha256 = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return { body, sha256 };
}
