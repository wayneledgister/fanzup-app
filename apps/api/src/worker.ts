/**
 * Background worker (design 02 §6): every WORKER_INTERVAL_MS runs one tick — heartbeat, expire holds, process
 * provider events, settle due campaigns, drain the outbox, run outbound ops, extra steps, daily reconciliation.
 * One instance is enough; a second is safe (SKIP LOCKED + leases).
 */
import { loadEnv } from "./env";
import { createDb } from "./db";
import { createProvider } from "./provider";
import { logOnlyNotify } from "./notify";
import { runWorkerTick } from "./jobs";
import { log, redact } from "./log";

const env = loadEnv();
const sql = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
const provider = createProvider(env, sql);
let stopping = false;

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });

log("info", "worker.start", { provider: provider.name, intervalMs: env.WORKER_INTERVAL_MS });
while (!stopping) {
  try {
    const r = await runWorkerTick({ sql, provider, notify: logOnlyNotify });
    if (r.settled.length || r.processed || r.ops || r.events || r.holdsReleased || r.recon) log("info", "worker.tick", r);
  } catch (e) {
    log("error", "worker.error", { error: redact(String((e as Error).stack ?? e)) });
  }
  await new Promise((r) => setTimeout(r, env.WORKER_INTERVAL_MS));
}
await sql.end({ timeout: 5 });
