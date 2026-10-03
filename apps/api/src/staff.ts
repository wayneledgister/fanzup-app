/**
 * Staff authority and single-operator mode (FR-ID-002 staff, FR-ID-003, FR-ID-007; card G1-A option 1).
 *
 * Every privileged action: second-factor session (aal2) from the verified token, a typed reason, a row in
 * privileged_actions and an audit event. While single-operator mode is on, money actions above
 * singleOperator.delayAboveMinor wait singleOperator.delayHours (cancellable), and daily limits apply to refunds
 * and verifications. A staff member can never act on a campaign they own.
 */
import type { FastifyRequest } from "fastify";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Claims, type Sql } from "./db";
import { currentCtx, runWithCtx, setActor } from "./context";
import { HttpError, requireUser } from "./lib/auth";
import { log, redact } from "./log";
import type { Deps } from "./app";
import { processEventById } from "./inbox";

export async function requireStaff(req: FastifyRequest, d: Pick<Deps, "verify" | "sql">): Promise<Claims> {
  const u = await requireUser(req, d.verify);
  const [s] = await asService(d.sql, (tx) => tx<{ role: string }[]>`select role from public.staff where user_id = ${u.sub}`);
  if (!s) throw new HttpError(403, "not_staff", "This area is for FanZuP staff.");
  if (u.aal !== "aal2") throw new HttpError(403, "second_factor_required", "Confirm it's you with your authenticator app to use staff tools.");
  setActor(u.sub, "staff", "aal2");
  return u;
}

export async function singleOperatorMode(sql: Sql): Promise<boolean> {
  const [r] = await asService(sql, (tx) => tx<{ on: boolean }[]>`
    select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = 'single_operator_mode'), true) as on`);
  return r.on;
}

export type ActionName = "campaign.review" | "tranche.verify" | "backing.refund" | "recon.override" | "provider_event.replay" | "outbound_op.replay" | "weekly_review.signoff";

/** Actions that move money (delay + daily limits apply while single-operator mode is on). */
const MONEY_ACTIONS = new Set<ActionName>(["tranche.verify", "backing.refund"]);

interface ActionRow {
  id: string;
  action: ActionName;
  subject_id: string | null;
  actor_id: string;
  aal: string;
  reason: string;
  amount_minor: bigint | null;
  params: Record<string, unknown>;
  correlation_id: string | null;
  status: string;
  execute_after: Date;
}

type Executor = (d: Pick<Deps, "sql" | "provider">, a: ActionRow) => Promise<void>;

const EXECUTORS: Record<ActionName, Executor> = {
  "campaign.review": async (d, a) => {
    const p = a.params as { decision: string; notes?: string; checklist?: unknown };
    await asService(d.sql, (tx) => tx`select public.review_campaign(${a.subject_id}, ${p.decision}, ${tx.json((p.checklist ?? {}) as never)}, ${p.notes ?? null})`);
  },
  "tranche.verify": async (d, a) => {
    await asService(d.sql, (tx) => tx`select public.verify_tranche(${a.subject_id}, ${a.actor_id})`);
  },
  "backing.refund": async (d, a) => {
    await asService(d.sql, (tx) => tx`select public.request_backing_refund(${a.subject_id}, ${a.reason})`);
  },
  "recon.override": async (d) => {
    const until = new Date(Date.now() + 24 * 3_600_000).toISOString();
    await asService(d.sql, (tx) => tx`
      insert into public.platform_settings (key, value) values ('recon_override_until', ${tx.json(until)})
      on conflict (key) do update set value = excluded.value, updated_at = now()`);
  },
  "provider_event.replay": async (d, a) => {
    await asService(d.sql, (tx) => tx`update public.provider_events set status = 'failed', attempts = 0, next_attempt_at = now() where id = ${a.subject_id} and status in ('failed', 'dead', 'unmatched')`);
    await processEventById(d.sql, d.provider, a.subject_id!);
  },
  "outbound_op.replay": async (d, a) => {
    const [r] = await asService(d.sql, (tx) => tx`
      update public.outbound_ops set status = 'initiated', next_attempt_at = now(), lease_until = null, last_error = null
       where id = ${a.subject_id} and status in ('dead', 'failed') returning id`);
    if (!r) throw new HttpError(409, "not_replayable", "Only dead-lettered or failed operations can be replayed.");
  },
  "weekly_review.signoff": async () => undefined, // the sign-off row is written by the route itself
};

/** The campaign a subject belongs to (for the reviewer ≠ owner rule), or null. */
async function campaignOwner(sql: Sql, action: ActionName, subjectId: string | null): Promise<string | null> {
  if (!subjectId) return null;
  const from: Partial<Record<ActionName, string>> = {
    "campaign.review": "public.campaigns c join public.artists a on a.id = c.artist_id where c.id = $1",
    "tranche.verify": "public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id join public.artists a on a.id = c.artist_id where t.id = $1",
    "backing.refund": "public.backings b join public.campaigns c on c.id = b.campaign_id join public.artists a on a.id = c.artist_id where b.id = $1",
  };
  const clause = from[action];
  if (!clause) return null;
  const rows = await asService(sql, (tx) => tx.unsafe<{ owner_id: string }[]>(`select a.owner_id from ${clause}`, [subjectId]));
  if (!rows.length) throw new HttpError(404, "not_found", "We couldn't find that item.");
  return rows[0].owner_id;
}

export async function privileged(
  d: Pick<Deps, "sql" | "provider">,
  input: { action: ActionName; subjectId: string | null; reason: unknown; amountMinor?: number | null; params?: Record<string, unknown> },
) {
  const c = currentCtx();
  if (!c?.actorId || c.actorKind !== "staff" || c.aal !== "aal2") throw new HttpError(403, "second_factor_required", "Staff session with second factor required.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10) throw new HttpError(400, "reason_required", "Type a reason of at least 10 characters. It goes in the audit log and your weekly review.");
  if ((await campaignOwner(d.sql, input.action, input.subjectId)) === c.actorId) {
    throw new HttpError(403, "reviewer_is_owner", "You can't act on a campaign you own.");
  }

  const single = await singleOperatorMode(d.sql);
  const amount = input.amountMinor ?? null;
  let delayed = false;
  if (single && MONEY_ACTIONS.has(input.action)) {
    const [day] = await asService(d.sql, (tx) => tx<{ refunds: bigint; verifications: bigint }[]>`
      select coalesce(sum(amount_minor) filter (where action = 'backing.refund'), 0) as refunds,
             count(*) filter (where action = 'tranche.verify') as verifications
        from public.privileged_actions
       where status in ('scheduled', 'executed') and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`);
    if (input.action === "backing.refund" && n(day.refunds) + (amount ?? 0) > POLICY.singleOperator.dailyLimits.refundsMinor) {
      throw new HttpError(409, "daily_limit", "This would pass today's refund limit for single-operator mode. It resets at midnight UTC.");
    }
    if (input.action === "tranche.verify" && n(day.verifications) >= POLICY.singleOperator.dailyLimits.verifications) {
      throw new HttpError(409, "daily_limit", "Today's verification limit for single-operator mode is reached. It resets at midnight UTC.");
    }
    delayed = (amount ?? 0) > POLICY.singleOperator.delayAboveMinor;
  }
  // A recon override lifts the payout pause for everyone, so it always waits out the delay (G1 N4).
  if (single && input.action === "recon.override") delayed = true;

  const [row] = await asService(d.sql, async (tx) => {
    const rows = await tx<ActionRow[]>`
      insert into public.privileged_actions (action, subject_id, actor_id, aal, reason, amount_minor, params, execute_after)
      values (${input.action}, ${input.subjectId}, ${c.actorId}, ${c.aal}, ${reason}, ${amount}, ${tx.json((input.params ?? {}) as never)},
              now() + make_interval(hours => ${delayed ? POLICY.singleOperator.delayHours : 0}))
      returning *`;
    await tx`insert into public.audit_events (action, entity, entity_id, data)
             values (${"staff." + input.action + (delayed ? ".scheduled" : ".requested")}, 'privileged_action', ${rows[0].id},
                     ${tx.json({ subject_id: input.subjectId, amount_minor: amount, delayed })})`;
    return rows;
  });
  if (delayed) return { id: row.id, status: "scheduled", executeAfter: row.execute_after.toISOString() };
  return execute(d, row);
}

async function execute(d: Pick<Deps, "sql" | "provider">, a: ActionRow) {
  try {
    await EXECUTORS[a.action](d, a);
    await asService(d.sql, async (tx) => {
      await tx`update public.privileged_actions set status = 'executed', executed_at = now() where id = ${a.id}`;
      await tx`insert into public.audit_events (action, entity, entity_id) values (${"staff." + a.action + ".executed"}, 'privileged_action', ${a.id})`;
    });
    return { id: a.id, status: "executed", executeAfter: null as string | null };
  } catch (e) {
    const msg = redact(String((e as { detail?: string; message?: string }).detail ?? (e as Error).message ?? e));
    await asService(d.sql, (tx) => tx`update public.privileged_actions set status = 'failed', error = ${msg} where id = ${a.id}`);
    throw e;
  }
}

/** Worker step: run scheduled actions whose delay has passed, as their original actor. */
export async function executeDueActions(d: Pick<Deps, "sql" | "provider">, now = new Date()) {
  const due = await asService(d.sql, (tx) => tx<ActionRow[]>`
    select * from public.privileged_actions where status = 'scheduled' and execute_after <= ${now} order by execute_after limit 20`);
  for (const a of due) {
    await runWithCtx({ correlationId: a.correlation_id, actorId: a.actor_id, actorKind: "staff", aal: a.aal }, async () => {
      try {
        await execute(d, a);
      } catch (e) {
        log("alert", "staff_action.failed", { actionId: a.id, action: a.action, error: redact(String((e as Error).message ?? e)) });
      }
    });
  }
  return due.length;
}

export async function cancelAction(sql: Sql, id: string, reason: string) {
  const [r] = await asService(sql, (tx) => tx<{ id: string }[]>`
    update public.privileged_actions set status = 'cancelled', error = ${"cancelled: " + reason} where id = ${id} and status = 'scheduled' returning id`);
  if (!r) throw new HttpError(409, "not_cancellable", "Only scheduled actions can be cancelled.");
  await asService(sql, (tx) => tx`insert into public.audit_events (action, entity, entity_id) values ('staff.action.cancelled', 'privileged_action', ${id})`);
}
