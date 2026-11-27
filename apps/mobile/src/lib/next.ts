/** Pure, unit-tested: which in-app paths may follow sign-in (FR-BCK-002). */
const ALLOWED = [/^\/checkout\/[a-z0-9-]+(\?perk=[0-9a-f-]{36})?$/i, /^\/campaigns\/[a-z0-9-]+$/i, /^\/(backed|account)?$/];

/** Only known in-app paths may be a `next` target; anything else falls back (no open redirects). */
export function safeAppNext(next: string | string[] | null | undefined, fallback = "/"): string {
  const n = Array.isArray(next) ? next[0] : next;
  if (!n || !n.startsWith("/") || n.startsWith("//")) return fallback;
  return ALLOWED.some((r) => r.test(n)) ? n : fallback;
}

