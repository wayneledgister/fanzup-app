/**
 * Marketplace closed-beta access on mobile (CR-007, FR-MKT-012/024). The Services tab and "My service requests" show
 * only when `GET /v1/services/access` says the caller can browse. A convenience only: the API enforces the rules.
 * Joining the beta and accepting the Provider Terms are web-only for now (mobile deprioritised, 2026-11-27).
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import { useConfig } from "./config";
import { useSession } from "./session";

export function useMarketplaceBrowse(): boolean {
  const on = !!useConfig()?.flags?.marketplace;
  const s = useSession();
  const userId = s.session?.user.id ?? null;
  const [can, setCan] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!on) {
      setCan(false);
      return;
    }
    api.marketplaceAccess().then((a) => alive && setCan(a.canBrowse)).catch(() => alive && setCan(false));
    return () => {
      alive = false;
    };
  }, [on, userId]);
  return on && can;
}
