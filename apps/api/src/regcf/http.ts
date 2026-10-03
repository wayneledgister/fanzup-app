/** HTTP adapter for apps/mock-escrow (ADR-007). A `northcapital` adapter would sit beside this one. */
import { verifySignature } from "@fanzup/mock-escrow/signing";
import { RegCfError, type RegCfEvent, type RegCfProvider } from "./types";

export class HttpMockEscrow implements RegCfProvider {
  readonly name = "mock-escrow" as const;
  constructor(private cfg: { baseUrl: string; apiKey: string; webhookSecret: string }) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, idem?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { "x-api-key": this.cfg.apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idem ? { "idempotency-key": idem } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new RegCfError("retry", "network", `mock-escrow unreachable: ${(e as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) {
      const retry = res.status >= 500 || res.status === 429 || json.error === "funds_pending" || json.error === "insufficient_funds";
      throw new RegCfError(retry ? "retry" : "permanent", json.error ?? `http_${res.status}`, json.message ?? `mock-escrow ${res.status}`, res.status);
    }
    return json as T;
  }

  createIssuer: RegCfProvider["createIssuer"] = (i, idem) => this.call("POST", "/v1/issuers", i, idem);
  createOffering: RegCfProvider["createOffering"] = (i, idem) => this.call("POST", "/v1/offerings", i, idem);
  closeOffering: RegCfProvider["closeOffering"] = (id, idem) => this.call("POST", `/v1/offerings/${encodeURIComponent(id)}/close`, {}, idem);
  createParty: RegCfProvider["createParty"] = (i, idem) => this.call("POST", "/v1/parties", i, idem);
  setPartyKyc: RegCfProvider["setPartyKyc"] = (id, kycStatus, idem) => this.call("POST", `/v1/parties/${encodeURIComponent(id)}/kyc`, { kycStatus }, idem);
  createAccount: RegCfProvider["createAccount"] = (i, idem) => this.call("POST", "/v1/accounts", i, idem);
  createLink: RegCfProvider["createLink"] = (i, idem) => this.call("POST", "/v1/links", i, idem);
  createTrade: RegCfProvider["createTrade"] = (i, idem) => this.call("POST", "/v1/trades", i, idem);
  fundTrade: RegCfProvider["fundTrade"] = (id, i, idem) => this.call("POST", `/v1/trades/${encodeURIComponent(id)}/fund`, i, idem);
  refundTrade: RegCfProvider["refundTrade"] = (id, i, idem) => this.call("POST", `/v1/trades/${encodeURIComponent(id)}/refund`, i, idem);
  disburseToIssuer: RegCfProvider["disburseToIssuer"] = (id, i, idem) => this.call("POST", `/v1/offerings/${encodeURIComponent(id)}/disbursements`, i, idem);
  getEscrow: RegCfProvider["getEscrow"] = (id) => this.call("GET", `/v1/offerings/${encodeURIComponent(id)}/escrow`);
  createCollectionAccount: RegCfProvider["createCollectionAccount"] = (i, idem) => this.call("POST", "/v1/collection-accounts", i, idem);
  getCollectionAccount: RegCfProvider["getCollectionAccount"] = (id) => this.call("GET", `/v1/collection-accounts/${encodeURIComponent(id)}`);
  payoutFromCollection: RegCfProvider["payoutFromCollection"] = (id, i, idem) => this.call("POST", `/v1/collection-accounts/${encodeURIComponent(id)}/payouts`, i, idem);
  simulateDeposit: NonNullable<RegCfProvider["simulateDeposit"]> = (id, i, idem) => this.call("POST", `/v1/collection-accounts/${encodeURIComponent(id)}/deposits`, i, idem);
  advance: NonNullable<RegCfProvider["advance"]> = (seconds) => this.call("POST", "/admin/advance", { seconds });

  parseWebhook(rawBody: string, signature: string | undefined): RegCfEvent {
    return parseSigned(this.cfg.webhookSecret, rawBody, signature);
  }
}

export function parseSigned(secret: string, rawBody: string, signature: string | undefined): RegCfEvent {
  const v = verifySignature(secret, rawBody, signature);
  if (!v.ok) throw new RegCfError("permanent", "bad_signature", `webhook signature ${v.reason}`);
  const e = JSON.parse(rawBody) as { id?: unknown; type?: unknown; createdAt?: unknown; data?: unknown };
  if (typeof e.id !== "string" || typeof e.type !== "string" || typeof e.data !== "object" || !e.data) throw new RegCfError("permanent", "bad_payload", "malformed webhook");
  return { eventId: e.id, type: e.type, createdAt: String(e.createdAt ?? ""), data: e.data as Record<string, unknown> };
}
