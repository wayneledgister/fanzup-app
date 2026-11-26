/**
 * Agent runtime (CR-003, specs/agents/02-design.md §4). One tick: heartbeat → flag check → schedule the weekly pack →
 * claim due tasks (skip locked, lease) → run each. Every read and write runs as `fanzup_agent` (asAgent); the model call
 * happens with no transaction open (NFR-AGT-03). Never imported by the money worker (NFR-AGT-01).
 */
import { createHash } from "node:crypto";
import { lastCompletedWeek } from "@fanzup/shared/agents";
import { POLICY } from "@fanzup/shared/policy";
import { asAgent, type Sql } from "../db";
import { runWithCtx } from "../context";
import { log } from "../log";
import { ModelError, type ModelClient } from "./model";
import { campaignReview } from "./campaign-review";
import { opsWeekly } from "./ops-weekly";
import type { AgentDefinition, AgentTask } from "./types";

export const AGENTS: Record<string, AgentDefinition<any, any, any>> = {
  campaign_review: campaignReview,
  ops_weekly: opsWeekly,
};

export interface AgentDeps {
  sql: Sql;
  model: ModelClient;
}

export interface TickResult {
  enabled: boolean;
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  /** Lease lost to another worker before this one finished; its writes rolled back (review minor 1). */
  lost: number;
}

/** Thrown inside a write transaction when the task is no longer ours, so the run and proposal roll back with it. */
class LeaseLost extends Error {
  constructor() { super("lease_lost"); }
}

/** Fenced completion: only the holder of this attempt's lease may finish the task. */
async function finish(tx: Parameters<Parameters<typeof asAgent>[1]>[0], task: AgentTask, set: "done" | "dead" | "retry", code: string | null, backoffSecs = 0) {
  const rows = set === "retry"
    ? await tx`update public.agent_tasks set status = 'queued', lease_until = null, last_error = ${code},
                      available_at = now() + make_interval(secs => ${backoffSecs})
                where id = ${task.id} and status = 'running' and attempts = ${task.attempts} returning id`
    : await tx`update public.agent_tasks set status = ${set}, lease_until = null, last_error = ${code}
                where id = ${task.id} and status = 'running' and attempts = ${task.attempts} returning id`;
  if (!rows.length) throw new LeaseLost();
}

const flagOn = (sql: Sql) => asAgent(sql, async (tx) => (await tx<{ on: boolean }[]>`select public.agents_enabled() as on`)[0].on);

export async function agentTick(d: AgentDeps, now = new Date()): Promise<TickResult> {
  return runWithCtx({ actorId: null, actorKind: "system:agent", aal: null }, async () => {
    const enabled = await asAgent(d.sql, async (tx) => {
      await tx`insert into public.worker_heartbeats (worker, beat_at, info) values ('agents', now(), ${tx.json({ model: d.model.name })})
               on conflict (worker) do update set beat_at = excluded.beat_at, info = excluded.info`;
      const [r] = await tx<{ on: boolean }[]>`select public.agents_enabled() as on`;
      return r.on;
    });
    const res: TickResult = { enabled, claimed: 0, done: 0, retried: 0, dead: 0, lost: 0 };
    if (!enabled) return res; // FR-AGT-F-002: tasks wait; nothing runs.
    await scheduleWeekly(d.sql, now);
    const tasks = await claim(d.sql, now);
    res.claimed = tasks.length;
    for (const [i, t] of tasks.entries()) {
      // The flag is re-read before every task after the first, so turning it off stops the batch (review nit).
      let on = true;
      try {
        if (i > 0) on = await flagOn(d.sql);
      } catch (e) {
        on = false; // can't read the flag: stop, and give the rest back rather than hold their leases
        log("warn", "agent.flag_check_failed", { error: String((e as Error).message) });
      }
      if (!on) {
        await release(d.sql, tasks.slice(i)).catch(() => undefined);
        break;
      }
      const outcome = await runTask(d, t, now);
      res[outcome] += 1;
    }
    return res;
  });
}

/** FR-AGT-A8-001: exactly one ops_weekly task per completed week. */
export async function scheduleWeekly(sql: Sql, now: Date) {
  const week = lastCompletedWeek(now);
  await asAgent(sql, (tx) => tx`
    insert into public.agent_tasks (agent, subject_kind, subject_key, dedupe_key)
    values ('ops_weekly', 'week', ${"week:" + week}, ${"ops_weekly:" + week}) on conflict (dedupe_key) do nothing`);
}

/** Give back claimed tasks we won't run (the attempt isn't counted). */
async function release(sql: Sql, tasks: AgentTask[]) {
  await asAgent(sql, async (tx) => {
    for (const t of tasks) {
      await tx`update public.agent_tasks set status = 'queued', attempts = attempts - 1, lease_until = null
                where id = ${t.id} and status = 'running' and attempts = ${t.attempts}`;
    }
  });
}

async function claim(sql: Sql, now: Date): Promise<AgentTask[]> {
  return asAgent(sql, (tx) => tx<AgentTask[]>`
    update public.agent_tasks t set status = 'running', attempts = t.attempts + 1,
           lease_until = ${now}::timestamptz + make_interval(mins => ${POLICY.agents.leaseMinutes})
     where t.id in (select id from public.agent_tasks
                     where (status = 'queued' and available_at <= ${now}) or (status = 'running' and lease_until < ${now})
                     order by available_at, created_at limit ${POLICY.agents.batchSize} for update skip locked)
    returning t.id, t.agent, t.subject_kind, t.subject_id, t.subject_key, t.attempts, t.correlation_id`);
}

const digest = (system: string, input: string) => createHash("sha256").update(system).update("\u0000").update(input).digest("hex");

export async function runTask(d: AgentDeps, task: AgentTask, now: Date): Promise<"done" | "retried" | "dead" | "lost"> {
  try {
    return await runTaskInner(d, task, now);
  } catch (e) {
    if (!(e instanceof LeaseLost)) throw e;
    log("warn", "agent.lease_lost", { agent: task.agent, taskId: task.id, attempt: task.attempts });
    return "lost";
  }
}

async function runTaskInner(d: AgentDeps, task: AgentTask, now: Date): Promise<"done" | "retried" | "dead"> {
  const def = AGENTS[task.agent];
  return runWithCtx({ actorKind: `system:agent:${task.agent}`, correlationId: task.correlation_id }, async () => {
    const startedAt = new Date();
    const lastAttempt = task.attempts >= POLICY.agents.maxAttempts;
    let input: unknown;
    try {
      if (!def) throw new Error("unknown_agent");
      input = await asAgent(d.sql, (tx) => def.gather(tx, task, now));
    } catch (e) {
      const code = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "gather_failed";
      log("warn", "agent.gather_failed", { agent: task.agent, taskId: task.id, code });
      return fail(d.sql, task, def?.promptVersion ?? "-", startedAt, code, lastAttempt ? "dead" : "retry");
    }

    const skip = def.skip?.(input) ?? null;
    if (skip) {
      await asAgent(d.sql, async (tx) => {
        await insertRun(tx, task, def.promptVersion, startedAt, { status: "skipped", error_code: skip });
        await finish(tx, task, "done", skip);
      });
      return "done";
    }

    const findings = def.checks(input, now);
    const prompt = def.prompt(input, findings);
    const inputDigest = digest(def.system, prompt);
    let assessment: unknown = null;
    let model: string | null = null;
    let usage: Record<string, number> = {};
    let errorCode: string | null = null;
    try {
      const r = await d.model.generate({ agent: def.name, system: def.system, input: prompt, schema: def.schema });
      assessment = r.output;
      model = r.model;
      usage = r.usage;
    } catch (e) {
      errorCode = e instanceof ModelError ? e.code : "model_error";
    }

    if (errorCode && errorCode !== "model_disabled" && !lastAttempt) {
      log("warn", "agent.model_failed", { agent: task.agent, taskId: task.id, code: errorCode, attempt: task.attempts });
      return fail(d.sql, task, def.promptVersion, startedAt, errorCode, "retry", inputDigest);
    }

    // Success, provider "none", or the last attempt failed: ship the proposal (deterministic findings are never lost).
    const body = {
      ...def.body(input, findings, assessment),
      model_unavailable: assessment == null && errorCode !== "model_disabled",
    };
    await asAgent(d.sql, async (tx) => {
      const runId = await insertRun(tx, task, def.promptVersion, startedAt, {
        status: assessment == null && errorCode !== "model_disabled" ? "failed" : "succeeded",
        error_code: errorCode, model, usage, input_digest: inputDigest,
      });
      await tx`update public.agent_proposals set status = 'superseded'
                where agent = ${def.name} and subject_key = ${task.subject_key} and status = 'open' and verdict is null`;
      await tx`insert into public.agent_proposals (task_id, run_id, agent, subject_kind, subject_id, subject_key, kind, source, body)
               values (${task.id}, ${runId}, ${def.name}, ${task.subject_kind}, ${task.subject_id}, ${task.subject_key}, ${def.kind},
                       ${assessment == null ? "deterministic" : "model"}, ${tx.json(body as never)})`;
      await finish(tx, task, "done", errorCode);
    });
    log("info", "agent.proposal", { agent: task.agent, taskId: task.id, source: assessment == null ? "deterministic" : "model" });
    return "done";
  });
}

async function insertRun(
  tx: Parameters<Parameters<typeof asAgent>[1]>[0], task: AgentTask, promptVersion: string, startedAt: Date,
  r: { status: "succeeded" | "failed" | "skipped"; error_code?: string | null; model?: string | null; usage?: Record<string, number>; input_digest?: string | null },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.agent_runs (task_id, agent, attempt, model, prompt_version, input_digest, status, usage, error_code, started_at)
    values (${task.id}, ${task.agent}, ${task.attempts}, ${r.model ?? null}, ${promptVersion}, ${r.input_digest ?? null}, ${r.status},
            ${tx.json(r.usage ?? {})}, ${r.error_code ?? null}, ${startedAt}) returning id`;
  return row.id;
}

async function fail(sql: Sql, task: AgentTask, promptVersion: string, startedAt: Date, code: string, next: "retry" | "dead", inputDigest?: string) {
  const backoff = POLICY.agents.backoffSeconds[Math.min(task.attempts - 1, POLICY.agents.backoffSeconds.length - 1)] ?? 600;
  await asAgent(sql, async (tx) => {
    await insertRun(tx, task, promptVersion, startedAt, { status: "failed", error_code: code, input_digest: inputDigest ?? null });
    await finish(tx, task, next, code, backoff);
  });
  return next === "dead" ? ("dead" as const) : ("retried" as const);
}
