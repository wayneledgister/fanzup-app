import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type Stripe from "stripe";
import type { Env } from "./env";
import type { Sql } from "./db";
import type { EscrowProvider } from "./escrow";
import { HttpError, type Verify } from "./lib/auth";
import { campaignRoutes } from "./routes/campaigns";
import { backingRoutes } from "./routes/backings";
import { stripeWebhook } from "./routes/webhooks";
import { devRoutes } from "./routes/dev";

export interface Deps {
  env: Env;
  sql: Sql;
  escrow: EscrowProvider;
  stripe: Stripe | null;
  verify: Verify;
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.env.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, { origin: deps.env.CORS_ORIGINS.split(",").map((s) => s.trim()), credentials: true });

  app.setErrorHandler((err: Error & { validation?: unknown; code?: string }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    // Business-rule violations raised by the SQL functions (RAISE EXCEPTION → P0001, check_violation → 23514).
    const pg = err as { code?: string; message: string };
    if (pg.code === "P0001" || pg.code === "23514") return reply.status(409).send({ error: "rule_violation", message: pg.message });
    if (err.validation || err.name === "ZodError") {
      return reply.status(400).send({ error: "invalid_request", message: err.message });
    }
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Something went wrong on our side." });
  });

  app.get("/health", async () => {
    await deps.sql`select 1`;
    return { ok: true, escrow: deps.escrow.name };
  });

  await app.register(campaignRoutes(deps), { prefix: "/v1" });
  await app.register(backingRoutes(deps), { prefix: "/v1" });
  await app.register(stripeWebhook(deps), { prefix: "/v1/webhooks" });
  if (deps.env.NODE_ENV !== "production" && deps.escrow.name === "sandbox") {
    await app.register(devRoutes(deps), { prefix: "/v1/dev" });
  }
  return app;
}
