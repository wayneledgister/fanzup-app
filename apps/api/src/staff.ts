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
import { commitDistribution } from "./l2/service";

export async function requireStaff(req: FastifyRequest, d: Pick<Deps, "verify" | "sql">): Promise<Claims> {
  const u = await requireUser(req, d.verify);
  const [s] = await asService(d.sql, (tx) => tx<{ role: string }[]>`select role from public.staff where user_id = ${u.sub}`);
  if (!s) throw new HttpError(403, "not_staff", "This area is for FanZuP staff.");
  if (u.aal !== "aal2") throw new HttpError(403, "second_factor_required", "Confirm it's you with your authenticator app to use staff tools.");
  setActor(u.sub, "staff", "aal2");
  return u;
}

export async function singleOperatorMode(sql: Sql): Promise<boolean> {
  const [r] = await asService(sql, (tx) => tx<{ on: boolean }[]>`select public.single_operator_mode() as on`);
  return r.on;
}

export type ActionName =
  | "campaign.review" | "tranche.verify" | "backing.refund" | "recon.override" | "provider_event.replay" | "outbound_op.replay" | "weekly_review.signoff"
  // Layer 2 (CR-002)
  | "pool.review" | "pool.collection_execute" | "investor.kyc_decide" | "pool_tranche.verify" | "pool.distribution_commit" | "pool.collection_state"
  | "pool.deposit_simulate" | "flag.set" | "pool_op.replay";

/** Actions that move money (delay + daily limits apply while single-operator mode is on). */
const MONEY_ACTIONS = new Set<ActionName>(["tranche.verify", "backing.refund", "pool_tranche.verify", "pool.distribution_commit"]);
/**
 * Count-limited per UTC day in single-operator mode, each against `dailyLimits.verifications` (round-1 review, PR #12:
 * Layer 2 milestone verifications and distribution commits get the same daily limit as M1 milestone verifications).
 */
const COUNT_LIMITED = new Set<ActionName>(["tranche.verify", "pool_tranche.verify", "pool.distribution_commit"]);

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

type ActionDeps = Pick<Deps, "sql" | "provider"> & { regcf?: Deps["regcf"] };
/** `now` is the clock of the request (immediate) or the worker tick (delayed), passed to every L2 money function. */
type Executor = (d: ActionDeps, a: ActionRow, now: Date) => Promise<unknown>;

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
  /**
   * Layer 2 twin of `outbound_op.replay` (review round 2, PR #12): a `failed` or `dead` `pool_ops` row goes back to
   * `initiated` with its lease and claim cleared. `call_started_at` and the amount stay, so the runner's
   * lookup-before-call rules still apply (a disburse amount is frozen once a call started; the provider sees the op's own
   * idempotency key again; and because a call started, the runner looks the movement up at the provider before any
   * re-call). Not a money action: like M1's replay it is never delayed and has no daily limit (a refund owed to an
   * investor must not wait). An op the provider already moved for a different amount (failed `amount_mismatch`, or
   * carrying the provider ref of a confirmation) is refused `replay_requires_resolution` while its `amount_mismatch`
   * break is open or was never raised: staff resolve the break first (review round 3, PR #12).
   */
  "pool_op.replay": async (d, a) => {
    const rows = await asService(d.sql, async (tx) => {
      const [prev] = await tx<{ status: string; provider_ref: string | null; last_error: string | null; open_break: boolean; resolved_break: boolean }[]>`
        select o.status, o.provider_ref, o.last_error,
               exists (select 1 from public.pool_breaks b where b.dedupe_key = 'amount_mismatch:' || o.id::text and b.resolved_at is null) as open_break,
               exists (select 1 from public.pool_breaks b where b.dedupe_key = 'amount_mismatch:' || o.id::text and b.resolved_at is not null) as resolved_break
          from public.pool_ops o where o.id = ${a.subject_id} for update`;
      if (prev && ["failed", "dead"].includes(prev.status)) {
        const moved = prev.provider_ref != null || (prev.last_error ?? "").startsWith("amount_mismatch");
        if (prev.open_break || (moved && !prev.resolved_break)) {
          throw new HttpError(409, "replay_requires_resolution", "The provider already moved money for this operation. Resolve its amount-mismatch break before replaying it.");
        }
      }
      const r = await tx<{ id: string }[]>`
        update public.pool_ops set status = 'initiated', next_attempt_at = now(), lease_until = null, claim_token = null, last_error = null
         where id = ${a.subject_id} and status in ('dead', 'failed') returning id`;
      if (r.length) {
        await tx`insert into public.audit_events (action, entity, entity_id, data)
                 values ('pool_op.replayed', 'pool_op', ${a.subject_id}, ${tx.json({ from_status: prev.status, privileged_action_id: a.id })})`;
      }
      return r;
    });
    if (!rows.length) throw new HttpError(409, "not_replayable", "Only dead-lettered or failed operations can be replayed.");
  },
  // The sign-off row is written by the executor, so it exists only if the action executed (PR #8 review fix 10).
  "weekly_review.signoff": async (d, a) => {
    const p = a.params as { weekStart: string; note?: string | null };
    try {
      const [row] = await asService(d.sql, (tx) => tx`
        insert into public.review_signoffs (week_start, actor_id, note, action_count)
        select ${p.weekStart}::date, ${a.actor_id}, ${p.note ?? null}, count(*)
          from public.privileged_actions
         where action <> 'weekly_review.signoff' and created_at >= ${p.weekStart}::date and created_at < ${p.weekStart}::date + 7
        returning *`);
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "already_signed", "That week is already signed off.");
      throw e;
    }
  },
  // ── Layer 2 (CR-002). Reviewer ≠ owner is enforced here (campaignOwner) and again in SQL. ──
  "pool.review": async (d, a, now) => {
    const p = a.params as { decision: string; notes?: string };
    await asService(d.sql, (tx) => tx`select public.review_pool(${a.subject_id}, ${a.actor_id}, ${p.decision}, ${p.notes ?? null}, ${now})`);
  },
  "pool.collection_execute": async (d, a, now) => {
    await asService(d.sql, (tx) => tx`select public.execute_collection_mechanism(${a.subject_id}, ${a.actor_id}, ${tx.json(((a.params as { details?: unknown }).details ?? {}) as never)}, ${now})`);
  },
  "investor.kyc_decide": async (d, a) => {
    const decision = (a.params as { decision: "approved" | "rejected" }).decision;
    const [ip] = await asService(d.sql, (tx) => tx<{ party: string | null; status: string }[]>`select provider_party_ref as party, kyc_status::text as status from public.investor_profiles where user_id = ${a.subject_id}`);
    if (!ip?.party || ip.status !== "manual_review") throw new HttpError(409, "kyc_not_in_review", "This investor isn't waiting for a manual KYC decision.");
    if (!d.regcf) throw new HttpError(404, "layer2_disabled", "Investing isn't open yet.");
    await d.regcf.setPartyKyc(ip.party, decision, `kyc-decision:${a.id}`);
    await asService(d.sql, async (tx) => {
      await tx`update public.investor_profiles set kyc_status = ${decision}::public.kyc_status, kyc_decided_by = ${a.actor_id}, kyc_updated_at = now() where user_id = ${a.subject_id}`;
      await tx`insert into public.outbox (topic, payload) values ('l2.notify', ${tx.json({ template: "kyc_result", user_id: a.subject_id, status: decision })})`;
    });
  },
  "pool_tranche.verify": async (d, a, now) => {
    await asService(d.sql, (tx) => tx`select public.verify_pool_tranche(${a.subject_id}, ${a.actor_id}, ${now})`);
  },
  "pool.distribution_commit": async (d, a, now) => {
    const p = a.params as { label: string; hash: string };
    return commitDistribution(d.sql, a.subject_id!, p.label, p.hash, a.actor_id, now);
  },
  // Runs with the flag off (design §2, §6): staff can still move a Pool already in DEFAULT or REMEDIATION.
  "pool.collection_state": async (d, a, now) => {
    await asService(d.sql, (tx) => tx`select public.set_collection_state(${a.subject_id}, ${a.actor_id}, ${(a.params as { to: string }).to}::public.collection_state, ${a.reason}, ${now})`);
  },
  // Mock-only test trigger (design §5 key table): one deposit per staff action, key `deposit:<privileged_action_id>` —
  // never derived from amount and reference, so two real deposits with the same figures are never merged and a retried
  // action never deposits twice. An entry path: refused while the flag is off.
  "pool.deposit_simulate": async (d, a) => {
    const p = a.params as { amountMinor: number; reference: string };
    if (!d.regcf?.simulateDeposit) throw new HttpError(404, "not_available", "Deposits can only be simulated with the mock provider.");
    const [pool] = await asService(d.sql, (tx) => tx<{ collection: string | null; on: boolean }[]>`
      select provider_collection_ref as collection, public.l2_enabled() as on from public.pools where id = ${a.subject_id}`);
    if (!pool?.on) throw new HttpError(404, "layer2_disabled", "Investing isn't open yet.");
    if (!pool.collection) throw new HttpError(409, "no_collection_account", "This Pool has no collection account yet.");
    const dep = await d.regcf.simulateDeposit(pool.collection, { amount: p.amountMinor, reference: p.reference, externalId: a.subject_id! }, `deposit:${a.id}`);
    await asService(d.sql, (tx) => tx`insert into public.audit_events (action, entity, entity_id, data)
                                      values ('revenue.deposit_simulated', 'pool', ${a.subject_id}, ${tx.json({ amount_minor: p.amountMinor, reference: p.reference, deposit_ref: dep.id })})`);
    return { depositId: dep.id };
  },
  "flag.set": async (d, a) => {
    const p = a.params as { flag: string; on: boolean };
    await asService(d.sql, (tx) => tx`
      update public.platform_settings set value = ${tx.json(p.on)}, updated_at = now(), updated_by = ${a.actor_id} where key = ${"flag." + p.flag}`);
  },
};

/** The campaign a subject belongs to (for the reviewer ≠ owner rule), or null. */
async function campaignOwner(sql: Sql, action: ActionName, subjectId: string | null): Promise<string | null> {
  if (!subjectId) return null;
  const from: Partial<Record<ActionName, string>> = {
    "campaign.review": "public.campaigns c join public.artists a on a.id = c.artist_id where c.id = $1",
    "tranche.verify": "public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id join public.artists a on a.id = c.artist_id where t.id = $1",
    "backing.refund": "public.backings b join public.campaigns c on c.id = b.campaign_id join public.artists a on a.id = c.artist_id where b.id = $1",
    "pool.review": "public.pools p join public.artists a on a.id = p.artist_id where p.id = $1",
    "pool.collection_execute": "public.pools p join public.artists a on a.id = p.artist_id where p.id = $1",
    "pool.distribution_commit": "public.pools p join public.artists a on a.id = p.artist_id where p.id = $1",
    "pool.collection_state": "public.pools p join public.artists a on a.id = p.artist_id where p.id = $1",
    "pool_tranche.verify": "public.pool_tranches t join public.pools p on p.id = t.pool_id join public.artists a on a.id = p.artist_id where t.id = $1",
    "pool_op.replay": "public.pool_ops o join public.pools p on p.id = o.pool_id join public.artists a on a.id = p.artist_id where o.id = $1",
    // Staff can't decide their own KYC: the "owner" of an investor subject is the investor.
    "investor.kyc_decide": "(select $1::uuid as owner_id) a",
  };
  const clause = from[action];
  if (!clause) return null;
  const rows = await asService(sql, (tx) => tx.unsafe<{ owner_id: string }[]>(`select a.owner_id from ${clause}`, [subjectId]));
  if (!rows.length) throw new HttpError(404, "not_found", "We couldn't find that item.");
  return rows[0].owner_id;
}

export interface ActionResult {
  id: string;
  status: "scheduled" | "executed";
  executeAfter: string | null;
  /** The request's correlation id, so an operator can open `GET /staff/trace/:correlationId` (PR #9, exit test 4). */
  correlationId: string | null;
  /** What the executor returned (e.g. the sign-off row); not part of the HTTP `action` object. */
  result?: unknown;
}

/**
 * Record a privileged action and run it now or schedule it.
 *
 * Claiming (PR #8 review fix 1): an immediate action is inserted already `executing`, so neither the worker nor a
 * cancel can touch it; a delayed one is inserted `scheduled`, and only `executeDueActions` (which claims it with
 * `scheduled → executing` under `for update skip locked`) or `cancelAction` (only from `scheduled`) can move it.
 * Final updates are conditional on `executing`, so every action runs at most once.
 *
 * Daily limits (review fix 7): the check and the insert run in one transaction under a per-action-type advisory
 * lock, so two concurrent requests can't both fit under the same limit.
 */
export async function privileged(
  d: ActionDeps,
  input: { action: ActionName; subjectId: string | null; reason: unknown; amountMinor?: number | null; params?: Record<string, unknown> },
): Promise<ActionResult> {
  const c = currentCtx();
  if (!c?.actorId || c.actorKind !== "staff" || c.aal !== "aal2") throw new HttpError(403, "second_factor_required", "Staff session with second factor required.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10) throw new HttpError(400, "reason_required", "Type a reason of at least 10 characters. It goes in the audit log and your weekly review.");
  if ((await campaignOwner(d.sql, input.action, input.subjectId)) === c.actorId) {
    throw new HttpError(403, "reviewer_is_owner", "You can't approve, verify or decide something you own or are the subject of.");
  }

  const single = await singleOperatorMode(d.sql);
  const amount = input.amountMinor ?? null;
  const money = single && MONEY_ACTIONS.has(input.action);
  // A recon override lifts the payout pause for everyone, so it always waits out the delay (G1 N4).
  const delayed = (money && (amount ?? 0) > POLICY.singleOperator.delayAboveMinor) || (single && input.action === "recon.override");
  const delayHours = delayed ? POLICY.singleOperator.delayHours : 0;

  const [row] = await asService(d.sql, async (tx) => {
    if (money) {
      await tx`select pg_advisory_xact_lock(hashtext(${"privileged_actions:" + input.action}))`;
      const [day] = await tx<{ refunds: bigint; same: bigint }[]>`
        select coalesce(sum(amount_minor) filter (where action = 'backing.refund'), 0) as refunds,
               count(*) filter (where action = ${input.action}) as same
          from public.privileged_actions
         where status in ('scheduled', 'executing', 'executed') and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
      if (input.action === "backing.refund" && n(day.refunds) + (amount ?? 0) > POLICY.singleOperator.dailyLimits.refundsMinor) {
        throw new HttpError(409, "daily_limit", "This would pass today's refund limit for single-operator mode. It resets at midnight UTC.");
      }
      if (COUNT_LIMITED.has(input.action) && n(day.same) >= POLICY.singleOperator.dailyLimits.verifications) {
        throw new HttpError(409, "daily_limit", "Today's limit for this action in single-operator mode is reached. It resets at midnight UTC.");
      }
    }
    // A delayed staff refund must not run at or after the campaign's deadline (design §9; review round 2).
    if (delayed && input.action === "backing.refund") {
      const [late] = await tx<{ late: boolean }[]>`
        select now() + make_interval(hours => ${delayHours}) >= c.ends_at as late
          from public.backings b join public.campaigns c on c.id = b.campaign_id where b.id = ${input.subjectId}`;
      if (late?.late) {
        throw new HttpError(409, "refund_after_deadline",
          "This refund would run after the campaign ends. If the campaign misses its goal every backer is refunded automatically; refunds from a funded campaign arrive in M2.");
      }
    }
    const rows = await tx<ActionRow[]>`
      insert into public.privileged_actions (action, subject_id, actor_id, aal, reason, amount_minor, params, status, execute_after)
      values (${input.action}, ${input.subjectId}, ${c.actorId}, ${c.aal}, ${reason}, ${amount}, ${tx.json((input.params ?? {}) as never)},
              ${delayed ? "scheduled" : "executing"}, now() + make_interval(hours => ${delayHours}))
      returning *`;
    await tx`insert into public.audit_events (action, entity, entity_id, data)
             values (${"staff." + input.action + (delayed ? ".scheduled" : ".requested")}, 'privileged_action', ${rows[0].id},
                     ${tx.json({ subject_id: input.subjectId, amount_minor: amount, delayed })})`;
    return rows;
  });
  if (delayed) return { id: row.id, status: "scheduled", executeAfter: row.execute_after.toISOString(), correlationId: row.correlation_id };
  return execute(d, row);
}

/** Error code for the audit trail (audit payloads carry ids and codes only, NFR-COMP-11). */
function errorCode(e: unknown): string {
  if (e instanceof HttpError) return e.code;
  const pg = e as { code?: string; message?: string };
  if (pg.code === "P0001" && pg.message && /^[a-z_]{3,60}$/.test(pg.message)) return pg.message;
  return pg.code ?? "error";
}

/** Run an action this process has claimed (`status = 'executing'`). */
async function execute(d: ActionDeps, a: ActionRow, now = new Date()): Promise<ActionResult> {
  let result: unknown;
  try {
    result = await EXECUTORS[a.action](d, a, now);
  } catch (e) {
    const msg = redact(String((e as { detail?: string; message?: string }).detail ?? (e as Error).message ?? e));
    await asService(d.sql, async (tx) => {
      const [r] = await tx`update public.privileged_actions set status = 'failed', error = ${msg}, executed_at = now()
                            where id = ${a.id} and status = 'executing' returning id`;
      if (r) {
        await tx`insert into public.audit_events (action, entity, entity_id, data)
                 values (${"staff." + a.action + ".failed"}, 'privileged_action', ${a.id}, ${tx.json({ error_code: errorCode(e) })})`;
      }
    });
    throw e;
  }
  await asService(d.sql, async (tx) => {
    const [r] = await tx`update public.privileged_actions set status = 'executed', executed_at = now()
                          where id = ${a.id} and status = 'executing' returning id`;
    if (!r) {
      log("alert", "staff_action.claim_lost", { actionId: a.id, action: a.action });
      return;
    }
    await tx`insert into public.audit_events (action, entity, entity_id) values (${"staff." + a.action + ".executed"}, 'privileged_action', ${a.id})`;
  });
  return { id: a.id, status: "executed", executeAfter: null, correlationId: a.correlation_id, result };
}

/**
 * Worker step: claim scheduled actions whose delay has passed (`scheduled → executing`, skip-locked, so two workers
 * never take the same row and a cancel can't race the run) and execute them as their original actor.
 */
export async function executeDueActions(d: ActionDeps, now = new Date()) {
  const due = await asService(d.sql, (tx) => tx<ActionRow[]>`
    update public.privileged_actions set status = 'executing'
     where id in (select id from public.privileged_actions
                   where status = 'scheduled' and execute_after <= ${now}
                   order by execute_after for update skip locked limit 20)
    returning *`);
  for (const a of due) {
    await runWithCtx({ correlationId: a.correlation_id, actorId: a.actor_id, actorKind: "staff", aal: a.aal }, async () => {
      try {
        await execute(d, a, now);
      } catch (e) {
        log("alert", "staff_action.failed", { actionId: a.id, action: a.action, error: redact(String((e as Error).message ?? e)) });
      }
    });
  }
  return due.length;
}

/** Cancel a scheduled action. Only `scheduled` can be cancelled; once claimed (`executing`) it runs to the end. */
export async function cancelAction(sql: Sql, id: string, reason: string) {
  await asService(sql, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      update public.privileged_actions set status = 'cancelled', error = ${"cancelled: " + reason} where id = ${id} and status = 'scheduled' returning id`;
    if (!r) throw new HttpError(409, "not_cancellable", "Only scheduled actions can be cancelled.");
    await tx`insert into public.audit_events (action, entity, entity_id) values ('staff.action.cancelled', 'privileged_action', ${id})`;
  });
}
