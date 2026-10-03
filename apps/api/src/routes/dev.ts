import type { FastifyPluginAsync } from "fastify";
import { processingFeeMinor } from "@fanzup/shared/policy";
import { asService, n } from "../db";
import { recordCaptured, settleDueCampaigns, drainOutbox } from "../money";
import { HttpError } from "../lib/auth";
import type { Deps } from "../app";

/**
 * Sandbox-only helpers to walk the whole money flow locally without a payment processor.
 * Registered only when NODE_ENV !== "production" AND ESCROW_PROVIDER=sandbox.
 */
export const devRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.post<{ Params: { backingId: string } }>("/sandbox/confirm-payment/:backingId", async (req) => {
    const [b] = await asService(d.sql, (tx) => tx<{ amount_minor: bigint; payment_ref: string | null }[]>`
      select amount_minor, payment_ref from public.backings where id = ${req.params.backingId}`);
    if (!b) throw new HttpError(404, "not_found", "No such backing");
    await recordCaptured(d.sql, req.params.backingId, b.payment_ref ?? `sbx_pi_${req.params.backingId}`, processingFeeMinor(n(b.amount_minor)));
    return { ok: true };
  });

  /** Runs one worker tick: settle due campaigns, then drain the outbox. `?now=` lets you time-travel. */
  app.post<{ Querystring: { now?: string } }>("/sandbox/tick", async (req) => {
    const now = req.query.now ? new Date(req.query.now) : new Date();
    const settled = await settleDueCampaigns(d.sql, now);
    const processed = await drainOutbox(d.sql, d.escrow);
    return { settled, processed };
  });
};
