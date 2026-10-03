/**
 * Structured JSON logs with the correlation id, and redaction (NFR-SEC-12): authorization headers, cookies,
 * webhook signatures, idempotency keys, client secrets, email addresses and query strings never reach logs.
 */
import { currentCtx } from "./context";

const PATTERNS: [RegExp, string][] = [
  [/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]+/g, "<stripe-key>"],
  [/\bwhsec_[A-Za-z0-9]+/g, "<webhook-secret>"],
  [/\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, "<client-secret>"],
  [/_secret_[A-Za-z0-9]+/g, "_secret_<redacted>"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer <token>"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "<url>"],
];

export function redact(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out.slice(0, 2000);
}

export function log(level: "info" | "warn" | "error" | "alert", msg: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level !== "alert" && !process.env.LOG_IN_TESTS) return;
  const c = currentCtx();
  const line = JSON.stringify({ level, msg, correlationId: c?.correlationId, ...data, time: new Date().toISOString() });
  (level === "error" || level === "alert" ? console.error : console.log)(redact(line));
}

/** Path only (query strings can carry tokens or emails). */
export const pathOnly = (url: string) => url.split("?")[0];
