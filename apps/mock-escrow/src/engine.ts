/**
 * MockEscrowEngine — the mock Reg CF provider's domain logic (ADR-007). Shaped after North Capital TransactAPI's documented
 * workflow: issuer → offering → party (KYC/AML) → account → link → trade → fund move into escrow → close → disburse;
 * plus refunds and a collection account for royalty deposits and distribution payouts.
 *
 * Sandbox semantics:
 *  - every mutating call takes an idempotency key: same key + same body → the original response; different body → 422;
 *  - state changes that a real provider makes later (KYC decision, ACH settlement, refunds, disbursements, deposits,
 *    payouts) are scheduled jobs on a virtual clock and announced by signed webhooks;
 *  - deterministic triggers: party last name KYCFAIL → KYC rejected, AMLHOLD → manual review; a fund move whose
 *    whole-dollar amount ends in 13 (e.g. $113.00, $2,013.50) is returned (R01).
 * Storage: node:sqlite (file in the service, ":memory:" in tests). Used by the HTTP server and in-process by API tests.
 */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { signPayload, SIGNATURE_HEADER } from "./signing";

export class MockError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface WebhookEnvelope {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}
export type Deliver = (body: string, headers: Record<string, string>, evt: WebhookEnvelope) => Promise<boolean>;

export interface EngineOptions {
  /** sqlite path or ":memory:" */
  db?: string;
  webhookSecret: string;
  deliver?: Deliver;
  /** Seconds of virtual delay per async step (defaults below). */
  delays?: Partial<typeof DEFAULT_DELAYS>;
}

export const DEFAULT_DELAYS = { kyc: 2, fund: 3, refund: 2, disbursement: 2, deposit: 1, payout: 2 };

type Obj = Record<string, unknown> & { id: string };

const SCHEMA = `
create table if not exists objects (id text primary key, type text not null, data text not null, created_at integer not null);
create index if not exists objects_type on objects (type);
create table if not exists idempotency (key text primary key, scope text not null, request_hash text not null, response text not null);
create table if not exists jobs (id integer primary key autoincrement, due_at integer not null, kind text not null, payload text not null, done integer not null default 0);
create table if not exists webhooks (id text primary key, type text not null, body text not null, status text not null default 'pending',
  attempts integer not null default 0, next_at integer not null, last_error text, created_at integer not null);
create table if not exists meta (key text primary key, value text not null);
`;

const dollarsEndIn13 = (amount: number) => Math.floor(amount / 100) % 100 === 13;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");

export class MockEscrowEngine {
  readonly db: DatabaseSync;
  private delays: typeof DEFAULT_DELAYS;
  deliver: Deliver | undefined;

  constructor(private opts: EngineOptions) {
    this.db = new DatabaseSync(opts.db ?? ":memory:");
    this.db.exec(SCHEMA);
    this.delays = { ...DEFAULT_DELAYS, ...opts.delays };
    this.deliver = opts.deliver;
  }

  // ── Clock ─────────────────────────────────────────────────────────────
  get offsetMs(): number {
    const r = this.db.prepare("select value from meta where key = 'offset_ms'").get() as { value: string } | undefined;
    return r ? Number(r.value) : 0;
  }
  now(): number {
    return Date.now() + this.offsetMs;
  }
  /** Move the virtual clock forward and run everything that becomes due. */
  async advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10 * 365 * 86_400) throw new MockError(400, "invalid_advance", "seconds must be between 0 and 10 years");
    this.db.prepare("insert into meta (key, value) values ('offset_ms', ?) on conflict (key) do update set value = excluded.value").run(String(this.offsetMs + Math.round(seconds * 1000)));
    return this.tick();
  }
  /** Run due jobs, then try to deliver pending webhooks. */
  async tick() {
    let jobs = 0;
    for (;;) {
      const j = this.db.prepare("select id, kind, payload from jobs where done = 0 and due_at <= ? order by due_at, id limit 1").get(this.now()) as
        | { id: number; kind: string; payload: string }
        | undefined;
      if (!j) break;
      this.db.prepare("update jobs set done = 1 where id = ?").run(j.id);
      this.runJob(j.kind, JSON.parse(j.payload));
      jobs++;
    }
    const delivered = await this.deliverWebhooks();
    return { jobs, delivered, now: new Date(this.now()).toISOString() };
  }

  // ── Storage helpers ───────────────────────────────────────────────────
  private put(type: string, obj: Obj) {
    this.db.prepare("insert into objects (id, type, data, created_at) values (?, ?, ?, ?) on conflict (id) do update set data = excluded.data")
      .run(obj.id, type, JSON.stringify(obj), this.now());
    return obj;
  }
  get<T extends Obj = Obj>(type: string, id: string): T {
    const r = this.db.prepare("select data from objects where id = ? and type = ?").get(id, type) as { data: string } | undefined;
    if (!r) throw new MockError(404, "not_found", `${type} ${id} not found`);
    return JSON.parse(r.data) as T;
  }
  list<T extends Obj = Obj>(type: string, where: (o: T) => boolean = () => true): T[] {
    return (this.db.prepare("select data from objects where type = ? order by created_at, id").all(type) as { data: string }[])
      .map((r) => JSON.parse(r.data) as T)
      .filter(where);
  }
  private patch<T extends Obj>(type: string, id: string, changes: Partial<T>): T {
    const o = { ...this.get<T>(type, id), ...changes, updatedAt: new Date(this.now()).toISOString() };
    this.put(type, o);
    return o;
  }
  private newId(prefix: string) {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  private schedule(kind: string, seconds: number, payload: Record<string, unknown>) {
    this.db.prepare("insert into jobs (due_at, kind, payload) values (?, ?, ?)").run(this.now() + seconds * 1000, kind, JSON.stringify(payload));
  }
  private emit(type: string, data: Record<string, unknown>) {
    const evt: WebhookEnvelope = { id: `evt_${randomUUID().replace(/-/g, "")}`, type, createdAt: new Date(this.now()).toISOString(), data };
    this.db.prepare("insert into webhooks (id, type, body, next_at, created_at) values (?, ?, ?, ?, ?)").run(evt.id, type, JSON.stringify(evt), Date.now(), Date.now());
  }

  /** Idempotency (TransactAPI-style): replay returns the stored response; a different body under the same key is refused. */
  idempotent<T>(key: string | undefined, scope: string, body: unknown, fn: () => T): T {
    if (!key || key.length < 8 || key.length > 200) throw new MockError(400, "idempotency_key_required", "Send an Idempotency-Key header (8–200 chars).");
    const h = hash({ scope, body });
    const prior = this.db.prepare("select scope, request_hash, response from idempotency where key = ?").get(key) as { scope: string; request_hash: string; response: string } | undefined;
    if (prior) {
      if (prior.request_hash !== h) throw new MockError(422, "idempotency_conflict", "That Idempotency-Key was used for a different request.");
      return JSON.parse(prior.response) as T;
    }
    const res = fn();
    this.db.prepare("insert into idempotency (key, scope, request_hash, response) values (?, ?, ?, ?)").run(key, scope, h, JSON.stringify(res));
    return res;
  }

  // ── Issuers and offerings ─────────────────────────────────────────────
  createIssuer(input: { name: string; entityType?: string; externalId: string }, idem?: string) {
    return this.idempotent(idem, "createIssuer", input, () => {
      if (!input.name) throw new MockError(400, "invalid_request", "name is required");
      return this.put("issuer", { id: this.newId("iss"), name: input.name, entityType: input.entityType ?? "LLC", externalId: input.externalId, status: "active" });
    });
  }

  createOffering(input: { issuerId: string; name: string; targetAmount: number; maxAmount: number; unitPrice: number; endDate: string; externalId: string }, idem?: string) {
    return this.idempotent(idem, "createOffering", input, () => {
      this.get("issuer", input.issuerId);
      for (const k of ["targetAmount", "maxAmount", "unitPrice"] as const) {
        if (!Number.isSafeInteger(input[k]) || input[k] <= 0) throw new MockError(400, "invalid_request", `${k} must be a positive integer (cents)`);
      }
      if (input.targetAmount > input.maxAmount) throw new MockError(400, "invalid_request", "targetAmount can't exceed maxAmount");
      return this.put("offering", { id: this.newId("off"), ...input, status: "open", escrowAccount: this.newId("esc") });
    });
  }

  closeOffering(offeringId: string, idem?: string) {
    return this.idempotent(idem, "closeOffering", { offeringId }, () => {
      const o = this.get("offering", offeringId);
      if (o.status === "closed") return o;
      const pending = this.list("fundMove", (f) => f.offeringId === offeringId && f.status === "pending");
      if (pending.length) throw new MockError(409, "funds_pending", "Fund moves are still settling.");
      const out = this.patch("offering", offeringId, { status: "closed", closedAt: new Date(this.now()).toISOString() });
      this.emit("offering.closed", { offeringId, externalId: o.externalId });
      return out;
    });
  }

  // ── Parties, accounts, links (KYC/AML) ────────────────────────────────
  createParty(input: { firstName: string; lastName: string; state: string; externalId: string }, idem?: string) {
    return this.idempotent(idem, "createParty", input, () => {
      if (!input.firstName || !input.lastName || !/^[A-Z]{2}$/.test(input.state ?? "")) throw new MockError(400, "invalid_request", "firstName, lastName and a 2-letter state are required");
      const party = this.put("party", { id: this.newId("P"), externalId: input.externalId, state: input.state, kycStatus: "pending", amlStatus: "pending",
        // Names stay at the provider (FanZuP stores only the party id). Last name drives the deterministic triggers.
        lastNameUpper: input.lastName.toUpperCase() });
      this.schedule("kyc.decide", this.delays.kyc, { partyId: party.id });
      return party;
    });
  }

  updatePartyKyc(partyId: string, kycStatus: "approved" | "rejected", idem?: string) {
    return this.idempotent(idem, "updatePartyKyc", { partyId, kycStatus }, () => {
      const p = this.patch("party", partyId, { kycStatus, amlStatus: kycStatus === "approved" ? "cleared" : "rejected" });
      this.emit("party.kyc_updated", { partyId, externalId: p.externalId, kycStatus, amlStatus: p.amlStatus, manual: true });
      return p;
    });
  }

  createAccount(input: { partyId: string; externalId: string }, idem?: string) {
    return this.idempotent(idem, "createAccount", input, () => {
      this.get("party", input.partyId);
      return this.put("account", { id: this.newId("A"), partyId: input.partyId, externalId: input.externalId, type: "individual" });
    });
  }

  createLink(input: { accountId: string; partyId: string }, idem?: string) {
    return this.idempotent(idem, "createLink", input, () => {
      this.get("account", input.accountId);
      this.get("party", input.partyId);
      return this.put("link", { id: this.newId("L"), ...input, relationship: "owner" });
    });
  }

  // ── Trades and fund moves into escrow ─────────────────────────────────
  createTrade(input: { offeringId: string; accountId: string; units: number; unitPrice: number; amount: number; externalId: string }, idem?: string) {
    return this.idempotent(idem, "createTrade", input, () => {
      const o = this.get("offering", input.offeringId);
      if (o.status !== "open") throw new MockError(409, "offering_not_open", "The offering isn't open.");
      const acct = this.get("account", input.accountId);
      const party = this.get("party", String(acct.partyId));
      if (party.kycStatus !== "approved") throw new MockError(409, "kyc_not_approved", "The account's party hasn't passed KYC/AML.");
      if (input.amount !== input.units * input.unitPrice) throw new MockError(400, "invalid_request", "amount must equal units × unitPrice");
      return this.put("trade", { id: this.newId("T"), ...input, status: "created" });
    });
  }

  fundTrade(tradeId: string, input: { amount: number; externalId: string }, idem?: string) {
    return this.idempotent(idem, "fundTrade", { tradeId, ...input }, () => {
      const t = this.get("trade", tradeId);
      if (t.status !== "created") throw new MockError(409, "trade_state", `Trade is ${t.status}.`);
      if (input.amount !== t.amount) throw new MockError(400, "invalid_request", "Fund amount must equal the trade amount.");
      const fm = this.put("fundMove", { id: this.newId("FM"), tradeId, offeringId: t.offeringId, amount: input.amount, externalId: input.externalId, status: "pending" });
      this.patch("trade", tradeId, { status: "funding", fundMoveId: fm.id });
      this.schedule("fund.settle", this.delays.fund, { fundMoveId: fm.id });
      return fm;
    });
  }

  getTrade(id: string) {
    return this.get("trade", id);
  }

  refundTrade(tradeId: string, input: { amount: number; externalId: string }, idem?: string) {
    return this.idempotent(idem, "refundTrade", { tradeId, ...input }, () => {
      const t = this.get("trade", tradeId);
      if (t.status !== "funded") throw new MockError(409, "trade_state", `Only a funded trade can be refunded (trade is ${t.status}).`);
      if (input.amount !== t.amount) throw new MockError(400, "invalid_request", "Refunds return the full funded amount.");
      if (this.escrowBalance(String(t.offeringId)) < input.amount) throw new MockError(409, "insufficient_escrow", "Not enough held in escrow.");
      const r = this.put("refund", { id: this.newId("RF"), tradeId, offeringId: t.offeringId, amount: input.amount, externalId: input.externalId, status: "pending" });
      this.patch("trade", tradeId, { status: "refunding" });
      this.schedule("refund.settle", this.delays.refund, { refundId: r.id });
      return r;
    });
  }

  disburseToIssuer(offeringId: string, input: { amount: number; externalId: string }, idem?: string) {
    return this.idempotent(idem, "disburse", { offeringId, ...input }, () => {
      const o = this.get("offering", offeringId);
      if (o.status !== "closed") throw new MockError(409, "offering_not_closed", "Escrow is released only after the offering closes.");
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new MockError(400, "invalid_request", "amount must be positive");
      if (this.escrowBalance(offeringId) < input.amount) throw new MockError(409, "insufficient_escrow", "Not enough held in escrow.");
      const d = this.put("disbursement", { id: this.newId("DB"), offeringId, amount: input.amount, externalId: input.externalId, status: "pending" });
      this.schedule("disbursement.settle", this.delays.disbursement, { disbursementId: d.id });
      return d;
    });
  }

  /** Escrow balance: settled fund moves − settled refunds − settled disbursements (pending outflows reserved). */
  escrowBalance(offeringId: string, settledOnly = false) {
    const inn = this.list("fundMove", (f) => f.offeringId === offeringId && f.status === "settled").reduce((s, f) => s + Number(f.amount), 0);
    const outStatuses = settledOnly ? ["settled"] : ["settled", "pending"];
    const out = [...this.list("refund", (r) => r.offeringId === offeringId), ...this.list("disbursement", (d) => d.offeringId === offeringId)]
      .filter((x) => outStatuses.includes(String(x.status)))
      .reduce((s, x) => s + Number(x.amount), 0);
    return inn - out;
  }
  getEscrow(offeringId: string) {
    const o = this.get("offering", offeringId);
    return { offeringId, status: o.status, balance: this.escrowBalance(offeringId, true), available: this.escrowBalance(offeringId) };
  }

  // ── Collection account (royalty deposits → distributions) ────────────
  createCollectionAccount(input: { offeringId: string; externalId: string }, idem?: string) {
    return this.idempotent(idem, "createCollectionAccount", input, () => {
      this.get("offering", input.offeringId);
      return this.put("collectionAccount", { id: this.newId("CA"), ...input });
    });
  }
  collectionBalance(id: string, settledOnly = false) {
    const inn = this.list("deposit", (d) => d.collectionAccountId === id && d.status === "settled").reduce((s, d) => s + Number(d.amount), 0);
    const outStatuses = settledOnly ? ["settled"] : ["settled", "pending"];
    const out = this.list("payout", (p) => p.collectionAccountId === id && outStatuses.includes(String(p.status))).reduce((s, p) => s + Number(p.amount), 0);
    return inn - out;
  }
  getCollectionAccount(id: string) {
    this.get("collectionAccount", id);
    return { id, balance: this.collectionBalance(id, true), available: this.collectionBalance(id) };
  }
  /** Test trigger: a distributor/lockbox settlement arrives in the collection account. */
  simulateDeposit(collectionAccountId: string, input: { amount: number; reference: string; externalId: string }, idem?: string) {
    return this.idempotent(idem, "deposit", { collectionAccountId, ...input }, () => {
      this.get("collectionAccount", collectionAccountId);
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new MockError(400, "invalid_request", "amount must be positive");
      const d = this.put("deposit", { id: this.newId("DP"), collectionAccountId, ...input, status: "pending" });
      this.schedule("deposit.settle", this.delays.deposit, { depositId: d.id });
      return d;
    });
  }
  payoutFromCollection(collectionAccountId: string, input: { recipientType: "investor" | "issuer" | "platform"; recipientRef: string; amount: number; externalId: string }, idem?: string) {
    return this.idempotent(idem, "payout", { collectionAccountId, ...input }, () => {
      this.get("collectionAccount", collectionAccountId);
      if (input.recipientType === "investor") this.get("account", input.recipientRef);
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new MockError(400, "invalid_request", "amount must be positive");
      if (this.collectionBalance(collectionAccountId) < input.amount) throw new MockError(409, "insufficient_funds", "Not enough in the collection account.");
      const p = this.put("payout", { id: this.newId("PO"), collectionAccountId, ...input, status: "pending" });
      this.schedule("payout.settle", this.delays.payout, { payoutId: p.id });
      return p;
    });
  }

  // ── Jobs (what the provider does later) ───────────────────────────────
  private runJob(kind: string, p: Record<string, string>) {
    const at = new Date(this.now()).toISOString();
    switch (kind) {
      case "kyc.decide": {
        const party = this.get("party", p.partyId);
        if (party.kycStatus !== "pending") return;
        const last = String(party.lastNameUpper);
        const kycStatus = last === "KYCFAIL" ? "rejected" : last === "AMLHOLD" ? "manual_review" : "approved";
        const amlStatus = last === "AMLHOLD" ? "hold" : kycStatus === "approved" ? "cleared" : "rejected";
        this.patch("party", party.id, { kycStatus, amlStatus });
        this.emit("party.kyc_updated", { partyId: party.id, externalId: party.externalId, kycStatus, amlStatus });
        return;
      }
      case "fund.settle": {
        const fm = this.get("fundMove", p.fundMoveId);
        if (fm.status !== "pending") return;
        const trade = this.get("trade", String(fm.tradeId));
        if (dollarsEndIn13(Number(fm.amount))) {
          this.patch("fundMove", fm.id, { status: "returned", returnCode: "R01", settledAt: at });
          this.patch("trade", trade.id, { status: "returned" });
          this.emit("fund_move.returned", { fundMoveId: fm.id, tradeId: trade.id, offeringId: fm.offeringId, amount: fm.amount, externalId: trade.externalId, returnCode: "R01" });
        } else {
          this.patch("fundMove", fm.id, { status: "settled", settledAt: at });
          this.patch("trade", trade.id, { status: "funded" });
          this.emit("fund_move.settled", { fundMoveId: fm.id, tradeId: trade.id, offeringId: fm.offeringId, amount: fm.amount, externalId: trade.externalId });
        }
        return;
      }
      case "refund.settle": {
        const r = this.get("refund", p.refundId);
        if (r.status !== "pending") return;
        this.patch("refund", r.id, { status: "settled", settledAt: at });
        this.patch("trade", String(r.tradeId), { status: "refunded" });
        this.emit("refund.settled", { refundId: r.id, tradeId: r.tradeId, offeringId: r.offeringId, amount: r.amount, externalId: r.externalId });
        return;
      }
      case "disbursement.settle": {
        const d = this.get("disbursement", p.disbursementId);
        if (d.status !== "pending") return;
        this.patch("disbursement", d.id, { status: "settled", settledAt: at });
        this.emit("disbursement.settled", { disbursementId: d.id, offeringId: d.offeringId, amount: d.amount, externalId: d.externalId });
        return;
      }
      case "deposit.settle": {
        const d = this.get("deposit", p.depositId);
        if (d.status !== "pending") return;
        this.patch("deposit", d.id, { status: "settled", settledAt: at });
        this.emit("deposit.settled", { depositId: d.id, collectionAccountId: d.collectionAccountId, amount: d.amount, reference: d.reference, externalId: d.externalId, settledAt: at });
        return;
      }
      case "payout.settle": {
        const po = this.get("payout", p.payoutId);
        if (po.status !== "pending") return;
        this.patch("payout", po.id, { status: "settled", settledAt: at });
        this.emit("payout.settled", { payoutId: po.id, collectionAccountId: po.collectionAccountId, amount: po.amount, recipientType: po.recipientType, externalId: po.externalId });
        return;
      }
    }
  }

  // ── Webhook outbox (signed, retried with backoff) ─────────────────────
  async deliverWebhooks(limit = 200) {
    if (!this.deliver) return 0;
    let delivered = 0;
    const due = this.db.prepare("select id, body, attempts from webhooks where status = 'pending' and next_at <= ? order by created_at, id limit ?").all(Date.now(), limit) as {
      id: string; body: string; attempts: number;
    }[];
    for (const w of due) {
      let ok = false;
      let err: string | null = null;
      try {
        ok = await this.deliver(w.body, { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(this.opts.webhookSecret, w.body) }, JSON.parse(w.body));
      } catch (e) {
        err = String((e as Error).message ?? e).slice(0, 300);
      }
      if (ok) {
        this.db.prepare("update webhooks set status = 'delivered', attempts = attempts + 1 where id = ?").run(w.id);
        delivered++;
      } else {
        const attempts = w.attempts + 1;
        this.db.prepare("update webhooks set attempts = ?, last_error = ?, next_at = ?, status = ? where id = ?")
          .run(attempts, err ?? "non-2xx", Date.now() + Math.min(60_000, 500 * 2 ** w.attempts), attempts >= 12 ? "dead" : "pending", w.id);
      }
    }
    return delivered;
  }

  /** Re-send an already-delivered event (tests: duplicate delivery must be harmless). */
  async redeliver(eventId: string) {
    this.db.prepare("update webhooks set status = 'pending', next_at = 0 where id = ?").run(eventId);
    return this.deliverWebhooks();
  }
  webhookLog() {
    return this.db.prepare("select id, type, status, attempts, last_error from webhooks order by created_at, id").all() as { id: string; type: string; status: string; attempts: number; last_error: string | null }[];
  }

  // ── Admin ─────────────────────────────────────────────────────────────
  reset() {
    this.db.exec("delete from objects; delete from idempotency; delete from jobs; delete from webhooks; delete from meta;");
  }
  isEmpty() {
    return !(this.db.prepare("select 1 as x from objects limit 1").get() as { x: number } | undefined);
  }
  /** Load fixtures: objects keyed by type (ids preserved, balances derived from settled moves). No webhooks are sent. */
  loadFixture(f: { objects: Record<string, Obj[]> }) {
    for (const [type, objs] of Object.entries(f.objects)) for (const o of objs) this.put(type, o);
  }
  state() {
    const types = ["issuer", "offering", "party", "account", "link", "trade", "fundMove", "refund", "disbursement", "collectionAccount", "deposit", "payout"];
    return {
      now: new Date(this.now()).toISOString(),
      offsetMs: this.offsetMs,
      counts: Object.fromEntries(types.map((t) => [t, this.list(t).length])),
      offerings: this.list("offering").map((o) => ({ id: o.id, externalId: o.externalId, status: o.status, escrow: this.escrowBalance(o.id, true) })),
      collectionAccounts: this.list("collectionAccount").map((c) => ({ id: c.id, externalId: c.externalId, balance: this.collectionBalance(c.id, true) })),
      pendingJobs: (this.db.prepare("select count(*) as n from jobs where done = 0").get() as { n: number }).n,
      pendingWebhooks: (this.db.prepare("select count(*) as n from webhooks where status = 'pending'").get() as { n: number }).n,
    };
  }
}
