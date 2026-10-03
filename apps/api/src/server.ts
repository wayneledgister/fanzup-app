import { loadEnv } from "./env";
import { createDb } from "./db";
import { createEscrow, createStripe } from "./escrow";
import { createVerifier } from "./lib/auth";
import { buildApp } from "./app";

const env = loadEnv();
const sql = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
const stripe = createStripe(env);
const app = await buildApp({ env, sql, stripe, escrow: createEscrow(env, stripe), verify: createVerifier(env) });

await app.listen({ port: env.PORT, host: "0.0.0.0" });
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
