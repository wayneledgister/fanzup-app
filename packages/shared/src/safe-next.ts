/**
 * Post-auth redirect guard (no open redirects; PR #9 review round 2, finding 4).
 *
 * `next` comes from the URL (`/login?next=…`, `/signup?next=…`, the confirmation link), so it is attacker-controlled.
 * Only a same-origin path is accepted:
 *  - raw and percent-decoded forms must start with a single "/" (not "//"), with no backslash and no control character
 *    (browsers strip tab/newline and treat "\" as "/", so "/\t/evil.com" or "/\evil.com" would become "//evil.com");
 *  - resolved with `new URL(next, origin)`, it must stay on `origin` with a path starting "/" but not "//".
 * Returns the normalised path + search + hash, or `fallback`.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

const looksSafe = (s: string) => s.startsWith("/") && !s.startsWith("//") && !UNSAFE.test(s);

export function safeNext(next: string | null | undefined, origin: string, fallback = "/backed"): string {
  if (!next || !looksSafe(next)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  if (!looksSafe(decoded)) return fallback;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return fallback;
  return url.pathname + url.search + url.hash;
}
