/**
 * Background worker: settles campaigns at their deadline and drains the outbox
 * (refunds for failed campaigns, tranche releases for funded ones).
 * Run as its own process (one instance; the outbox uses SKIP LOCKED so a second is safe too).
 */
import { loadEnv } from "./env";
import { createDb } from "./db";
import { createEscrow, createStripe } from "./escrow";
import { settleDueCampaigns, drainOutbox } from "./money";

const env = loadEnv();
const sql = createDb(env.DATABASE_URL);
const escrow = createEscrow(env, createStripe(env));
const INTERVAL_MS = 30_000;
let stopping = false;

async function tick() {
  const settled = await settleDueCampaigns(sql);
  const processed = await drainOutbox(sql, escrow);
  if (settled.length || processed) console.log(JSON.stringify({ msg: "worker.tick", settled, processed }));
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });

console.log(JSON.stringify({ msg: "worker.start", escrow: escrow.name }));
while (!stopping) {
  try {
    await tick();
  } catch (e) {
    console.error(JSON.stringify({ msg: "worker.error", error: String(e) }));
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
await sql.end({ timeout: 5 });
