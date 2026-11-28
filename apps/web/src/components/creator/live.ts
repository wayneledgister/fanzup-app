/**
 * Owner data for the artist screens (CR-006, ADR-011, FR-CMP-009). Only API data: no sample fallback (FR-PLT-002).
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { MyArtist, MyCampaign } from "@fanzup/shared/schemas";

export type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "missing" } | { status: "error" };

/**
 * Loads `fetcher` whenever `key` changes (or `reload()` is called); a newer load aborts the older one so a late
 * answer can't overwrite it. A 404 whose code is in `missingCodes` is `missing`, anything else that fails is `error`.
 */
function useLoad<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, missingCodes: readonly string[]) {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(fetcher);
  latest.current = fetcher;
  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: "loading" });
    latest.current(ctl.signal)
      .then((data) => !ctl.signal.aborted && setState({ status: "ready", data }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setState(e instanceof ApiError && e.status === 404 && missingCodes.includes(e.code) ? { status: "missing" } : { status: "error" });
      });
    return () => ctl.abort();
    // missingCodes is a module constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return [state, () => setNonce((n) => n + 1)] as const;
}

const NO_ARTIST = ["no_artist"] as const;
const NO_CAMPAIGN = ["not_found", "no_artist"] as const;

/** `missing` = the user has no artist profile yet (404 `no_artist`). */
export const useMyArtist = () => useLoad<MyArtist>("artist", (signal) => api.myArtist(signal), NO_ARTIST);

/** `missing` = no such campaign, or not this artist's (the API answers 404 for both). */
export const useMyCampaign = (id: string) => useLoad<MyCampaign>(id, (signal) => api.myCampaign(id, signal), NO_CAMPAIGN);

/** The campaign's public page, on whatever host serves this app. */
export const publicCampaignUrl = (slug: string) => `${window.location.origin}/campaigns/${slug}`;
