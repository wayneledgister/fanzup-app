/**
 * Reg CF provider webhooks → the M1 inbox (design §5; ADR-007 §4). Verified events are stored in provider_events
 * (unique per provider event id) and acknowledged; processing is idempotent and retried by the inbox worker.
 */
import { asService, n, type Sql } from "../db";
import { runWithCtx } from "../context";
import type { EventRow } from "../inbox";
import type { RegCfEvent } from "../regcf";
import { log } from "../log";

export const REGCF_PROVIDER_NAME = "mock-escrow";

const objectRef = (e: RegCfEvent) =>
  String(e.data.fundMoveId ?? e.data.refundId ?? e.data.disbursementId ?? e.data.depositId ?? e.data.payoutId ?? e.data.partyId ?? e.data.offeringId ?? "") || null;

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
type OpRow = { id: string; kind: string; subject_id: string; idempotency_key: string; correlation_id: string | null; status: string };

const SYS = { actorId: null, actorKind: "system:webhook", aal: null } as const;

async function opById(sql: Sql, id: string, kind: string): Promise<OpRow | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [op] = await asService(sql, (tx) => tx<OpRow[]>`select id, kind, subject_id, idempotency_key, correlation_id, status from public.pool_ops where id = ${id} and kind = ${kind}`);
  return op ?? null;
}

async function confirmOp(sql: Sql, op: OpRow, ref: string, apply: (tx: import("../db").Tx) => Promise<unknown>) {
  await runWithCtx({ ...SYS, correlationId: op.correlation_id }, () =>
    asService(sql, async (tx) => {
      await apply(tx);
      await tx`update public.pool_ops set status = 'confirmed', provider_ref = ${ref}, lease_until = null, last_error = null where id = ${op.id}`;
    }),
  );
}

export async function handleRegCfEvent(sql: Sql, row: EventRow): Promise<Outcome> {
  const d = (row.payload as unknown as { data: Record<string, unknown> }).data ?? {};
  const ext = String(d.externalId ?? "");
  switch (row.type) {
    case "regcf.party.kyc_updated": {
      const status = String(d.kycStatus);
      if (!["approved", "rejected", "manual_review"].includes(status)) return "ignored";
      const [ip] = await asService(sql, (tx) => tx<{ user_id: string }[]>`
        update public.investor_profiles set kyc_status = ${status}::public.kyc_status, kyc_updated_at = now()
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
    case "regcf.fund_move.returned": {
      const [inv] = await asService(sql, (tx) => tx<{ id: string; correlation_id: string | null }[]>`
        select id, correlation_id from public.investments where id::text = ${ext} or provider_fund_ref = ${String(d.fundMoveId)} limit 1`);
      if (!inv) return "wait";
      await runWithCtx({ ...SYS, correlationId: inv.correlation_id }, () =>
        asService(sql, (tx) =>
          row.type === "regcf.fund_move.settled"
            ? tx`select public.record_investment_funded(${inv.id}, ${String(d.fundMoveId)}, ${n(d.amount as number)}, ${"fund:" + String(d.fundMoveId)})`
            : tx`select public.record_investment_returned(${inv.id}, ${String(d.fundMoveId)}, ${String(d.returnCode ?? "R01")})`,
        ),
      );
      return "processed";
    }
    case "regcf.refund.settled": {
      const op = await opById(sql, ext, "refund");
      if (!op) return "wait";
      if (op.status === "confirmed") return "processed";
      await confirmOp(sql, op, String(d.refundId), (tx) => tx`select public.record_investment_refunded(${op.subject_id}, ${String(d.refundId)}, ${n(d.amount as number)}, ${op.idempotency_key})`);
      return "processed";
    }
    case "regcf.disbursement.settled": {
      const op = await opById(sql, ext, "disburse");
      if (!op) return "wait";
      if (op.status === "confirmed") return "processed";
      await confirmOp(sql, op, String(d.disbursementId), (tx) => tx`select public.record_pool_tranche_released(${op.subject_id}, ${String(d.disbursementId)}, ${n(d.amount as number)}, ${op.idempotency_key})`);
      return "processed";
    }
    case "regcf.payout.settled": {
      const op = await opById(sql, ext, "payout");
      if (!op) return "wait";
      if (op.status === "confirmed") return "processed";
      await confirmOp(sql, op, String(d.payoutId), (tx) => tx`select public.record_pool_payout_confirmed(${op.subject_id}, ${String(d.payoutId)}, ${n(d.amount as number)}, ${op.idempotency_key})`);
      return "processed";
    }
    case "regcf.deposit.settled": {
      const [p] = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.pools where provider_collection_ref = ${String(d.collectionAccountId)}`);
      if (!p) return "wait";
      await runWithCtx({ ...SYS, correlationId: row.correlation_id }, () =>
        asService(sql, (tx) => tx`select public.record_collection_deposit(${p.id}, ${String(d.depositId)}, ${n(d.amount as number)}, ${String(d.reference ?? "")},
                                     ${String(d.settledAt ?? new Date().toISOString())}::timestamptz, ${"deposit:" + String(d.depositId)})`),
      );
      return "processed";
    }
    case "regcf.offering.closed":
      return "processed";
    default:
      log("warn", "regcf.unknown_event", { type: row.type });
      return "ignored";
  }
}
