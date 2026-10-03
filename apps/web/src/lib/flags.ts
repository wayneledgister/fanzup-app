/**
 * Feature flags (docs/CONSOLIDATION.md).
 *  - layer2:   Reg CF securities surfaces (investor KYC, investing, holdings, rev-share Pools).
 *              Off until partner funding portal / BD + counsel sign-off (PRD 01 §14, Mechanism 05 §6).
 *  - postBeta: Post-Beta surfaces (secondary soft transfer, holder votes). Mechanism 07, PRD 01 §3.2.
 *
 * Defaults come from env (VITE_FLAG_LAYER2 / VITE_FLAG_POSTBETA = "true").
 * For design review, `?flags=layer2,postBeta` in the URL turns them on for the browser session.
 */
import { useSyncExternalStore } from "react";
import { useConfig } from "./config";

export type Flag = "layer2" | "postBeta";
const ALL: Flag[] = ["layer2", "postBeta"];
const KEY = "fanzup.flags";

function envDefault(flag: Flag): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[`VITE_FLAG_${flag.toUpperCase()}`] === "true";
}

function readOverrides(): Partial<Record<Flag, boolean>> {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("flags");
    if (q !== null) {
      const on = new Set(q.split(",").map((s) => s.trim()));
      const next = Object.fromEntries(ALL.map((f) => [f, on.has(f)])) as Record<Flag, boolean>;
      sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    }
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let overrides = typeof window === "undefined" ? {} : readOverrides();
const listeners = new Set<() => void>();

export function isEnabled(flag: Flag): boolean {
  return overrides[flag] ?? envDefault(flag);
}

export function setFlag(flag: Flag, value: boolean) {
  overrides = { ...overrides, [flag]: value };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable — keep in memory */
  }
  listeners.forEach((l) => l());
}

/**
 * A flag is on when the browser override/env says so, or — for `layer2` — when the API says the server-side flag is
 * on (FR-PLT-001: the server is the gate for data; the client override only reveals mock-only screens).
 */
export function useFlag(flag: Flag): boolean {
  const cfg = useConfig();
  const client = useClientFlag(flag);
  return client || (flag === "layer2" && !!cfg?.flags?.layer2);
}

function useClientFlag(flag: Flag): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => isEnabled(flag),
    () => envDefault(flag),
  );
}

export const allFlags = ALL;
