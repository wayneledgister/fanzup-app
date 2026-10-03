/**
 * Supabase Auth client (ADR-004). Public values only: the project URL and the publishable (anon) key.
 * When they're missing (e.g. a design-review build), auth screens say sign-in isn't configured here.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Implicit flow: the confirmation link signs in whichever device opens it (cross-device, G2 condition 13).
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { flowType: "implicit", persistSession: true, detectSessionInUrl: true } }) : null;

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Only same-origin paths are allowed as `next` (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/backed"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
