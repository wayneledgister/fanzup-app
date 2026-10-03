import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asUser, n } from "../db";
import { requireUser, requireVerifiedUser, HttpError } from "../lib/auth";
import { createBacking } from "../checkout";
import type { Deps } from "../app";

const BackingBody = z.object({
  campaignId: z.string().uuid(),
  perkId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
  source: z.string().regex(/^[a-z0-9_-]{1,40}$/).nullish(),
});

export const backingRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  /**
   * Back a campaign (FR-PAY-001, FR-PAY-006). Requires a verified account and an Idempotency-Key header:
   * a retried request returns the original response and never creates a second backing or payment.
   */
  app.post("/backings", async (req, reply) => {
    const user = await requireVerifiedUser(req, d.verify, d.sql);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 200) throw new HttpError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
    const body = BackingBody.parse(req.body);
    const r = await createBacking(d.sql, d.provider, user.sub, key, body);
    return reply.status(r.status).send(r.body);
  });

  /** One backing, for the checkout confirmation poll (owner only, via RLS). */
  app.get<{ Params: { id: string } }>("/backings/:id", async (req) => {
    const user = await requireUser(req, d.verify);
    if (!z.string().uuid().safeParse(req.params.id).success) throw new HttpError(404, "not_found", "We couldn't find that backing.");
    const [b] = await asUser(d.sql, user, (tx) => tx<{ id: string; status: string; amount_minor: bigint; hold_expires_at: Date | null; slug: string; title: string; ends_at: Date | null; perk_title: string }[]>`
      select b.id, b.status::text, b.amount_minor, b.hold_expires_at, c.slug, c.title, c.ends_at, p.title as perk_title
        from public.backings b join public.campaigns c on c.id = b.campaign_id join public.perks p on p.id = b.perk_id
       where b.id = ${req.params.id} and b.backer_id = ${user.sub}`);
    if (!b) throw new HttpError(404, "not_found", "We couldn't find that backing.");
    return {
      id: b.id, status: b.status, amountMinor: n(b.amount_minor), holdExpiresAt: b.hold_expires_at?.toISOString() ?? null,
      campaign: { slug: b.slug, title: b.title, endsAt: b.ends_at?.toISOString() ?? null }, perk: { title: b.perk_title },
    };
  });

  /** The signed-in fan's backings (RLS: only their own). Enriched with ledger-derived money state in PR-C. */
  app.get("/me/backings", async (req) => {
    const user = await requireUser(req, d.verify);
    const rows = await asUser(d.sql, user, (tx) => tx<{ id: string; campaign_id: string; perk_id: string; amount_minor: bigint; status: string; created_at: Date }[]>`
      select id, campaign_id, perk_id, amount_minor, status::text, created_at from public.backings where backer_id = ${user.sub} order by created_at desc`);
    return { backings: rows.map((r) => ({ id: r.id, campaignId: r.campaign_id, perkId: r.perk_id, status: r.status, amountMinor: n(r.amount_minor), createdAt: r.created_at.toISOString() })) };
  });
};
