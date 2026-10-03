/**
 * Layer 2 outbound operations (two-phase, M1 pattern; design §5). Each `pool_ops` row is committed before the provider
 * is called; a retry calls again with the same idempotency key and gets the original object back. Refunds,
 * disbursements and payouts are confirmed by the provider's webhook (events.ts); closing the offering by the response.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "../db";
import { runWithCtx } from "../context";
import { RegCfError, type RegCfProvider } from "../regcf";
import { log, redact } from "../log";

export interface PoolOpRow {
  id: string;
  kind: "refund" | "disburse" | "payout" | "close_offering";
  subject_id: string;
  pool_id: string;
  amount_minor: bigint;
  idempotency_key: string;
  status: string;
  attempts: number;
  correlation_id: string | null;
}

export async function runDuePoolOps(d: { sql: Sql; regcf: RegCfProvider }, limit = 100) {
  let done = 0;
  for (; done < limit; done++) {
    const [op] = await asService(d.sql, (tx) => tx<PoolOpRow[]>`
      update public.pool_ops set lease_until = now() + interval '5 minutes'
       where id = (select id from public.pool_ops
                    where status = 'initiated' and next_attempt_at <= now() and (lease_until is null or lease_until < now())
                    order by (kind = 'close_offering') desc, next_attempt_at, created_at limit 1 for update skip locked)
      returning *`);
    if (!op) break;
    await runWithCtx({ correlationId: op.correlation_id, actorId: null, actorKind: "system:worker", aal: null }, () => runPoolOp(d, op));
  }
  return done;
}

async function defer(sql: Sql, op: PoolOpRow, why: string, seconds: number) {
  await asService(sql, (tx) => tx`update public.pool_ops set last_error = ${why}, lease_until = null, next_attempt_at = now() + make_interval(secs => ${seconds}) where id = ${op.id}`);
}
async function sent(sql: Sql, op: PoolOpRow, ref: string) {
  await asService(sql, (tx) => tx`
    update public.pool_ops set status = 'sent', provider_ref = ${ref}, attempts = attempts + 1, lease_until = null, last_error = null
     where id = ${op.id} and status = 'initiated'`);
}

export async function runPoolOp(d: { sql: Sql; regcf: RegCfProvider }, op: PoolOpRow) {
  const { sql, regcf } = d;
  const amount = n(op.amount_minor);
  try {
    const [p] = await asService(sql, (tx) => tx<{ offering: string | null; collection: string | null; issuer: string | null }[]>`
      select p.provider_offering_ref as offering, p.provider_collection_ref as collection, i.provider_issuer_ref as issuer
        from public.pools p left join public.issuers i on i.id = p.issuer_id where p.id = ${op.pool_id}`);
    if (!p?.offering) throw new RegCfError("permanent", "no_offering", "Pool has no provider offering");
    switch (op.kind) {
      case "close_offering": {
        const r = await regcf.closeOffering(p.offering, op.idempotency_key);
        await asService(sql, (tx) => tx`update public.pool_ops set status = 'confirmed', provider_ref = ${r.id}, attempts = attempts + 1, lease_until = null, last_error = null where id = ${op.id}`);
        return;
      }
      case "refund": {
        const [i] = await asService(sql, (tx) => tx<{ trade: string | null }[]>`select provider_trade_ref as trade from public.investments where id = ${op.subject_id}`);
        if (!i?.trade) throw new RegCfError("retry", "no_trade", "Investment has no provider trade yet");
        const r = await regcf.refundTrade(i.trade, { amount, externalId: op.id }, op.idempotency_key);
        return sent(sql, op, r.id);
      }
      case "disburse": {
        const [g] = await asService(sql, (tx) => tx<{ closed: boolean; earlier: boolean }[]>`
          select exists (select 1 from public.pool_ops c where c.kind = 'close_offering' and c.subject_id = ${op.pool_id} and c.status = 'confirmed') as closed,
                 exists (select 1 from public.pool_tranches t join public.pool_tranches me on me.id = ${op.subject_id}
                          where t.pool_id = me.pool_id and t.seq < me.seq and t.status <> 'released') as earlier`);
        if (!g.closed) return defer(sql, op, "waiting: offering close", 2);
        if (g.earlier) return defer(sql, op, "waiting: earlier milestone", 2);
        const r = await regcf.disburseToIssuer(p.offering, { amount, externalId: op.id }, op.idempotency_key);
        return sent(sql, op, r.id);
      }
      case "payout": {
        if (!p.collection) throw new RegCfError("permanent", "no_collection_account", "Pool has no collection account");
        const [x] = await asService(sql, (tx) => tx<{ kind: string; account: string | null }[]>`
          select d.kind, ip.provider_account_ref as account
            from public.distribution_payouts d left join public.investor_profiles ip on ip.user_id = d.investor_id where d.id = ${op.subject_id}`);
        const recipientRef = x.kind === "investor" ? x.account : x.kind === "creator" ? p.issuer : "fanzup-platform";
        if (!recipientRef) throw new RegCfError("permanent", "no_recipient", "Payout recipient has no provider account");
        const r = await regcf.payoutFromCollection(p.collection, {
          recipientType: x.kind === "creator" ? "issuer" : (x.kind as "investor" | "platform"), recipientRef, amount, externalId: op.id,
        }, op.idempotency_key);
        return sent(sql, op, r.id);
      }
    }
  } catch (e) {
    await recordFailure(sql, op, e);
  }
}

async function recordFailure(sql: Sql, op: PoolOpRow, e: unknown) {
  const err = e instanceof RegCfError ? e : new RegCfError((e as { code?: string })?.code === "P0001" ? "permanent" : "retry", "error", String((e as Error)?.message ?? e));
  const msg = redact(`${err.code}: ${err.message}`);
  if (err.cls === "permanent") {
    await asService(sql, (tx) => tx`update public.pool_ops set status = 'failed', last_error = ${msg}, lease_until = null, attempts = attempts + 1 where id = ${op.id}`);
    log("alert", "pool_op.failed", { opId: op.id, kind: op.kind, code: err.code });
    return;
  }
  const attempts = op.attempts + 1;
  const dead = attempts >= POLICY.outbound.maxAttempts;
  await asService(sql, (tx) => tx`
    update public.pool_ops set attempts = ${attempts}, status = ${dead ? "dead" : "initiated"}, last_error = ${msg}, lease_until = null,
           next_attempt_at = now() + make_interval(secs => ${Math.min(3600, 5 * 2 ** op.attempts)})
     where id = ${op.id}`);
  if (dead) log("alert", "pool_op.dead_letter", { opId: op.id, kind: op.kind, attempts });
}
