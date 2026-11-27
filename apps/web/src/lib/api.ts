/**
 * Browser → API client. The API is the `api` Vercel service, publicly routed at /api on the SAME domain as this
 * app, so the default base is the relative path "/api". Set VITE_API_URL only to point a build elsewhere.
 * The client itself lives in @fanzup/shared (CR-004) so the mobile app uses exactly the same calls and errors.
 */
import { ApiError, createApiClient } from "@fanzup/shared/api-client";
import { accessToken } from "./supabase";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export const api = createApiClient({ baseUrl: BASE, getAccessToken: accessToken });
export const request = api.request;
export { ApiError };

export type { CampaignCard, PerkView, TrancheView, MyBacking, PublicConfig } from "@fanzup/shared/schemas";
