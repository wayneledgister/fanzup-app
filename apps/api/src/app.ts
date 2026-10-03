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
import { createNotifier } from "./notify";
import type { JobDeps } from "./jobs";
import { campaignRoutes } from "./routes/campaigns";
import { backingRoutes } from "./routes/backings";
import { webhookRoutes } from "./routes/webhooks";
import { devRoutes } from "./routes/dev";
import { internalRoutes } from "./routes/internal";
import { meRoutes } from "./routes/me";
import { artistRoutes } from "./routes/artist";
import { staffRoutes } from "./routes/staff";
import { executeDueActions } from "./staff";
import type { RegCfProvider } from "./regcf";
import { l2CreatorRoutes, l2DevRoutes, l2FanRoutes, l2StaffRoutes } from "./l2/routes";
import { l2On } from "./l2/gate";
import { l2Tick } from "./l2/service";

/** Public path prefix. Vercel routes /api/* to this service and does NOT strip the prefix. */
export const API_PREFIX = "/api";

export interface Deps {
  env: Env;
  sql: Sql;
  provider: PaymentProvider;
  /** Layer 2 Reg CF provider (ADR-007). Undefined unless REGCF_PROVIDER=mock. */
  regcf?: RegCfProvider;
  verify: Verify;
  notify?: NotifyHandler;
  /** Extra worker steps (registered by the staff module). */
  extraSteps?: JobDeps["extraSteps"];
}

const defaultNotifier = createNotifier();
export const jobDeps = (d: Deps): JobDeps => ({ sql: d.sql, provider: d.provider, notify: d.notify ?? defaultNotifier, extraSteps: [...(d.extraSteps ?? []), (now) => executeDueActions(d, now), ...(d.regcf ? [(now: Date) => l2Tick(d, now)] : [])] });

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
    // Behind Vercel's proxy: req.ip comes from X-Forwarded-For (recorded with consents, FR-PRV-001).
    trustProxy: true,
    genReqId: (req) => acceptCorrelationId(req.headers["x-correlation-id"]),
  });

  // bigint columns (cents, identity ids) serialise as numbers; every value M1 returns is within 2^53.
  app.setReplySerializer((payload) => JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));

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
    // FR-PLT-001: the server's view of the flags (the web app's ?flags= override reveals mock-only screens, never data).
    flags: { layer2: await l2On(deps).catch(() => false) },
  }));

  await app.register(campaignRoutes(deps), { prefix: `${API_PREFIX}/v1` });
  await app.register(backingRoutes(deps), { prefix: `${API_PREFIX}/v1` });
  await app.register(webhookRoutes(deps), { prefix: `${API_PREFIX}/v1/webhooks` });
  await app.register(meRoutes(deps), { prefix: `${API_PREFIX}/v1` });
  await app.register(artistRoutes(deps), { prefix: `${API_PREFIX}/v1/artist` });
  await app.register(staffRoutes(deps), { prefix: `${API_PREFIX}/v1/staff` });
  await app.register(internalRoutes(deps), { prefix: `${API_PREFIX}/internal` });
  // Layer 2 (CR-002): every route is behind the server-side layer2 gate.
  await app.register(l2FanRoutes(deps), { prefix: `${API_PREFIX}/v1` });
  await app.register(l2CreatorRoutes(deps), { prefix: `${API_PREFIX}/v1/creator` });
  await app.register(l2StaffRoutes(deps), { prefix: `${API_PREFIX}/v1/staff/l2` });
  if (!deps.env.deployed && deps.regcf && deps.env.NODE_ENV !== "production") {
    await app.register(l2DevRoutes(deps), { prefix: `${API_PREFIX}/v1/dev/l2` });
  }
  // Dev routes exist only with the sandbox provider outside deployed environments (design §9).
  if (!deps.env.deployed && deps.provider.name === "sandbox" && deps.env.NODE_ENV !== "production") {
    await app.register(devRoutes(deps), { prefix: `${API_PREFIX}/v1/dev` });
  }
  return app;
}
