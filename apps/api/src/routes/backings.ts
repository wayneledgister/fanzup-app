import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { BackCampaignRequest } from "@fanzup/shared/schemas";
import { asService, asUser, n } from "../db";
import { requireUser, HttpError } from "../lib/auth";
import type { Deps } from "../app";

export const backingRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  /**
   * Back a campaign. Requires an Idempotency-Key header (PRD 01a): a retried request returns the
   * original response and never creates a second backing or payment.
   */
  app.post("/backings", async (req, reply) => {
    const user = await requireUser(req, d.verify);
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 200) throw new HttpError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
    const body = BackCampaignRequest.parse(req.body);
    const hash = createHash("sha256").update(JSON.stringify({ u: user.sub, body })).digest("hex");
    const scopedKey = `backings:${user.sub}:${key}`;

    const [prior] = await asService(d.sql, (tx) => tx<{ request_hash: string; response: unknown; status_code: number }[]>`
      select request_hash, response, status_code from public.api_idempotency where key = ${scopedKey}`);
    if (prior) {
      if (prior.request_hash !== hash) throw new HttpError(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
      return reply.status(prior.status_code).send(prior.response);
    }

    const backing = await asService(d.sql, async (tx) => {
      const [c] = await tx<{ id: string; status: string; ends_at: Date | null; owner_id: string; title: string }[]>`
        select c.id, c.status, c.ends_at, a.owner_id, c.title from public.campaigns c join public.artists a on a.id = c.artist_id
        where c.id = ${body.campaignId} for share of c`;
      if (!c) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
      if (c.status !== "live" || !c.ends_at || c.ends_at <= new Date()) throw new HttpError(409, "campaign_closed", "This campaign isn't accepting backers right now.");
      // Market integrity (PRD 03 FR-MKT; council D1 condition 3): no self-backing.
      if (c.owner_id === user.sub) throw new HttpError(403, "self_backing", "You can't back your own campaign.");
      const [p] = await tx<{ price_minor: bigint; quantity_limit: number | null; claimed: number; title: string }[]>`
        select price_minor, quantity_limit, claimed, title from public.perks where id = ${body.perkId} and campaign_id = ${c.id}`;
      if (!p) throw new HttpError(404, "perk_not_found", "That perk isn't part of this campaign.");
      if (p.quantity_limit != null && p.claimed + body.quantity > p.quantity_limit) throw new HttpError(409, "perk_sold_out", "That perk just sold out.");
      const amount = n(p.price_minor) * body.quantity;
      const [b] = await tx<{ id: string }[]>`
        insert into public.backings (campaign_id, perk_id, backer_id, quantity, amount_minor)
        values (${c.id}, ${body.perkId}, ${user.sub}, ${body.quantity}, ${amount}) returning id`;
      return { id: b.id, amount, description: `${c.title} — ${p.title}` };
    });

    const pay = await d.escrow.createPayment({
      backingId: backing.id,
      campaignId: body.campaignId,
      amountMinor: backing.amount,
      description: backing.description,
      idempotencyKey: `payment:${backing.id}`,
    });
    const response = { backingId: backing.id, amountMinor: backing.amount, clientSecret: pay.clientSecret };
    await asService(d.sql, async (tx) => {
      await tx`update public.backings set payment_ref = ${pay.paymentRef} where id = ${backing.id}`;
      await tx`insert into public.api_idempotency (key, user_id, request_hash, response, status_code)
               values (${scopedKey}, ${user.sub}, ${hash}, ${tx.json(response)}, 201) on conflict do nothing`;
    });
    return reply.status(201).send(response);
  });

  /** The signed-in fan's backings (RLS: only their own). */
  app.get("/me/backings", async (req) => {
    const user = await requireUser(req, d.verify);
    const rows = await asUser(d.sql, user, (tx) => tx<{ id: string; campaign_id: string; perk_id: string; amount_minor: bigint; status: string; created_at: Date }[]>`
      select id, campaign_id, perk_id, amount_minor, status, created_at from public.backings where backer_id = ${user.sub} order by created_at desc`);
    return { backings: rows.map((r) => ({ ...r, amount_minor: undefined, amountMinor: n(r.amount_minor) })) };
  });
};
