/** The shared API client (CR-004): the same calls, errors and correlation ids as the web app. */
import { randomUUID } from "expo-crypto";
import { ApiError, createApiClient } from "@fanzup/shared/api-client";
import { env } from "./env";
import { accessToken } from "./supabase";

export const api = createApiClient({ baseUrl: env.apiUrl, getAccessToken: accessToken, newId: randomUUID });
export { ApiError };
