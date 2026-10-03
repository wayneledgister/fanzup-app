import Fastify from "fastify";
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

let env: Env | null = null;
let app;
try {
  env = loadEnv();
  const sql = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const stripe = createStripe(env);
  app = await buildApp({ env, sql, stripe, escrow: createEscrow(env, stripe), verify: createVerifier(env) });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      await app!.close();
      await sql.end({ timeout: 5 });
      process.exit(0);
    });
  }
} catch (e) {
  app = misconfiguredApp(e);
}

await app.listen({ port: env?.PORT ?? Number(process.env.PORT ?? 8787), host: "0.0.0.0" });
export { API_PREFIX };
