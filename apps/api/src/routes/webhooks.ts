import type { FastifyPluginAsync } from "fastify";
import { asService } from "../db";
import { ingestEvent, processEventById } from "../inbox";
import { log } from "../log";
import type { Deps } from "../app";
import { registerRegCfWebhook } from "../l2/routes";

/**
 * Stripe webhooks (FR-PAY-002, FR-PAY-008; design §4.2, §5). Verified against the raw body, stored, acknowledged,
 * then processed. Only a bad signature or a live-mode event gets a 400 (no custody model is approved, E1 card B).
 * An event for a connected account that isn't one of our artists' is stored already `ignored` in the same insert and
 * answered 200 — a 4xx would only make Stripe retry an event we will never act on.
 */
export const webhookRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/stripe", async (req, reply) => {
    if (d.provider.name !== "stripe-test") return reply.status(404).send();
    let evt;
    try {
      evt = d.provider.parseWebhook(req.body as Buffer, req.headers["stripe-signature"] as string | undefined);
    } catch {
      log("warn", "webhook.bad_signature");
      return reply.status(400).send({ error: "bad_signature" });
    }
    if (evt.livemode) {
      log("alert", "webhook.livemode_rejected", { eventId: evt.eventId });
      return reply.status(400).send({ error: "livemode_rejected" });
    }
    // Platform events carry no account; Connect events are kept only for our artists' accounts (G2 condition 16).
    let ignored: string | undefined;
    if (evt.account) {
      const [known] = await asService(d.sql, (tx) => tx`select 1 from public.artists where payout_account_ref = ${evt.account}`);
      if (!known) ignored = "account_not_ours";
    }
    const { id, inserted } = await ingestEvent(d.sql, evt, { ignored });
    reply.status(200).send({ received: true });
    // Best-effort inline processing after the acknowledgement; the worker retries anything left. The claim inside
    // processEventById makes this safe to race with the worker.
    if (inserted && !ignored) void processEventById(d.sql, d.provider, id).catch(() => undefined);
    return reply;
  });

  // Layer 2 Reg CF provider webhooks (ADR-007): verified, stored, acknowledged, processed.
  registerRegCfWebhook(app, d);
};
