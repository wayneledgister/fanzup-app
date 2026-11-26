/**
 * One worker tick (design 02 §6). Used by the worker loop, the cron fallback (/api/internal/tick) and the
 * sandbox dev route. Steps run in order; each is bounded so a slow step can't starve the next.
 */
import { asService, type Sql } from "./db";
import { runWithCtx } from "./context";
import type { PaymentProvider } from "./provider/types";
import { processPendingEvents } from "./inbox";
import { drainOutbox, expireHolds, settleDueCampaigns } from "./money";
import { runDueOps } from "./outbound";
import { runReconciliation } from "./recon";
import type { NotifyHandler } from "./notify";

export interface JobDeps {
  sql: Sql;
  provider: PaymentProvider;
  notify: NotifyHandler;
  /** Extra steps registered by other modules (e.g. executing due privileged actions). */
  extraSteps?: ((now: Date) => Promise<unknown>)[];
}

export async function heartbeat(sql: Sql, info: Record<string, unknown> = {}) {
  await asService(sql, (tx) => tx`
    insert into public.worker_heartbeats (worker, beat_at, info) values ('worker', now(), ${tx.json(info as never)})
    on conflict (worker) do update set beat_at = excluded.beat_at, info = excluded.info`);
}

export async function runWorkerTick(d: JobDeps, now = new Date(), opts: { recon?: boolean } = {}) {
  return runWithCtx({ actorId: null, actorKind: "system:worker", aal: null }, async () => {
    await heartbeat(d.sql, { provider: d.provider.name });
    const holdsReleased = await expireHolds(d.sql, d.provider, now);
    const events = await processPendingEvents(d.sql, d.provider);
    const settled = await settleDueCampaigns(d.sql, now);
    let processed = 0;
    let ops = 0;
    // Outbox → ops → provider events (sandbox emits synchronously) → outbox again, until quiet (bounded).
    for (let i = 0; i < 5; i++) {
      const o = await drainOutbox(d.sql, d.notify);
      const r = await runDueOps(d.sql, d.provider);
      const e = await processPendingEvents(d.sql, d.provider);
      processed += o;
      ops += r;
      if (!o && !r && !e) break;
    }
    for (const step of d.extraSteps ?? []) await step(now);
    let recon: string | null = null;
    if (opts.recon ?? (await reconDue(d.sql))) recon = (await runReconciliation(d.sql, d.provider)).runId;
    return { holdsReleased, events, settled, processed, ops, recon };
  });
}

async function reconDue(sql: Sql) {
  const [r] = await asService(sql, (tx) => tx<{ due: boolean }[]>`
    select not exists (select 1 from public.recon_runs where status = 'completed' and started_at > now() - interval '24 hours') as due`);
  return r.due;
}
