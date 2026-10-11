/**
 * Notification hook for `notify.*` outbox topics (FR-NTF-001). The money path only queues them; templates,
 * logging and transport live here. Until notifications are wired (PR-C), topics are acknowledged and logged.
 */
import type { Sql } from "./db";
import { log } from "./log";

export type NotifyHandler = (sql: Sql, topic: string, payload: Record<string, unknown>) => Promise<void>;

export const logOnlyNotify: NotifyHandler = async (_sql, topic, payload) => {
  log("info", "notify.skipped", { topic, subject: payload.backing_id ?? payload.tranche_id ?? payload.campaign_id });
};
