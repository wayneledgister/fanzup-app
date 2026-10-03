import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Env } from "./env";
import { asService, type Sql } from "./db";
import type { PaymentProvider } from "./provider";
import { HttpError, type Verify } from "./lib/auth";
import { RULE_STATUS } from "./lib/errors";
import { acceptCorrelationId, currentCtx, enterRequest } from "./context";
import { log, pathOnly, redact } from "./log";
import type { NotifyHandler } from "./notify";
import { logOnlyNotify } from "./notify";
import type { JobDeps } from "./jobs";
import { campaignRoutes } from "./routes/campaigns";
import { backingRoutes } from "./routes/backings";
import { webhookRoutes } from "./routes/webhooks";
import { devRoutes } from "./routes/dev";
import { internalRoutes } from "./routes/internal";

/** Public path prefix. Vercel routes /api/* to this service and does NOT strip the prefix. */
export const API_PREFIX = "/api";

export interface Deps {
  env: Env;
  sql: Sql;
  provider: PaymentProvider;
  verify: Verify;
  notify?: NotifyHandler;
  /** Extra worker steps (registered by the staff module). */
  extraSteps?: JobDeps["extraSteps"];
}

export const jobDeps = (d: Deps): JobDeps => ({ sql: d.sql, provider: d.provider, notify: d.notify ?? logOnlyNotify, extraSteps: d.extraSteps });

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.env.NODE_ENV === "test"
        ? false
        : {
            // NFR-SEC-12: no auth headers, cookies, signatures, idempotency keys or query strings in logs.
            redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["stripe-signature"]', 'req.headers["idempotency-key"]'],
            serializers: { req: (req) => ({ method: req.method, url: pathOnly(req.url), id: req.id }) },
          },
    bodyLimit: 64 * 1024,
    genReqId: (req) => acceptCorrelationId(req.headers["x-correlation-id"]),
  });

  // Every request runs inside its own context (ADR-005); the id is echoed on every response.
  app.addHook("onRequest", (req, reply, done) => {
    reply.header("x-correlation-id", req.id);
    enterRequest(req.id, done);
  });

  await app.register(cors, {
    origin: deps.env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ["x-correlation-id"],
  });

  app.setErrorHandler((err: Error & { validation?: unknown; code?: string; detail?: string; statusCode?: number }, req, reply) => {
    const correlationId = currentCtx()?.correlationId ?? req.id;
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, correlationId });
    if (err.code === "P0001" && RULE_STATUS[err.message]) {
      return reply.status(RULE_STATUS[err.message]).send({ error: err.message, message: err.detail ?? "That isn't allowed.", correlationId });
    }
    // Other business-rule violations raised by our SQL (RAISE EXCEPTION → P0001, check_violation → 23514).
    if (err.code === "P0001" || err.code === "23514") {
      return reply.status(409).send({ error: "rule_violation", message: redact(err.detail ?? err.message), correlationId });
    }
    if (err.validation || err.name === "ZodError") {
      return reply.status(400).send({ error: "invalid_request", message: redact(err.message), correlationId });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: "invalid_request", message: redact(err.message), correlationId });
    }
    log("error", "api.error", { error: redact(String(err.stack ?? err.message)) });
    return reply.status(500).send({ error: "internal", message: "Something went wrong on our side.", correlationId });
  });

  // Opening the API's own port in a browser (localhost:8787/) lands here; the website is on :5173.
  app.get("/", async () => ({
    ok: true,
    service: "fanzup-api",
    message: `This is the API. Routes live under ${API_PREFIX}; the website runs separately (pnpm dev:web, http://localhost:5173).`,
    health: `${API_PREFIX}/health`,
  }));

  // NFR-OPS-06: the worker heartbeat's age is visible to an external monitor.
  app.get(`${API_PREFIX}/health`, async (_req, reply) => {
    try {
      const [hb] = await asService(deps.sql, (tx) => tx<{ beat_at: Date }[]>`select beat_at from public.worker_heartbeats where worker = 'worker'`);
      return {
        ok: true,
        provider: deps.provider.name,
        testMode: deps.provider.testMode,
        worker: { lastBeatAt: hb?.beat_at.toISOString() ?? null, ageSeconds: hb ? Math.round((Date.now() - hb.beat_at.getTime()) / 1000) : null },
      };
    } catch {
      return reply.status(503).send({ ok: false, error: "database_unavailable" });
    }
  });

  app.get(`${API_PREFIX}/v1/config`, async () => ({
    provider: deps.provider.name,
    testMode: deps.provider.testMode,
    stripePublishableKey: deps.provider.publishableKey,
  }));

  await app.register(campaignRoutes(deps), { prefix: `${API_PREFIX}/v1` });
  await app.register(backingRoutes(deps), { prefix: `${API_PREFIX}/v1` });
  await app.register(webhookRoutes(deps), { prefix: `${API_PREFIX}/v1/webhooks` });
  await app.register(internalRoutes(deps), { prefix: `${API_PREFIX}/internal` });
  // Dev routes exist only with the sandbox provider outside deployed environments (design §9).
  if (!deps.env.deployed && deps.provider.name === "sandbox" && deps.env.NODE_ENV !== "production") {
    await app.register(devRoutes(deps), { prefix: `${API_PREFIX}/v1/dev` });
  }
  return app;
}
