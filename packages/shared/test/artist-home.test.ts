import { describe, expect, it } from "vitest";
import { isInProgress, nextSteps, pickCurrentCampaign } from "../src/artist-home";
import type { MyArtist, MyCampaignSummary } from "../src/schemas";

let n = 0;
const camp = (p: Partial<MyCampaignSummary>): MyCampaignSummary => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  slug: `c-${n}`,
  title: `Campaign ${n}`,
  type: "Show",
  blurb: null,
  status: "draft",
  goalMinor: 100_000,
  raisedMinor: 0,
  backers: 0,
  milestoneRelease: false,
  startsAt: null,
  endsAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...p,
});
const artist = (campaigns: MyCampaignSummary[], over: Partial<MyArtist> = {}): MyArtist => ({
  id: "00000000-0000-4000-8000-0000000000aa", slug: "a", name: "A", tier: "Starter", identityStatus: "verified", payoutAccount: { status: "connected" }, campaigns, ...over,
});

describe("pickCurrentCampaign (FR-CMP-009)", () => {
  it("leads with live, then review, approved, revisions, draft", () => {
    const d = camp({ status: "draft" });
    const r = camp({ status: "in_review" });
    const l = camp({ status: "live", endsAt: "2027-01-01T00:00:00Z" });
    expect(pickCurrentCampaign([d, r, l])).toBe(l);
    expect(pickCurrentCampaign([d, r])).toBe(r);
    expect(pickCurrentCampaign([d, camp({ status: "revisions_requested" })])?.status).toBe("revisions_requested");
  });
  it("picks the live campaign ending soonest, never the one with the most money", () => {
    const rich = camp({ status: "live", raisedMinor: 9_000_000, endsAt: "2027-03-01T00:00:00Z" });
    const soon = camp({ status: "live", raisedMinor: 10, endsAt: "2027-01-01T00:00:00Z" });
    expect(pickCurrentCampaign([rich, soon])).toBe(soon);
  });
  it("falls back to the latest closed campaign and ignores withdrawn ones", () => {
    const old = camp({ status: "closed", endsAt: "2025-06-01T00:00:00Z" });
    const recent = camp({ status: "refunded", endsAt: "2026-06-01T00:00:00Z" });
    expect(pickCurrentCampaign([old, recent])).toBe(recent);
    expect(pickCurrentCampaign([camp({ status: "withdrawn" })])).toBeNull();
    expect(pickCurrentCampaign([])).toBeNull();
  });
});

describe("nextSteps (FR-CMP-009)", () => {
  it("asks for a profile first when there is none", () => {
    expect(nextSteps(null).map((s) => s.id)).toEqual(["profile"]);
  });
  it("puts payout setup first until identity is verified", () => {
    const d = camp({ status: "draft" });
    expect(nextSteps(artist([d], { identityStatus: "todo", payoutAccount: { status: "none" } })).map((s) => s.id)).toEqual(["payout", `submit-${d.id}`]);
    expect(nextSteps(artist([d], { identityStatus: "pending" }))[0].label).toMatch(/Finish setting up/);
    expect(nextSteps(artist([d])).map((s) => s.id)).toEqual([`submit-${d.id}`]);
  });
  it("derives one step per campaign that needs the artist", () => {
    const live = camp({ status: "live" });
    const approved = camp({ status: "approved" });
    const funded = camp({ status: "funded", milestoneRelease: true });
    const done = camp({ status: "closed" });
    const ids = nextSteps(artist([live, approved, funded, done])).map((s) => s.id);
    expect(ids).toEqual([`share-${live.id}`, `publish-${approved.id}`, `evidence-${funded.id}`]);
    expect(nextSteps(artist([live]))[0].to).toBe(`/creator/campaigns/${live.id}#share`);
  });
  it("suggests a first campaign when there are none (withdrawn ones don't count)", () => {
    expect(nextSteps(artist([camp({ status: "withdrawn" })])).map((s) => s.id)).toEqual(["first-campaign"]);
  });
  it("knows which statuses are in progress", () => {
    expect(isInProgress("live")).toBe(true);
    expect(isInProgress("refunded")).toBe(false);
  });
});
