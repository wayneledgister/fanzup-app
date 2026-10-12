/**
 * Layer 2 outbound operations (two-phase, M1 rules as on main; design §5 "Outbound").
 *
 * The runner claims due `initiated` ops with `l2_claim_pool_ops` (5-minute lease + a fresh `claim_token` each) and
 * every outcome write it makes — `sent`, `confirmed` (close), `failed`, `dead`, back to `initiated` — applies only
 * `where claim_token = <ours>`, so a runner that outlived its lease can't overwrite the op of the runner that re-claimed
 * it. Right before the first provider call `l2_op_start_call` (under the pool lock, claim-checked) sets
 * `call_started_at`, re-derives a disburse op's amount (frozen afterwards: `disburse_amount_changed`) and refuses while an
 * earlier tranche is unreleased. A retry calls the provider again with the same idempotency key (the op's key) and gets
 * the original object back. Refunds, disbursements and payouts are confirmed by the provider's webhook (events.ts);
 * closing the offering by the response. `disburse` waits until the `close:<pool>` op is confirmed. The Pool's
 * `disburse`/`payout` ops wait while an L2 pausing break is open (L2_PAYOUT_PAUSING_KINDS); refunds never wait.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "../db";
import { runWithCtx } from "../context";
import { RegCfError, type RegCfProvider } from "../regcf";
import { log, redact } from "../log";
import { isPoolPayoutPaused } from "../recon";

export interface PoolOpRow {
  id: string;
  kind: "refund" | "disburse" | "payout" | "close_offering";
  subject_id: string;
  pool_id: string;
  fund_ref: string | null;
  amount_minor: bigint;
  idempotency_key: string;
  status: string;
  attempts: number;
  claim_token: string;
  call_started_at: Date | null;
  correlation_id: string | null;
}

type D = { sql: Sql; regcf: RegCfProvider };
const later = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000);

export async function runDuePoolOps(d: D, now = new Date(), limit = 100) {
  let done = 0;
  while (done < limit) {
    const batch = await asService(d.sql, (tx) => tx<PoolOpRow[]>`select * from public.l2_claim_pool_ops(${now}, ${Math.min(20, limit - done)})`);
    if (!batch.length) break;
    // Close the offering first: disbursements wait for it.
    batch.sort((a, b) => Number(b.kind === "close_offering") - Number(a.kind === "close_offering"));
    for (const op of batch) {
      await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:worker", aal: null }, () => runPoolOp(d, op, now));
      done++;
    }
  }
  return done;
}

/** Back to `initiated` later, without counting an attempt (waiting on something that will happen). */
async function defer(sql: Sql, op: PoolOpRow, why: string, seconds: number, now: Date) {
  await asService(sql, (tx) => tx`
    update public.pool_ops set last_error = ${why}, lease_until = null, claim_token = null, next_attempt_at = ${later(now, seconds)}
     where id = ${op.id} and status = 'initiated' and claim_token = ${op.claim_token}`);
}
/** The provider accepted the movement; its confirmation webhook will mark it `confirmed` (it may already have). */
async function sent(sql: Sql, op: PoolOpRow, ref: string) {
  const [r] = await asService(sql, (tx) => tx<{ id: string }[]>`
    update public.pool_ops set status = 'sent', provider_ref = ${ref}, attempts = attempts + 1, lease_until = null, claim_token = null, last_error = null
     where id = ${op.id} and status = 'initiated' and claim_token = ${op.claim_token} returning id`);
  if (!r) log("warn", "pool_op.claim_lost", { opId: op.id, kind: op.kind });
}

/** Before the first provider call: claim-checked, under the pool lock (design §5). Null: don't call now. */
async function startCall(d: D, op: PoolOpRow, now: Date): Promise<number | null> {
  const [s] = await asService(d.sql, (tx) => tx<{ amount_minor: bigint; outcome: string }[]>`
    select * from public.l2_op_start_call(${op.id}, ${op.claim_token}, ${now})`);
  switch (s.outcome) {
    case "call":
      return n(s.amount_minor);
    case "earlier_tranche_pending":
      await defer(d.sql, op, "waiting: earlier milestone", 30, now);
      return null;
    case "nothing_owed":
      throw new RegCfError("permanent", "nothing_owed", "Nothing is owed for this milestone");
    case "disburse_amount_changed":
      // l2_op_start_call already failed the op (claim-conditional) and wrote the audit row.
      log("alert", "pool_op.disburse_amount_changed", { opId: op.id });
      return null;
    default: // not_claimed | not_initiated: someone else owns or finished it
      log("warn", "pool_op.claim_lost", { opId: op.id, kind: op.kind, outcome: s.outcome });
      return null;
  }
}

export async function runPoolOp(d: D, op: PoolOpRow, now = new Date()) {
  const { sql, regcf } = d;
  try {
    const [p] = await asService(sql, (tx) => tx<{ offering: string | null; collection: string | null; issuer: string | null }[]>`
      select p.provider_offering_ref as offering, p.provider_collection_ref as collection, i.provider_issuer_ref as issuer
        from public.pools p left join public.issuers i on i.id = p.issuer_id where p.id = ${op.pool_id}`);
    if (!p?.offering) throw new RegCfError("permanent", "no_offering", "Pool has no provider offering");
    if ((op.kind === "disburse" || op.kind === "payout") && (await isPoolPayoutPaused(sql, op.pool_id, now))) {
      return defer(sql, op, "waiting: recon_pause", 15 * 60, now);
    }
    switch (op.kind) {
      case "close_offering": {
        if ((await startCall(d, op, now)) == null) return;
        const r = await regcf.closeOffering(p.offering, op.idempotency_key);
        const [ok] = await asService(sql, (tx) => tx<{ id: string }[]>`
          update public.pool_ops set status = 'confirmed', provider_ref = ${r.id}, attempts = attempts + 1, lease_until = null, claim_token = null, last_error = null
           where id = ${op.id} and status = 'initiated' and claim_token = ${op.claim_token} returning id`);
        if (!ok) log("warn", "pool_op.claim_lost", { opId: op.id, kind: op.kind });
        return;
      }
      case "refund": {
        // A stray fund move is refunded by its own fund ref (design §3.1). An investment whose fund ref is stored is
        // refunded by that fund move for the amount actually received (`funded_received_minor`, which the op carries), so a
        // received amount that differs from the trade amount is still returned in full (review round 2, PR #12); only
        // an investment with a trade and no fund ref falls back to the trade.
        let target: { fund?: string; trade?: string };
        if (op.fund_ref) target = { fund: op.fund_ref };
        else {
          const [i] = await asService(sql, (tx) => tx<{ trade: string | null; fund: string | null }[]>`
            select provider_trade_ref as trade, provider_fund_ref as fund from public.investments where id = ${op.subject_id}`);
          if (!i?.trade && !i?.fund) throw new RegCfError("retry", "no_trade", "Investment has no provider trade yet");
          target = i.fund ? { fund: i.fund } : { trade: i.trade! };
        }
        const amount = await startCall(d, op, now);
        if (amount == null) return;
        const r = target.fund
          ? await regcf.refundFundMove(target.fund, { amount, externalId: op.id }, op.idempotency_key)
          : await regcf.refundTrade(target.trade!, { amount, externalId: op.id }, op.idempotency_key);
        return sent(sql, op, r.id);
      }
      case "disburse": {
        // The issuer is paid only after the offering is closed at the provider (`close:<pool>` confirmed).
        const [c] = await asService(sql, (tx) => tx<{ ok: boolean }[]>`
          select exists (select 1 from public.pool_ops where idempotency_key = ${"close:" + op.pool_id} and status = 'confirmed') as ok`);
        if (!c.ok) return defer(sql, op, "waiting: offering close", 2, now);
        const amount = await startCall(d, op, now);
        if (amount == null) return;
        try {
          const r = await regcf.disburseToIssuer(p.offering, { amount, externalId: op.id }, op.idempotency_key);
          return sent(sql, op, r.id);
        } catch (e) {
          // The provider hasn't processed the close yet: wait, never count it as a failure.
          if (e instanceof RegCfError && e.code === "offering_not_closed") return defer(sql, op, "waiting: offering close (provider)", 5, now);
          throw e;
        }
      }
      case "payout": {
        if (!p.collection) throw new RegCfError("permanent", "no_collection_account", "Pool has no collection account");
        const [x] = await asService(sql, (tx) => tx<{ kind: string; account: string | null }[]>`
          select d.kind, ip.provider_account_ref as account
            from public.distribution_payouts d left join public.investor_profiles ip on ip.user_id = d.investor_id where d.id = ${op.subject_id}`);
        const recipientRef = x.kind === "investor" ? x.account : x.kind === "creator" ? p.issuer : "fanzup-platform";
        if (!recipientRef) throw new RegCfError("permanent", "no_recipient", "Payout recipient has no provider account");
        const amount = await startCall(d, op, now);
        if (amount == null) return;
        const r = await regcf.payoutFromCollection(p.collection, {
          recipientType: x.kind === "creator" ? "issuer" : (x.kind as "investor" | "platform"), recipientRef, amount, externalId: op.id,
        }, op.idempotency_key);
        return sent(sql, op, r.id);
      }
    }
  } catch (e) {
    await recordFailure(sql, op, e, now);
  }
}

async function recordFailure(sql: Sql, op: PoolOpRow, e: unknown, now: Date) {
  const err = e instanceof RegCfError ? e : new RegCfError((e as { code?: string })?.code === "P0001" ? "permanent" : "retry", "error", String((e as Error)?.message ?? e));
  const msg = redact(`${err.code}: ${err.message}`);
  if (err.cls === "permanent") {
    await asService(sql, (tx) => tx`
      update public.pool_ops set status = 'failed', last_error = ${msg}, lease_until = null, claim_token = null, attempts = attempts + 1
       where id = ${op.id} and status = 'initiated' and claim_token = ${op.claim_token}`);
    log("alert", "pool_op.failed", { opId: op.id, kind: op.kind, code: err.code });
    return;
  }
  const attempts = op.attempts + 1;
  const dead = attempts >= POLICY.outbound.maxAttempts;
  await asService(sql, (tx) => tx`
    update public.pool_ops set attempts = ${attempts}, status = ${dead ? "dead" : "initiated"}, last_error = ${msg}, lease_until = null, claim_token = null,
           next_attempt_at = ${later(now, Math.min(3600, 5 * 2 ** op.attempts))}
     where id = ${op.id} and status = 'initiated' and claim_token = ${op.claim_token}`);
  if (dead) log("alert", "pool_op.dead_letter", { opId: op.id, kind: op.kind, attempts });
}
