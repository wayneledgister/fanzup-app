import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../src/api-client";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("createApiClient (CR-004: one client for web and mobile)", () => {
  it("sends bearer token, correlation id and idempotency key; drops a trailing slash from the base", async () => {
    const fetch = vi.fn(async () => json(201, { backingId: "b" }));
    const api = createApiClient({ baseUrl: "https://x.test/api/", getAccessToken: async () => "tok", fetch, newId: () => "cid" });
    await api.back({ campaignId: "c", perkId: "p", quantity: 2 }, "key-1");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/api/v1/backings");
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("x-correlation-id")).toBe("cid");
    expect(h.get("idempotency-key")).toBe("key-1");
    expect(h.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ campaignId: "c", perkId: "p", quantity: 2 });
  });

  it("never sends a token on public calls", async () => {
    const fetch = vi.fn(async () => json(200, { provider: "sandbox" }));
    const getAccessToken = vi.fn(async () => "tok");
    const api = createApiClient({ baseUrl: "/api", getAccessToken, fetch });
    await api.config();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("authorization")).toBeNull();
  });

  it("builds the campaign list query", async () => {
    const fetch = vi.fn(async () => json(200, { campaigns: [], nextCursor: null }));
    const api = createApiClient({ baseUrl: "/api", getAccessToken: async () => null, fetch });
    await api.campaigns({ tab: "funded", cursor: "abc" });
    await api.campaigns();
    expect(fetch.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(["/api/v1/campaigns?tab=funded&cursor=abc", "/api/v1/campaigns"]);
  });

  it("maps API errors to ApiError with code, message and correlation id", async () => {
    const fetch = vi.fn(async () => json(409, { error: "perk_sold_out", message: "That perk just sold out.", correlationId: "c-1" }));
    const api = createApiClient({ baseUrl: "/api", getAccessToken: async () => null, fetch });
    const e = await api.campaign("x").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: "perk_sold_out", message: "That perk just sold out.", correlationId: "c-1" });
  });

  it("falls back to the response header and a generic message when the body isn't JSON", async () => {
    const fetch = vi.fn(async () => new Response("oops", { status: 500, headers: { "x-correlation-id": "h-1" } }));
    const api = createApiClient({ baseUrl: "/api", getAccessToken: async () => null, fetch });
    await expect(api.me()).rejects.toMatchObject({ status: 500, code: "error", correlationId: "h-1" });
  });

  it("turns a failed fetch into a network ApiError (status 0)", async () => {
    const fetch = vi.fn(async () => { throw new TypeError("Network request failed"); });
    const api = createApiClient({ baseUrl: "/api", getAccessToken: async () => null, fetch });
    await expect(api.myBackings()).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("swallows funnel-event failures", async () => {
    const fetch = vi.fn(async () => json(500, { error: "x", message: "y" }));
    const api = createApiClient({ baseUrl: "/api", getAccessToken: async () => null, fetch });
    await expect(api.event({ name: "perk_selected", campaignId: "00000000-0000-4000-8000-000000000000", anonId: "00000000-0000-4000-8000-000000000001" })).resolves.toBeNull();
  });
});
