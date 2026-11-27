/** CR-005 MKT-1: shared marketplace rules (FR-MKT-002/003/004/007/008, NFR-MKT-05). */
import { describe, expect, it } from "vitest";
import {
  CATEGORY_KEYS, ListingInput, MKT_OFF_PLATFORM_NOTICE, ProviderProfileInput, ProviderReviewInput, ServiceRequestInput,
  categoryLabel, priceFromLabel, requestStatusCopy, turnaroundLabel,
} from "../src/marketplace";

const profile = { slug: "ada-mixes", displayName: "Ada Mixes", headline: "Mixing for indie rock", remoteOk: true, categories: ["mixing_mastering"], contactEmail: "ada@example.com" };

describe("marketplace shared rules", () => {
  it("has ten categories and never a paid-placement one", () => {
    expect(CATEGORY_KEYS).toHaveLength(10);
    expect(CATEGORY_KEYS.join(",")).not.toMatch(/playlist|placement/);
    expect(categoryLabel("video")).toBe("Music video & film");
    expect(categoryLabel("nope")).toBe("Other");
  });
  it("validates provider profiles", () => {
    expect(ProviderProfileInput.parse(profile).links).toEqual([]);
    expect(ProviderProfileInput.safeParse({ ...profile, categories: [] }).success).toBe(false);
    expect(ProviderProfileInput.safeParse({ ...profile, categories: ["video", "video"] }).success).toBe(false);
    expect(ProviderProfileInput.safeParse({ ...profile, links: ["http://insecure.example.com"] }).success).toBe(false);
    expect(ProviderProfileInput.safeParse({ ...profile, slug: "Bad Slug" }).success).toBe(false);
  });
  it("validates listings and caps the starting price", () => {
    expect(ListingInput.parse({ category: "production", title: "Beat + arrangement" }).priceUnit).toBe("project");
    expect(ListingInput.safeParse({ category: "production", title: "Beat", priceFromMinor: 10_000_001 }).success).toBe(false);
    expect(ListingInput.safeParse({ category: "production", title: "Beat", priceFromMinor: 12.5 }).success).toBe(false);
  });
  it("needs a real brief and an explicit email choice", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(ServiceRequestInput.safeParse({ listingId: id, brief: "too short", shareEmail: true }).success).toBe(false);
    expect(ServiceRequestInput.safeParse({ listingId: id, brief: "Mix 4 songs for an EP due in March." }).success).toBe(false);
    expect(ServiceRequestInput.safeParse({ listingId: id, brief: "Mix 4 songs for an EP due in March.", shareEmail: false }).success).toBe(true);
  });
  it("needs a note unless staff list the provider", () => {
    expect(ProviderReviewInput.safeParse({ decision: "listed", reason: "Checked portfolio" }).success).toBe(true);
    expect(ProviderReviewInput.safeParse({ decision: "changes_requested", reason: "Checked portfolio" }).success).toBe(false);
  });
  it("labels prices as starting-at guides, never fees", () => {
    expect(priceFromLabel(25_000, "song")).toBe("Starting at $250 per song");
    expect(priceFromLabel(null)).toBe("Price on request");
    expect(turnaroundLabel(1)).toBe("About 1 day");
    expect(MKT_OFF_PLATFORM_NOTICE).toMatch(/doesn't handle payment/);
    expect(MKT_OFF_PLATFORM_NOTICE).not.toMatch(/escrow|fee|protected/i);
    expect(requestStatusCopy("accepted").tone).toBe("success");
  });
});
