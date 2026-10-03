import type { FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";
import { asService } from "../db";
import { recordCaptured, recordRefunded } from "../money";
import type { Deps } from "../app";

/** Stripe test-mode webhook (dev escrow only). Signature-verified against the raw body. */
export const stripeWebhook = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/stripe", async (req, reply) => {
    if (!d.stripe || !d.env.STRIPE_WEBHOOK_SECRET) return reply.status(404).send();
    let event: Stripe.Event;
    try {
      event = d.stripe.webhooks.constructEvent(req.body as Buffer, String(req.headers["stripe-signature"]), d.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.status(400).send({ error: "bad_signature" });
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = await d.stripe.paymentIntents.retrieve(event.data.object.id, { expand: ["latest_charge.balance_transaction"] });
        const backingId = pi.metadata.backing_id;
        if (!backingId) break;
        const charge = pi.latest_charge as Stripe.Charge | null;
        const fee = (charge?.balance_transaction as Stripe.BalanceTransaction | null)?.fee ?? 0;
        await recordCaptured(d.sql, backingId, pi.id, fee);
        break;
      }
      case "payment_intent.payment_failed": {
        const backingId = event.data.object.metadata.backing_id;
        if (backingId) await asService(d.sql, (tx) => tx`update public.backings set status = 'payment_failed' where id = ${backingId} and status = 'pending_payment'`);
        break;
      }
      case "charge.refunded": {
        const ch = event.data.object;
        const [b] = await asService(d.sql, (tx) => tx<{ id: string }[]>`select id from public.backings where payment_ref = ${String(ch.payment_intent)}`);
        const refundId = ch.refunds?.data[0]?.id ?? `refund_for_${ch.id}`;
        if (b) await recordRefunded(d.sql, b.id, refundId);
        break;
      }
    }
    return { received: true };
  });
};
