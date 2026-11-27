import { describe, expect, it } from "vitest";
import { safeAppNext } from "../src/lib/next";

describe("safeAppNext (FR-BCK-002, no open redirects)", () => {
  it("allows known in-app paths", () => {
    expect(safeAppNext("/checkout/summer-tour?perk=6f1c3b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f")).toBe("/checkout/summer-tour?perk=6f1c3b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f");
    expect(safeAppNext("/campaigns/summer-tour")).toBe("/campaigns/summer-tour");
    expect(safeAppNext("/backed")).toBe("/backed");
    expect(safeAppNext("/")).toBe("/");
  });
  it("rejects everything else", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/checkout/x?perk=1&next=//evil", "/staff/queue", "javascript:alert(1)", "", undefined, null]) {
      expect(safeAppNext(bad as string, "/fallback")).toBe("/fallback");
    }
  });
  it("takes the first of repeated params", () => {
    expect(safeAppNext(["/backed", "https://evil.example"])).toBe("/backed");
  });
});
