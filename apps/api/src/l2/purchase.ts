/**
 * Purchase (FR-L2-INV-004; design §5 "Purchase") and reservation expiry (design §4.3). Idempotency-Key exactly as M1
 * §4.4 on main (`checkout.ts`):
 *   1. ONE transaction: claim the key (`investments:<user>:<key>`) and, under a savepoint, `reserve_investment`. A rule
 *      violation rolls back to the savepoint and is stored on the claim as `done` with its 4xx, so a retry replays it.
 *      A claim `in_progress` with no investment older than the abandoned-claim window is re-claimable.
 *   2. Resume guard before EVERY provider call (first pass and resume): re-read the investment and answer from its state
 *      (cases (a), (a′), (b)–(e) of design §5). Only a live reservation gets a provider call, after
 *      `l2_start_provider_call` committed the call-started marker; the guard runs again between createTrade and
 *      fundTrade, so a reservation that died in between is looked up and voided, never funded. A dead reservation with a
 *      call started is looked up only (findTrade/getTrade), never created or funded: an unfunded trade is voided
 *      (`cancel_trade:<investment_id>`), a funded one has its refs stored and goes through the §3.1 matcher.
 *   3. Every provider parameter comes from the stored investment row.
 * A failure after (1) leaves the claim `in_progress` with the investment, so a retry with the key resumes at (2).
 */
import { createHash } from "node:crypto";
import type { InvestRequest } from "@fanzup/shared";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql, type Tx } from "../db";
import { HttpError } from "../lib/auth";
import { RULE_STATUS } from "../lib/errors";
import { log, redact } from "../log";
import { RegCfError, type RegCfProvider, type RegCfTrade } from "../regcf";
import { applyFundMoveReturned, applyFundMoveSettled } from "./events";
import { regcfOf, type L2Deps } from "./gate";

export interface InvestSuccess { investmentId: string; status: string; amountMinor: number; units: number }
export interface InvestError { error: string; message: string; refundPending?: boolean }
export type InvestOutcome = { status: number; body: InvestSuccess | InvestError };

type Claim = { request_hash: string; response: InvestSuccess | InvestError | null; status_code: number | null; state: string; resource_id: string | null };

export const providerDown = (e: unknown) => {
  if (e instanceof HttpError) return e;
  if (e instanceof RegCfError && e.cls === "permanent") return new HttpError(409, `provider_${e.code}`, e.message);
  return new HttpError(502, "provider_unavailable", "We couldn't reach the escrow provider. Nothing was charged — try again.");
};

const err = (error: string, message: string, refundPending = false): InvestError => (refundPending ? { error, message, refundPending } : { error, message });
const EXPIRED = (refundPending: boolean) =>
  err("reservation_expired", refundPending ? "This reservation expired. Any payment taken will be refunded in full." : "Your reservation expired. Start again from the Pool page.", refundPending);
const CANCELLED = (refundPending: boolean) =>
  err("investment_cancelled", refundPending ? "This investment was cancelled. Any payment taken will be refunded in full." : "This investment was cancelled. Nothing was charged.", refundPending);
const RETURNED = () => err("funding_returned", "Your bank returned the payment. Start again from the Pool page.");
const NOT_APPLIED = () => err("payment_not_applied", "We couldn't apply your payment to this investment. It's being refunded in full.", true);

export interface InvState {
  id: string;
  pool_id: string;
  status: string;
  status_reason: string | null;
  funded_at: Date | null;
  cancel_requested_at: Date | null;
  provider_call_started_at: Date | null;
  reserve_expires_at: Date | null;
  provider_trade_ref: string | null;
  provider_fund_ref: string | null;
  amount: bigint;
  units: number;
  unit_price: bigint;
  pool_status: string;
  ends_at: Date | null;
  offering: string | null;
  account: string | null;
}

export async function loadInvestment(sql: Sql, id: string): Promise<InvState> {
  const [r] = await asService(sql, (tx) => tx<InvState[]>`
    select i.id, i.pool_id, i.status::text, i.status_reason, i.funded_at, i.cancel_requested_at, i.provider_call_started_at, i.reserve_expires_at,
           i.provider_trade_ref, i.provider_fund_ref, i.amount_minor as amount, i.units, i.unit_price_minor as unit_price,
           p.status::text as pool_status, p.ends_at, p.provider_offering_ref as offering, ip.provider_account_ref as account
      from public.investments i join public.pools p on p.id = i.pool_id join public.investor_profiles ip on ip.user_id = i.investor_id
     where i.id = ${id}`);
  return r;
}

type Verdict = { kind: "done"; status: number; body: InvestSuccess | InvestError } | { kind: "call" } | { kind: "lookup" };

/** The resume guard (design §5): what to answer, or whether a provider call / lookup is allowed now. */
export function guard(i: InvState, now: Date): Verdict {
  const ok = (): Verdict => ({ kind: "done", status: 201, body: { investmentId: i.id, status: i.status, amountMinor: n(i.amount), units: i.units } });
  const no = (body: InvestError): Verdict => ({ kind: "done", status: 409, body });
  const moneyMayExist = !!i.provider_fund_ref || !!i.provider_call_started_at;
  switch (i.status) {
    case "funded":
    case "issued":
      return ok(); // (a)
    case "funding":
      return i.cancel_requested_at ? no(CANCELLED(true)) : ok(); // (a) / cancel pending
    case "refund_pending":
    case "refunded":
      if (i.funded_at) return ok(); // (a): applied, refunded later (investor cancel of a funded investment, failed Pool)
      // (a′): money arrived (or may) but was never applied.
      if (i.status_reason === "amount_mismatch") return no(NOT_APPLIED());
      if (i.status_reason === "cancelled_by_investor" || i.status_reason === "reservation_cancelled") return no(CANCELLED(true));
      return no(EXPIRED(true));
    case "expired":
      return no(EXPIRED(false)); // (b)
    case "cancelled":
      return no(CANCELLED(false)); // (b)
    case "returned":
      return no(RETURNED()); // (b)
    case "reserved": {
      if (i.cancel_requested_at) return no(CANCELLED(moneyMayExist));
      const live = !!i.reserve_expires_at && i.reserve_expires_at > now && i.pool_status === "live" && !!i.ends_at && now < i.ends_at;
      if (live) return { kind: "call" }; // (c)
      if (!i.provider_call_started_at) return no(EXPIRED(false)); // (d)
      if (i.provider_fund_ref) return no(EXPIRED(true)); // (e) refs already stored by a lookup: the fund move resolves through §3.1
      return { kind: "lookup" }; // (e)
    }
    default:
      return no(EXPIRED(false));
  }
}

/**
 * Look up (never create, never fund) a dead or cancel-pending reservation's provider trade (design §4.3, §5 case (e)).
 * No trade → nothing can arrive; an unfunded trade is voided (`cancel_trade:<investment_id>`); a trade with a fund move
 * has its refs stored (status unchanged, still a counted reservation) and, if the provider already reports the fund
 * move settled or returned, it is handed to the §3.1 matcher (idempotent on `fund:<fund_ref>`).
 * Returns `fundMove: true` when money may still arrive or has arrived.
 */
export async function lookupReservation(sql: Sql, regcf: RegCfProvider, invId: string, now: Date): Promise<{ fundMove: boolean; voided: boolean }> {
  let trade: RegCfTrade | null = await regcf.findTrade({ externalId: invId });
  if (!trade) return { fundMove: false, voided: false };
  if (!trade.fundMoves.length) {
    try {
      await regcf.cancelTrade(trade.id, `cancel_trade:${invId}`);
      return { fundMove: false, voided: true };
    } catch (e) {
      if (!(e instanceof RegCfError && e.code === "trade_funded")) throw e;
      trade = await regcf.getTrade(trade.id); // a fund move appeared meanwhile
    }
  }
  const fm = trade.fundMoves[0];
  await asService(sql, (tx) => tx`select public.record_investment_provider_refs(${invId}, ${trade!.id}, ${fm.id}, ${now})`);
  const ev = { fundMoveId: fm.id, amount: fm.amount, externalId: invId, offeringId: trade.offeringId };
  if (fm.status === "settled") await applyFundMoveSettled(sql, ev, null, now);
  else if (fm.status === "returned") await applyFundMoveReturned(sql, { ...ev, returnCode: null }, now);
  return { fundMove: true, voided: false };
}

const storeOutcomeTx = (tx: Tx, key: string, status: number, body: InvestSuccess | InvestError) =>
  tx`update public.api_idempotency set response = ${tx.json(body as never)}, status_code = ${status}, state = 'done'
      where key = ${key} and state = 'in_progress'`;
const storeOutcome = (sql: Sql, key: string, status: number, body: InvestSuccess | InvestError) =>
  asService(sql, (tx) => storeOutcomeTx(tx, key, status, body));

export async function invest(d: L2Deps, userId: string, poolId: string, key: string, body: InvestRequest, now = new Date()): Promise<InvestOutcome> {
  const regcf = regcfOf(d);
  const hash = createHash("sha256").update(JSON.stringify({ u: userId, poolId, body })).digest("hex");
  const k = `investments:${userId}:${key}`;

  // ── 1. Claim + reservation in one transaction ─────────────────────────
  const step1 = await asService(d.sql, async (tx): Promise<{ replay: InvestOutcome } | { invId: string }> => {
    const [mine] = await tx<{ key: string }[]>`
      insert into public.api_idempotency (key, user_id, request_hash, state, claimed_at) values (${k}, ${userId}, ${hash}, 'in_progress', now())
      on conflict (key) do nothing returning key`;
    if (!mine) {
      const [prior] = await tx<Claim[]>`select request_hash, response, status_code, state, resource_id from public.api_idempotency where key = ${k} for update`;
      if (prior.request_hash !== hash) throw new HttpError(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
      if (prior.state === "done" && prior.response) return { replay: { status: prior.status_code ?? 201, body: prior.response } };
      if (prior.resource_id) return { invId: prior.resource_id }; // resume at the guard
      const [reclaimed] = await tx<{ key: string }[]>`
        update public.api_idempotency set claimed_at = now()
         where key = ${k} and state = 'in_progress' and resource_id is null
           and coalesce(claimed_at, created_at) < now() - make_interval(mins => ${POLICY.checkout.abandonedClaimMinutes})
        returning key`;
      if (!reclaimed) throw new HttpError(409, "in_progress", "This purchase is already being processed. Wait a moment and try again.");
    }
    try {
      const [r] = await tx.savepoint((sp) => sp<{ investment_id: string }[]>`
        select investment_id from public.reserve_investment(${userId}, ${poolId}, ${body.units}, ${body.riskAckVersion}, ${now})`);
      await tx`update public.api_idempotency set resource_id = ${r.investment_id} where key = ${k}`;
      return { invId: r.investment_id };
    } catch (e) {
      const pe = e as { code?: string; message?: string; detail?: string };
      const status = pe.code === "P0001" && pe.message ? RULE_STATUS[pe.message] : undefined;
      if (!status) throw e; // not a business rule: roll everything back (no claim, no reservation)
      const stored = err(pe.message!, pe.detail ?? "That isn't allowed.");
      await storeOutcomeTx(tx, k, status, stored);
      return { replay: { status, body: stored } };
    }
  });
  if ("replay" in step1) return step1.replay;
  const invId = step1.invId;

  // ── 2. Resume guard before every provider call ────────────────────────
  for (let pass = 0; pass < 4; pass++) {
    const i = await loadInvestment(d.sql, invId);
    const v = guard(i, now);
    if (v.kind === "done") {
      await storeOutcome(d.sql, k, v.status, v.body);
      return { status: v.status, body: v.body };
    }
    if (v.kind === "lookup") {
      let found: { fundMove: boolean };
      try {
        found = await lookupReservation(d.sql, regcf, invId, now);
      } catch (e) {
        throw providerDown(e);
      }
      const body = EXPIRED(found.fundMove);
      await storeOutcome(d.sql, k, 409, body);
      return { status: 409, body };
    }
    // (c) Live reservation: commit the call-started marker first (conditional; re-run the guard if it didn't apply).
    const [s] = await asService(d.sql, (tx) => tx<{ r: string }[]>`select public.l2_start_provider_call(${invId}, ${now}) as r`);
    if (s.r !== "started") continue;
    if (!i.offering || !i.account) throw new HttpError(409, "provider_not_ready", "This Pool or your investor account isn't set up at the escrow provider yet.");
    try {
      const params = { offeringId: i.offering, accountId: i.account, units: i.units, unitPrice: n(i.unit_price), amount: n(i.amount), externalId: invId };
      const trade = await regcf.createTrade(params, `trade:${invId}`);
      // The guard runs again between the calls: a reservation that died after createTrade is looked up and voided, never funded.
      if (guard(await loadInvestment(d.sql, invId), now).kind !== "call") continue;
      const fund = await regcf.fundTrade(trade.id, { amount: n(i.amount), externalId: invId }, `fund:${invId}`);
      const [m] = await asService(d.sql, (tx) => tx<{ r: string }[]>`select public.mark_investment_funding(${invId}, ${trade.id}, ${fund.id}, ${now}) as r`);
      if (m.r === "dead") {
        const body = EXPIRED(true);
        await storeOutcome(d.sql, k, 409, body);
        return { status: 409, body };
      }
      // 'funding' or the row's current status (the fund-move webhook or a cancellation got there first): the guard answers.
    } catch (e) {
      log("warn", "investment.provider_call_failed", { investmentId: invId, error: redact(String((e as Error).message ?? e)) });
      throw providerDown(e);
    }
  }
  throw new HttpError(409, "in_progress", "This purchase is still being processed. Try again in a moment.");
}

/**
 * Worker step `expireReservations` (design §4.3; flag-independent). Rows with no provider call expire at once; rows with
 * a call started are looked up (after the lookup grace, which `l2_expiry_candidates` applies) and expire only once the
 * provider confirms no trade or a voided trade; rows whose fund ref is stored are skipped (they await their fund-move
 * event). The SQL re-checks each row under the pool lock and resolves a cancel-pending row to `cancelled`.
 */
export async function expireReservations(d: { sql: Sql; regcf: RegCfProvider }, now: Date) {
  const cands = await asService(d.sql, (tx) => tx<{ investment_id: string; pool_id: string; action: string }[]>`
    select investment_id, pool_id, action from public.l2_expiry_candidates(${now})`);
  const byPool = new Map<string, string[]>();
  const add = (pool: string, id: string) => byPool.set(pool, [...(byPool.get(pool) ?? []), id]);
  let lookedUp = 0;
  for (const c of cands) {
    if (c.action === "expire") {
      add(c.pool_id, c.investment_id);
      continue;
    }
    try {
      lookedUp++;
      const r = await lookupReservation(d.sql, d.regcf, c.investment_id, now);
      if (!r.fundMove) add(c.pool_id, c.investment_id);
    } catch (e) {
      log("warn", "investment.expiry_lookup_failed", { investmentId: c.investment_id, error: redact(String((e as Error).message ?? e)) });
    }
  }
  let resolved = 0;
  for (const [pool, ids] of byPool) {
    const [r] = await asService(d.sql, (tx) => tx<{ n: number }[]>`select public.expire_investment_reservations(${pool}, ${ids}::uuid[], ${now}) as n`);
    resolved += r.n;
  }
  return { resolved, lookedUp };
}
