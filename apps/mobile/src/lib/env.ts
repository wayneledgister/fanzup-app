/**
 * Build-time public configuration (mobile design §6). EXPO_PUBLIC_* values are inlined by Metro at build time;
 * they must be read as literal `process.env.EXPO_PUBLIC_X` expressions.
 */
const trim = (s: string | undefined) => (s ?? "").trim().replace(/\/$/, "");

export const env = {
  apiUrl: trim(process.env.EXPO_PUBLIC_API_URL),
  webUrl: trim(process.env.EXPO_PUBLIC_WEB_URL),
  supabaseUrl: trim(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim(),
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV ?? "local").trim(),
};

export const apiConfigured = !!env.apiUrl;
export const authConfigured = !!env.supabaseUrl && !!env.supabaseAnonKey;

/** The host shown on the Account tab for support (FR-MOB-007). */
export const apiHost = (() => {
  try {
    return env.apiUrl ? new URL(env.apiUrl).host : "not configured";
  } catch {
    return env.apiUrl || "not configured";
  }
})();
