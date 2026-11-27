/**
 * Services marketplace, Phase MKT-1 (CR-005; specs/marketplace/01-requirements.md, 02-design.md §4).
 * One set of rules for the API, the web app and the mobile app: categories, request-body schemas, response types
 * and copy. MKT-1 moves no money (NFR-MKT-01, ADR-010): prices here are "starting at" guides, never charges.
 */
import { z } from "zod";
import { POLICY } from "./policy";
import { formatUsd } from "./format";

const M = POLICY.marketplace;

/** FR-MKT-002. Must match `public.marketplace_categories()` (an API test enforces this). */
export const MARKETPLACE_CATEGORIES = [
  { key: "production", label: "Production & beats" },
  { key: "mixing_mastering", label: "Mixing & mastering" },
  { key: "session_musicians", label: "Session musicians & vocals" },
  { key: "songwriting", label: "Songwriting" },
  { key: "video", label: "Music video & film" },
  { key: "photography", label: "Photography" },
  { key: "design", label: "Artwork & design" },
  { key: "marketing_pr", label: "Marketing & PR" },
  { key: "live_support", label: "Tour & live support" },
  { key: "other", label: "Other" },
] as const;
export type CategoryKey = (typeof MARKETPLACE_CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = MARKETPLACE_CATEGORIES.map((c) => c.key) as [CategoryKey, ...CategoryKey[]];
export const Category = z.enum(CATEGORY_KEYS);
export const categoryLabel = (k: string) => MARKETPLACE_CATEGORIES.find((c) => c.key === k)?.label ?? "Other";

export const PRICE_UNITS = ["project", "song", "hour", "day"] as const;
export const PriceUnit = z.enum(PRICE_UNITS);
export type PriceUnit = z.infer<typeof PriceUnit>;

export const PROVIDER_STATUSES = ["draft", "in_review", "changes_requested", "listed", "suspended"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export const REQUEST_STATUSES = ["sent", "accepted", "declined", "withdrawn"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// ── Request bodies (the API parses with these; the clients validate inline with them) ──
const HttpsUrl = z.string().max(300).url().refine((u) => u.startsWith("https://"), "Links must start with https://");
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-01");

/** FR-MKT-003. */
export const ProviderProfileInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/, "Use 3–60 lowercase letters, numbers or dashes"),
  displayName: z.string().trim().min(2).max(80),
  headline: z.string().trim().min(5).max(120),
  bio: z.string().max(2000).nullish(),
  city: z.string().max(80).nullish(),
  remoteOk: z.boolean(),
  categories: z.array(Category).min(1).max(M.maxCategories).refine((a) => new Set(a).size === a.length, "Pick each category once"),
  links: z.array(HttpsUrl).max(M.maxLinks).default([]),
  contactEmail: z.string().email().max(200),
});
export type ProviderProfileInput = z.infer<typeof ProviderProfileInput>;

/** FR-MKT-004. */
export const ListingInput = z.object({
  category: Category,
  title: z.string().trim().min(3).max(90),
  description: z.string().max(2000).nullish(),
  priceFromMinor: z.number().int().min(0).max(M.maxPriceFromMinor).nullish(),
  priceUnit: PriceUnit.default("project"),
  turnaroundDays: z.number().int().min(1).max(365).nullish(),
  active: z.boolean().default(true),
});
export type ListingInput = z.infer<typeof ListingInput>;
export const ListingsInput = z.array(ListingInput).max(M.maxListings);

/** FR-MKT-007. */
export const ServiceRequestInput = z.object({
  listingId: z.string().uuid(),
  brief: z.string().trim().min(20, "Tell the provider a little more (at least 20 characters)").max(4000),
  budgetMinor: z.number().int().min(0).max(M.maxPriceFromMinor).nullish(),
  neededBy: Day.nullish(),
  campaignId: z.string().uuid().nullish(),
  shareEmail: z.boolean(),
});
export type ServiceRequestInput = z.infer<typeof ServiceRequestInput>;

/** FR-MKT-009. */
export const RespondInput = z.object({ decision: z.enum(["accepted", "declined"]), note: z.string().max(1000).nullish() });
export type RespondInput = z.infer<typeof RespondInput>;

/** FR-MKT-008. A note is required unless the decision is to list. */
export const ProviderReviewInput = z
  .object({ decision: z.enum(["listed", "changes_requested", "suspended"]), note: z.string().max(1000).nullish(), reason: z.string() })
  .refine((v) => v.decision === "listed" || (v.note ?? "").trim().length >= 5, { message: "Add a note for the provider", path: ["note"] });

// ── Responses ──
export interface ListingView {
  id: string;
  category: CategoryKey;
  title: string;
  description: string | null;
  priceFromMinor: number | null;
  priceUnit: PriceUnit;
  turnaroundDays: number | null;
  active: boolean;
}
export interface ServiceResult extends ListingView {
  provider: { slug: string; displayName: string; headline: string; city: string | null; remoteOk: boolean };
}
export interface ServiceList {
  items: ServiceResult[];
  nextCursor: string | null;
}
export interface ProviderPage {
  slug: string;
  displayName: string;
  headline: string;
  bio: string | null;
  city: string | null;
  remoteOk: boolean;
  categories: CategoryKey[];
  links: string[];
  listings: ListingView[];
}
export interface MyProvider extends ProviderPage {
  id: string;
  status: ProviderStatus;
  reviewNote: string | null;
  contactEmail: string;
}
export interface ServiceRequestView {
  id: string;
  status: RequestStatus;
  brief: string;
  budgetMinor: number | null;
  neededBy: string | null;
  createdAt: string;
  respondedAt: string | null;
  providerNote: string | null;
  listing: { id: string; title: string; category: CategoryKey };
  provider: { slug: string; displayName: string };
  artist: { name: string };
  campaign: { id: string; title: string } | null;
  /** FR-MKT-009: present only for the counterpart of an accepted request. */
  providerContactEmail?: string | null;
  requesterEmail?: string | null;
}

// ── Copy (Brand §7; NFR-MKT-05) ──
export const MKT_OFF_PLATFORM_NOTICE =
  "FanZuP doesn't handle payment for services yet. You agree the price, terms and payment directly with the provider.";
export const MKT_VETTING_NOTE = "Every provider is reviewed by the FanZuP team before they're listed.";

const UNIT_LABEL: Record<PriceUnit, string> = { project: "per project", song: "per song", hour: "per hour", day: "per day" };
/** "Starting at $250 per song", or "Price on request". Never a fee or a charge. */
export function priceFromLabel(minor: number | null | undefined, unit: PriceUnit = "project"): string {
  if (minor == null) return "Price on request";
  return `Starting at ${formatUsd(minor)} ${UNIT_LABEL[unit]}`;
}
export const turnaroundLabel = (days: number | null | undefined) => (days == null ? null : days === 1 ? "About 1 day" : `About ${days} days`);

export function requestStatusCopy(s: RequestStatus): { label: string; tone: "info" | "success" | "warning" | "muted" } {
  switch (s) {
    case "sent": return { label: "Waiting for the provider", tone: "info" };
    case "accepted": return { label: "Accepted: get in touch to agree terms", tone: "success" };
    case "declined": return { label: "Declined", tone: "warning" };
    case "withdrawn": return { label: "Withdrawn", tone: "muted" };
  }
}

export function providerStatusCopy(s: ProviderStatus): string {
  switch (s) {
    case "draft": return "Draft. Add at least one listing, then submit for review.";
    case "in_review": return "In review. We'll list you once the team has checked your profile.";
    case "changes_requested": return "Changes requested. See the note, update your profile and submit again.";
    case "listed": return "Listed. Artists can find you and send requests.";
    case "suspended": return "Not listed. Contact FanZuP support if you think this is a mistake.";
  }
}

/** The limits clients show in hints (same numbers the schemas enforce). */
export const POLICY_LIMITS = { maxCategories: M.maxCategories, maxLinks: M.maxLinks, maxListings: M.maxListings, requestsPerDay: M.requestsPerDay } as const;
