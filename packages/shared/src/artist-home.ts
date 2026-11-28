/**
 * Artist home rules (CR-006, FR-CMP-009, ADR-011): which campaign the dashboard leads with and which next steps it
 * shows, derived only from the owner API's data. Shared so web and mobile show the same thing.
 */
import type { CampaignStatus } from "./campaign";
import { POLICY } from "./policy";
import type { MyArtist, MyCampaignSummary } from "./schemas";

/** Campaigns still being built, reviewed or collecting money. */
export const IN_PROGRESS_STATUSES: readonly CampaignStatus[] = ["draft", "in_review", "revisions_requested", "approved", "live"];
export const isInProgress = (s: CampaignStatus) => IN_PROGRESS_STATUSES.includes(s);

/** Dashboard order: the campaign that needs the artist most comes first. Closed campaigns follow, newest first. */
const LEAD_ORDER: readonly CampaignStatus[] = ["live", "in_review", "approved", "revisions_requested", "draft"];

const recency = (c: MyCampaignSummary) => Date.parse(c.endsAt ?? c.updatedAt) || 0;

/** The campaign the artist home leads with, or null when there's nothing to show (no campaigns, or only withdrawn ones). */
export function pickCurrentCampaign(campaigns: readonly MyCampaignSummary[]): MyCampaignSummary | null {
  for (const s of LEAD_ORDER) {
    const same = campaigns.filter((c) => c.status === s);
    if (!same.length) continue;
    // Several live campaigns: the one ending soonest. Several drafts/reviews: the most recently touched.
    return s === "live"
      ? [...same].sort((a, b) => (Date.parse(a.endsAt ?? "") || Infinity) - (Date.parse(b.endsAt ?? "") || Infinity))[0]
      : [...same].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  }
  const closed = campaigns.filter((c) => c.status !== "withdrawn");
  return closed.length ? [...closed].sort((a, b) => recency(b) - recency(a))[0] : null;
}

export interface NextStep {
  id: string;
  label: string;
  detail: string;
  /** In-app path. */
  to: string;
}

/**
 * Next steps for the artist home, most important first. `artist` null means no artist profile yet.
 * Every step comes from real state; nothing here is a placeholder task.
 */
export function nextSteps(artist: MyArtist | null): NextStep[] {
  if (!artist) {
    return [{ id: "profile", label: "Create your artist profile", detail: "Your name, city and genre, so fans know who they're backing.", to: "/artist-onboarding/basic" }];
  }
  const steps: NextStep[] = [];
  const live = artist.campaigns.filter((c) => c.status !== "withdrawn");
  for (const c of live) {
    const page = `/creator/campaigns/${c.id}`;
    switch (c.status) {
      case "revisions_requested":
        steps.push({ id: `revise-${c.id}`, label: `Answer the review notes on "${c.title}"`, detail: "Our reviewers asked for changes. Make them and submit again.", to: page });
        break;
      case "approved":
        steps.push({ id: `publish-${c.id}`, label: `Publish "${c.title}"`, detail: "It passed review. Publishing starts the clock on your deadline.", to: page });
        break;
      case "draft":
        steps.push({ id: `submit-${c.id}`, label: `Finish and submit "${c.title}"`, detail: "Add your perks and milestones, then send it for review.", to: page });
        break;
      case "in_review":
        steps.push({ id: `review-${c.id}`, label: `"${c.title}" is in review`, detail: `We'll email you when it's approved or needs changes, ${POLICY.campaign.reviewEstimate}.`, to: page });
        break;
      case "live":
        steps.push({ id: `share-${c.id}`, label: `Share "${c.title}"`, detail: "Post the link where your fans already are. The first week sets the pace.", to: `${page}#share` });
        break;
      case "funded":
        if (c.milestoneRelease) steps.push({ id: `evidence-${c.id}`, label: `Show progress on "${c.title}"`, detail: "Each milestone payment is released after we verify your evidence.", to: page });
        break;
      default:
        break;
    }
  }
  // Submitting needs a ready payout account (M1 design §3.5.2), so it comes before the campaign steps once there's a draft.
  if (artist.identityStatus !== "verified") {
    const started = artist.payoutAccount.status === "connected";
    steps.unshift({
      id: "payout",
      label: started ? "Finish setting up your payout account" : "Connect your payout account",
      detail: "We verify your identity through it, and you need it before a campaign can be submitted.",
      to: "/creator?payout=start",
    });
  }
  if (!live.length) steps.push({ id: "first-campaign", label: "Start your first campaign", detail: "Set a goal, a deadline and the perks you'll deliver.", to: "/creator/campaigns/new/basics" });
  return steps;
}
