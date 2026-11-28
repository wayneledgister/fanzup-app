/**
 * Marketplace closed-beta access on the web (CR-007, FR-MKT-024; design §12.6). Reads `GET /v1/services/access` per
 * signed-in user (cached) so the nav and pages can hide what the caller can't use. A convenience only: the API
 * enforces the same rules on every route (NFR-MKT-09).
 *
 * Every load gets a sequence number and only the latest one may write the cache, so a slow answer for an earlier
 * user, or one computed before a join committed, can't overwrite a newer one (PR #31 review).
 */
import { useEffect, useSyncExternalStore } from "react";
import type { MarketplaceAccess } from "@fanzup/shared/marketplace";
import { api } from "./api";
import { useFlag } from "./flags";
import { useSession } from "./session";

type Entry = { key: string; value: MarketplaceAccess | null; failed: boolean };
let entry: Entry | null = null;
let latest = 0;
let pendingKey: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(key: string, force = false) {
  if (!force && pendingKey === key) return;
  const n = ++latest;
  pendingKey = key;
  api.marketplaceAccess()
    .then((value) => { if (n === latest) entry = { key, value, failed: false }; })
    .catch(() => { if (n === latest) entry = { key, value: null, failed: true }; })
    .finally(() => {
      if (n !== latest) return;
      pendingKey = null;
      emit();
    });
}

/** Ask again now (after redeeming an invite or accepting the Provider Terms); any older answer is ignored. */
export function refreshMarketplaceAccess() {
  const key = entry?.key ?? pendingKey;
  entry = null;
  if (key) load(key, true);
  emit();
}

/** `undefined` while loading; `null` when the flag is off or the check failed. */
export function useMarketplaceAccess(): MarketplaceAccess | null | undefined {
  const on = useFlag("marketplace");
  const s = useSession();
  const key = `${on}:${s.loading ? "loading" : s.session?.user.id ?? "anon"}`;
  const snap = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => entry,
    () => null,
  );
  useEffect(() => {
    if (on && !s.loading && entry?.key !== key) load(key);
  }, [on, s.loading, key, snap]);
  if (!on) return null;
  if (!snap || snap.key !== key) return undefined;
  return snap.value;
}

/**
 * Whether the browse entry points show in the nav. With the server flag on, the access check decides. Only in the dev
 * server, where `?flags=marketplace` can be on with no API flag, does a failed check fall back to the flag.
 */
export function useMarketplaceNav(): boolean {
  const on = useFlag("marketplace");
  const a = useMarketplaceAccess();
  if (!on || a === undefined) return false;
  if (a) return a.canBrowse;
  return !!import.meta.env.DEV;
}
