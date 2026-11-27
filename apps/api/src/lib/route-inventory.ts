/**
 * Route inventory (wire contract guard, docs/API.md). Builds the app in two configurations and lists the union of
 * the routes Fastify registered:
 *  - **local**: sandbox payments, mock Reg CF, cron secret — every dev and Layer 2 route is on;
 *  - **deployed** (staging): Stripe test provider, no mock — catches a route registered only when deployed or only
 *    with the real provider.
 * Nothing connects to a database or a provider: postgres.js and the adapters are lazy, and no request is made.
 */
import { buildApp } from "../app";
import { createDb } from "../db";
import { loadEnv } from "../env";
import { createVerifier } from "./auth";
import { createProvider } from "../provider";
import { createRegCf } from "../regcf";

export interface RouteEntry { method: string; path: string }

const BASE = {
  DATABASE_URL: "postgres://inventory@127.0.0.1:1/inventory",
  SUPABASE_JWT_SECRET: "route-inventory-route-inventory-0123456789",
  NODE_ENV: "test",
  CRON_SECRET: "route-inventory-cron-secret",
};
const CONFIGS: Record<string, string>[] = [
  { ...BASE, DEPLOY_ENV: "local", ESCROW_PROVIDER: "sandbox", REGCF_PROVIDER: "mock" },
  { ...BASE, DEPLOY_ENV: "staging", ESCROW_PROVIDER: "stripe-test", STRIPE_SECRET_KEY: "sk_test_route_inventory", REGCF_PROVIDER: "none" },
];

async function routesFor(src: Record<string, string>): Promise<RouteEntry[]> {
  const env = loadEnv(src);
  const sql = createDb(env.DATABASE_URL);
  const routes: RouteEntry[] = [];
  try {
    const app = await buildApp(
      { env, sql, provider: createProvider(env, sql), regcf: createRegCf(env), verify: createVerifier(env) },
      { onRoute: (r) => { for (const method of [r.method].flat()) routes.push({ method, path: r.url }); } },
    );
    await app.ready();
    await app.close();
  } finally {
    await sql.end({ timeout: 0 });
  }
  // Drop only what the framework adds on its own: the HEAD route Fastify creates beside every GET, and the CORS
  // preflight catch-all (`OPTIONS *`). A HEAD or OPTIONS route the code registers itself stays in the list.
  // (A plugin's root route can surface its HEAD twin with a trailing slash, so compare without it.)
  const bare = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);
  const gets = new Set(routes.filter((r) => r.method === "GET").map((r) => bare(r.path)));
  return routes.filter((r) => !(r.method === "HEAD" && gets.has(bare(r.path))) && !(r.method === "OPTIONS" && r.path === "*"));
}

export async function collectRoutes(): Promise<RouteEntry[]> {
  const all = (await Promise.all(CONFIGS.map(routesFor))).flat();
  const seen = new Set<string>();
  return all
    .filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
