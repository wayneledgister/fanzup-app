# Agent layer, Phase 0 (CR-003) — Technical design
**Requirements:** `01-requirements.md` · **ADR:** [ADR-008](../../docs/adr/ADR-008-agent-layer.md) · **Date:** 2026-11-26

## 1. Architecture
```
 campaigns.status → in_review ──trigger──► agent_tasks ◄── agent worker enqueues ops_weekly (schedule)
                                               │
                         agent-worker (own process, role fanzup_agent for reads/writes)
                                               │ claim (skip locked) → gather from agent_v_* views
                                               │ deterministic checks (packages/shared/src/agents)
                                               │ model call (no DB transaction open) → schema-validated JSON
                                               ▼
                                   agent_runs (append-only) + agent_proposals
                                               │
               staff API (service role, aal2): list · verdict via privileged() · metrics · flag
```
The money worker (`apps/api/src/worker.ts` → `runWorkerTick`) is untouched (NFR-AGT-01).

## 2. Database (`supabase/migrations/20261126000100_agents.sql`)
- **Role** `fanzup_agent` (created nologin, noinherit). Deployed, an operator gives it a login once (SETUP D3) and the agent worker connects as it via `AGENT_DATABASE_URL`, so it never holds the owner credential (review M2). It is also granted to the migration owner so tests and local dev can `set local role fanzup_agent`, the same pattern `asService` uses for `service_role`. Default privileges from the Supabase shim/project grant new tables to `anon, authenticated, service_role`, not to this role, so it starts with nothing.
- **Grants:** usage on schema public; select on the six `agent_v_*` views; select on the three agent tables; column-limited insert on `agent_tasks` (agent, subject columns, dedupe_key), `agent_runs` (no actor column) and `agent_proposals` (no status or verdict columns); update(status, attempts, available_at, lease_until, last_error) on `agent_tasks` (`updated_at` is set by the touch trigger); update(status) on `agent_proposals` for supersession; execute on `public.ctx(text)` and `public.agents_enabled()`; select/insert/update(beat_at, info) on `worker_heartbeats` under RLS for the `agents` row only. Nothing else. Executable functions (including PUBLIC defaults) are asserted exactly by test.
- **Views** are owned by the migration owner (security definer semantics of a plain view), so they read the base tables without exposing them. Column lists are fixed and asserted by test (NFR-AGT-02).
- **`agent_tasks`** `(id uuid, agent text check in ('campaign_review','ops_weekly'), subject_kind text, subject_id uuid null, subject_key text, dedupe_key text unique, status check in ('queued','running','done','dead'), attempts int, available_at, lease_until, last_error, correlation_id default ctx, created_at, updated_at)`.
- **`agent_runs`** `(id, task_id, agent, attempt, model, prompt_version, input_digest, status check in ('succeeded','failed','skipped'), usage jsonb, error_code, started_at, finished_at, correlation_id)`. Trigger rejects update/delete (same function as ledger/audit).
- **`agent_proposals`** `(id, task_id, run_id, agent, subject_kind, subject_id, subject_key, kind, source check in ('model','deterministic'), body jsonb, status check in ('open','superseded'), verdict check in ('agree','partial','disagree') null, verdict_note, verdict_by, verdict_at, correlation_id, created_at)`. A trigger rejects delete and any update except `open → superseded` and setting the verdict once (verdict columns null → set) — the latter only by `service_role`.
- **Audit:** insert triggers on `agent_proposals` write `audit_events` (`agent.proposal.created`); the context's actor kind (`system:agent:<name>`) lands in `actor_kind`.
- **Enqueue trigger** `after update of status on campaigns` when `new.status = 'in_review' and old.status is distinct from 'in_review'` → insert task `campaign_review`, dedupe `campaign_review:<id>:<µs of clock_timestamp()>` (one per submission).
- **Flag:** `platform_settings('flag.agents', false)`; `public.agents_enabled()` stable function.

## 3. Shared rules (`packages/shared/src/agents.ts`, `copy-rules.ts`)
- `copy-rules.ts`: TS copy of `BANNED` from `apps/web/scripts/copy-rules.mjs`; a test imports both and compares `source`/flags/labels.
- `reviewChecks(campaign, perks, tranches)`: pure function → `Finding[]` `{ code, severity: 'info'|'check'|'concern', field, quote?, detail, requirement }`. Codes: `banned_language`, `investment_language`, `urgency_claim`, `escrow_wording`, `goal_headroom`, `backers_needed`, `physical_perk`, `perk_fulfill_date`, `tranche_evidence_missing`, `tranche_date`.
- `POLICY.agents`: `maxAttempts 4`, `backoffSeconds [30, 120, 600]`, `leaseMinutes 30` (≥ batch × worst-case task), `batchSize 5`, `modelTimeoutMs 120000`, `goalHeadroomPct 80`, `model 'claude-opus-5-5'`, `promptVersions { campaign_review: 'cr-1', ops_weekly: 'ow-1' }`.

## 4. Worker (`apps/api/src/agents/`)
- `runtime.ts`: `agentTick(deps, now)`: heartbeat; if `!agents_enabled()` return; `scheduleWeekly(now)`; claim up to N tasks; re-read the flag before each task after the first and give back the rest if it is off (`update … set status='running', attempts=attempts+1, lease_until=now()+lease where id in (select … where (status='queued' and available_at<=now()) or (status='running' and lease_until<now()) … for update skip locked limit N) returning *`); run each.
- `runTask`: inside `runWithCtx({ actorKind: 'system:agent:<agent>', correlationId: task.correlation_id })`: gather (short transaction as `fanzup_agent`), deterministic findings, model call **outside** any transaction, then one transaction: insert run, supersede older open proposals for the subject, insert proposal, mark task done. Every completion is fenced (`where status='running' and attempts=<claimed attempt>`); if another worker took the lease, the transaction rolls back and the outcome is `lost`. On model error: insert failed run; if attempts < max → `queued` with backoff; else write deterministic proposal with `model_unavailable: true`, task done. On gather error at max attempts → `dead`.
- `asAgent(sql, fn)`: begin; `setContext`; `set local role fanzup_agent`.
- `model.ts`: `ModelClient.generate({ system, input, schema, maxTokens }) → { output, model, usage }`. `AnthropicModel` uses `client.beta.messages.parse` with `betaZodOutputFormat(schema)`, model from policy, `thinking` omitted (adaptive), `output_config.effort: 'high'`, `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, timeout; refuses on `stop_reason === 'refusal'` or `parsed_output == null`. `FakeModel` for tests. `NoModel` throws `model_disabled` (deterministic path).
- `campaign-review.ts`, `ops-weekly.ts`: gather, checks, prompt (system prompt is fixed text; campaign text goes in a `<campaign_content>` block labelled untrusted; every block is JSON with `<`, `>`, `&` escaped, `blocks.ts`, so artist text can't close or forge a block), schema (zod v4).
- `env.ts`: `loadAgentEnv` (`AGENT_DATABASE_URL`, required and checked to be a `fanzup_agent` login when deployed; `DATABASE_URL` accepted locally; `AGENT_MODEL_PROVIDER`, `ANTHROPIC_API_KEY`, interval); refuses `fake` when deployed (reuses `isDeployed`).
- Entry `apps/api/src/agent-worker.ts`; script `pnpm --filter @fanzup/api agent-worker`; built by tsup.

## 5. Staff API (`apps/api/src/routes/staff.ts` additions)
| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/staff/agents/proposals` | `subjectId?`, `agent?`, `status?` (≤ 50, newest first) | `{ proposals: [...] }` |
| POST | `/staff/agents/proposals/:id/verdict` | `{ verdict, note?, reason }` | `{ action }` via `privileged('agent_proposal.verdict')` |
| GET | `/staff/agents/metrics` | — | `{ agents: [{ agent, proposals, agree, partial, disagree, agreementRate }] }` |
| POST | `/staff/flags/agents` | `{ on, reason }` | `{ action }` via `flag.set` |
The staff queue gains type `agent_dead_letters` (dead agent tasks). `agent_proposal.verdict` is not a money action, so single-operator delays and limits don't apply; it still needs aal2 and a reason.

## 6. Security
- Least privilege enforced by Postgres role (FR-AGT-F-001); test enumerates denied tables and functions.
- Prompt injection: campaign text is data inside a delimited block; the model has no tools and cannot write; its output is schema-validated and stored as JSON for staff to read. Worst case: a misleading packet, which the reviewer judges anyway; deterministic findings sit beside it and can't be suppressed by the model.
- Secrets: `ANTHROPIC_API_KEY` only in the agent worker's environment; never logged.
- Fail closed: `fake` refused when deployed; flag off by default; provider `none` by default.

## 7. Failure modes
| Failure | Effect | Handling |
|---|---|---|
| Model outage / 429 | No model section | Backoff, then deterministic proposal with `model_unavailable` |
| Model returns invalid JSON / refusal | Same | Counted as a failed attempt |
| Agent worker down | No packets | Reviews proceed manually; heartbeat shows it; tasks wait |
| Bad migration grant | Agent could read more | Privilege test fails CI |
| Campaign edited after packet | Stale packet | Packet records `campaign_updated_at`; resubmission creates a new task |

## 8. Requirements coverage
| Requirement | Where |
|---|---|
| FR-AGT-F-001 | migration grants; agent login (`AGENT_DATABASE_URL`); `apps/api/test/agents.test.ts` |
| FR-AGT-F-002 | `flag.agents`, `agents_enabled()`, staff route, runtime check |
| FR-AGT-F-003 | `agent_tasks`, claim query, backoff, `agent_dead_letters` queue |
| FR-AGT-F-004 | `agent_runs`, append-only trigger, actor kind |
| FR-AGT-F-005 | `agent_proposals`, supersession, verdict route, metrics |
| FR-AGT-F-006 | `model.ts`, `agents/env.ts` |
| FR-AGT-A1-001/002 | trigger, `campaign-review.ts`, `reviewChecks` |
| FR-AGT-A8-001 | `ops-weekly.ts`, `agent_v_weekly_actions`, `agent_v_ops_snapshot` |
| NFR-AGT-01…06 | separate entry point; view column test; model call outside tx; logging; JSON only; heartbeat |

## 9. Deployment (manual, Wayne)
Not added to `render.yaml` in this change, so merging doesn't create a paid service. To run it: a second Render worker with start command `node apps/api/dist/agent-worker.js`, first `alter role fanzup_agent login password …`, then env `AGENT_DATABASE_URL` (user `fanzup_agent.<project-ref>`), `AGENT_MODEL_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `NODE_ENV=production`; then `POST /staff/flags/agents {on:true}`.

## 10. Rejected alternatives
- Agent steps inside `runWorkerTick`: couples model latency to settlement.
- Draining agent work from the outbox: the outbox handler throws on unknown topics and is the money path; a trigger-fed table keeps the two apart.
- Managed Agents: not ZDR-eligible; Phase 0 needs no sandbox or tool loop.
- Service-role connection with app-level checks: a code bug could then write money; a Postgres role makes it impossible.
