/**
 * Creator-area demo data for the signed-in creator (Nova Reyes, Rising tier).
 * Page-local to the creator area so we don't churn the shared mock. Amounts in cents.
 * Fees: only the Stripe pass-through (2.9% + $0.30) is known; platform fee is TBD (docs/brand/fees.html).
 */
import { artistById, campaignById, events as allEvents, type Campaign, type CampaignType, type Perk } from "@/lib/mock";
import { tier } from "@/config/tiers";

export const ME = artistById("nova-reyes");
export const LIVE_CAMPAIGN_ID = "nova-live-band-tour";
export const TODAY = "2026-10-02";

/* ── Campaigns ─────────────────────────────────────────── */

export type CreatorCampaignStatus = "draft" | "review" | "live" | "funded" | "ended" | "refunded";

export interface CreatorCampaign extends Omit<Campaign, "status"> {
  status: CreatorCampaignStatus;
  /** When the campaign was submitted / launched / closed — depends on status. */
  statusDate: string;
  releasedMinor?: number;
}

const live = campaignById(LIVE_CAMPAIGN_ID)!;

export const creatorCampaigns: CreatorCampaign[] = [
  { ...live, status: "live", statusDate: "2026-09-15" },
  {
    id: "nova-hometown-show",
    artistId: ME.id,
    title: "Hometown night with the full band",
    type: "Show",
    blurb: "Fund My Show: one night in Atlanta, horns and strings, recorded for a live EP.",
    goalMinor: 400_000,
    raisedMinor: 0,
    backers: 0,
    endsOn: "2026-12-20",
    status: "review",
    statusDate: "2026-09-28",
    perks: [
      { id: "p1", title: "General admission", priceMinor: 2500, description: "One ticket to the show.", limit: 350, claimed: 0, delivery: "Show date Dec 2026", kind: "experience" },
      { id: "p2", title: "Live EP download", priceMinor: 1000, description: "The recording, before anyone else.", claimed: 0, delivery: "Feb 2027", kind: "digital" },
    ],
  },
  {
    id: "nova-holiday-stream",
    artistId: ME.id,
    title: "Holiday horns livestream special",
    type: "Show",
    blurb: "A seated holiday set streamed from the studio.",
    goalMinor: 300_000,
    raisedMinor: 0,
    backers: 0,
    endsOn: "2026-12-10",
    status: "draft",
    statusDate: "2026-09-30",
    perks: [],
  },
  {
    id: "nova-midnight-horns-vinyl",
    artistId: ME.id,
    title: "Press Midnight Horns to vinyl",
    type: "Album",
    blurb: "The second EP on 180g vinyl with a gatefold sleeve.",
    goalMinor: 600_000,
    raisedMinor: 742_000,
    backers: 268,
    endsOn: "2026-04-12",
    status: "funded",
    statusDate: "2026-04-12",
    releasedMinor: 742_000,
    perks: [
      { id: "p1", title: "Digital EP + liner notes", priceMinor: 1200, description: "Lossless files and a PDF booklet.", claimed: 104, delivery: "Delivered May 2026", kind: "digital" },
      { id: "p2", title: "Vinyl + digital", priceMinor: 3500, description: "First-press 180g vinyl.", limit: 200, claimed: 146, delivery: "Ships Nov 2026", kind: "physical" },
      { id: "p3", title: "Test pressing, signed", priceMinor: 9000, description: "One of 20 white-label test pressings.", limit: 20, claimed: 18, delivery: "Ships Oct 2026", kind: "physical" },
    ],
  },
  {
    id: "nova-first-ep-release",
    artistId: ME.id,
    title: "First EP release show",
    type: "Show",
    blurb: "A release night for the first EP at a 200-cap room.",
    goalMinor: 250_000,
    raisedMinor: 288_000,
    backers: 131,
    endsOn: "2025-06-01",
    status: "ended",
    statusDate: "2025-06-01",
    releasedMinor: 288_000,
    perks: [
      { id: "p1", title: "Ticket", priceMinor: 2000, description: "General admission.", limit: 200, claimed: 112, delivery: "Delivered Jul 2025", kind: "experience" },
      { id: "p2", title: "Signed CD", priceMinor: 2500, description: "Signed at the show or shipped.", claimed: 19, delivery: "Delivered Jul 2025", kind: "physical" },
    ],
  },
  {
    id: "nova-acoustic-film",
    artistId: ME.id,
    title: "Acoustic sessions short film",
    type: "Documentary",
    blurb: "A 20-minute film of stripped-back sessions in an empty church.",
    goalMinor: 1_500_000,
    raisedMinor: 610_000,
    backers: 140,
    endsOn: "2025-12-01",
    status: "refunded",
    statusDate: "2025-12-01",
    perks: [{ id: "p1", title: "Digital film + soundtrack", priceMinor: 2000, description: "Stream and download.", claimed: 140, delivery: "—", kind: "digital" }],
  },
];

export const creatorCampaignById = (id?: string) => creatorCampaigns.find((c) => c.id === id);

/** Milestone release schedule for the live campaign (Mechanism 05 §2.4 — optional milestone release). */
export const milestoneSchedule = [
  // Council D1 condition 1: matches the wizard default and Mechanism 05 §2.4 (50/50).
  { id: "m1", label: "Goal met — booking and deposits", sharePct: 50, when: "When the goal is met", status: "Waiting on goal" as const },
  { id: "m2", label: "Tour starts — first show played", sharePct: 50, when: "Feb 2027", status: "Not started" as const },
];

export type FulfillmentStatus = "Not started" | "Date needed" | "Scheduled" | "In progress" | "Delivered";

export const liveFulfillment: Record<string, { status: FulfillmentStatus; note: string }> = {
  p1: { status: "Scheduled", note: "First diary entry Dec 4" },
  p2: { status: "Date needed", note: "Confirm a ship date with your printer" },
  p3: { status: "Scheduled", note: "Backers pick a stop by Jan 15" },
  p4: { status: "Date needed", note: "Confirm when the tour site goes live" },
};

export const liveBackers = [
  { name: "Jordan P.", perk: "p3", amountMinor: 15000, on: "2026-10-01", city: "Little Rock, AR" },
  { name: "Imani W.", perk: "p2", amountMinor: 4000, on: "2026-10-01", city: "Atlanta, GA" },
  { name: "Marcus T.", perk: "p1", amountMinor: 1000, on: "2026-09-30", city: "Decatur, GA" },
  { name: "Priya S.", perk: "p4", amountMinor: 2500, on: "2026-09-30", city: "Durham, NC" },
  { name: "Dani R.", perk: "p3", amountMinor: 15000, on: "2026-09-29", city: "Nashville, TN" },
  { name: "Theo K.", perk: "p2", amountMinor: 5000, on: "2026-09-29", city: "Atlanta, GA" },
  { name: "Ana L.", perk: "p1", amountMinor: 1000, on: "2026-09-28", city: "Savannah, GA" },
  { name: "Chris O.", perk: "p2", amountMinor: 4000, on: "2026-09-27", city: "Charlotte, NC" },
  { name: "Sam B.", perk: "p1", amountMinor: 2000, on: "2026-09-26", city: "Birmingham, AL" },
  { name: "Lena V.", perk: "p4", amountMinor: 2500, on: "2026-09-25", city: "Athens, GA" },
];

export const campaignUpdates = [
  { id: "u2", title: "Horn section confirmed", body: "Dre and Kiana are in for all 12 dates. Rehearsals start in January.", on: "2026-09-26", audience: "All backers" },
  { id: "u1", title: "We're live", body: "Thank you for the first 100 backers in 48 hours. Tour routing is coming next week.", on: "2026-09-17", audience: "Public" },
];

export function perkById(c: { perks: Perk[] }, id: string) {
  return c.perks.find((p) => p.id === id);
}

/* ── Revenue ───────────────────────────────────────────── */

export type RevenueSource = "subscriptions" | "tickets" | "merch" | "streams" | "tips" | "campaigns";

export const SOURCE_LABEL: Record<RevenueSource, string> = {
  subscriptions: "Subscriptions",
  tickets: "Tickets",
  merch: "Merch",
  streams: "Live streams",
  tips: "Tips",
  campaigns: "Campaign proceeds",
};

/** Average transaction size per source, used to estimate per-transaction processing fees. */
const AVG_TXN: Record<RevenueSource, number> = { subscriptions: 500, tickets: 3500, merch: 3200, streams: 1200, tips: 800, campaigns: 2770 };

export const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

const SERIES: Record<RevenueSource, number[]> = {
  subscriptions: [310000, 322000, 335000, 341000, 356000, 368000, 379000, 392000, 410000, 428000, 446000, 462000],
  tickets: [0, 0, 184000, 0, 0, 96000, 0, 0, 252000, 0, 0, 140000],
  merch: [42000, 61000, 118000, 38000, 29000, 44000, 52000, 47000, 88000, 61000, 55000, 73000],
  streams: [0, 36000, 0, 24000, 0, 41000, 0, 38000, 0, 52000, 0, 47000],
  tips: [8200, 9100, 14300, 7600, 6900, 8800, 9400, 10200, 12800, 11100, 10400, 12600],
  campaigns: [0, 0, 0, 0, 0, 0, 742000, 0, 0, 0, 0, 0],
};

export const SOURCES = Object.keys(SERIES) as RevenueSource[];

export interface MonthRow {
  month: string;
  label: string;
  bySource: Record<RevenueSource, number>;
  total: number;
  totalExCampaigns: number;
}

export const revenueByMonth: MonthRow[] = MONTHS.map((m, i) => {
  const bySource = Object.fromEntries(SOURCES.map((s) => [s, SERIES[s][i]])) as Record<RevenueSource, number>;
  const total = SOURCES.reduce((a, s) => a + bySource[s], 0);
  return {
    month: m,
    label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${m}-15`)),
    bySource,
    total,
    totalExCampaigns: total - bySource.campaigns,
  };
});

/** Stripe pass-through estimate: 2.9% + $0.30 per transaction. */
export function processingFee(source: RevenueSource, grossMinor: number) {
  if (!grossMinor) return 0;
  const txns = Math.max(1, Math.round(grossMinor / AVG_TXN[source]));
  return Math.round(grossMinor * 0.029 + txns * 30);
}

/* ── Activity, tasks, events ───────────────────────────── */

export const recentActivity = [
  { id: "a1", kind: "backer" as const, text: "Jordan P. backed the tour — Two tickets + soundcheck", at: "2h ago" },
  { id: "a2", kind: "subscriber" as const, text: "14 new subscribers this week", at: "Today" },
  { id: "a3", kind: "sale" as const, text: "3 Horn Section Tees sold", at: "Yesterday" },
  { id: "a4", kind: "milestone" as const, text: "Tour campaign passed 75% of its goal", at: "Sep 29" },
  { id: "a5", kind: "payout" as const, text: "Weekly payout sent to Checking ••4821", at: "Sep 28" },
];

export const dashboardTasks = [
  { id: "t1", label: "Post a campaign update", detail: "Your last update was 6 days ago. Backers hear from you weekly on the best campaigns.", to: `/creator/campaigns/${LIVE_CAMPAIGN_ID}#update` },
  { id: "t2", label: "Confirm perk fulfillment dates", detail: "2 perks on the tour campaign still need a delivery date.", to: `/creator/campaigns/${LIVE_CAMPAIGN_ID}#fulfillment` },
  { id: "t3", label: "Ship the test pressings", detail: "18 signed test pressings for Midnight Horns are due in October.", to: "/creator/campaigns/nova-midnight-horns-vinyl" },
  { id: "t4", label: "Open a backer presale", detail: "Give tour backers first access to Live with the Band tickets.", to: "/creator/events" },
];

export interface CreatorEvent {
  id: string;
  title: string;
  venue: string;
  city: string;
  date: string;
  time: string;
  priceMinor: number;
  capacity: number;
  sold: number;
  presale: boolean;
  presaleAudience: string;
  status: "onsale" | "presale" | "draft" | "past";
}

const e1 = allEvents.find((e) => e.id === "e1")!;

export const creatorEvents: CreatorEvent[] = [
  { id: "e1", title: e1.title, venue: e1.venue, city: e1.city, date: e1.date, time: "8:00 PM", priceMinor: e1.priceMinor, capacity: 400, sold: 400 - e1.remaining, presale: true, presaleAudience: "tour backers + subscribers", status: "onsale" },
  { id: "ev-hometown", title: "Hometown Night — Live EP Recording", venue: "The Earl", city: "Atlanta, GA", date: "2026-12-19", time: "9:00 PM", priceMinor: 2500, capacity: 300, sold: 64, presale: true, presaleAudience: "subscribers", status: "presale" },
  { id: "ev-listening", title: "Midnight Horns Listening Party", venue: "Wax n Facts", city: "Atlanta, GA", date: "2026-11-21", time: "6:00 PM", priceMinor: 1500, capacity: 80, sold: 0, presale: false, presaleAudience: "", status: "draft" },
  { id: "ev-past-1", title: "Summer Sessions", venue: "Terminal West", city: "Atlanta, GA", date: "2026-06-20", time: "8:00 PM", priceMinor: 3000, capacity: 650, sold: 612, presale: true, presaleAudience: "subscribers", status: "past" },
  { id: "ev-past-2", title: "Winter Warm-Up", venue: "Smith's Olde Bar", city: "Atlanta, GA", date: "2025-12-13", time: "8:30 PM", priceMinor: 2000, capacity: 250, sold: 250, presale: false, presaleAudience: "", status: "past" },
];

/* ── Tier progress ─────────────────────────────────────── */

/**
 * Progress toward Established, per PRD 01 §6.3 via @/config/tiers (council D1 Blocker 1 —
 * replaces invented targets). Demo status for Nova Reyes.
 */
const EST = tier("Established");
export const establishedCriteria = [
  { label: "LLC and EIN verified", current: 1, target: 1, unit: "" },
  { label: "Business bank account linked and verified", current: 0, target: 1, unit: "" },
  { label: "Monthly listeners", current: ME.monthlyListeners, target: EST.minMonthlyListeners!, unit: "" },
  { label: "Months of streaming history", current: 9, target: EST.minHistoryMonths!, unit: "" },
];

export const CAMPAIGN_TYPES: CampaignType[] = ["Album", "Tour", "Music Video", "Show", "Documentary"];
