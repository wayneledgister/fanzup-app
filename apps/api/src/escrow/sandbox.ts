import { randomUUID } from "node:crypto";
import type { EscrowProvider } from "./provider";

/** No external calls. Used in tests and local dev until a partner sandbox is connected. */
export class SandboxEscrow implements EscrowProvider {
  readonly name = "sandbox";
  readonly confirmsImmediately = true;
  readonly calls: { op: string; input: unknown }[] = [];

  async createPayment(input: Parameters<EscrowProvider["createPayment"]>[0]) {
    this.calls.push({ op: "createPayment", input });
    const paymentRef = `sbx_pi_${input.backingId}`;
    return { paymentRef, clientSecret: `${paymentRef}_secret_${randomUUID().slice(0, 8)}` };
  }
  async refund(input: Parameters<EscrowProvider["refund"]>[0]) {
    this.calls.push({ op: "refund", input });
    return { refundRef: `sbx_re_${input.paymentRef}` };
  }
  async releaseToArtist(input: Parameters<EscrowProvider["releaseToArtist"]>[0]) {
    this.calls.push({ op: "releaseToArtist", input });
    return { payoutRef: `sbx_po_${input.idempotencyKey}` };
  }
}
