import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { asService, n } from "../db";
import { HttpError } from "../lib/auth";
import { SandboxProvider, ProviderError } from "../provider";
import { processEventById } from "../inbox";
import { runWorkerTick } from "../jobs";
import { jobDeps, type Deps } from "../app";

/**
 * Sandbox-only helpers (local and CI). Registered only with the sandbox provider in a non-deployed environment.
 * `pay` is what the browser's sandbox card form calls; `tick` runs one worker tick, optionally at a future time.
 */
export const devRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  const sandbox = d.provider as SandboxProvider;

  app.post<{ Params: { backingId: string } }>("/sandbox/pay/:backingId", async (req) => {
    const body = z.object({ outcome: z.enum(["succeed", "decline"]).default("succeed"), amountMinor: z.number().int().positive().optional() }).parse(req.body ?? {});
    const [b] = await asService(d.sql, (tx) => tx<{ amount_minor: bigint; payment_ref: string | null; campaign_id: string; correlation_id: string | null }[]>`
      select amount_minor, payment_ref, campaign_id, correlation_id from public.backings where id = ${req.params.backingId}`);
    if (!b?.payment_ref) throw new HttpError(404, "not_found", "No payment attempt for that backing");
    try {
      const r = await sandbox.simulatePayment({
        paymentRef: b.payment_ref,
        amountMinor: body.amountMinor ?? n(b.amount_minor),
        outcome: body.outcome,
        metadata: { backing_id: req.params.backingId, campaign_id: b.campaign_id, correlation_id: b.correlation_id ?? "" },
      });
      if (r.status === "succeeded" && r.eventRowId) await processEventById(d.sql, d.provider, r.eventRowId);
      return { status: r.status };
    } catch (e) {
      if (e instanceof ProviderError && e.code === "payment_canceled") throw new HttpError(409, "checkout_expired", "This checkout expired. Start again from the campaign page.");
      throw e;
    }
  });

  /**
   * Platform money into the sandbox balance (a Stripe top-up; design §12.1 float, worklog D-008/D-013). FanZuP absorbs
   * the processing fee on refunds, so without it the e2e's payouts would wait for funds.
   */
  app.post("/sandbox/topup", async (req) => {
    const body = z.object({ amountMinor: z.number().int().positive().max(10_000_000) }).parse(req.body ?? {});
    await sandbox.topUp(body.amountMinor);
    return { ok: true };
  });

  app.post<{ Querystring: { now?: string; recon?: string } }>("/sandbox/tick", async (req) => {
    const now = req.query.now ? new Date(req.query.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new HttpError(400, "invalid_request", "now must be an ISO date");
    return runWorkerTick(jobDeps(d), now, { recon: req.query.recon === "1" });
  });
};
