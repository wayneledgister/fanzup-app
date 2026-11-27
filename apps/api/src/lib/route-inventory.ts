/**
 * Route inventory (wire contract guard, docs/API.md). Builds the app with every optional module switched on
 * (sandbox payments, mock Reg CF, cron secret) and lists the routes Fastify registered. Nothing connects to a
 * database: postgres.js and the providers are lazy, and no request is made.
 */
import { buildApp } from "../app";
import { createDb } from "../db";
import { loadEnv } from "../env";
import { createVerifier } from "./auth";
import { createProvider } from "../provider";
import { createRegCf } from "../regcf";

export interface RouteEntry { method: string; path: string }

export async function collectRoutes(): Promise<RouteEntry[]> {
  const env = loadEnv({
    DATABASE_URL: "postgres://inventory@127.0.0.1:1/inventory",
    SUPABASE_JWT_SECRET: "route-inventory-route-inventory-0123456789",
    NODE_ENV: "test",
    DEPLOY_ENV: "local",
    ESCROW_PROVIDER: "sandbox",
    REGCF_PROVIDER: "mock",
    CRON_SECRET: "route-inventory-cron-secret",
  });
  const sql = createDb(env.DATABASE_URL);
  const routes: RouteEntry[] = [];
  try {
    const app = await buildApp(
      { env, sql, provider: createProvider(env, sql), regcf: createRegCf(env), verify: createVerifier(env) },
      {
        onRoute: (r) => {
          for (const method of [r.method].flat()) {
            if (method === "HEAD" || method === "OPTIONS") continue; // Fastify adds HEAD for every GET; CORS adds OPTIONS
            routes.push({ method, path: r.url });
          }
        },
      },
    );
    await app.ready();
    await app.close();
  } finally {
    await sql.end({ timeout: 0 });
  }
  const seen = new Set<string>();
  return routes
    .filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
