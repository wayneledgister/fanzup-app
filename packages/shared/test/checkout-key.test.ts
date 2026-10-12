import { describe, expect, it } from "vitest";
import { checkoutKeyName, checkoutKeys, keepsKeyAfterError, type KeyStorage } from "../src/checkout-key";

/** In-memory stand-in for sessionStorage. */
function fakeStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function setup() {
  let n = 0;
  const storage = fakeStorage();
  const keys = checkoutKeys(storage, () => `key-${++n}`);
  const name = checkoutKeyName("some-show", "perk-a", 1);
  return { storage, keys, name };
}

describe("checkout Idempotency-Key lifecycle (design §11, PR #9 review finding 1)", () => {
  it("one key per checkout attempt, stable across reloads, scoped by campaign, perk and quantity", () => {
    const { storage, keys, name } = setup();
    expect(keys.get(name)).toBe("key-1");
    expect(keys.get(name)).toBe("key-1");
    expect(storage.data.get(name)).toBe("key-1");
    expect(keys.get(checkoutKeyName("some-show", "perk-a", 2))).toBe("key-2");
  });

  it.each([
    [409, "checkout_expired"],
    [403, "acceptance_required"],
    [409, "too_many_open_checkouts"],
    [409, "perk_sold_out"],
    [409, "campaign_closed"],
    [403, "self_backing"],
    [422, "idempotency_key_reused"],
    [400, "invalid_request"],
  ])("mints a new key after a stored %i %s", (status, code) => {
    const { keys, name } = setup();
    const first = keys.get(name);
    expect(keys.afterError(name, { status, code })).toBe(true);
    expect(keys.get(name)).not.toBe(first);
  });

  it.each([
    [502, "provider_unavailable"],
    [409, "in_progress"],
    [0, "network"],
    [500, "internal"],
  ])("keeps the key after %i %s so the retry resumes the same backing", (status, code) => {
    const { keys, name } = setup();
    const first = keys.get(name);
    expect(keys.afterError(name, { status, code })).toBe(false);
    expect(keys.get(name)).toBe(first);
  });

  it.each(["expired", "canceled", "payment_failed", "refund_pending", "refunded"])("mints a new key once the backing is %s", (status) => {
    const { keys, name } = setup();
    const first = keys.get(name);
    expect(keys.afterBackingStatus(name, status)).toBe(true);
    expect(keys.get(name)).not.toBe(first);
  });

  it.each(["pending_payment", "held"])("keeps the key while the backing is %s", (status) => {
    const { keys, name } = setup();
    const first = keys.get(name);
    expect(keys.afterBackingStatus(name, status)).toBe(false);
    expect(keys.get(name)).toBe(first);
  });

  it("discard() after confirmation starts the next checkout fresh", () => {
    const { keys, name } = setup();
    const first = keys.get(name);
    keys.discard(name);
    expect(keys.get(name)).not.toBe(first);
  });

  it("works without storage (private mode): keys live in memory for the page", () => {
    let n = 0;
    const keys = checkoutKeys(null, () => `mem-${++n}`);
    expect(keys.get("x")).toBe("mem-1");
    expect(keys.get("x")).toBe("mem-1");
    keys.afterError("x", { status: 409, code: "checkout_expired" });
    expect(keys.get("x")).toBe("mem-2");
  });

  it("keepsKeyAfterError is the single rule", () => {
    expect(keepsKeyAfterError({ status: 409, code: "in_progress" })).toBe(true);
    expect(keepsKeyAfterError({ status: 409, code: "checkout_expired" })).toBe(false);
  });
});
