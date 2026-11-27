/**
 * Supabase Auth on React Native (FR-MOB-003; Supabase's documented RN pattern). Public values only.
 * The session lives in the keystore (chunked SecureStore); tokens refresh while the app is in the foreground.
 */
import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authConfigured, env } from "./env";
import { chunkedStorage } from "./secure-storage";

export const supabase: SupabaseClient | null = authConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { storage: chunkedStorage(SecureStore), autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    })
  : null;

if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
