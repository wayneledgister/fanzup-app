import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { settleDueCampaigns, drainOutbox } from "../money";
import type { Deps } from "../app";

/**
 * Scheduled work for serverless hosting (Vercel Cron → GET /api/internal/tick).
 * Same job as src/worker.ts's loop: settle campaigns past their deadline, then drain the outbox
 * (refunds, tranche releases). Safe to run twice or miss a run: every step is idempotent and the
 * outbox uses SKIP LOCKED, which is exactly what Vercel's best-effort cron delivery needs.
 */
export const internalRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/tick", async (req, reply) => {
    const secret = d.env.CRON_SECRET;
    if (!secret) return reply.status(404).send(); // not configured → route doesn't exist
    const given = Buffer.from(String(req.headers.authorization ?? ""));
    const want = Buffer.from(`Bearer ${secret}`);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return reply.status(401).send({ error: "unauthorized" });

    const settled = await settleDueCampaigns(d.sql);
    const processed = await drainOutbox(d.sql, d.escrow, 50);
    return { settled, processed };
  });
};
