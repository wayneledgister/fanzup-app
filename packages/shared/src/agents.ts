/**
 * Agent layer, Phase 0 (CR-003): deterministic checks the agents always ship, with or without a model.
 * Pure functions, no I/O. Requirements: specs/agents/01-requirements.md FR-AGT-A1-002, FR-AGT-A8-001.
 */
import { BANNED } from "./copy-rules";
import { POLICY } from "./policy";

export type FindingSeverity = "info" | "check" | "concern";
export interface Finding {
  code:
    | "banned_language" | "investment_language" | "urgency_claim" | "escrow_wording" | "goal_headroom" | "backers_needed"
    | "physical_perk" | "perk_fulfill_date" | "tranche_evidence_missing" | "tranche_date";
  severity: FindingSeverity;
  /** Where it was found, e.g. "story", "perk:<id>.description", "tranche:2". */
  field: string;
  /** The exact text it rests on (trimmed to 160 characters), when there is one. */
  quote?: string;
  detail: string;
  /** The rule it comes from. */
  requirement: string;
}

export interface ReviewCampaign {
  title: string;
  blurb: string | null;
  story: string | null;
  risks: string | null;
  goal_minor: number;
  duration_days: number;
  milestone_release: boolean;
  cap_minor_at_submission: number | null;
}
export interface ReviewPerk {
  id: string;
  title: string;
  description: string | null;
  kind: "digital" | "physical" | "experience";
  price_minor: number;
  fulfill_by: string | null;
}
export interface ReviewTranche {
  seq: number;
  pct: number;
  milestone: string | null;
  evidence_required: string | null;
  target_date: string | null;
}

/** Layer 1 never says invest / returns / ownership (v2 brief, Brand §7.4). */
const INVESTMENT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\binvest(s|ed|ing|ment|ments|or|ors)?\b/i, "invest"],
  [/\breturns?\b(?!\s+(policy|window|label|shipping))/i, "returns"],
  [/\bprofits?\b/i, "profit"],
  [/\bequity\b/i, "equity"],
  [/\bshares?\s+(in|of)\b/i, "shares"],
  [/\bownership\b|\bown\s+a\s+(piece|part|share)\b/i, "ownership"],
  [/\bdividends?\b/i, "dividend"],
];
/** Claims a person must check against reality (NFR-COMP-23: no invented scarcity or countdowns). */
const URGENCY: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bonly\s+\d+\s+(left|remaining)\b/i, "only N left"],
  [/\blast\s+chance\b/i, "last chance"],
  [/\bhurry\b/i, "hurry"],
  [/\bselling\s+(out\s+)?fast\b/i, "selling fast"],
  [/\bact\s+now\b/i, "act now"],
  [/\blimited[- ]time\b/i, "limited time"],
  [/\bbefore\s+it'?s\s+(too\s+late|gone)\b/i, "before it's gone"],
];

const quoteAround = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - 50);
  const out = text.slice(start, Math.min(text.length, index + length + 50)).replace(/\s+/g, " ").trim();
  return out.length > 160 ? out.slice(0, 157) + "..." : out;
};

function scan(text: string | null, field: string, rules: ReadonlyArray<readonly [RegExp, string]>): { label: string; quote: string }[] {
  if (!text) return [];
  const hits: { label: string; quote: string }[] = [];
  for (const [re, label] of rules) {
    const m = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g").exec(text);
    if (m) hits.push({ label, quote: quoteAround(text, m.index, m[0].length) });
  }
  return hits;
}

/** Every user-written field of a campaign, labelled. */
export function campaignTexts(c: ReviewCampaign, perks: ReviewPerk[], tranches: ReviewTranche[]): [string, string | null][] {
  return [
    ["title", c.title], ["blurb", c.blurb], ["story", c.story], ["risks", c.risks],
    ...perks.flatMap((p): [string, string | null][] => [[`perk:${p.id}.title`, p.title], [`perk:${p.id}.description`, p.description]]),
    ...tranches.flatMap((t): [string, string | null][] => [[`tranche:${t.seq}.milestone`, t.milestone], [`tranche:${t.seq}.evidence_required`, t.evidence_required]]),
  ];
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * FR-AGT-A1-002. `now` is the review time; the latest the campaign could end is `now + duration_days`
 * (it can't go live before approval).
 */
export function reviewChecks(c: ReviewCampaign, perks: ReviewPerk[], tranches: ReviewTranche[], now: Date): Finding[] {
  const out: Finding[] = [];
  for (const [field, text] of campaignTexts(c, perks, tranches)) {
    for (const h of scan(text, field, BANNED))
      out.push({ code: "banned_language", severity: "concern", field, quote: h.quote, detail: `Banned wording: ${h.label}.`, requirement: "Brand §7.4; lint:copy" });
    for (const h of scan(text, field, INVESTMENT))
      out.push({ code: "investment_language", severity: "concern", field, quote: h.quote, detail: `Layer 1 copy can't use "${h.label}" language; a reward campaign offers perks, not a financial return.`, requirement: "v2 brief (Layer 1 copy); Brand §7.4" });
    for (const h of scan(text, field, URGENCY))
      out.push({ code: "urgency_claim", severity: "check", field, quote: h.quote, detail: `Urgency or scarcity claim ("${h.label}"): check it is true and not invented.`, requirement: "NFR-COMP-23" });
    for (const h of scan(text, field, [[/\bescrow(ed)?\b/i, "escrow"]]))
      out.push({ code: "escrow_wording", severity: "concern", field, quote: h.quote, detail: `"Escrow" may be used only in counsel-approved wording.`, requirement: "FR-PAY-008" });
  }

  if (c.cap_minor_at_submission && c.goal_minor * 100 > c.cap_minor_at_submission * POLICY.agents.goalHeadroomPct) {
    const pct = Math.round((c.goal_minor / c.cap_minor_at_submission) * 100);
    out.push({ code: "goal_headroom", severity: "info", field: "goal_minor", detail: `Goal is ${pct}% of the artist's tier cap.`, requirement: "PRD 01 §6.3 (tier caps)" });
  }
  if (perks.length > 0) {
    const prices = perks.map((p) => p.price_minor).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
    const backers = Math.ceil(c.goal_minor / median);
    out.push({ code: "backers_needed", severity: "info", field: "goal_minor", detail: `About ${backers} backers at the median perk price (${(median / 100).toFixed(2)}) reach the goal.`, requirement: "Reviewer checklist" });
  }

  const latestEnd = addDays(now, c.duration_days);
  for (const p of perks) {
    if (p.kind === "physical")
      out.push({ code: "physical_perk", severity: "info", field: `perk:${p.id}`, detail: `"${p.title}" ships a physical item: addresses are collected after funding and protected (NFR-SEC-08); late delivery offers a refund (FR-FUL-003).`, requirement: "NFR-SEC-08, FR-FUL-003" });
    if (!p.fulfill_by)
      out.push({ code: "perk_fulfill_date", severity: "concern", field: `perk:${p.id}.fulfill_by`, detail: `"${p.title}" has no delivery date.`, requirement: "FR-FUL-003" });
    else if (p.fulfill_by < isoDay(latestEnd))
      out.push({ code: "perk_fulfill_date", severity: "concern", field: `perk:${p.id}.fulfill_by`, quote: p.fulfill_by, detail: `"${p.title}" is promised by ${p.fulfill_by}, before the campaign could end (${isoDay(latestEnd)} at the latest).`, requirement: "FR-FUL-003" });
  }

  if (c.milestone_release) {
    const sorted = [...tranches].sort((a, b) => a.seq - b.seq);
    let prev: string | null = null;
    for (const t of sorted) {
      if (t.seq > 1 && !t.evidence_required?.trim())
        out.push({ code: "tranche_evidence_missing", severity: "concern", field: `tranche:${t.seq}`, detail: `Milestone ${t.seq} doesn't say what evidence unlocks it.`, requirement: "FR-PAY-005" });
      if (t.target_date) {
        if (t.target_date < isoDay(latestEnd))
          out.push({ code: "tranche_date", severity: "concern", field: `tranche:${t.seq}.target_date`, quote: t.target_date, detail: `Milestone ${t.seq} is due ${t.target_date}, before the campaign could end.`, requirement: "FR-PAY-005" });
        if (prev && t.target_date < prev)
          out.push({ code: "tranche_date", severity: "concern", field: `tranche:${t.seq}.target_date`, quote: t.target_date, detail: `Milestone ${t.seq} is due before milestone ${t.seq - 1}.`, requirement: "FR-PAY-005" });
        prev = t.target_date;
      } else if (t.seq > 1) {
        out.push({ code: "tranche_date", severity: "check", field: `tranche:${t.seq}.target_date`, detail: `Milestone ${t.seq} has no target date.`, requirement: "FR-PAY-005" });
      }
    }
  }
  return out;
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStartUtc(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)));
}
/** The last week that has fully ended before `now` (Monday, UTC). */
export function lastCompletedWeek(now: Date): string {
  return isoDay(addDays(new Date(weekStartUtc(now) + "T00:00:00Z"), -7));
}

export interface WeeklyAction {
  id: string;
  action: string;
  status: string;
  amount_minor: number | null;
  created_at: string; // ISO
  execute_after: string | null;
  has_error: boolean;
}
export interface WeeklyPack {
  weekStart: string;
  totalActions: number;
  byAction: { action: string; status: string; count: number }[];
  delayed: string[];
  cancelled: string[];
  failed: string[];
  refundsByDay: { day: string; totalMinor: number; limitMinor: number; overLimit: boolean }[];
  verificationsByDay: { day: string; count: number; limit: number; overLimit: boolean }[];
  signedOff: boolean;
}

/** FR-AGT-A8-001: the deterministic weekly pack. */
export function weeklyPack(weekStart: string, actions: WeeklyAction[], signedOff: boolean): WeeklyPack {
  const counts = new Map<string, number>();
  for (const a of actions) counts.set(`${a.action}\u0000${a.status}`, (counts.get(`${a.action}\u0000${a.status}`) ?? 0) + 1);
  const byAction = [...counts].map(([k, count]) => { const [action, status] = k.split("\u0000"); return { action, status, count }; })
    .sort((a, b) => a.action.localeCompare(b.action) || a.status.localeCompare(b.status));
  const day = (iso: string) => iso.slice(0, 10);
  const refunds = new Map<string, number>();
  const verifications = new Map<string, number>();
  for (const a of actions) {
    if (a.status === "cancelled" || a.status === "failed") continue;
    if (a.action === "backing.refund") refunds.set(day(a.created_at), (refunds.get(day(a.created_at)) ?? 0) + (a.amount_minor ?? 0));
    if (a.action === "tranche.verify") verifications.set(day(a.created_at), (verifications.get(day(a.created_at)) ?? 0) + 1);
  }
  const L = POLICY.singleOperator.dailyLimits;
  return {
    weekStart,
    totalActions: actions.length,
    byAction,
    delayed: actions.filter((a) => a.execute_after && a.execute_after > a.created_at && new Date(a.execute_after).getTime() - new Date(a.created_at).getTime() > 60_000).map((a) => a.id),
    cancelled: actions.filter((a) => a.status === "cancelled").map((a) => a.id),
    failed: actions.filter((a) => a.status === "failed" || a.has_error).map((a) => a.id),
    refundsByDay: [...refunds].sort().map(([d, totalMinor]) => ({ day: d, totalMinor, limitMinor: L.refundsMinor, overLimit: totalMinor > L.refundsMinor })),
    verificationsByDay: [...verifications].sort().map(([d, count]) => ({ day: d, count, limit: L.verifications, overLimit: count > L.verifications })),
    signedOff,
  };
}
