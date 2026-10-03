/**
 * Staff API (M1: API only, no UI — G2 condition 9). Every route requires a staff session with a second factor;
 * every state change goes through `privileged()` (reason, audit, single-operator delay and limits).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asService, n, type Tx } from "../db";
import { HttpError } from "../lib/auth";
import { cancelAction, privileged, requireStaff } from "../staff";
import { runReconciliation } from "../recon";
import type { Deps } from "../app";

const Uuid = z.string().uuid();
const Reason = z.object({ reason: z.string() });
const id = (v: string) => {
  if (!Uuid.safeParse(v).success) throw new HttpError(404, "not_found", "We couldn't find that item.");
  return v;
};

export const staffRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", async (req) => {
    await requireStaff(req, d);
  });

  /** One table-backed worklist (FR-ADM-001 API slice). */
  app.get<{ Querystring: { type?: string } }>("/queue", async (req) => {
    const type = req.query.type ?? null;
    const items = await asService(d.sql, (tx) => tx<{ type: string; id: string; subject_id: string | null; summary: string; created: Date; correlation_id: string | null }[]>`
      select * from (
        select 'review' as type, c.id, c.id as subject_id, c.title as summary, c.updated_at as created, null::text as correlation_id
          from public.campaigns c where c.status = 'in_review'
        union all
        select 'verification', t.id, t.campaign_id, 'Milestone ' || t.seq || ' of ' || c.title, coalesce(e.created_at, now()), e.correlation_id
          from public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id
          left join lateral (select created_at, correlation_id from public.tranche_evidence x where x.tranche_id = t.id order by created_at desc limit 1) e on true
         where t.status = 'evidence_submitted'
        union all
        select 'refunds', o.id, o.subject_id, 'Refund ' || o.status || coalesce(' (' || o.waiting || ')', ''), o.created_at, o.correlation_id
          from public.outbound_ops o where o.kind = 'refund' and o.status in ('initiated', 'sent')
        union all
        select 'dead_letters', o.id, o.subject_id, initcap(o.kind) || ' ' || o.status || ': ' || coalesce(o.last_error, ''), o.updated_at, o.correlation_id
          from public.outbound_ops o where o.status in ('dead', 'failed')
        union all
        select 'unmatched', e.id, null, e.type || ' ' || coalesce(e.object_ref, ''), e.received_at, e.correlation_id
          from public.provider_events e where e.status = 'unmatched'
        union all
        select 'failed_events', e.id, null, e.type || ': ' || coalesce(e.last_error, ''), e.received_at, e.correlation_id
          from public.provider_events e where e.status in ('failed', 'dead')
        union all
        select 'breaks', b.id, b.campaign_id, b.kind || ' ' || b.amount_minor, b.opened_at, null
          from public.recon_breaks b where b.resolved_at is null
        union all
        select 'scheduled', p.id, p.subject_id, p.action || ' after ' || p.execute_after, p.created_at, p.correlation_id
          from public.privileged_actions p where p.status = 'scheduled'
      ) q where ${type}::text is null or q.type = ${type}
      order by created limit 200`);
    return {
      items: items.map((i) => ({ type: i.type, id: i.id, subjectId: i.subject_id, summary: i.summary, ageSeconds: Math.max(0, Math.round((Date.now() - i.created.getTime()) / 1000)), correlationId: i.correlation_id })),
    };
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/review", async (req) => {
    const body = z.object({ decision: z.enum(["approved", "revisions_requested"]), notes: z.string().max(4000).optional(), reason: z.string() }).parse(req.body);
    return { action: await privileged(d, { action: "campaign.review", subjectId: id(req.params.id), reason: body.reason, params: { decision: body.decision, notes: body.notes } }) };
  });

  app.post<{ Params: { id: string } }>("/tranches/:id/verify", async (req) => {
    const { reason } = Reason.parse(req.body);
    const [t] = await asService(d.sql, (tx) => tx<{ amount: bigint | null }[]>`
      select case when c.status = 'funded' then public.tranche_release_amount(t.id) end as amount
        from public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id where t.id = ${id(req.params.id)}`);
    if (!t) throw new HttpError(404, "not_found", "We couldn't find that milestone.");
    return { action: await privileged(d, { action: "tranche.verify", subjectId: req.params.id, reason, amountMinor: t.amount == null ? null : n(t.amount) }) };
  });

  app.post<{ Params: { id: string } }>("/backings/:id/refund", async (req) => {
    const { reason } = Reason.parse(req.body);
    const [b] = await asService(d.sql, (tx) => tx<{ amount: bigint | null }[]>`select coalesce(captured_minor, amount_minor) as amount from public.backings where id = ${id(req.params.id)}`);
    if (!b) throw new HttpError(404, "not_found", "We couldn't find that backing.");
    return { action: await privileged(d, { action: "backing.refund", subjectId: req.params.id, reason, amountMinor: n(b.amount) }) };
  });

  app.post<{ Params: { id: string } }>("/actions/:id/cancel", async (req) => {
    const { reason } = Reason.parse(req.body);
    if (reason.trim().length < 10) throw new HttpError(400, "reason_required", "Type a reason of at least 10 characters.");
    await cancelAction(d.sql, id(req.params.id), reason);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/provider-events/:id/replay", async (req) => {
    const { reason } = Reason.parse(req.body);
    return { action: await privileged(d, { action: "provider_event.replay", subjectId: id(req.params.id), reason }) };
  });

  app.post<{ Params: { id: string } }>("/outbound-ops/:id/replay", async (req) => {
    const { reason } = Reason.parse(req.body);
    return { action: await privileged(d, { action: "outbound_op.replay", subjectId: id(req.params.id), reason }) };
  });

  app.post("/recon/run", async () => {
    const r = await runReconciliation(d.sql, d.provider);
    return r;
  });

  app.get("/recon/latest", async () => {
    const [run] = await asService(d.sql, (tx) => tx`select * from public.recon_runs where status = 'completed' order by started_at desc limit 1`);
    const breaks = await asService(d.sql, (tx) => tx`select id, kind, campaign_id, amount_minor::text, refs, opened_at from public.recon_breaks where resolved_at is null order by opened_at`);
    return { run: run ?? null, openBreaks: breaks };
  });

  app.post("/recon/override", async (req) => {
    const { reason } = Reason.parse(req.body);
    return { action: await privileged(d, { action: "recon.override", subjectId: null, reason }) };
  });

  /** FR-PLT-001: flag changes are privileged and audited. Layer 2 additionally needs REGCF_PROVIDER=mock, refused when deployed. */
  app.post<{ Params: { flag: string } }>("/flags/:flag", async (req) => {
    if (req.params.flag !== "layer2") throw new HttpError(404, "not_found", "Unknown flag.");
    const b = z.object({ on: z.boolean(), reason: z.string() }).parse(req.body);
    if (b.on && !d.regcf) throw new HttpError(409, "provider_missing", "Layer 2 needs a Reg CF provider (REGCF_PROVIDER=mock, local/CI only).");
    return { action: await privileged(d, { action: "flag.set", subjectId: null, reason: b.reason, params: { flag: "layer2", on: b.on } }) };
  });

  /** Everything carrying one correlation id, in time order (M1 exit test 4). */
  app.get<{ Params: { cid: string } }>("/trace/:cid", async (req) => {
    const cid = req.params.cid;
    const q = (fn: (tx: Tx) => PromiseLike<readonly unknown[]>) => asService(d.sql, async (tx) => [...(await fn(tx))]);
    const [audit, ledger, outbox, providerEvents, outboundOps, actions, notifications] = await Promise.all([
      q((tx) => tx`select id, action, entity, entity_id, actor_id, actor_kind, aal, data, created_at from public.audit_events where correlation_id = ${cid} order by id`),
      q((tx) => tx`select id, kind, campaign_id, backing_id, external_ref, created_at from public.ledger_transactions where correlation_id = ${cid} order by created_at`),
      q((tx) => tx`select id, topic, payload, processed_at, created_at from public.outbox where correlation_id = ${cid} order by id`),
      q((tx) => tx`select id, type, object_ref, status, received_at from public.provider_events where correlation_id = ${cid} order by received_at`),
      q((tx) => tx`select id, kind, subject_id, amount_minor::text, status, provider_ref, created_at from public.outbound_ops where correlation_id = ${cid} order by created_at`),
      q((tx) => tx`select id, action, subject_id, status, created_at from public.privileged_actions where correlation_id = ${cid} order by created_at`),
      q((tx) => tx`select id, template, template_version, status, created_at from public.notifications where correlation_id = ${cid} order by created_at`),
    ]);
    return { correlationId: cid, audit, ledger, outbox, providerEvents, outboundOps, actions, notifications };
  });

  /** FR-ID-007 weekly review: every privileged action in the week, and the operator's recorded sign-off. */
  app.get<{ Querystring: { weekStart?: string } }>("/weekly-review", async (req) => {
    const weekStart = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.weekStart);
    const actions = await asService(d.sql, (tx) => tx`
      select id, action, subject_id, actor_id, reason, amount_minor::text, status, execute_after, executed_at, created_at
        from public.privileged_actions where created_at >= ${weekStart}::date and created_at < ${weekStart}::date + 7 order by created_at`);
    const [signoff] = await asService(d.sql, (tx) => tx`select * from public.review_signoffs where week_start = ${weekStart}::date`);
    return { weekStart, actions, signoff: signoff ?? null };
  });

  app.post("/weekly-review/signoff", async (req, reply) => {
    const body = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(2000).optional(), reason: z.string().optional() }).parse(req.body);
    const action = await privileged(d, { action: "weekly_review.signoff", subjectId: null, reason: body.reason ?? `Weekly review sign-off for ${body.weekStart}` });
    const [{ count }] = await asService(d.sql, (tx) => tx<{ count: bigint }[]>`
      select count(*) from public.privileged_actions where action <> 'weekly_review.signoff' and created_at >= ${body.weekStart}::date and created_at < ${body.weekStart}::date + 7`);
    try {
      const [row] = await asService(d.sql, (tx) => tx`
        insert into public.review_signoffs (week_start, actor_id, note, action_count)
        values (${body.weekStart}::date, public.ctx('actor_id')::uuid, ${body.note ?? null}, ${n(count)}) returning *`);
      return reply.status(201).send({ signoff: row, action });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "already_signed", "That week is already signed off.");
      throw e;
    }
  });
};
