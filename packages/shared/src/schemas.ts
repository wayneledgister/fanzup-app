/** Request/response contracts shared by apps/web and apps/api. */
import { z } from "zod";

export const BackCampaignRequest = z.object({
  campaignId: z.string().uuid(),
  perkId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
});
export type BackCampaignRequest = z.infer<typeof BackCampaignRequest>;

export const BackCampaignResponse = z.object({
  backingId: z.string().uuid(),
  amountMinor: z.number().int(),
  /** Stripe PaymentIntent client secret for the web checkout. */
  clientSecret: z.string(),
});
export type BackCampaignResponse = z.infer<typeof BackCampaignResponse>;

export const CampaignSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  goalMinor: z.number().int(),
  raisedMinor: z.number().int(),
  backers: z.number().int(),
  endsAt: z.string(),
  artist: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
});
export type CampaignSummary = z.infer<typeof CampaignSummary>;
