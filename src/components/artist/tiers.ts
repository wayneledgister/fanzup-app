/**
 * Creator tier gates — PRD 01 §6.3. Single source for the artist area's tier copy.
 * UI names are Starter / Rising / Established / Pro; "Tier 1/2" only as secondary labels.
 */
import type { Requirement } from "./RequirementsChecklist";
import { profileCompletion, type ArtistDraft } from "./draft";

/** Starter reward-campaign cap, in cents. */
export const STARTER_CAMPAIGN_CAP_MINOR = 10_000_00;
export const RISING_MIN_MONTHLY_LISTENERS = 1_000;
export const RISING_MIN_HISTORY_DAYS = 90;

export const STARTER_UNLOCKS = [
  { key: "campaigns", title: "Reward campaigns", body: "Raise up to $10K per campaign from your fans. Funds sit in escrow until you hit your goal." },
  { key: "subs", title: "Subscriptions", body: "Monthly memberships with the access and extras you choose." },
  { key: "merch", title: "Merch", body: "Sell your merch straight to fans from your profile." },
  { key: "tickets", title: "Tickets", body: "Sell tickets to your shows, with presale perks for backers and subscribers." },
  { key: "live", title: "Live streams", body: "Go live with pay-per-view shows and sessions." },
] as const;

export function starterRequirements(
  d: ArtistDraft,
  opts: { identity: "met" | "pending" | "todo" | "blocked"; emailVerified?: boolean },
): Requirement[] {
  const pct = profileCompletion(d);
  const hasTrack = d.trackUrl.trim().length > 0;
  return [
    {
      id: "identity",
      label: "Identity verified",
      detail: opts.identity === "pending" ? "Our identity partner is reviewing your ID and selfie." : "Government ID and a selfie, checked by our identity partner.",
      status: opts.identity,
      action: { to: "/artist-onboarding/verify", label: opts.identity === "blocked" ? "Try verification again" : "Verify your identity" },
    },
    {
      id: "contact",
      label: "Email and phone confirmed",
      detail: d.phoneVerified ? "We'll use these for payout and security alerts." : "Confirm your mobile number with a one-time code.",
      status: d.phoneVerified && opts.emailVerified !== false ? "met" : "todo",
      action: { to: "/artist-onboarding/basic", label: "Confirm your phone" },
    },
    {
      id: "profile",
      label: "Profile 100% complete",
      detail: "Name, genre, city, bio, profile photo and banner.",
      status: pct === 100 ? "met" : "todo",
      value: `${pct}%`,
      action: { to: pct >= 67 ? "/artist-onboarding/media" : "/artist-onboarding/basic", label: "Finish your profile" },
    },
    {
      id: "track",
      label: "One released track linked",
      detail: hasTrack ? d.trackUrl : "Paste a link to a track that's out on a streaming service.",
      status: hasTrack ? "met" : "todo",
      action: { to: "/artist-onboarding/streaming", label: "Link a track" },
    },
  ];
}
