/**
 * In-process adapter over MockEscrowEngine (ADR-007 §3): the same domain logic as the HTTP service, no network.
 * Used by API tests. The engine's webhook deliveries are pointed at the API's webhook route by the test kit.
 */
import { MockError, MockEscrowEngine } from "@fanzup/mock-escrow/engine";
import { parseSigned } from "./http";
import { RegCfError, type RegCfEvent, type RegCfProvider } from "./types";

export class InProcessRegCf implements RegCfProvider {
  readonly name = "mock-escrow" as const;
  /** Test hook: make the next call of `op` fail with this class. */
  private failures: { op: string; cls: "retry" | "permanent"; code: string }[] = [];
  constructor(readonly engine: MockEscrowEngine, private webhookSecret: string) {}

  failNext(op: string, cls: "retry" | "permanent" = "retry", code = `inproc_${cls}`) {
    this.failures.push({ op, cls, code });
  }
  private run<T>(op: string, fn: () => T): Promise<T> {
    const i = this.failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      return Promise.reject(new RegCfError(f.cls, f.code, `${op} failed (${f.code})`));
    }
    try {
      return Promise.resolve(fn());
    } catch (e) {
      if (e instanceof MockError) {
        const retry = e.status >= 500 || e.code === "funds_pending" || e.code === "insufficient_funds";
        return Promise.reject(new RegCfError(retry ? "retry" : "permanent", e.code, e.message, e.status));
      }
      return Promise.reject(e);
    }
  }
  private e = () => this.engine;

  createIssuer: RegCfProvider["createIssuer"] = (i, idem) => this.run("createIssuer", () => this.e().createIssuer(i, idem));
  createOffering: RegCfProvider["createOffering"] = (i, idem) => this.run("createOffering", () => this.e().createOffering(i, idem));
  closeOffering: RegCfProvider["closeOffering"] = (id, idem) => this.run("closeOffering", () => this.e().closeOffering(id, idem) as { id: string; status: string });
  createParty: RegCfProvider["createParty"] = (i, idem) => this.run("createParty", () => this.e().createParty(i, idem) as unknown as { id: string; kycStatus: string });
  setPartyKyc: RegCfProvider["setPartyKyc"] = (id, d, idem) => this.run("setPartyKyc", () => this.e().updatePartyKyc(id, d, idem) as unknown as { id: string; kycStatus: string });
  createAccount: RegCfProvider["createAccount"] = (i, idem) => this.run("createAccount", () => this.e().createAccount(i, idem));
  createLink: RegCfProvider["createLink"] = (i, idem) => this.run("createLink", () => this.e().createLink(i, idem));
  createTrade: RegCfProvider["createTrade"] = (i, idem) => this.run("createTrade", () => this.e().createTrade(i, idem));
  fundTrade: RegCfProvider["fundTrade"] = (id, i, idem) => this.run("fundTrade", () => this.e().fundTrade(id, i, idem) as unknown as { id: string; status: string });
  refundTrade: RegCfProvider["refundTrade"] = (id, i, idem) => this.run("refundTrade", () => this.e().refundTrade(id, i, idem));
  disburseToIssuer: RegCfProvider["disburseToIssuer"] = (id, i, idem) => this.run("disburse", () => this.e().disburseToIssuer(id, i, idem));
  getEscrow: RegCfProvider["getEscrow"] = (id) => this.run("getEscrow", () => this.e().getEscrow(id) as { balance: number; status: string });
  createCollectionAccount: RegCfProvider["createCollectionAccount"] = (i, idem) => this.run("createCollectionAccount", () => this.e().createCollectionAccount(i, idem));
  getCollectionAccount: RegCfProvider["getCollectionAccount"] = (id) => this.run("getCollectionAccount", () => this.e().getCollectionAccount(id));
  payoutFromCollection: RegCfProvider["payoutFromCollection"] = (id, i, idem) => this.run("payout", () => this.e().payoutFromCollection(id, i, idem));
  simulateDeposit: NonNullable<RegCfProvider["simulateDeposit"]> = (id, i, idem) => this.run("deposit", () => this.e().simulateDeposit(id, i, idem));
  advance: NonNullable<RegCfProvider["advance"]> = (seconds) => this.e().advance(seconds);

  parseWebhook(rawBody: string, signature: string | undefined): RegCfEvent {
    return parseSigned(this.webhookSecret, rawBody, signature);
  }
}
