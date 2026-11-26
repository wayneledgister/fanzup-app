/**
 * Agent worker (CR-003, ADR-008): a separate process from the money worker (NFR-AGT-01). Every AGENT_INTERVAL_MS runs
 * one agent tick. With `flag.agents` off it only writes its heartbeat. Safe to run twice (skip locked + leases).
 */
import { loadAgentEnv } from "./agents/env";
import { createModel } from "./agents/model";
import { agentTick } from "./agents/runtime";
import { createDb } from "./db";
import { log, redact } from "./log";

const env = loadAgentEnv(process.env);
const sql = createDb(env.databaseUrl, env.DB_POOL_MAX);
const model = createModel(env.AGENT_MODEL_PROVIDER, env.ANTHROPIC_API_KEY);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });

log("info", "agent_worker.start", { model: model.name, intervalMs: env.AGENT_INTERVAL_MS });
while (!stopping) {
  try {
    const r = await agentTick({ sql, model });
    if (r.claimed) log("info", "agent_worker.tick", { ...r });
  } catch (e) {
    log("error", "agent_worker.error", { error: redact(String((e as Error).stack ?? e)) });
  }
  await new Promise((r) => setTimeout(r, env.AGENT_INTERVAL_MS));
}
await sql.end({ timeout: 5 });
