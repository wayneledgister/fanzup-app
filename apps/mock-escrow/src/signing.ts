/**
 * Webhook signatures (design §5): header `x-mock-escrow-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`.
 * Shared by the mock service (signing) and the API (verification).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-mock-escrow-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export function verifySignature(secret: string, body: string, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  if (!header) return { ok: false, reason: "missing" };
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || !/^[0-9a-f]{64}$/.test(parts.v1)) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
