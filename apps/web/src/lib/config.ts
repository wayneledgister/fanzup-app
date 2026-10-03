/** Public API configuration (provider, test mode, Stripe publishable key), fetched once per page load. */
import { useEffect, useState } from "react";
import { api, type PublicConfig } from "./api";

let cached: Promise<PublicConfig | null> | null = null;
export function loadConfig(): Promise<PublicConfig | null> {
  cached ??= api.config().catch(() => {
    cached = null; // retry on next use
    return null;
  });
  return cached;
}

export function useConfig(): PublicConfig | null {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
