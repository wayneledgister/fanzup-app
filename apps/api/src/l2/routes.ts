/**
 * Layer 2 HTTP routes (design §9). Every plugin is behind the server-side `layer2` gate (gate.ts): 404
 * `layer2_disabled` unless the mock provider is configured and the DB flag is on.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CertificationRequest, InvestRequest, KycStartRequest, PoolDraftRequest, StatementRequest } from "@fanzup/shared/l2schemas";
import { asService, n } from "../db";
import { HttpError, optionalUser, requireUser, requireVerifiedUser } from "../lib/auth";
import type { Claims } from "../db";
import { privileged, requireStaff } from "../staff";
import { runWorkerTick } from "../jobs";
import { jobDeps, type Deps } from "../app";
import { ingestRegCfEvent } from "./events";
import { processEventById } from "../inbox";
import { log } from "../log";
import { l2Gate, l2On, regcfOf } from "./gate";
import {
  addStatement, certify, commitDistribution, computeDistribution, createPoolDraft, investorMe, invest, launchPool, ownPool, reconcileL2Ledger, startKyc,
  submitPool, updatePoolDraft,
} from "./service";
import { creatorPool, creatorPools, formCDocument, investmentsFor, listPools, poolDetail, staffMoney, staffPools, staffQueue } from "./views";

const Uuid = z.string().uuid();
const uuid = (v: string, what = "item") => {
  if (!Uuid.safeParse(v).success) throw new HttpError(404, "not_found", `We couldn't find that ${what}.`);
  return v;
};
const Reason = z.object({ reason: z.string() });

/** Fan + public routes, mounted at /api/v1. */
export const l2FanRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", l2Gate(d));

  app.get("/pools", async (req) => {
    const q = z.object({
      tab: z.enum(["live", "closed"]).default("live"),
      revenueType: z.enum(["master", "sync", "publishing"]).optional(),
      badge: z.enum(["SECURED_ISH", "VERIFIED", "TRUST_BASED"]).optional(),
      genre: z.string().max(40).optional(),
      sort: z.enum(["ending", "newest"]).default("ending"),
    }).parse(req.query);
    return listPools(d.sql, q);
  });
  app.get<{ Params: { slug: string } }>("/pools/:slug", async (req) => {
    await optionalUser(req, d.verify);
    return poolDetail(d.sql, req.params.slug);
  });
  app.get<{ Params: { slug: string } }>("/pools/:slug/form-c", async (req) => formCDocument(d.sql, req.params.slug));

  app.get("/investor/me", async (req) => investorMe(d.sql, (await requireUser(req, d.verify)).sub));
  app.post("/investor/kyc", async (req) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    return startKyc(d, u.sub, KycStartRequest.parse(req.body));
  });
  app.post("/investor/certification", async (req) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    return certify(d.sql, u.sub, CertificationRequest.parse(req.body));
  });

  app.post<{ Params: { id: string } }>("/pools/:id/investments", async (req, reply) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 200) throw new HttpError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
    const [{ missing }] = await asService(d.sql, (tx) => tx<{ missing: string[] }[]>`select public.missing_acceptances(${u.sub}) as missing`);
    if (missing.length) throw new HttpError(403, "acceptance_required", "Please review and accept the current terms first.");
    const r = await invest(d, u.sub, uuid(req.params.id, "Pool"), key, InvestRequest.parse(req.body));
    return reply.status(r.status).send(r.body);
  });
  app.get<{ Params: { id: string } }>("/investments/:id", async (req) => {
    const u = await requireUser(req, d.verify);
    const [inv] = await investmentsFor(d.sql, u.sub, uuid(req.params.id, "investment"));
    if (!inv) throw new HttpError(404, "investment_not_found", "We couldn't find that investment.");
    return inv;
  });
  app.post<{ Params: { id: string } }>("/investments/:id/cancel", async (req) => {
    const u = await requireUser(req, d.verify);
    await asService(d.sql, (tx) => tx`select public.cancel_investment(${uuid(req.params.id, "investment")}, ${u.sub})`);
    const [inv] = await investmentsFor(d.sql, u.sub, req.params.id);
    return inv;
  });
  app.get("/portfolio", async (req) => {
    const u = await requireUser(req, d.verify);
    const [investor, investments] = await Promise.all([investorMe(d.sql, u.sub), investmentsFor(d.sql, u.sub)]);
    return { investor, investments };
  });
};

/** Creator routes, mounted at /api/v1/creator. */
export const l2CreatorRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", l2Gate(d));
  app.addHook("preHandler", async (req) => {
    (req as unknown as { fzUser: Claims }).fzUser = await requireVerifiedUser(req, d.verify, d.sql);
  });
  const user = (req: unknown) => (req as { fzUser: Claims }).fzUser.sub;

  app.get("/pools", async (req) => creatorPools(d.sql, user(req)));
  app.post("/pools", async (req, reply) => reply.status(201).send(await createPoolDraft(d.sql, user(req), PoolDraftRequest.parse(req.body) as never)));
  app.get<{ Params: { id: string } }>("/pools/:id", async (req) => creatorPool(d.sql, user(req), uuid(req.params.id, "Pool")));
  app.patch<{ Params: { id: string } }>("/pools/:id", async (req) => updatePoolDraft(d.sql, user(req), uuid(req.params.id, "Pool"), PoolDraftRequest.parse(req.body) as never));
  app.post<{ Params: { id: string } }>("/pools/:id/submit", async (req) => submitPool(d.sql, user(req), uuid(req.params.id, "Pool")));
  app.post<{ Params: { id: string } }>("/pools/:id/launch", async (req) => launchPool(d, user(req), uuid(req.params.id, "Pool")));
  app.post<{ Params: { id: string } }>("/pools/:id/statements", async (req, reply) =>
    reply.status(201).send(await addStatement(d.sql, user(req), uuid(req.params.id, "Pool"), StatementRequest.parse(req.body))));
  app.post<{ Params: { id: string } }>("/pool-tranches/:id/evidence", async (req, reply) => {
    const b = z.object({ notes: z.string().min(10).max(4000), links: z.array(z.string().url().startsWith("https://")).max(10).default([]) }).parse(req.body);
    const [r] = await asService(d.sql, (tx) => tx<{ id: string }[]>`select public.submit_pool_tranche_evidence(${uuid(req.params.id, "milestone")}, ${user(req)}, ${b.notes}, ${b.links}) as id`);
    return reply.status(201).send({ evidenceId: r.id });
  });
};

/** Staff routes, mounted at /api/v1/staff/l2. Every state change goes through privileged(). */
export const l2StaffRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", async (req) => {
    await requireStaff(req, d);
  });
  app.addHook("preHandler", l2Gate(d));

  app.get("/queue", async () => staffQueue(d.sql));
  app.get("/pools", async () => staffPools(d.sql));
  app.get<{ Params: { id: string } }>("/pools/:id/money", async (req) => staffMoney(d.sql, uuid(req.params.id, "Pool")));
  app.get<{ Params: { id: string } }>("/pools/:id/form-c", async (req) => {
    const [doc] = await asService(d.sql, (tx) => tx`select d.version, d.sha256, d.body from public.pools p join public.pool_documents d on d.id = p.form_c_document_id where p.id = ${uuid(req.params.id, "Pool")}`);
    if (!doc) throw new HttpError(404, "form_c_not_found", "No Form C yet.");
    return doc;
  });
  app.get("/investors", async () => {
    const rows = await asService(d.sql, (tx) => tx<{ user_id: string; name: string; kyc_status: string; state: string | null; certified: boolean; accredited: boolean; updated: Date }[]>`
      select ip.user_id, coalesce(nullif(pr.display_name, ''), 'Investor') as name, ip.kyc_status::text, ip.state, ip.certified_at is not null as certified, ip.accredited,
             coalesce(ip.kyc_updated_at, ip.created_at) as updated
        from public.investor_profiles ip join public.profiles pr on pr.id = ip.user_id order by (ip.kyc_status = 'manual_review') desc, updated desc limit 200`);
    return { investors: rows.map((r) => ({ userId: r.user_id, name: r.name, kycStatus: r.kyc_status, state: r.state, certified: r.certified, accredited: r.accredited, updatedAt: r.updated.toISOString() })) };
  });

  app.post<{ Params: { id: string } }>("/pools/:id/review", async (req) => {
    const b = z.object({ decision: z.enum(["approved", "revisions_requested"]), notes: z.string().max(4000).optional(), reason: z.string() }).parse(req.body);
    return { action: await privileged(d, { action: "pool.review", subjectId: uuid(req.params.id, "Pool"), reason: b.reason, params: { decision: b.decision, notes: b.notes } }) };
  });
  app.post<{ Params: { id: string } }>("/pools/:id/collection/execute", async (req) => {
    const b = z.object({ reason: z.string(), details: z.record(z.string().max(200)).optional() }).parse(req.body);
    return { action: await privileged(d, { action: "pool.collection_execute", subjectId: uuid(req.params.id, "Pool"), reason: b.reason, params: { details: b.details ?? {} } }) };
  });
  app.post<{ Params: { userId: string } }>("/investors/:userId/kyc", async (req) => {
    const b = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string() }).parse(req.body);
    return { action: await privileged(d, { action: "investor.kyc_decide", subjectId: uuid(req.params.userId, "investor"), reason: b.reason, params: { decision: b.decision } }) };
  });
  app.post<{ Params: { id: string } }>("/pool-tranches/:id/verify", async (req) => {
    const { reason } = Reason.parse(req.body);
    const [t] = await asService(d.sql, (tx) => tx<{ amount: bigint | null }[]>`
      select case when p.status in ('funded', 'matured') then public.pool_tranche_release_amount(t.id) end as amount
        from public.pool_tranches t join public.pools p on p.id = t.pool_id where t.id = ${uuid(req.params.id, "milestone")}`);
    if (!t) throw new HttpError(404, "not_found", "We couldn't find that milestone.");
    return { action: await privileged(d, { action: "pool_tranche.verify", subjectId: req.params.id, reason, amountMinor: t.amount == null ? null : n(t.amount) }) };
  });
  app.post<{ Params: { id: string } }>("/pools/:id/recon", async (req) => {
    const id = uuid(req.params.id, "Pool");
    const [r] = await asService(d.sql, (tx) => tx<{ r: unknown }[]>`select public.reconcile_pool_revenue(${id}) as r`);
    const ledger = await reconcileL2Ledger(d, id);
    return { revenue: r.r, ledger };
  });
  /** Mock-only trigger: a distributor/lockbox settlement lands in the Pool's collection account (01b §3). */
  app.post<{ Params: { id: string } }>("/pools/:id/deposits", async (req) => {
    const regcf = regcfOf(d);
    if (!regcf.simulateDeposit) throw new HttpError(404, "not_available", "Deposits can only be simulated with the mock provider.");
    const b = z.object({ amountMinor: z.number().int().positive(), reference: z.string().min(2).max(40), reason: z.string().optional() }).parse(req.body);
    const [p] = await asService(d.sql, (tx) => tx<{ collection: string | null }[]>`select provider_collection_ref as collection from public.pools where id = ${uuid(req.params.id, "Pool")}`);
    if (!p?.collection) throw new HttpError(409, "no_collection_account", "This Pool has no collection account yet.");
    const key = String(req.headers["idempotency-key"] ?? `deposit:${req.params.id}:${b.reference}:${b.amountMinor}`);
    const dep = await regcf.simulateDeposit(p.collection, { amount: b.amountMinor, reference: b.reference, externalId: req.params.id }, key);
    await asService(d.sql, (tx) => tx`insert into public.audit_events (action, entity, entity_id, data) values ('revenue.deposit_simulated', 'pool', ${req.params.id}, ${tx.json({ amount_minor: b.amountMinor, reference: b.reference })})`);
    return { depositId: dep.id, status: "pending" };
  });
  app.post<{ Params: { id: string } }>("/pools/:id/distributions/dry-run", async (req) => {
    const b = z.object({ label: z.string().min(2).max(40) }).parse(req.body);
    return computeDistribution(d.sql, uuid(req.params.id, "Pool"), b.label);
  });
  app.post<{ Params: { id: string } }>("/pools/:id/distributions/commit", async (req) => {
    const b = z.object({ label: z.string().min(2).max(40), hash: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string() }).parse(req.body);
    const run = await computeDistribution(d.sql, uuid(req.params.id, "Pool"), b.label);
    return { action: await privileged(d, { action: "pool.distribution_commit", subjectId: req.params.id, reason: b.reason, amountMinor: run.allocation.runTotalMinor, params: { label: b.label, hash: b.hash } }) };
  });
  app.post<{ Params: { id: string } }>("/pools/:id/collection-state", async (req) => {
    const b = z.object({ to: z.enum(["REMEDIATION", "CHARGED_OFF", "COLLECTING"]), reason: z.string() }).parse(req.body);
    return { action: await privileged(d, { action: "pool.collection_state", subjectId: uuid(req.params.id, "Pool"), reason: b.reason, params: { to: b.to } }) };
  });
};

/** Signed provider webhooks, mounted at /api/v1/webhooks (raw-body parser registered by the parent plugin). */
export function registerRegCfWebhook(app: Parameters<FastifyPluginAsync>[0], d: Deps) {
  app.post("/regcf", async (req, reply) => {
    if (!d.regcf) return reply.status(404).send();
    let evt;
    try {
      evt = d.regcf.parseWebhook((req.body as Buffer).toString("utf8"), req.headers["x-mock-escrow-signature"] as string | undefined);
    } catch {
      log("warn", "webhook.regcf_bad_signature");
      return reply.status(400).send({ error: "bad_signature" });
    }
    if (!(await l2On(d))) return reply.status(404).send({ error: "layer2_disabled" });
    const { id, inserted } = await ingestRegCfEvent(d.sql, evt);
    // Stored before processing (FR-PAY-002). Processing failures never fail the delivery; the worker retries.
    if (inserted) await processEventById(d.sql, d.provider, id).catch(() => undefined);
    return reply.status(200).send({ received: true, duplicate: !inserted });
  });
}

/** Dev-only (mock provider, never deployed): move the provider clock and run one worker tick at the same offset. */
export const l2DevRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", l2Gate(d));
  app.post("/advance", async (req) => {
    const b = z.object({ seconds: z.number().min(0).max(10 * 365 * 86_400).default(5) }).parse(req.body ?? {});
    const provider = regcfOf(d);
    const mock = provider.advance ? await provider.advance(b.seconds) : null;
    const tick = await runWorkerTick(jobDeps(d), new Date(Date.now() + b.seconds * 1000));
    return { provider: mock, tick };
  });
};
