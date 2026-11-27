/**
 * Supabase session storage on top of the platform keystore (NFR-MOB-02). SecureStore warns above ~2 KB per item and
 * a Supabase session is larger, so values are split into chunks: `<key>` holds the chunk count, `<key>.<i>` the parts.
 * The store is injected so the chunking can be unit-tested without native modules.
 */
export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const CHUNK_SIZE = 1800;

/** SecureStore keys may only contain letters, digits, ".", "-" and "_". */
export const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export function chunkedStorage(store: KeyValueStore, chunkSize = CHUNK_SIZE) {
  const countKey = (k: string) => `${safeKey(k)}.n`;
  const partKey = (k: string, i: number) => `${safeKey(k)}.${i}`;

  async function removeItem(key: string): Promise<void> {
    const n = Number(await store.getItemAsync(countKey(key))) || 0;
    for (let i = 0; i < n; i++) await store.deleteItemAsync(partKey(key, i));
    await store.deleteItemAsync(countKey(key));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const raw = await store.getItemAsync(countKey(key));
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await store.getItemAsync(partKey(key, i));
        if (p === null) return null; // a torn write: treat as signed out rather than hand back half a token
        parts.push(p);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const n = Math.max(1, Math.ceil(value.length / chunkSize));
      for (let i = 0; i < n; i++) await store.setItemAsync(partKey(key, i), value.slice(i * chunkSize, (i + 1) * chunkSize));
      await store.setItemAsync(countKey(key), String(n)); // written last: readers never see a count without its parts
    },
    removeItem,
  };
}
