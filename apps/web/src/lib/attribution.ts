/**
 * First-party funnel context (FR-ANL-001 events; no third-party trackers — FR-PRV-005 P0a).
 * An anonymous id per browser session and the `?ref=` source per campaign, kept in sessionStorage only.
 */
const ANON = "fanzup.anon";
export function anonId(): string {
  try {
    let v = sessionStorage.getItem(ANON);
    if (!v) {
      v = crypto.randomUUID();
      sessionStorage.setItem(ANON, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

const clean = (s: string | null) => (s && /^[a-z0-9_-]{1,40}$/.test(s.toLowerCase()) ? s.toLowerCase() : null);
export function rememberSource(slug: string, ref: string | null) {
  const v = clean(ref);
  if (!v) return;
  try {
    sessionStorage.setItem(`fanzup.ref.${slug}`, v);
  } catch { /* storage unavailable */ }
}
export function sourceFor(slug: string): string | undefined {
  try {
    return sessionStorage.getItem(`fanzup.ref.${slug}`) ?? undefined;
  } catch {
    return undefined;
  }
}
