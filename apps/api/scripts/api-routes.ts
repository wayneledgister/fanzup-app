/** Print every registered API route (`pnpm --filter @fanzup/api api:routes`). docs/API.md must list the same set. */
import { collectRoutes } from "../src/lib/route-inventory";

for (const r of await collectRoutes()) console.log(`${r.method.padEnd(6)} ${r.path}`);
