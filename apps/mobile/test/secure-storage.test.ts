import { describe, expect, it } from "vitest";
import { chunkedStorage, safeKey, type KeyValueStore } from "../src/lib/secure-storage";

const memStore = () => {
  const m = new Map<string, string>();
  const store: KeyValueStore = {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => void m.set(k, v),
    deleteItemAsync: async (k) => void m.delete(k),
  };
  return { m, store };
};

describe("chunked SecureStore adapter (NFR-MOB-02)", () => {
  it("round-trips a value larger than one chunk", async () => {
    const { m, store } = memStore();
    const s = chunkedStorage(store, 10);
    const v = "x".repeat(35) + "end";
    await s.setItem("sb-abc-auth-token", v);
    expect(await s.getItem("sb-abc-auth-token")).toBe(v);
    expect(m.get("sb-abc-auth-token.n")).toBe("4");
    for (const k of m.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  it("overwriting with a shorter value removes stale chunks", async () => {
    const { m, store } = memStore();
    const s = chunkedStorage(store, 10);
    await s.setItem("k", "a".repeat(50));
    await s.setItem("k", "short");
    expect(await s.getItem("k")).toBe("short");
    expect([...m.keys()].sort()).toEqual(["k.0", "k.n"]);
  });
  it("remove clears every part; missing keys read as null", async () => {
    const { m, store } = memStore();
    const s = chunkedStorage(store, 4);
    await s.setItem("k", "abcdefghij");
    await s.removeItem("k");
    expect(m.size).toBe(0);
    expect(await s.getItem("k")).toBeNull();
  });
  it("a torn write (missing part) reads as signed out, not half a token", async () => {
    const { m, store } = memStore();
    const s = chunkedStorage(store, 4);
    await s.setItem("k", "abcdefghij");
    m.delete("k.1");
    expect(await s.getItem("k")).toBeNull();
  });
  it("stores the empty string", async () => {
    const { store } = memStore();
    const s = chunkedStorage(store);
    await s.setItem("k", "");
    expect(await s.getItem("k")).toBe("");
  });
  it("sanitises keys", () => {
    expect(safeKey("sb:proj/auth token")).toBe("sb_proj_auth_token");
  });
});
