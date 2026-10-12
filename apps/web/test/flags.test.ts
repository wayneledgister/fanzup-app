/**
 * L2-T-012 (PR #10 review round 2, finding 6): a production build shows Layer 2 only when the server says so.
 * `useFlag(flag)` is `resolveFlag(flag, isEnabled(flag), cfg.flags)`; these tests drive both halves with a stubbed
 * browser (URL `?flags=layer2` + sessionStorage) and a stubbed `import.meta.env`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubBrowser(search: string, stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  vi.stubGlobal("window", { location: { href: `http://localhost:5173/pools${search}`, origin: "http://localhost:5173" } });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

async function load() {
  vi.resetModules();
  return import("../src/lib/flags");
}

describe("layer2 flag (L2-T-012)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("production build: ?flags=layer2, sessionStorage and VITE_FLAG_LAYER2 are ignored; only the server flag counts", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_FLAG_LAYER2", "true");
    stubBrowser("?flags=layer2", { "fanzup.flags": JSON.stringify({ layer2: true }) });
    const f = await load();
    expect(f.isEnabled("layer2")).toBe(false);
    // useFlag('layer2') while /v1/config says off, says on, or hasn't loaded yet
    expect(f.resolveFlag("layer2", f.isEnabled("layer2"), { layer2: false })).toBe(false);
    expect(f.resolveFlag("layer2", f.isEnabled("layer2"), null)).toBe(false);
    expect(f.resolveFlag("layer2", f.isEnabled("layer2"), { layer2: true })).toBe(true);
    // A completion signal alone never turns the entry flag on.
    expect(f.resolveFlag("layer2", f.isEnabled("layer2"), { layer2: false, layer2Completion: true })).toBe(false);
  });

  it("production build: an override set in this session (setFlag) is ignored too", async () => {
    vi.stubEnv("PROD", true);
    stubBrowser("");
    const f = await load();
    f.setFlag("layer2", true);
    expect(f.isEnabled("layer2")).toBe(false);
    expect(f.resolveFlag("layer2", f.isEnabled("layer2"), { layer2: false })).toBe(false);
  });

  it("dev server: the ?flags= override still reveals the mock-only screens", async () => {
    vi.stubEnv("PROD", false);
    vi.stubEnv("DEV", true);
    const store = stubBrowser("?flags=layer2");
    const f = await load();
    expect(f.isEnabled("layer2")).toBe(true);
    expect(JSON.parse(store.get("fanzup.flags")!)).toEqual({ layer2: true, postBeta: false });
    expect(f.resolveFlag("layer2", f.isEnabled("layer2"), { layer2: false })).toBe(true);
    expect(f.resolveFlag("layer2", false, { layer2: true })).toBe(true);
    expect(f.resolveFlag("layer2", false, { layer2: false })).toBe(false);
  });

  it("dev server: sessionStorage carries the override across pages; VITE_FLAG_LAYER2 is the default", async () => {
    vi.stubEnv("PROD", false);
    stubBrowser("", { "fanzup.flags": JSON.stringify({ layer2: true }) });
    let f = await load();
    expect(f.isEnabled("layer2")).toBe(true);
    stubBrowser("");
    vi.stubEnv("VITE_FLAG_LAYER2", "true");
    f = await load();
    expect(f.isEnabled("layer2")).toBe(true);
  });

  it("postBeta stays a client flag in production builds", async () => {
    vi.stubEnv("PROD", true);
    stubBrowser("?flags=postBeta");
    const f = await load();
    expect(f.isEnabled("postBeta")).toBe(true);
    expect(f.resolveFlag("postBeta", f.isEnabled("postBeta"), { layer2: false })).toBe(true);
  });
});
