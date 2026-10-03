/**
 * Demo compliance-review data (campaign review + identity queues). Fictional.
 * Times are relative to "now" so SLA ages stay meaningful in the prototype.
 */
import { artistById, type Artist, type CreatorTier } from "@/lib/mock";
import { perksOnlyIssue, TIER_LIMIT_DOLLARS, type PerkKind, type ShipsTo } from "./draft";
import type { CampaignView } from "./CampaignFanView";

export const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
export const ageHours = (iso: string) => Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
export function formatAge(iso: string) {
  const h = ageHours(iso);
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
}
/** Stamp for audit logs: 2026-09-30 14:12:05 */
export function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type SlaState = "ok" | "risk" | "breach";
/** SLA target in hours (campaign review ≈ 2 business days). */
export function slaState(iso: string, targetH = 48): SlaState {
  const h = ageHours(iso);
  return h > targetH ? "breach" : h > targetH * 0.75 ? "risk" : "ok";
}

export type ReviewStatus = "under-review" | "revisions" | "approved";
export type CheckId = "language" | "goal" | "fulfillment" | "identity" | "tier" | "escrow";
export type Decision = "pass" | "flag" | null;

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface RevisionRequest {
  id: string;
  section: string;
  issue: string;
  change: string;
  priority: "high" | "medium" | "low";
}

export interface Submission {
  id: string;
  status: ReviewStatus;
  submittedAt: string;
  reviewer?: string;
  artist: Artist;
  identity: "verified" | "pending" | "failed";
  view: CampaignView;
  decisions: Record<CheckId, Decision>;
  notes: Partial<Record<CheckId, string>>;
  revisions: RevisionRequest[];
  approvedAt?: string;
  goLive?: string;
  audit: AuditEntry[];
}

type PerkSeed = [title: string, price: number, kind: PerkKind, fulfillBy: string, items: string[], limit?: number, shipsTo?: ShipsTo];
function view(o: {
  artistId: string; title: string; type: string; blurb: string; goal: number; days: number; deadlineInDays: number;
  funds: [string, number][]; perks: PerkSeed[]; milestones?: [number, string, string, string][]; story?: string; risks?: string;
}): CampaignView {
  const artist = artistById(o.artistId);
  const deadline = new Date(Date.now() + o.deadlineInDays * 86_400_000).toISOString();
  return {
    title: o.title,
    type: o.type,
    blurb: o.blurb,
    story:
      o.story ??
      `${artist.name} has spent the last two years building a following in ${artist.city.split(",")[0]}. This campaign pays for the people, rooms and gear it takes to do this properly — and every backer gets a perk they can hold, hear or attend.`,
    risks: o.risks ?? "Production schedules can slip. If a date moves, backers get an update within 7 days and can ask for a refund of any perk they can no longer use.",
    city: artist.city,
    artist,
    coverSeed: `${o.artistId}-${o.title}`,
    goalMinor: o.goal * 100,
    raisedMinor: 0,
    backers: 0,
    durationDays: o.days,
    deadline,
    useOfFunds: o.funds.map(([label, a]) => ({ label, amountMinor: a * 100 })),
    release: o.milestones
      ? { kind: "milestones", tranches: o.milestones.map(([pct, milestone, targetDate, evidence]) => ({ pct, milestone, targetDate, evidence })) }
      : { kind: "single", tranches: [] },
    perks: o.perks.map(([title, price, kind, fulfillBy, items, limit, shipsTo], i) => ({
      id: `p${i}`, title, priceMinor: price * 100, description: items.join(", ") + ".", kind, items, limit, fulfillBy, shipsTo,
    })),
  };
}

const empty = (): Record<CheckId, Decision> => ({ language: null, goal: null, fulfillment: null, identity: null, tier: null, escrow: null });
const allPass = (): Record<CheckId, Decision> => ({ language: "pass", goal: "pass", fulfillment: "pass", identity: "pass", tier: "pass", escrow: "pass" });

export const SUBMISSIONS: Submission[] = [
  {
    id: "CMP-26-0418",
    status: "under-review",
    submittedAt: hoursAgo(27),
    reviewer: "Dana Okafor",
    artist: artistById("sol-amara"),
    identity: "verified",
    view: view({
      artistId: "sol-amara", title: "Hometown headline night", type: "Fund My Show", blurb: "A 9-piece band, one night at The Rail Yard. Little Rock's first Afrobeats headline show of its size.",
      goal: 6000, days: 45, deadlineInDays: 47,
      funds: [["Venue + production", 2800], ["Band (9 players)", 2200], ["Perks + shipping", 1000]],
      perks: [
        ["General admission", 30, "experience", "2027-01", ["1 GA ticket"], 400],
        ["Signed poster + GA", 55, "physical", "2027-01", ["Signed 18×24 poster", "1 GA ticket"], 100, "us"],
        ["Meet & greet", 90, "experience", "2027-01", ["GA ticket", "Pre-show hang with the band"], 40],
      ],
      milestones: [[50, "", "", ""], [50, "Venue contract signed", "2026-12-15", "Signed venue or vendor contract"]],
    }),
    decisions: { ...empty(), identity: "pass", escrow: "pass" },
    notes: {},
    revisions: [],
    audit: [
      { at: hoursAgo(27), actor: "Sol Amara", action: "Submitted for review" },
      { at: hoursAgo(26.9), actor: "System", action: "Automated checks ran", detail: "Language: clear · Tier limit: within Rising $100,000 · Identity: verified" },
      { at: hoursAgo(3), actor: "Dana Okafor", action: "Claimed for review" },
      { at: hoursAgo(2.5), actor: "Dana Okafor", action: "Marked “Artist identity verified” as pass" },
      { at: hoursAgo(2.4), actor: "Dana Okafor", action: "Marked “Escrow terms” as pass" },
    ],
  },
  {
    id: "CMP-26-0415",
    status: "under-review",
    submittedAt: hoursAgo(41),
    artist: artistById("june-ash"),
    identity: "pending",
    view: view({
      artistId: "june-ash", title: "Record my first EP", type: "Album", blurb: "Five songs about small towns, cut live at a Nashville studio.",
      goal: 12000, days: 60, deadlineInDays: 62,
      funds: [["Studio time (4 days)", 6000], ["Mixing + mastering", 3500], ["Vinyl test pressing", 2500]],
      perks: [
        ["Digital EP", 10, "digital", "2027-03", ["Lossless download"]],
        ["Signed EP + 5% of streaming royalties", 100, "physical", "2027-04", ["Signed CD", "5% of streaming royalties for a year"], 50, "us"],
        ["House concert", 600, "experience", "", ["Acoustic set at your place"], 3],
      ],
    }),
    decisions: empty(),
    notes: {},
    revisions: [],
    audit: [
      { at: hoursAgo(41), actor: "June Ash", action: "Submitted for review" },
      { at: hoursAgo(40.9), actor: "System", action: "Automated checks ran", detail: "Language: 1 match (“royalties”) · Tier limit: $12,000 exceeds Starter $10,000 · Identity: pending" },
    ],
  },
  {
    id: "CMP-26-0409",
    status: "under-review",
    submittedAt: hoursAgo(53),
    artist: artistById("velvet-circuit"),
    identity: "verified",
    view: view({
      artistId: "velvet-circuit", title: "Warehouse sessions — the film", type: "Documentary", blurb: "Six nights, one warehouse, all modular. A short film about Detroit's late-night scene.",
      goal: 40000, days: 30, deadlineInDays: 32,
      funds: [["Crew + cameras", 22000], ["Edit + color", 12000], ["Perks + shipping", 6000]],
      perks: [
        ["Early screening link", 15, "digital", "2027-05", ["Watch 7 days early"]],
        ["Film + soundtrack vinyl", 70, "physical", "2027-06", ["Soundtrack LP", "Film download"], 300, "world"],
        ["Be in the crowd", 120, "experience", "2027-01", ["Guest list for one filming night"], 60],
      ],
    }),
    decisions: empty(),
    notes: {},
    revisions: [],
    audit: [
      { at: hoursAgo(53), actor: "Velvet Circuit", action: "Submitted for review" },
      { at: hoursAgo(52.9), actor: "System", action: "Automated checks ran", detail: "Language: clear · Tier limit: within Rising $100,000 · Identity: verified" },
    ],
  },
  {
    id: "CMP-26-0397",
    status: "revisions",
    submittedAt: hoursAgo(96),
    reviewer: "Marcus Lee",
    artist: artistById("the-low-ends"),
    identity: "verified",
    view: view({
      artistId: "the-low-ends", title: "Get the van on the road", type: "Tour", blurb: "Eight East Coast dates in March. We need a van that won't die in Delaware.",
      goal: 9500, days: 45, deadlineInDays: 40,
      funds: [["Van lease (6 weeks)", 4500], ["Fuel + tolls", 2500], ["Perks", 2500]],
      perks: [
        ["Tour diary", 10, "digital", "2027-03", ["Weekly video diary"]],
        ["Ticket to any date", 25, "experience", "2027-03", ["1 ticket, any stop"], 200],
      ],
    }),
    decisions: { language: "pass", goal: "flag", fulfillment: "pass", identity: "pass", tier: "pass", escrow: "pass" },
    notes: { goal: "Use of funds lists the van at $4,500 but story says $6,000. Reconcile." },
    revisions: [
      { id: "r1", section: "Use of funds", issue: "Van lease cost doesn't match the story ($4,500 vs $6,000).", change: "Update either the breakdown or the story so both show the same van cost, and keep the total equal to the goal.", priority: "high" },
      { id: "r2", section: "Perks", issue: "“Ticket to any date” doesn't say how backers pick a date.", change: "Add one line explaining how and when backers choose their tour stop.", priority: "low" },
    ],
    audit: [
      { at: hoursAgo(96), actor: "The Low Ends", action: "Submitted for review" },
      { at: hoursAgo(95.9), actor: "System", action: "Automated checks ran", detail: "Language: clear · Tier limit: within Starter $10,000 · Identity: verified" },
      { at: hoursAgo(70), actor: "Marcus Lee", action: "Claimed for review" },
      { at: hoursAgo(68), actor: "Marcus Lee", action: "Requested revisions", detail: "2 requests (1 high, 1 low) sent to artist" },
    ],
  },
  {
    id: "CMP-26-0371",
    status: "approved",
    submittedAt: hoursAgo(520),
    reviewer: "Dana Okafor",
    artist: artistById("nova-reyes"),
    identity: "verified",
    approvedAt: hoursAgo(490),
    goLive: hoursAgo(470),
    view: view({
      artistId: "nova-reyes", title: "Take the band on the road", type: "Tour", blurb: "Fund a 12-city run with the full horn section — not backing tracks.",
      goal: 25000, days: 60, deadlineInDays: 43,
      funds: [["Travel + lodging", 11000], ["Band + horn section", 9000], ["Perks + shipping", 5000]],
      perks: [
        ["Digital thank-you + tour diary", 10, "digital", "2026-12", ["Weekly diary from the road"]],
        ["Signed tour poster", 40, "physical", "2027-01", ["18×24 screen print, signed"], 300, "na"],
        ["Two tickets + soundcheck", 150, "experience", "2027-02", ["2 tickets, any stop", "Soundcheck access"], 60],
      ],
      milestones: [[50, "", "", ""], [50, "First 4 tour dates confirmed", "2026-12-20", "Signed venue or vendor contract"]],
    }),
    decisions: allPass(),
    notes: { goal: "Goal is ~$20/subscriber; consistent with prior show sales." },
    revisions: [],
    audit: [
      { at: hoursAgo(520), actor: "Nova Reyes", action: "Submitted for review" },
      { at: hoursAgo(519.9), actor: "System", action: "Automated checks ran", detail: "Language: clear · Tier limit: within Rising $100,000 · Identity: verified" },
      { at: hoursAgo(500), actor: "Dana Okafor", action: "Claimed for review" },
      { at: hoursAgo(491), actor: "Dana Okafor", action: "All 6 checks marked pass" },
      { at: hoursAgo(490), actor: "Dana Okafor", action: "Approved", detail: "Scheduled to go live on artist's launch date" },
      { at: hoursAgo(470), actor: "System", action: "Campaign went live", detail: "Escrow account opened with our escrow partner" },
    ],
  },
];

export const CHECKS: { id: CheckId; label: string; help: string }[] = [
  { id: "language", label: "Perks-only language", help: "No share of proceeds, earnings, royalties or financial interest anywhere on the page or in perks." },
  { id: "goal", label: "Realistic goal", help: "Goal fits the artist's audience and the use-of-funds breakdown adds up." },
  { id: "fulfillment", label: "Fulfillment dates", help: "Every perk has an estimated delivery month after the deadline that looks achievable." },
  { id: "identity", label: "Artist identity verified", help: "KYC passed for the account holder (Identity review queue)." },
  { id: "tier", label: "Tier limit respected", help: "Goal is within the artist's tier limit (Starter $10K, Rising $100K)." },
  { id: "escrow", label: "Escrow terms", help: "Target-or-refund terms shown; milestone releases have verifiable proof and dates." },
];

/** Automated signal for each check (assists the reviewer — never decides). */
export function autoSignal(s: Submission, id: CheckId): { tone: "success" | "warning" | "error" | "neutral"; text: string } {
  const v = s.view;
  switch (id) {
    case "language": {
      const hits = [v.title, v.blurb, v.story, ...v.perks.flatMap((p) => [p.title, p.description, ...p.items])].map(perksOnlyIssue).filter(Boolean) as string[];
      return hits.length ? { tone: "error", text: `Found “${hits[0]}”${hits.length > 1 ? ` +${hits.length - 1}` : ""}` } : { tone: "success", text: "No matches" };
    }
    case "goal": {
      const per = Math.round(v.goalMinor / 100 / Math.max(1, s.artist.subscribers));
      const sum = v.useOfFunds.reduce((a, l) => a + l.amountMinor, 0);
      if (sum !== v.goalMinor) return { tone: "error", text: "Breakdown ≠ goal" };
      return per > 25 ? { tone: "warning", text: `$${per}/subscriber — high` } : { tone: "success", text: `$${per}/subscriber` };
    }
    case "fulfillment": {
      const missing = v.perks.filter((p) => !p.fulfillBy).length;
      return missing ? { tone: "error", text: `${missing} perk${missing > 1 ? "s" : ""} missing a date` } : { tone: "success", text: `All ${v.perks.length} dated` };
    }
    case "identity":
      return s.identity === "verified" ? { tone: "success", text: "Verified" } : s.identity === "pending" ? { tone: "warning", text: "Pending KYC" } : { tone: "error", text: "Failed" };
    case "tier": {
      const cap = TIER_LIMIT_DOLLARS[s.artist.tier as CreatorTier] ?? 100_000;
      return v.goalMinor / 100 > cap ? { tone: "error", text: `Over ${s.artist.tier} $${cap.toLocaleString()}` } : { tone: "success", text: `Within $${cap.toLocaleString()}` };
    }
    case "escrow":
      return v.release.kind === "milestones" ? { tone: "neutral", text: `${v.release.tranches.length}-stage release` } : { tone: "success", text: "Single release" };
  }
}

export const REVISION_SECTIONS = ["Title or pitch", "Story", "Risks and challenges", "Funding goal", "Use of funds", "Perks", "Fulfillment dates", "Milestone release", "Cover image", "Identity", "Other"];
