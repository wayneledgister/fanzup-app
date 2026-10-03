/**
 * Demo data shared across screens so the prototype tells one consistent story.
 * All artists are fictional. All amounts are in minor units (cents).
 * Replace with API calls when services land (PRD 01 §9.2).
 */
export type CreatorTier = "Starter" | "Rising" | "Established" | "Pro";

export interface Artist {
  id: string;
  name: string;
  handle: string;
  genre: string;
  city: string;
  tier: CreatorTier;
  verified: boolean;
  monthlyListeners: number;
  subscribers: number;
  bio: string;
}

export const artists: Artist[] = [
  { id: "nova-reyes", name: "Nova Reyes", handle: "@novareyes", genre: "Alt R&B", city: "Atlanta, GA", tier: "Rising", verified: true, monthlyListeners: 48200, subscribers: 1240, bio: "Late-night R&B with live horns. Two self-released EPs, now building a full band for the road." },
  { id: "the-low-ends", name: "The Low Ends", handle: "@thelowends", genre: "Indie Rock", city: "Philadelphia, PA", tier: "Starter", verified: true, monthlyListeners: 9100, subscribers: 410, bio: "Four-piece from South Philly. Loud guitars, louder crowds." },
  { id: "kai-marlo", name: "Kai Marlo", handle: "@kaimarlo", genre: "Hip-Hop", city: "Houston, TX", tier: "Established", verified: true, monthlyListeners: 212000, subscribers: 5620, bio: "Producer-rapper making soul-sampled records from a home studio in Third Ward." },
  { id: "june-ash", name: "June Ash", handle: "@juneash", genre: "Folk / Americana", city: "Nashville, TN", tier: "Starter", verified: false, monthlyListeners: 3400, subscribers: 95, bio: "Songs about small towns and long drives." },
  { id: "velvet-circuit", name: "Velvet Circuit", handle: "@velvetcircuit", genre: "Electronic", city: "Detroit, MI", tier: "Rising", verified: true, monthlyListeners: 67300, subscribers: 2210, bio: "Detroit techno lineage, modular synths, warehouse energy." },
  { id: "sol-amara", name: "Sol Amara", handle: "@solamara", genre: "Afrobeats", city: "Little Rock, AR", tier: "Rising", verified: true, monthlyListeners: 31800, subscribers: 980, bio: "Afrobeats meets Ozark soul. First headline tour in the works." },
];

export type CampaignType = "Album" | "Tour" | "Music Video" | "Show" | "Documentary";

/** Layer 1 reward campaign (Mechanism 05 — perks only, target-or-refund escrow). */
export interface Campaign {
  id: string;
  artistId: string;
  title: string;
  type: CampaignType;
  blurb: string;
  goalMinor: number;
  raisedMinor: number;
  backers: number;
  endsOn: string;
  status: "live" | "funded" | "ended" | "draft";
  perks: Perk[];
  milestoneRelease?: boolean;
}

export interface Perk {
  id: string;
  title: string;
  priceMinor: number;
  description: string;
  limit?: number;
  claimed: number;
  delivery: string;
  kind: "digital" | "physical" | "experience";
}

export const campaigns: Campaign[] = [
  {
    id: "nova-live-band-tour",
    artistId: "nova-reyes",
    title: "Take the band on the road",
    type: "Tour",
    blurb: "Fund a 12-city run with the full horn section — not backing tracks.",
    goalMinor: 2_500_000,
    raisedMinor: 1_870_000,
    backers: 412,
    endsOn: "2026-11-14",
    status: "live",
    milestoneRelease: true,
    perks: [
      { id: "p1", title: "Digital thank-you + tour diary", priceMinor: 1000, description: "Weekly behind-the-scenes diary from the road.", claimed: 188, delivery: "Weekly from Dec 2026", kind: "digital" },
      { id: "p2", title: "Signed tour poster", priceMinor: 4000, description: "18×24 screen print, signed by the band.", limit: 300, claimed: 141, delivery: "Ships Jan 2027", kind: "physical" },
      { id: "p3", title: "Two tickets + soundcheck", priceMinor: 15000, description: "Any one stop on the tour. Watch soundcheck from the floor.", limit: 60, claimed: 52, delivery: "Tour dates Feb–Mar 2027", kind: "experience" },
      { id: "p4", title: "Name in the tour credits", priceMinor: 2500, description: "Your name on the tour site and merch insert.", claimed: 31, delivery: "Feb 2027", kind: "digital" },
    ],
  },
  {
    id: "low-ends-debut-lp",
    artistId: "the-low-ends",
    title: "Press our debut LP to vinyl",
    type: "Album",
    blurb: "Ten songs, recorded live to tape. Help us press the first 500.",
    goalMinor: 800_000,
    raisedMinor: 812_500,
    backers: 233,
    endsOn: "2026-10-09",
    status: "funded",
    perks: [
      { id: "p1", title: "Digital album", priceMinor: 1200, description: "Lossless download on release day.", claimed: 120, delivery: "Mar 2027", kind: "digital" },
      { id: "p2", title: "Vinyl + digital", priceMinor: 3500, description: "First-press 180g vinyl.", limit: 500, claimed: 98, delivery: "Ships Apr 2027", kind: "physical" },
    ],
  },
  {
    id: "sol-amara-first-headline",
    artistId: "sol-amara",
    title: "My first headline show",
    type: "Show",
    blurb: "Fund My Show: a hometown headline night with a 9-piece band.",
    goalMinor: 600_000,
    raisedMinor: 214_000,
    backers: 88,
    endsOn: "2026-11-30",
    status: "live",
    perks: [
      { id: "p1", title: "General admission", priceMinor: 3000, description: "One ticket to the show.", limit: 400, claimed: 61, delivery: "Show date Jan 2027", kind: "experience" },
      { id: "p2", title: "Meet & greet", priceMinor: 9000, description: "GA ticket plus pre-show hang.", limit: 40, claimed: 12, delivery: "Show date Jan 2027", kind: "experience" },
    ],
  },
  {
    id: "velvet-circuit-video",
    artistId: "velvet-circuit",
    title: "\"Night Shift\" music video",
    type: "Music Video",
    blurb: "A one-take warehouse video shot on 16mm.",
    goalMinor: 1_200_000,
    raisedMinor: 540_000,
    backers: 167,
    endsOn: "2026-12-05",
    status: "live",
    perks: [
      { id: "p1", title: "Early premiere access", priceMinor: 800, description: "Watch 48 hours before release.", claimed: 120, delivery: "Feb 2027", kind: "digital" },
      { id: "p2", title: "Be an extra", priceMinor: 12000, description: "Join the shoot in Detroit.", limit: 25, claimed: 9, delivery: "Shoot Jan 2027", kind: "experience" },
    ],
  },
];

/** Layer 2 (Reg CF) Pool — only rendered behind the `layer2` flag. */
export interface Pool {
  id: string;
  artistId: string;
  kind: "Creator" | "Project" | "Brand";
  title: string;
  unitPriceMinor: number;
  targetMinor: number;
  raisedMinor: number;
  investors: number;
  revenueSharePct: number;
  returnCapMultiple: number;
  maturityYears: number;
  distribution: "Quarterly" | "Monthly";
  collection: "Distributor redirect" | "Lockbox" | "Self-reported + verified";
  endsOn: string;
}

export const pools: Pool[] = [
  { id: "kai-marlo-catalog", artistId: "kai-marlo", kind: "Creator", title: "Kai Marlo — next two albums", unitPriceMinor: 10_000, targetMinor: 15_000_000, raisedMinor: 9_120_000, investors: 684, revenueSharePct: 20, returnCapMultiple: 1.5, maturityYears: 5, distribution: "Quarterly", collection: "Distributor redirect", endsOn: "2026-12-20" },
  { id: "velvet-circuit-tour", artistId: "velvet-circuit", kind: "Project", title: "Velvet Circuit — 2027 tour", unitPriceMinor: 5_000, targetMinor: 5_000_000, raisedMinor: 1_350_000, investors: 141, revenueSharePct: 10, returnCapMultiple: 1.3, maturityYears: 3, distribution: "Quarterly", collection: "Self-reported + verified", endsOn: "2027-01-15" },
];

export interface Holding {
  poolId: string;
  units: number;
  investedMinor: number;
  distributionsMinor: number;
  purchasedOn: string;
  unlocksOn: string;
}

export const holdings: Holding[] = [
  { poolId: "kai-marlo-catalog", units: 5, investedMinor: 50_000, distributionsMinor: 3_140, purchasedOn: "2026-03-02", unlocksOn: "2027-03-02" },
  { poolId: "velvet-circuit-tour", units: 4, investedMinor: 20_000, distributionsMinor: 0, purchasedOn: "2026-09-18", unlocksOn: "2027-09-18" },
];

export interface EventItem {
  id: string;
  artistId: string;
  title: string;
  venue: string;
  city: string;
  date: string;
  priceMinor: number;
  remaining: number;
  backerPresale?: boolean;
}

export const events: EventItem[] = [
  { id: "e1", artistId: "nova-reyes", title: "Nova Reyes — Live with the Band", venue: "The Eastside Hall", city: "Atlanta, GA", date: "2027-02-13", priceMinor: 3500, remaining: 140, backerPresale: true },
  { id: "e2", artistId: "the-low-ends", title: "The Low Ends — LP Release Show", venue: "Front Street Ballroom", city: "Philadelphia, PA", date: "2027-04-03", priceMinor: 2000, remaining: 60 },
  { id: "e3", artistId: "sol-amara", title: "Sol Amara — Headline Night", venue: "The Rail Yard", city: "Little Rock, AR", date: "2027-01-23", priceMinor: 3000, remaining: 339, backerPresale: true },
  { id: "e4", artistId: "kai-marlo", title: "Kai Marlo — Third Ward Homecoming", venue: "Bayou Music Hall", city: "Houston, TX", date: "2027-03-20", priceMinor: 4500, remaining: 0 },
];

export interface MerchItem {
  id: string;
  artistId: string;
  title: string;
  priceMinor: number;
  kind: "Apparel" | "Vinyl" | "Print" | "Accessory";
  native: boolean; // false = link-out (no FanZuP commission — products/fees.html)
}

export const merch: MerchItem[] = [
  { id: "m1", artistId: "nova-reyes", title: "Horn Section Tee", priceMinor: 3000, kind: "Apparel", native: true },
  { id: "m2", artistId: "the-low-ends", title: "Debut LP — 180g Vinyl", priceMinor: 3200, kind: "Vinyl", native: true },
  { id: "m3", artistId: "velvet-circuit", title: "Night Shift Hoodie", priceMinor: 5500, kind: "Apparel", native: false },
  { id: "m4", artistId: "kai-marlo", title: "Third Ward Poster", priceMinor: 2500, kind: "Print", native: true },
  { id: "m5", artistId: "sol-amara", title: "Ozark Soul Tote", priceMinor: 1800, kind: "Accessory", native: true },
];

/** Perks the demo fan has earned from backed campaigns. */
export const myPerks = [
  { id: "mp1", campaignId: "low-ends-debut-lp", perkId: "p2", status: "Preparing" as const, detail: "Vinyl ships Apr 2027" },
  { id: "mp2", campaignId: "nova-live-band-tour", perkId: "p1", status: "Delivered" as const, detail: "Tour diary #3 is out" },
  { id: "mp3", campaignId: "nova-live-band-tour", perkId: "p3", status: "Scheduled" as const, detail: "Pick your tour stop by Jan 15" },
];

export const fan = {
  name: "Jordan Pierce",
  handle: "@jordanp",
  city: "Little Rock, AR",
  joined: "2026-05-01",
  following: ["nova-reyes", "sol-amara", "the-low-ends", "velvet-circuit"],
  backed: ["nova-live-band-tour", "low-ends-debut-lp"],
  subscriptions: ["nova-reyes", "sol-amara"],
};

export function artistById(id: string): Artist {
  const a = artists.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown artist ${id}`);
  return a;
}
export const campaignById = (id: string) => campaigns.find((c) => c.id === id);
export const poolById = (id: string) => pools.find((p) => p.id === id);
