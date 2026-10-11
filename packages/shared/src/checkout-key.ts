/**
 * Checkout Idempotency-Key lifecycle (FR-PAY-006; design §4.4 and §11, PR #9 review finding 1).
 *
 * One key per checkout attempt, kept in `sessionStorage` so a reload or a double tap resumes the same backing.
 * The server stores and replays the outcome of a key — including 4xx errors such as `checkout_expired` — so a key
 * whose attempt is over must be thrown away, or "Start again" would replay the dead backing forever.
 *
 * Rule (design §11): mint a new key after ANY 4xx from `POST /backings` (stored `409 checkout_expired`,
 * `403 acceptance_required`, `409 too_many_open_checkouts`, `perk_sold_out`, `campaign_closed`, …) and whenever the
 * backing it points at is no longer payable (hold expired, payment canceled, `canceled`/`refund_pending`/`refunded`).
 * Keep it only after a 502 `provider_unavailable`, a 409 `in_progress` or a network error — those retries must resume
 * the same backing.
 */

/** The parts of `Storage` the helper uses (so tests can pass a plain object). */
export type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** An error from the API client: HTTP status (0 = network) and the API's error code. */
export interface CheckoutError {
  status: number;
  code: string;
}

/** Backing statuses after which the backing can never be paid again. */
export const DEAD_BACKING_STATUSES = ["canceled", "payment_failed", "refund_pending", "refunded"] as const;

export const checkoutKeyName = (slug: string, perkId: string, quantity: number) => `fanzup.checkout.${slug}.${perkId}.${quantity}`;

/** True when a retry with the same key must resume the same backing (design §11). */
export function keepsKeyAfterError(e: CheckoutError): boolean {
  if (e.status === 0 || e.code === "network") return true; // the request may or may not have reached the server
  if (e.status === 409 && e.code === "in_progress") return true; // the first request with this key is still running
  if (e.status >= 400 && e.status < 500) return false; // stored and replayed by the server: a new attempt needs a new key
  return true; // 502 provider_unavailable (and any other 5xx): the claim stays open, resume it
}

/** True when the backing a key points at can't be paid any more. */
export const isDeadBacking = (status: string) => (DEAD_BACKING_STATUSES as readonly string[]).includes(status);

export function checkoutKeys(storage: KeyStorage | null, mint: () => string = () => crypto.randomUUID()) {
  const memory = new Map<string, string>();
  const read = (name: string) => {
    try {
      return storage ? storage.getItem(name) : memory.get(name) ?? null;
    } catch {
      return memory.get(name) ?? null;
    }
  };
  const write = (name: string, v: string) => {
    memory.set(name, v);
    try {
      storage?.setItem(name, v);
    } catch { /* private mode: memory only */ }
  };
  const discard = (name: string) => {
    memory.delete(name);
    try {
      storage?.removeItem(name);
    } catch { /* ignore */ }
  };
  return {
    /** The current key for this checkout, minted on first use. */
    get(name: string): string {
      let v = read(name);
      if (!v) {
        v = mint();
        write(name, v);
      }
      return v;
    },
    /** Forget the key (confirmation, "Start again", or a dead attempt). */
    discard,
    /** After `POST /backings` (or the sandbox pay call) failed. Returns true when the key was discarded. */
    afterError(name: string, e: CheckoutError): boolean {
      if (keepsKeyAfterError(e)) return false;
      discard(name);
      return true;
    },
    /** After polling `GET /backings/:id` (or the hold countdown reaching zero: pass "expired"). */
    afterBackingStatus(name: string, status: string): boolean {
      if (status !== "expired" && !isDeadBacking(status)) return false;
      discard(name);
      return true;
    },
  };
}
