import { describe, expect, it } from "vitest";
import { safeNext } from "../src/safe-next";

const ORIGIN = "https://fanzup.app";
const go = (next: string | null | undefined) => safeNext(next, ORIGIN, "/fallback");

describe("safeNext: only same-origin paths (no open redirects)", () => {
  it("keeps valid same-origin paths, with query and hash", () => {
    expect(go("/backed")).toBe("/backed");
    expect(go("/checkout/nova-live-band-tour?perk=abc-123")).toBe("/checkout/nova-live-band-tour?perk=abc-123");
    expect(go("/campaigns/x#perks")).toBe("/campaigns/x#perks");
    expect(go("/explore?tab=funded&type=Show")).toBe("/explore?tab=funded&type=Show");
  });
  it("falls back when next is missing or not a path", () => {
    expect(go(null)).toBe("/fallback");
    expect(go(undefined)).toBe("/fallback");
    expect(go("")).toBe("/fallback");
    expect(go("backed")).toBe("/fallback");
    expect(go("javascript:alert(1)")).toBe("/fallback");
  });
  it("rejects other origins and protocol-relative URLs", () => {
    expect(go("https://evil.com")).toBe("/fallback");
    expect(go("//evil.com")).toBe("/fallback");
    expect(go("//evil.com/backed")).toBe("/fallback");
    expect(go("https://fanzup.app.evil.com/x")).toBe("/fallback");
  });
  it("rejects backslashes (browsers read \\ as /)", () => {
    expect(go("/\\evil.com")).toBe("/fallback");
    expect(go("/\\/evil.com")).toBe("/fallback");
    expect(go("/%5Cevil.com")).toBe("/fallback");
  });
  it("rejects control characters, raw or percent-encoded (browsers strip tab/newline)", () => {
    expect(go("/%09/evil.com")).toBe("/fallback");
    expect(go("/\t/evil.com")).toBe("/fallback");
    expect(go("/\n/evil.com")).toBe("/fallback");
    expect(go("/%0a/evil.com")).toBe("/fallback");
    expect(go("/%2F/evil.com")).toBe("/fallback");
  });
  it("rejects malformed percent-encoding", () => {
    expect(go("/%E0%A4%A")).toBe("/fallback");
  });
});
