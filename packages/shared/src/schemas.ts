/**
 * Request/response contracts shared by apps/web and apps/api (G2 condition 11; design 02 §4.2).
 * The API parses requests with these; the web app types responses with them. Money is integer cents.
 */
import { z } from "zod";

// ── Requests ───────────────────────────────────────────────────────────
export const BackCampaignRequest = z.object({
  campaignId: z.string().uuid(),
  perkId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
  /** Referral source from `?ref=` (FR-ANL-001 events); lower-case slug. */
  source: z.string().regex(/^[a-z0-9_-]{1,40}$/).nullish(),
});
export type BackCampaignRequest = z.infer<typeof BackCampaignRequest>;

export const FunnelEventRequest = z.object({
  name: z.enum(["perk_selected", "checkout_started"]),
  campaignId: z.string().uuid(),
  perkId: z.string().uuid().optional(),
  anonId: z.string().uuid(),
  source: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
});
export type FunnelEventRequest = z.infer<typeof FunnelEventRequest>;

export const AcceptanceRequest = z.object({
  documents: z.array(z.object({ kind: z.enum(["terms", "privacy", "adult_attestation"]), version: z.string().max(40) })).min(1).max(3),
});
export type AcceptanceRequest = z.infer<typeof AcceptanceRequest>;

// ── Responses ──────────────────────────────────────────────────────────
export const ApiErrorBody = z.object({ error: z.string(), message: z.string(), correlationId: z.string().optional() });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const PublicConfig = z.object({
  provider: z.enum(["sandbox", "stripe-test"]),
  testMode: z.boolean(),
  stripePublishableKey: z.string().nullable(),
  /** Server-side flags (FR-PLT-001). Optional so older API builds still parse. */
  flags: z.object({ layer2: z.boolean() }).optional(),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const CampaignCard = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  blurb: z.string().nullable(),
  status: z.string(),
  goalMinor: z.number().int(),
  raisedMinor: z.number().int(),
  backers: z.number().int(),
  endsAt: z.string().nullable(),
  milestoneRelease: z.boolean(),
  artist: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), genre: z.string().nullable(), city: z.string().nullable(), tier: z.string() }),
});
export type CampaignCard = z.infer<typeof CampaignCard>;
/** Kept for older imports. */
export const CampaignSummary = CampaignCard;
export type CampaignSummary = CampaignCard;

export const CampaignList = z.object({ campaigns: z.array(CampaignCard), nextCursor: z.string().nullable() });
export type CampaignList = z.infer<typeof CampaignList>;

export const PerkView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["digital", "physical", "experience"]),
  priceMinor: z.number().int(),
  remaining: z.number().int().nullable(),
  limit: z.number().int().nullable(),
  fulfillBy: z.string(),
});
export type PerkView = z.infer<typeof PerkView>;

export const TrancheView = z.object({
  seq: z.number().int(),
  pct: z.number().int(),
  milestone: z.string().nullable(),
  status: z.string(),
  targetDate: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  releasedAt: z.string().nullable(),
});
export type TrancheView = z.infer<typeof TrancheView>;

export const CampaignDetail = z.object({
  campaign: CampaignCard.extend({ story: z.string().nullable(), risks: z.string().nullable(), startsAt: z.string().nullable() }),
  perks: z.array(PerkView),
  tranches: z.array(TrancheView),
});
export type CampaignDetail = z.infer<typeof CampaignDetail>;

export const BackCampaignResponse = z.object({
  backingId: z.string().uuid(),
  amountMinor: z.number().int(),
  holdExpiresAt: z.string(),
  /** Stripe PaymentIntent client secret (stripe-test) or an opaque sandbox value. */
  clientSecret: z.string(),
  provider: z.enum(["sandbox", "stripe-test"]),
});
export type BackCampaignResponse = z.infer<typeof BackCampaignResponse>;

export const BackingStatus = z.object({
  id: z.string().uuid(),
  status: z.string(),
  amountMinor: z.number().int(),
  holdExpiresAt: z.string().nullable(),
  campaign: z.object({ slug: z.string(), title: z.string(), endsAt: z.string().nullable() }),
  perk: z.object({ title: z.string() }),
});
export type BackingStatus = z.infer<typeof BackingStatus>;

export const MoneyState = z.enum(["pending", "held", "with_artist", "released", "refunding", "refunded", "canceled"]);
export type MoneyState = z.infer<typeof MoneyState>;

export const MyBacking = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  amountMinor: z.number().int(),
  quantity: z.number().int(),
  status: z.string(),
  moneyState: MoneyState,
  /** Campaign-level share released to the artist (0–100), not a per-backing figure. */
  releasedPct: z.number().int(),
  refund: z.object({ amountMinor: z.number().int(), at: z.string(), ref: z.string().nullable() }).nullable(),
  campaign: z.object({ id: z.string().uuid(), slug: z.string(), title: z.string(), status: z.string(), endsAt: z.string().nullable(), goalMinor: z.number().int(), raisedMinor: z.number().int() }),
  perk: z.object({ title: z.string(), fulfillBy: z.string(), status: z.string() }),
  next: z.object({ label: z.string(), at: z.string().nullable() }).nullable(),
});
export type MyBacking = z.infer<typeof MyBacking>;

export const Me = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  isStaff: z.boolean(),
  isArtist: z.boolean(),
  needsAcceptance: z.array(z.string()),
  legal: z.object({ termsVersion: z.string(), privacyVersion: z.string() }),
});
export type Me = z.infer<typeof Me>;
