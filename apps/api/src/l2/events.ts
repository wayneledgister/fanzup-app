/**
 * Reg CF provider webhooks → the M1 inbox (design §5 "Webhooks"; ADR-007 §4). Verified events are stored in
 * provider_events (unique per provider event id) and acknowledged before any processing. Processing runs ONLY through
 * main's claimed inbox processor (`inbox.ts` `handle()`: lease + `claim_token`, every outcome write — including the
 * "wait" path back to `received` — conditional on the claim). This module is the `regcf.*` branch of that dispatcher:
 * it returns an outcome and never writes provider_events itself. It runs whether or not the `layer2` flag is on.
 */
import { asService, n, type Sql, type Tx } from "../db";
import { runWithCtx } from "../context";
import type { EventRow } from "../inbox";
import type { RegCfEvent, RegCfProvider, RegCfTransaction } from "../regcf";
import { log, redact } from "../log";
import { attemptKey } from "../provider/types";

export const REGCF_PROVIDER_NAME = "mock-escrow";

const objectRef = (e: RegCfEvent) =>
  String(e.data.fundMoveId ?? e.data.refundId ?? e.data.disbursementId ?? e.data.depositId ?? e.data.payoutId ?? e.data.partyId ?? e.data.tradeId ?? e.data.offeringId ?? "") || null;

/** Store a verified event (stored before processing; a duplicate delivery is a no-op). */
export async function ingestRegCfEvent(sql: Sql, e: RegCfEvent): Promise<{ id: string; inserted: boolean }> {
  const type = `regcf.${e.type}`;
  const payload = { type, metadata: { external_id: String(e.data.externalId ?? "") }, data: e.data, createdAt: e.createdAt };
  return asService(sql, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into public.provider_events (provider, event_id, type, livemode, account, object_ref, payload)
      values (${REGCF_PROVIDER_NAME}, ${e.eventId}, ${type}, false, null, ${objectRef(e)}, ${tx.json(payload as never)})
      on conflict (provider, event_id) do nothing returning id`;
    if (row) return { id: row.id, inserted: true };
    const [old] = await tx<{ id: string }[]>`select id from public.provider_events where provider = ${REGCF_PROVIDER_NAME} and event_id = ${e.eventId}`;
    return { id: old.id, inserted: false };
  });
}

type Outcome = "processed" | "ignored" | "unmatched" | "wait";
export type PoolOpRef = { id: string; kind: string; subject_id: string; pool_id: string; fund_ref: string | null; amount_minor: bigint; idempotency_key: string; correlation_id: string | null; status: string; attempt_gen: number };

/**
 * Attempt generations (PR #12 review round 5; design §5 Outbound): a `pool_ops` movement is sent with externalId
 * `<op id>` (generation 0) or `<op id>:r<gen>`, and provider key `attemptKey(idempotency_key, gen)`. Lookups match the
 * current generation only; a movement the provider reports failed/returned/canceled is never re-adopted.
 */
export const opExternalId = (op: { id: string; attempt_gen?: number | null }) => attemptKey(op.id, op.attempt_gen ?? 0);
export const opProviderKey = (op: { idempotency_key: string; attempt_gen?: number | null }) => attemptKey(op.idempotency_key, op.attempt_gen ?? 0);
const OP_EXT_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::r(\d+))?$/i;
export const parseOpExternalId = (ext: string): { id: string; gen: number } | null => {
  const m = OP_EXT_RE.exec(ext);
  return m ? { id: m[1], gen: m[2] ? Number(m[2]) : 0 } : null;
};

/**
 * The provider reported a `pool_ops` movement failed/returned/canceled (no money moved): op `failed` + alert, the ref
 * appended to `failed_refs` with its generation — never re-adopted, never `sent`, never posted. Applies only while the op
 * is on that generation and not confirmed (and, from the runner, only under its claim). `pool_op.replay` then starts the
 * next generation. Shared by the runner's lookup (ops.ts), the `regcf.refund.failed` webhook and recon's lookup.
 */
export async function recordPoolFailedMovement(
  sql: Sql, op: Pick<PoolOpRef, "id" | "kind" | "correlation_id">,
  f: { gen: number; ref: string; status: string; via: string; lastError: string; claimToken?: string },
): Promise<boolean> {
  const entry = { gen: f.gen, ref: f.ref, status: f.status, via: f.via, at: new Date().toISOString() };
  const row = await runWithCtx({ ...SYS, correlationId: op.correlation_id }, () =>
    asService(sql, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        update public.pool_ops
           set status = 'failed', last_error = ${redact(f.lastError)}, lease_until = null, claim_token = null,
               failed_refs = case when failed_refs @> ${tx.json([{ gen: f.gen, ref: f.ref }])} then failed_refs else failed_refs || ${tx.json([entry])} end
         where id = ${op.id} and status <> 'confirmed' and attempt_gen = ${f.gen}
           and (${f.claimToken ?? null}::uuid is null or claim_token = ${f.claimToken ?? null}::uuid)
         returning id`;
      if (r) {
        await tx`insert into public.audit_events (action, entity, entity_id, data)
                 values ('pool_op.movement_failed', 'pool_op', ${op.id}, ${tx.json(entry)})`;
      }
      return r;
    }));
  if (row) log("alert", "pool_op.failed", { opId: op.id, kind: op.kind, providerRef: f.ref, status: f.status, attempt: f.gen, via: f.via });
  else log("warn", "pool_op.failed_movement_stale", { opId: op.id, providerRef: f.ref, attempt: f.gen, via: f.via });
  return !!row;
}

const SYS = { actorId: null, actorKind: "system:webhook", aal: null } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRule = (e: unknown, ...codes: string[]) => (e as { code?: string }).code === "P0001" && codes.includes(String((e as { message?: string }).message));

/**
 * The clock for processing a provider event (design §4.2 one clock): the later of when the provider says it happened
 * and when we process it, so a late delivery is never treated as earlier than it is.
 */
export const eventNow = (createdAt: unknown, now = new Date()) => {
  const t = Date.parse(String(createdAt ?? ""));
  return Number.isFinite(t) && t > now.getTime() ? new Date(t) : now;
};

export interface FundMoveEvent {
  fundMoveId: string;
  amount: number;
  externalId: string | null;
  offeringId: string | null;
}

/**
 * A fund move settled into an offering escrow (design §3.1): match by fund ref first, then by externalId (our
 * investment id) only if that investment has no fund ref yet or the same one; apply through record_investment_funded;
 * a `'stray'` result, or a fund move that names only our offering, goes to record_stray_fund_move (own refund op keyed
 * by the fund ref). Idempotent on `fund:<fund_ref>`. Returns 'wait' when nothing of ours matches (yet).
 * Shared by the webhook branch, the purchase resume guard (case e) and the expiry lookup (design §4.3).
 */
export async function applyFundMoveSettled(sql: Sql, fm: FundMoveEvent, eventId: string | null, now: Date): Promise<"processed" | "wait"> {
  type Inv = { id: string; pool_id: string; provider_fund_ref: string | null; correlation_id: string | null };
  const [byRef] = await asService(sql, (tx) => tx<Inv[]>`
    select id, pool_id, provider_fund_ref, correlation_id from public.investments where provider_fund_ref = ${fm.fundMoveId}`);
  let inv: Inv | undefined = byRef;
  let named: Inv | undefined;
  if (!inv && fm.externalId && UUID_RE.test(fm.externalId)) {
    [named] = await asService(sql, (tx) => tx<Inv[]>`select id, pool_id, provider_fund_ref, correlation_id from public.investments where id = ${fm.externalId}`);
    if (named && (named.provider_fund_ref == null || named.provider_fund_ref === fm.fundMoveId)) inv = named;
  }
  if (inv) {
    const target = inv;
    const [r] = await runWithCtx({ ...SYS, correlationId: target.correlation_id }, () =>
      asService(sql, (tx) => tx<{ r: string }[]>`
        select public.record_investment_funded(${target.id}, ${fm.fundMoveId}, ${fm.amount}, ${"fund:" + fm.fundMoveId}, ${now}) as r`));
    if (r.r !== "stray") return "processed";
    named = target;
  }
  // Stray: names an investment whose fund ref differs (or that already had a fund move), or names only our offering.
  let poolId = named?.pool_id ?? null;
  if (!poolId && fm.offeringId) {
    const [p] = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.pools where provider_offering_ref = ${fm.offeringId}`);
    poolId = p?.id ?? null;
  }
  if (!poolId) return "wait";
  const pool = poolId;
  await runWithCtx({ ...SYS, correlationId: named?.correlation_id ?? null }, () =>
    asService(sql, (tx) => tx`
      select public.record_stray_fund_move(${pool}, ${fm.fundMoveId}, ${fm.amount}, ${eventId}, ${named?.id ?? null}, ${now})`));
  log("alert", "fund_move.stray", { poolId: pool, fundRef: fm.fundMoveId, investmentId: named?.id ?? null });
  return "processed";
}

/** A fund move returned by the bank (no money arrived): same matching order, then record_investment_returned. */
export async function applyFundMoveReturned(sql: Sql, fm: FundMoveEvent & { returnCode: string | null }, now: Date): Promise<"processed" | "wait"> {
  const [byRef] = await asService(sql, (tx) => tx<{ id: string; correlation_id: string | null }[]>`
    select id, correlation_id from public.investments where provider_fund_ref = ${fm.fundMoveId}`);
  let inv = byRef;
  if (!inv && fm.externalId && UUID_RE.test(fm.externalId)) {
    [inv] = await asService(sql, (tx) => tx<{ id: string; correlation_id: string | null }[]>`
      select id, correlation_id from public.investments where id = ${fm.externalId} and (provider_fund_ref is null or provider_fund_ref = ${fm.fundMoveId})`);
  }
  if (!inv) {
    // A returned stray never settled into escrow: nothing was posted, nothing to do. Unknown offering: wait.
    const [p] = fm.offeringId ? await asService(sql, (tx) => tx`select 1 from public.pools where provider_offering_ref = ${fm.offeringId}`) : [];
    return p ? "processed" : "wait";
  }
  const target = inv;
  await runWithCtx({ ...SYS, correlationId: target.correlation_id }, () =>
    asService(sql, (tx) => tx`select public.record_investment_returned(${target.id}, ${fm.fundMoveId}, ${fm.returnCode ?? "R01"}, ${now})`));
  return "processed";
}

async function opById(sql: Sql, id: string, kind: string): Promise<PoolOpRef | null> {
  if (!UUID_RE.test(id)) return null;
  const [op] = await asService(sql, (tx) => tx<PoolOpRef[]>`
    select id, kind, subject_id, pool_id, fund_ref, amount_minor, idempotency_key, correlation_id, status, attempt_gen from public.pool_ops where id = ${id} and kind = ${kind}`);
  return op ?? null;
}

/**
 * A provider confirmation of a `pool_ops` movement (refund, disbursement, payout). The SQL confirm function asserts the
 * exact amount; the op becomes `confirmed` in the same transaction and its claim is cleared (claim_token, lease), so a
 * runner still holding an old claim can't overwrite it (its writes are conditional on `claim_token = <its token>`).
 * A provider amount that differs (design §5.1 "Confirmation amounts") opens an `amount_mismatch` break (pausing,
 * staff-resolved), fails the op, and the event goes to the inbox's failed → dead-letter path.
 */
export async function confirmOp(sql: Sql, op: PoolOpRef, ref: string, providerAmount: number, apply: (tx: Tx) => Promise<unknown>) {
  try {
    await runWithCtx({ ...SYS, correlationId: op.correlation_id }, () =>
      asService(sql, async (tx) => {
        await apply(tx);
        await tx`update public.pool_ops set status = 'confirmed', provider_ref = ${ref}, lease_until = null, claim_token = null, last_error = null
                  where id = ${op.id} and status <> 'confirmed'`;
      }),
    );
  } catch (e) {
    if (!isRule(e, "refund_amount_mismatch", "payout_amount_mismatch")) throw e;
    const msg = redact(`amount_mismatch: provider moved ${providerAmount}, op is ${n(op.amount_minor)}`);
    await asService(sql, async (tx) => {
      await tx`update public.pool_ops set status = 'failed', provider_ref = ${ref}, last_error = ${msg}, lease_until = null, claim_token = null
                where id = ${op.id} and status <> 'confirmed'`;
      await tx`insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs)
               values (${op.pool_id}, 'amount_mismatch', ${"amount_mismatch:" + op.id}, ${providerAmount - n(op.amount_minor)},
                       ${tx.json({ op_id: op.id, kind: op.kind, provider_ref: ref, expected_minor: n(op.amount_minor), provider_minor: providerAmount })})
               on conflict (dedupe_key) where resolved_at is null do nothing`;
    });
    log("alert", "pool_op.amount_mismatch", { opId: op.id, kind: op.kind, providerRef: ref, providerAmount });
    throw e;
  }
}

/**
 * Record the provider's settlement of a `pool_ops` movement through the op kind's SQL confirm function (the one path for
 * the webhook, the runner's lookup before a re-call, and recon's lookup of a `sent` op whose webhook never came — review
 * round 3, PR #12). An amount that differs fails the op and opens `amount_mismatch` (confirmOp) and rethrows.
 */
export async function applyPoolOpSettled(sql: Sql, op: PoolOpRef, ref: string, amount: number, now: Date) {
  switch (op.kind) {
    case "refund":
      // A stray fund move's refund op names its fund ref (design §3.1); an investment's names the investment.
      return confirmOp(sql, op, ref, amount, (tx) =>
        op.fund_ref
          ? tx`select public.record_stray_fund_refund_confirmed(${op.fund_ref}, ${ref}, ${amount}, ${op.idempotency_key}, ${now})`
          : tx`select public.record_investment_refunded(${op.subject_id}, ${ref}, ${amount}, ${op.idempotency_key}, ${now})`);
    case "disburse":
      return confirmOp(sql, op, ref, amount, (tx) => tx`select public.record_pool_tranche_released(${op.subject_id}, ${ref}, ${amount}, ${op.idempotency_key}, ${now})`);
    case "payout":
      return confirmOp(sql, op, ref, amount, (tx) => tx`select public.record_pool_payout_confirmed(${op.subject_id}, ${ref}, ${amount}, ${op.idempotency_key}, ${now})`);
    default:
      throw new Error(`no provider confirmation for a ${op.kind} op`);
  }
}

/** The provider transaction kind a `pool_ops` movement creates (its `externalId` is `opExternalId(op)`). */
export const OP_TXN_KIND: Record<string, RegCfTransaction["kind"] | undefined> = { refund: "refund", disburse: "disbursement", payout: "payout" };

/**
 * Look up the provider movement of a `pool_ops` row (M1 rule: ask the provider before calling it again): the escrow
 * (refund, disbursement) or collection-account (payout) transaction whose externalId is the op's CURRENT generation
 * (`opExternalId`). Null: none. A failed one is returned as such; the caller never treats it as moved.
 */
export async function findPoolOpTxn(regcf: RegCfProvider, refs: { offering: string; collection: string | null }, op: { id: string; kind: string; attempt_gen?: number | null }) {
  const kind = OP_TXN_KIND[op.kind];
  if (!kind) return null;
  const q = kind === "payout" ? (refs.collection ? { collectionAccountId: refs.collection } : null) : { offeringId: refs.offering };
  if (!q) return null;
  const ext = opExternalId(op);
  return (await regcf.listTransactions(q)).find((t) => t.kind === kind && t.externalId === ext) ?? null;
}

/** The `regcf.*` branch of main's inbox `handle()` (design §5). */
export async function handleRegCfEvent(sql: Sql, row: EventRow): Promise<Outcome> {
  const payload = row.payload as unknown as { data?: Record<string, unknown>; createdAt?: string };
  const d = payload.data ?? {};
  const now = eventNow(payload.createdAt);
  const ext = String(d.externalId ?? "");
  switch (row.type) {
    case "regcf.party.kyc_updated": {
      const status = String(d.kycStatus);
      if (!["approved", "rejected", "manual_review"].includes(status)) return "ignored";
      const [ip] = await asService(sql, (tx) => tx<{ user_id: string }[]>`
        update public.investor_profiles set kyc_status = ${status}::public.kyc_status, kyc_updated_at = ${now}
         where provider_party_ref = ${String(d.partyId)} and kyc_status in ('pending', 'manual_review', 'not_started')
         returning user_id`);
      if (!ip) {
        const [known] = await asService(sql, (tx) => tx`select 1 from public.investor_profiles where provider_party_ref = ${String(d.partyId)}`);
        return known ? "processed" : "wait";
      }
      await asService(sql, async (tx) => {
        await tx`insert into public.audit_events (action, entity, entity_id, data) values ('investor.kyc_updated', 'investor', ${ip.user_id}, ${tx.json({ kyc_status: status })})`;
        await tx`insert into public.outbox (topic, payload) values ('l2.notify', ${tx.json({ template: "kyc_result", user_id: ip.user_id, status })})`;
      });
      return "processed";
    }
    case "regcf.fund_move.settled":
      return applyFundMoveSettled(sql, { fundMoveId: String(d.fundMoveId), amount: n(d.amount as number), externalId: ext || null, offeringId: (d.offeringId as string) ?? null }, row.id, now);
    case "regcf.fund_move.returned":
      return applyFundMoveReturned(sql, { fundMoveId: String(d.fundMoveId), amount: n(d.amount as number), externalId: ext || null, offeringId: (d.offeringId as string) ?? null, returnCode: (d.returnCode as string) ?? null }, now);
    case "regcf.refund.settled":
    case "regcf.disbursement.settled":
    case "regcf.payout.settled": {
      const kind = row.type === "regcf.refund.settled" ? "refund" : row.type === "regcf.disbursement.settled" ? "disburse" : "payout";
      const parsed = parseOpExternalId(ext);
      const op = parsed ? await opById(sql, parsed.id, kind) : null;
      if (!op) return "wait";
      if (op.status === "confirmed") return "processed";
      const ref = String(d.refundId ?? d.disbursementId ?? d.payoutId);
      await applyPoolOpSettled(sql, op, ref, n(d.amount as number), now);
      return "processed";
    }
    case "regcf.refund.failed": {
      // The bank failed the refund (review round 5, PR #12): nothing left escrow. Op `failed` + alert with the ref in
      // `failed_refs`; `pool_op.replay` sends ONE new refund under a fresh generation key. A report about an earlier
      // generation than the op's current one changes nothing.
      const parsed = parseOpExternalId(ext);
      const op = parsed ? await opById(sql, parsed.id, "refund") : null;
      if (!op || !parsed) return "unmatched";
      if (op.status === "confirmed") {
        log("alert", "pool_op.failed_after_confirmed", { opId: op.id, providerRef: String(d.refundId) });
        return "processed";
      }
      await recordPoolFailedMovement(sql, op, {
        gen: parsed.gen, ref: String(d.refundId), status: "failed", via: "webhook", lastError: `refund failed: ${String(d.returnCode ?? "unknown")}`,
      });
      return "processed";
    }
    case "regcf.deposit.settled": {
      const [p] = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.pools where provider_collection_ref = ${String(d.collectionAccountId)}`);
      if (!p) return "wait";
      await runWithCtx({ ...SYS, correlationId: row.correlation_id }, () =>
        asService(sql, (tx) => tx`select public.record_collection_deposit(${p.id}, ${String(d.depositId)}, ${n(d.amount as number)}, ${String(d.reference ?? "")},
                                     ${String(d.settledAt ?? now.toISOString())}::timestamptz, ${"deposit:" + String(d.depositId)}, ${now})`),
      );
      return "processed";
    }
    case "regcf.offering.closed":
    case "regcf.trade.cancelled":
      return "processed";
    default:
      log("warn", "regcf.unknown_event", { type: row.type });
      return "ignored";
  }
}
