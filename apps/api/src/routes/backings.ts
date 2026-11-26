import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { BackCampaignRequest } from "@fanzup/shared/schemas";
import { asUser, n } from "../db";
import { requireUser, requireVerifiedUser, HttpError } from "../lib/auth";
import { asService } from "../db";
import { createBacking } from "../checkout";
import type { Deps } from "../app";

const BackingBody = BackCampaignRequest;

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
    // FR-PRV-001: the current terms must be accepted before backing (re-acceptance blocks the next backing).
    const [{ missing }] = await asService(d.sql, (tx) => tx<{ missing: string[] }[]>`select public.missing_acceptances(${user.sub}) as missing`);
    if (missing.length) throw new HttpError(403, "acceptance_required", "Please review and accept the current terms before backing.");
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
};
