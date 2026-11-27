/**
 * Staff API (M1: API only, no UI — G2 condition 9). Every route requires a staff session with a second factor;
 * every state change goes through `privileged()` (reason, audit, single-operator delay and limits).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asService, n, type Tx } from "../db";
import { HttpError } from "../lib/auth";
import { cancelAction, privileged, requireStaff, singleOperatorMode } from "../staff";
import { StaffQueueType } from "@fanzup/shared/schemas";
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
  /** Run a privileged action; the HTTP response carries `{ id, status, executeAfter }` only. */
  const act = async (input: Parameters<typeof privileged>[1]) => {
    const { result: _result, ...action } = await privileged(d, input);
    return action;
  };

  /** One table-backed worklist (FR-ADM-001 API slice). */
  app.get<{ Querystring: { type?: string } }>("/queue", async (req) => {
    const type = req.query.type == null ? null : StaffQueueType.parse(req.query.type);
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
        -- Releases waiting on the artist's payout account, funds, a recon pause or an earlier tranche (design §3.5.2).
        select 'payouts', o.id, o.subject_id, 'Payout waiting (' || o.waiting || ')', o.created_at, o.correlation_id
          from public.outbound_ops o where o.kind = 'payout' and o.status = 'initiated' and o.waiting is not null
        union all
        select 'dead_letters', o.id, o.subject_id, initcap(o.kind) || ' ' || o.status || ': ' || coalesce(o.last_error, ''), o.updated_at, o.correlation_id
          from public.outbound_ops o where o.status in ('dead', 'failed')
        union all
        -- Layer 2 money ops that need a person (review round 2, PR #12): replay with POST /staff/l2/pool-ops/:id/replay.
        -- Listed whatever the layer2 flag says: money already owed is a completion path.
        select 'pool_dead_letters', o.id, o.pool_id, 'Pool ' || replace(o.kind, '_', ' ') || ' ' || o.status || ': ' || coalesce(o.last_error, ''), o.updated_at, o.correlation_id
          from public.pool_ops o where o.status in ('dead', 'failed')
        union all
        -- Open Layer 2 breaks (review round 3 follow-up). amount_mismatch / unapplied_funding are closed with
        -- POST /staff/l2/pool-breaks/:id/resolve; the other kinds clear when recon no longer finds them.
        select 'pool_breaks', b.id, b.pool_id,
               b.kind || ' ' || b.amount_minor || case when b.kind in ('amount_mismatch', 'unapplied_funding') then ' (staff resolve)' else ' (clears on recon)' end,
               b.opened_at, null
          from public.pool_breaks b where b.resolved_at is null
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
        union all
        -- Claimed but never finished (the process stopped mid-run): needs a look, never re-run automatically.
        select 'scheduled', p.id, p.subject_id, p.action || ' stuck executing since ' || p.execute_after, p.created_at, p.correlation_id
          from public.privileged_actions p where p.status = 'executing' and p.execute_after < now() - interval '15 minutes'
        union all
        -- Agent tasks that gave up (CR-003, FR-AGT-F-003). Advisory work: nothing waits on them.
        select 'agent_dead_letters', t.id, t.subject_id, t.agent || ' ' || t.subject_key || ': ' || coalesce(t.last_error, ''), t.updated_at, t.correlation_id
          from public.agent_tasks t where t.status = 'dead'
      ) q where ${type}::text is null or q.type = ${type}
      order by created limit 200`);
    return {
      // FR-ID-007: the mode is visible to the operator; changing it is a SQL-only step in M1 (worklog deviation).
      singleOperatorMode: await singleOperatorMode(d.sql),
      items: items.map((i) => ({ type: i.type, id: i.id, subjectId: i.subject_id, summary: i.summary, ageSeconds: Math.max(0, Math.round((Date.now() - i.created.getTime()) / 1000)), correlationId: i.correlation_id })),
    };
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/review", async (req) => {
    const body = z.object({ decision: z.enum(["approved", "revisions_requested"]), notes: z.string().max(4000).optional(), reason: z.string() }).parse(req.body);
    return { action: await act({ action: "campaign.review", subjectId: id(req.params.id), reason: body.reason, params: { decision: body.decision, notes: body.notes } }) };
  });

  app.post<{ Params: { id: string } }>("/tranches/:id/verify", async (req) => {
    const { reason } = Reason.parse(req.body);
    const [t] = await asService(d.sql, (tx) => tx<{ amount: bigint | null }[]>`
      select case when c.status = 'funded' then public.tranche_release_amount(t.id) end as amount
        from public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id where t.id = ${id(req.params.id)}`);
    if (!t) throw new HttpError(404, "not_found", "We couldn't find that milestone.");
    return { action: await act({ action: "tranche.verify", subjectId: req.params.id, reason, amountMinor: t.amount == null ? null : n(t.amount) }) };
  });

  app.post<{ Params: { id: string } }>("/backings/:id/refund", async (req) => {
    const { reason } = Reason.parse(req.body);
    const [b] = await asService(d.sql, (tx) => tx<{ amount: bigint | null }[]>`select coalesce(captured_minor, amount_minor) as amount from public.backings where id = ${id(req.params.id)}`);
    if (!b) throw new HttpError(404, "not_found", "We couldn't find that backing.");
    return { action: await act({ action: "backing.refund", subjectId: req.params.id, reason, amountMinor: n(b.amount) }) };
  });

  app.post<{ Params: { id: string } }>("/actions/:id/cancel", async (req) => {
    const { reason } = Reason.parse(req.body);
    if (reason.trim().length < 10) throw new HttpError(400, "reason_required", "Type a reason of at least 10 characters.");
    await cancelAction(d.sql, id(req.params.id), reason);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/provider-events/:id/replay", async (req) => {
    const { reason } = Reason.parse(req.body);
    return { action: await act({ action: "provider_event.replay", subjectId: id(req.params.id), reason }) };
  });

  app.post<{ Params: { id: string } }>("/outbound-ops/:id/replay", async (req) => {
    const { reason } = Reason.parse(req.body);
    return { action: await act({ action: "outbound_op.replay", subjectId: id(req.params.id), reason }) };
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
    return { action: await act({ action: "recon.override", subjectId: null, reason }) };
  });

  /** FR-PLT-001: flag changes are privileged and audited. Layer 2 additionally needs REGCF_PROVIDER=mock, refused when deployed. */
  app.post<{ Params: { flag: string } }>("/flags/:flag", async (req) => {
    if (!["layer2", "agents", "marketplace"].includes(req.params.flag)) throw new HttpError(404, "not_found", "Unknown flag.");
    const b = z.object({ on: z.boolean(), reason: z.string() }).parse(req.body);
    if (req.params.flag === "marketplace") {
      // CR-005: the services marketplace moves no money in MKT-1 (ADR-010), so it needs no provider.
      return { action: await privileged(d, { action: "flag.set", subjectId: null, reason: b.reason, params: { flag: "marketplace", on: b.on } }) };
    }
    if (req.params.flag === "agents") {
      // CR-003: the agent layer is advisory; turning it on needs no provider (the agent worker brings its own model config).
      return { action: await privileged(d, { action: "flag.set", subjectId: null, reason: b.reason, params: { flag: "agents", on: b.on } }) };
    }
    if (b.on && !d.regcf) throw new HttpError(409, "provider_missing", "Layer 2 needs a Reg CF provider (REGCF_PROVIDER=mock, local/CI only).");
    return { action: await privileged(d, { action: "flag.set", subjectId: null, reason: b.reason, params: { flag: "layer2", on: b.on } }) };
  });

  // ── Agent layer (CR-003, FR-AGT-F-005). Proposals are advisory; a verdict changes nothing else. ──
  app.get<{ Querystring: { subjectId?: string; agent?: string; status?: string } }>("/agents/proposals", async (req) => {
    const q = z.object({
      subjectId: z.string().uuid().optional(),
      agent: z.enum(["campaign_review", "ops_weekly"]).optional(),
      status: z.enum(["open", "superseded"]).optional(),
    }).parse(req.query);
    const proposals = await asService(d.sql, (tx) => tx`
      select p.id, p.agent, p.subject_kind, p.subject_id, p.subject_key, p.kind, p.source, p.body, p.status,
             p.verdict, p.verdict_note, p.verdict_by, p.verdict_at, p.correlation_id, p.created_at,
             r.model, r.prompt_version, r.status as run_status, r.error_code
        from public.agent_proposals p join public.agent_runs r on r.id = p.run_id
       where (${q.subjectId ?? null}::uuid is null or p.subject_id = ${q.subjectId ?? null}::uuid)
         and (${q.agent ?? null}::text is null or p.agent = ${q.agent ?? null})
         and (${q.status ?? null}::text is null or p.status = ${q.status ?? null})
       order by p.created_at desc limit 50`);
    return { proposals };
  });

  app.post<{ Params: { id: string } }>("/agents/proposals/:id/verdict", async (req) => {
    const b = z.object({ verdict: z.enum(["agree", "partial", "disagree"]), note: z.string().max(2000).optional(), reason: z.string() }).parse(req.body);
    // Checked before privileged() so a repeat or a bad id doesn't leave a failed action in the weekly pack (review minor 7).
    // The executor's `verdict is null` guard still decides a race.
    const [p] = await asService(d.sql, (tx) => tx<{ verdict: string | null }[]>`select verdict from public.agent_proposals where id = ${id(req.params.id)}`);
    if (!p) throw new HttpError(404, "not_found", "We couldn't find that proposal.");
    if (p.verdict) throw new HttpError(409, "verdict_exists", "This proposal already has a verdict.");
    return { action: await act({ action: "agent_proposal.verdict", subjectId: id(req.params.id), reason: b.reason, params: { verdict: b.verdict, note: b.note ?? null } }) };
  });

  app.get("/agents/metrics", async () => {
    const rows = await asService(d.sql, (tx) => tx<{ agent: string; proposals: bigint; agree: bigint; partial: bigint; disagree: bigint }[]>`
      select agent, count(*) as proposals,
             count(*) filter (where verdict = 'agree') as agree,
             count(*) filter (where verdict = 'partial') as partial,
             count(*) filter (where verdict = 'disagree') as disagree
        from public.agent_proposals group by agent order by agent`);
    return {
      agents: rows.map((r) => {
        const judged = n(r.agree) + n(r.partial) + n(r.disagree);
        return { agent: r.agent, proposals: n(r.proposals), agree: n(r.agree), partial: n(r.partial), disagree: n(r.disagree), agreementRate: judged ? n(r.agree) / judged : null };
      }),
    };
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
    // A typed reason like every other privileged action (review fix 10); the executor writes the sign-off row.
    const body = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(2000).optional(), reason: z.string() }).parse(req.body);
    const { result, ...action } = await privileged(d, { action: "weekly_review.signoff", subjectId: null, reason: body.reason, params: { weekStart: body.weekStart, note: body.note ?? null } });
    return reply.status(201).send({ signoff: result, action });
  });
};
