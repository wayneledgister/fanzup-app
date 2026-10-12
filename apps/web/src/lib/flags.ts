/**
 * Feature flags (docs/CONSOLIDATION.md).
 *  - layer2:   Reg CF securities surfaces (investor KYC, investing, holdings, revenue-share Pools). A SERVER flag
 *              (CR-002, L2 design §2): the API serves Layer 2 only with the mock Reg CF provider (local/CI) and the
 *              database flag on, and reports it as `flags.layer2` in GET /v1/config.
 *  - postBeta: Post-Beta surfaces (secondary soft transfer, holder votes). A client flag.
 *
 * Client overrides — `VITE_FLAG_<NAME>=true` at build time, or `?flags=layer2,postBeta` in the URL (kept for the
 * browser session) — work for every flag in the dev server. In a PRODUCTION build (`import.meta.env.PROD`) they are
 * ignored for `layer2` (L2-T-012, PR #10 review round 2 finding 6): `useFlag('layer2')` is exactly the server's
 * `cfg.flags.layer2`, so a deployed bundle can never reveal Layer 2 screens the server hasn't turned on. Screenshots of
 * gated pages come from the dev server or from a local API with the server flag on (docs/BUILD_CONVENTIONS.md).
 */
import { useSyncExternalStore } from "react";
import { useConfig } from "./config";

export type Flag = "layer2" | "postBeta";
const ALL: Flag[] = ["layer2", "postBeta"];
const KEY = "fanzup.flags";

/** True in a production build. A function so tests can stub `import.meta.env.PROD`. */
const isProd = () => !!(import.meta.env as Record<string, unknown>).PROD;

/** Flags whose client overrides a production build ignores (the server decides). */
const SERVER_ONLY_IN_PROD: ReadonlySet<Flag> = new Set(["layer2"]);

function envDefault(flag: Flag): boolean {
  if (isProd() && SERVER_ONLY_IN_PROD.has(flag)) return false;
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

/** The client side of a flag: browser override, else the build-time env. Never true for `layer2` in a production build. */
export function isEnabled(flag: Flag): boolean {
  if (isProd() && SERVER_ONLY_IN_PROD.has(flag)) return false;
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

/** Re-reads the URL/sessionStorage overrides (tests; a page that changes `?flags=` without a reload). */
export function reloadOverrides() {
  overrides = typeof window === "undefined" ? {} : readOverrides();
  listeners.forEach((l) => l());
}

/** Server flags as GET /v1/config reports them (null while loading or when the API is unreachable). */
export type ServerFlags = { layer2?: boolean; layer2Completion?: boolean } | null | undefined;

/**
 * The one rule for whether a flag is on (pure; unit-tested in test/flags.test.ts):
 *  - `layer2` in a production build: the server flag only;
 *  - `layer2` in the dev server: the client override/env OR the server flag (the override reveals mock-only screens;
 *    the API still refuses Layer 2 data unless its own flag is on — FR-PLT-001);
 *  - other flags: the client override/env.
 */
export function resolveFlag(flag: Flag, client: boolean, server: ServerFlags, prod = isProd()): boolean {
  if (flag !== "layer2") return client;
  const serverOn = !!server?.layer2;
  return prod ? serverOn : client || serverOn;
}

export function useFlag(flag: Flag): boolean {
  const cfg = useConfig();
  const client = useClientFlag(flag);
  return resolveFlag(flag, client, cfg?.flags);
}

/**
 * Layer 2 completion paths (L2 design §2, round 5 finding 3; L2-T-038): with the server flag OFF, money already in
 * flight still finishes and an investor can still read and cancel an open investment. The API exposes those routes
 * only with the mock provider configured (never in a deployed environment) and reports it as
 * `flags.layer2Completion`. Never derived from a client override, so a production build can't render it unless the
 * server says so — and a deployed server never does.
 */
export function useLayer2Completion(): boolean {
  const cfg = useConfig();
  return !!cfg?.flags?.layer2Completion;
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
