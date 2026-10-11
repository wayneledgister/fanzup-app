import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { runWorkerTick } from "../jobs";
import { jobDeps, type Deps } from "../app";

/**
 * Scheduled work for serverless hosting (Vercel Cron → GET /api/internal/tick): one worker tick.
 * Safe to run twice or miss a run: every step is idempotent and uses SKIP LOCKED / leases.
 */
export const internalRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/tick", async (req, reply) => {
    const secret = d.env.CRON_SECRET;
    if (!secret) return reply.status(404).send(); // not configured → route doesn't exist
    const given = Buffer.from(String(req.headers.authorization ?? ""));
    const want = Buffer.from(`Bearer ${secret}`);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return reply.status(401).send({ error: "unauthorized" });
    return runWorkerTick(jobDeps(d));
  });
};
