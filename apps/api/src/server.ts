import Fastify, { type FastifyInstance } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Env } from "./env";
import { createDb } from "./db";
import { createEscrow, createStripe } from "./escrow";
import { createVerifier } from "./lib/auth";
import { buildApp, API_PREFIX } from "./app";

/**
 * If configuration is missing, don't crash (on Vercel that's an opaque FUNCTION_INVOCATION_FAILED).
 * Serve 503s that name the missing variables — names only, never values — so it's fixable from outside.
 */
function misconfiguredApp(error: unknown) {
  const app = Fastify({ logger: true });
  const issues =
    error && typeof error === "object" && "issues" in error
      ? (error as { issues: { path: (string | number)[]; message: string }[] }).issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      : [String(error instanceof Error ? error.message : error)];
  app.log.error({ issues }, "api.misconfigured");
  app.all("/*", async (_req, reply) =>
    reply.status(503).send({
      ok: false,
      error: "misconfigured",
      message: "The API is missing required configuration. See docs/SETUP.md Part D.",
      issues,
    }),
  );
  return app;
}

/** Build the app once per process. Never rejects: bad config yields the 503 app instead. */
async function createApp(): Promise<{ app: FastifyInstance; env: Env | null }> {
  try {
    const env = loadEnv();
    const sql = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
    const stripe = createStripe(env);
    const app = await buildApp({ env, sql, stripe, escrow: createEscrow(env, stripe), verify: createVerifier(env) });
    app.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
    return { app, env };
  } catch (e) {
    return { app: misconfiguredApp(e), env: null };
  }
}

const ready = createApp();

/**
 * Vercel: the function runtime imports this module and calls the default export with Node's
 * (req, res). We hand the request to Fastify's server instead of listening on a port, which
 * avoids depending on how the runtime intercepts listen(). No top-level await, so the module
 * also loads under require().
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const { app } = await ready;
  await app.ready();
  app.server.emit("request", req, res);
}

// Everywhere else (local dev, Render, tests via `node dist/server.js`): listen on a port.
if (!process.env.VERCEL) {
  ready
    .then(async ({ app, env }) => {
      for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.on(sig, async () => {
          await app.close();
          process.exit(0);
        });
      }
      await app.listen({ port: env?.PORT ?? Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
    })
    .catch((e) => {
      console.error("api.start_failed", e);
      process.exit(1);
    });
}

export { API_PREFIX };
