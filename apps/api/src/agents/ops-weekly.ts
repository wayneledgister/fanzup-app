/**
 * A8 Ops Steward (CR-003, FR-AGT-A8-001): the weekly single-operator review pack (FR-ID-007, G1-A).
 * Advisory: the sign-off stays POST /staff/weekly-review/signoff.
 */
import * as z from "zod/v4";
import { weeklyPack, type WeeklyAction, type WeeklyPack } from "@fanzup/shared/agents";
import { POLICY } from "@fanzup/shared/policy";
import type { Tx } from "../db";
import { block } from "./blocks";
import type { AgentDefinition } from "./types";

export const WeeklyBrief = z.object({
  brief: z.string().describe("Three to five sentences for the operator: what happened this week and whether anything is unusual."),
  attention: z.array(z.object({
    item: z.string(),
    why: z.string(),
    ref: z.string().describe("The action id, day or snapshot field this points at."),
  })).max(5),
});
export type WeeklyBrief = z.infer<typeof WeeklyBrief>;

export interface WeeklyInput {
  weekStart: string;
  actions: WeeklyAction[];
  signedOff: boolean;
  snapshot: Record<string, unknown>;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export const SYSTEM = `You help the sole operator of FanZuP, a fan-funding platform for independent musicians, prepare their weekly review of privileged staff actions. While the platform runs with one operator, every week's refunds, milestone verifications and other privileged actions must be reviewed and signed off.

You get a deterministic summary of the week and a snapshot of the work queues. Write a short, factual brief and list at most five things that deserve a second look (for example a day over a limit, failed or cancelled actions, a delayed action, an old item in review, dead-lettered work). Point each item at the exact action id, day or snapshot field. Don't invent facts that aren't in the data. If nothing is unusual, say so and return an empty list. You never sign off; the operator does.`;

export const opsWeekly: AgentDefinition<WeeklyInput, WeeklyBrief, WeeklyPack> = {
  name: "ops_weekly",
  kind: "weekly_pack",
  promptVersion: POLICY.agents.promptVersions.ops_weekly,
  schema: WeeklyBrief,
  system: SYSTEM,

  async gather(tx: Tx, task) {
    const weekStart = task.subject_key.replace(/^week:/, "");
    const rows = await tx<Record<string, unknown>[]>`
      select id, action, status, amount_minor, execute_after, created_at, has_error from public.agent_v_weekly_actions
       where created_at >= ${weekStart}::date and created_at < ${weekStart}::date + 7 order by created_at, id`;
    const [s] = await tx`select 1 from public.agent_v_week_signoffs where week_start = ${weekStart}::date`;
    const [snap] = await tx<Record<string, unknown>[]>`select * from public.agent_v_ops_snapshot`;
    return {
      weekStart,
      actions: rows.map((r) => ({
        id: String(r.id), action: String(r.action), status: String(r.status), amount_minor: r.amount_minor == null ? null : Number(r.amount_minor),
        created_at: iso(r.created_at)!, execute_after: iso(r.execute_after), has_error: Boolean(r.has_error),
      })),
      signedOff: Boolean(s),
      snapshot: Object.fromEntries(Object.entries(snap ?? {}).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v])),
    };
  },

  checks(input): WeeklyPack {
    return weeklyPack(input.weekStart, input.actions, input.signedOff);
  },

  prompt(input, pack) {
    return [
      block("week_summary", pack),
      block("queue_snapshot", input.snapshot),
      "Write the weekly brief.",
    ].join("\n\n");
  },

  body(input, pack, brief) {
    return { week_start: input.weekStart, pack, snapshot: input.snapshot, brief };
  },
};
