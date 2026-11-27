/** Ids minted on the device: funnel anon id (FR-ANL-001) and checkout Idempotency-Keys (FR-PAY-006). */
import { randomUUID } from "expo-crypto";
import { checkoutKeys } from "@fanzup/shared/checkout-key";

let anon: string | null = null;
/** One anonymous id per app process (no persistent tracking id; FR-PRV-005 consent comes later). */
export const anonId = () => (anon ??= randomUUID());

/** In memory for the app's life (NFR-MOB-02): a retry or a double tap resumes the same backing. */
export const keys = checkoutKeys(null, randomUUID);
