/**
 * Platform-neutral API client shared by the web app and the mobile app (CR-004, mobile design §2; NFR-MOB-04).
 * Every call carries its own correlation id (NFR-OPS-04). Each client supplies its base URL and how to read the
 * current Supabase access token; `fetch` can be injected for tests.
 */
import type {
  BackCampaignRequest, BackCampaignResponse, BackingStatus, CampaignDetail, CampaignList, Me, MyBacking, PublicConfig, FunnelEventRequest,
} from "./schemas";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId?: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export const NETWORK_MESSAGE = "We couldn't reach FanZuP. Check your connection and try again.";

export interface ApiClientOptions {
  /** e.g. "/api" on the web, "https://example.com/api" on mobile. A trailing slash is dropped. */
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  newId?: () => string;
}

export type RequestOptions = RequestInit & { auth?: boolean; idempotencyKey?: string };

const defaultId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const newId = opts.newId ?? defaultId;

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const doFetch = opts.fetch ?? fetch;
    const { auth, idempotencyKey, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (rest.body) headers.set("content-type", "application/json");
    headers.set("x-correlation-id", newId());
    if (auth !== false) {
      const t = await opts.getAccessToken();
      if (t) headers.set("authorization", `Bearer ${t}`);
    }
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...rest, headers });
    } catch {
      throw new ApiError(0, "network", NETWORK_MESSAGE);
    }
    const body = res.status === 204 || res.status === 202 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, body?.error ?? "error", body?.message ?? "Something went wrong on our side.", body?.correlationId ?? res.headers.get("x-correlation-id") ?? undefined, body ?? undefined);
    }
    return body as T;
  }

  return {
    request,
    config: () => request<PublicConfig>("/v1/config", { auth: false }),
    campaigns: (p: { tab?: "live" | "funded"; type?: string; cursor?: string | null } = {}, signal?: AbortSignal) => {
      const q = new URLSearchParams();
      if (p.tab) q.set("tab", p.tab);
      if (p.type) q.set("type", p.type);
      if (p.cursor) q.set("cursor", p.cursor);
      const qs = q.toString();
      return request<CampaignList>(`/v1/campaigns${qs ? `?${qs}` : ""}`, { signal });
    },
    campaign: (slug: string) => request<CampaignDetail>(`/v1/campaigns/${encodeURIComponent(slug)}`),
    me: () => request<Me>("/v1/me"),
    accept: (documents: { kind: "terms" | "privacy" | "adult_attestation"; version: string }[]) =>
      request<{ ok: true }>("/v1/me/acceptances", { method: "POST", body: JSON.stringify({ documents }) }),
    /** idempotencyKey must be stable across retries of the same checkout (`checkout-key.ts`). */
    back: (body: BackCampaignRequest, idempotencyKey: string) =>
      request<BackCampaignResponse>("/v1/backings", { method: "POST", body: JSON.stringify(body), idempotencyKey }),
    backing: (id: string) => request<BackingStatus>(`/v1/backings/${encodeURIComponent(id)}`),
    myBackings: () => request<{ backings: MyBacking[] }>("/v1/me/backings"),
    event: (e: FunnelEventRequest) => request<null>("/v1/events", { method: "POST", body: JSON.stringify(e), auth: false }).catch(() => null),
    /** Sandbox provider only (local/CI): what a card form submission does at a real processor. */
    sandboxPay: (backingId: string, outcome: "succeed" | "decline") =>
      request<{ status: string }>(`/v1/dev/sandbox/pay/${encodeURIComponent(backingId)}`, { method: "POST", body: JSON.stringify({ outcome }), auth: false }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
