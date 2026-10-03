/**
 * Browser → API client. The API is the `api` Vercel service, publicly routed at /api on the SAME
 * domain as this app, so the default base is the relative path "/api" — no hostnames, no CORS.
 * Set VITE_API_URL only to point a build at an API on another origin.
 *
 * (Not wired into pages yet — the prototype still renders src/lib/mock.ts. See specs/backlog.md.)
 */
import type { BackCampaignRequest } from "@fanzup/shared/schemas";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string; idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "error", body?.message ?? "Something went wrong.");
  return body as T;
}

export interface CampaignCard {
  id: string;
  slug: string;
  title: string;
  type: string;
  blurb: string | null;
  status: string;
  goalMinor: number;
  raisedMinor: number;
  backers: number;
  endsAt: string | null;
  milestoneRelease: boolean;
  artist: { id: string; slug: string; name: string; genre: string | null; city: string | null; tier: string };
}

export const api = {
  health: () => request<{ ok: boolean; escrow: string }>("/health"),
  campaigns: () => request<{ campaigns: CampaignCard[] }>("/v1/campaigns"),
  campaign: (slug: string) => request<{ campaign: CampaignCard; perks: unknown[]; tranches: unknown[] }>(`/v1/campaigns/${encodeURIComponent(slug)}`),
  /** idempotencyKey must be stable across retries of the same click (e.g. crypto.randomUUID() per checkout). */
  back: (body: BackCampaignRequest, token: string, idempotencyKey: string) =>
    request<{ backingId: string; amountMinor: number; clientSecret: string }>("/v1/backings", {
      method: "POST",
      body: JSON.stringify(body),
      token,
      idempotencyKey,
    }),
};
