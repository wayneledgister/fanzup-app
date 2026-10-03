/**
 * Browser → API client. The API is the `api` Vercel service, publicly routed at /api on the SAME domain as this
 * app, so the default base is the relative path "/api". Set VITE_API_URL only to point a build elsewhere.
 * Every call carries its own correlation id (shown with errors so support can trace it — NFR-OPS-04).
 */
import type {
  BackCampaignRequest, BackCampaignResponse, BackingStatus, CampaignDetail, CampaignList, Me, MyBacking, PublicConfig, FunnelEventRequest,
} from "@fanzup/shared/schemas";
import { accessToken } from "./supabase";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId?: string) {
    super(message);
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function request<T>(path: string, init: RequestInit & { auth?: boolean; idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  headers.set("x-correlation-id", newId());
  if (init.auth !== false) {
    const t = await accessToken();
    if (t) headers.set("authorization", `Bearer ${t}`);
  }
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "We couldn't reach FanZuP. Check your connection and try again.");
  }
  const body = res.status === 204 || res.status === 202 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "error", body?.message ?? "Something went wrong on our side.", body?.correlationId ?? res.headers.get("x-correlation-id") ?? undefined);
  return body as T;
}

export const api = {
  config: () => request<PublicConfig>("/v1/config", { auth: false }),
  campaigns: (p: { tab?: "live" | "funded"; type?: string; cursor?: string | null } = {}) => {
    const q = new URLSearchParams();
    if (p.tab) q.set("tab", p.tab);
    if (p.type) q.set("type", p.type);
    if (p.cursor) q.set("cursor", p.cursor);
    return request<CampaignList>(`/v1/campaigns${q.size ? `?${q}` : ""}`);
  },
  campaign: (slug: string) => request<CampaignDetail>(`/v1/campaigns/${encodeURIComponent(slug)}`),
  me: () => request<Me>("/v1/me"),
  accept: (documents: { kind: "terms" | "privacy" | "adult_attestation"; version: string }[]) =>
    request<{ ok: true }>("/v1/me/acceptances", { method: "POST", body: JSON.stringify({ documents }) }),
  /** idempotencyKey must be stable across retries of the same checkout (kept in sessionStorage). */
  back: (body: BackCampaignRequest, idempotencyKey: string) =>
    request<BackCampaignResponse>("/v1/backings", { method: "POST", body: JSON.stringify(body), idempotencyKey }),
  backing: (id: string) => request<BackingStatus>(`/v1/backings/${id}`),
  myBackings: () => request<{ backings: MyBacking[] }>("/v1/me/backings"),
  event: (e: FunnelEventRequest) => request<null>("/v1/events", { method: "POST", body: JSON.stringify(e), auth: false }).catch(() => null),
  /** Sandbox provider only (local/CI): what a card form submission does at a real processor. */
  sandboxPay: (backingId: string, outcome: "succeed" | "decline") =>
    request<{ status: string }>(`/v1/dev/sandbox/pay/${backingId}`, { method: "POST", body: JSON.stringify({ outcome }), auth: false }),
};

export type { CampaignCard, PerkView, TrancheView, MyBacking, PublicConfig } from "@fanzup/shared/schemas";
