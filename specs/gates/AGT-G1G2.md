# AGT G1+G2 — Requirements + design gate · FanZuP · CR-003 agent layer, Phase 0 · 2026-11-26
**Tier:** Enterprise (regulated domain) · **Review:** one independent reviewer over the spec set and the built code (G1, G2 and the code review combined, because Phase 0 can't move money and ships with its flag off).
**Artifacts:** `specs/changes/CR-003-agent-layer.md`, `specs/agents/00-strategy.md`, `01-requirements.md`, `02-design.md`, `03-tasks.md`, `docs/adr/ADR-008-agent-layer.md`, `supabase/migrations/20261126000100_agents.sql`, `apps/api/src/agents/*`, `apps/api/test/agents.test.ts`.

**Verdict, pass 1: REQUEST CHANGES** (2 majors, 7 minors, 6 nits; no blockers). All majors and minors are fixed below.
**Verdict, pass 2: APPROVE WITH NITS.** The reviewer confirmed every fix against the diff and a scratch database (including logging in as `fanzup_agent`: `reset role`, `set role postgres`/`service_role` and `set session authorization` all denied). Pass 2 nits are fixed in the table at the end.
**Sign-off:** ⏳ Wayne (AGT-T-012). The reviewer advises; Wayne signs.

## What the reviewer checked
- Agent tests 34/34, shared 66/66, `tsc` clean, the rls / staff-actions / identity-staff / sync / money-path suites 68/68.
- Applied every migration to a scratch database and listed what `fanzup_agent` can do (`has_table_privilege`, `has_column_privilege`, `has_function_privilege`). Table and column grants matched the test; executable functions were `ctx`, `agents_enabled`, `is_staff`, `owns_artist`, `owns_campaign`, `campaign_is_public` (none money or workflow).
- `runWorkerTick`, `jobs.ts`, `worker.ts` unchanged (NFR-AGT-01).
- `grant fanzup_agent to current_user` works as a non-superuser CREATEROLE role on PG16, as on hosted Supabase.
- SDK request shape checked by hand against `@anthropic-ai/sdk` 1.14.0.

## Findings and fixes
| # | Sev | Finding | Fix |
|---|---|---|---|
| M1 | MAJOR | The agent could insert a proposal already carrying a staff verdict (insert grant covered every column; the guard ran only on update), and a run with any `actor_kind`. Breaks "can't count as a human approval" (FR-AGT-F-005). | Column-limited insert grants on `agent_tasks`, `agent_runs`, `agent_proposals`; the proposal guard now also runs `before insert` and rejects a non-open or verdicted row; `agent_runs.actor_kind` is a generated column; the proposal audit row sets its own actor and clears `fanzup.actor_id`. Tests: inventory of insert columns, four refused inserts, a spoofed-context audit test. |
| M2 | MAJOR | The worker held the owner credential and dropped rights only per transaction; `reset role` escaped. "No money-writing credential" was false as deployed. | The worker logs in as `fanzup_agent` via `AGENT_DATABASE_URL` (SETUP D3 adds the one-time `alter role … login password`; no secret in the migration). `loadAgentEnv` requires it when deployed and refuses any other user. Verified locally: logged in as `fanzup_agent`, `reset role` stays `fanzup_agent` and `ledger_entries` is denied. ADR-008, CR-003, design and SETUP wording corrected. |
| 1 | MINOR | No fencing on lease reclaim; a late worker could overwrite another's result. | Every completion is `where status='running' and attempts=<claimed>`; no match rolls back the run and proposal (`lost`). Lease 10 → 30 min (≥ batch × worst case). Test: takeover mid-run leaves no proposal. |
| 2 | MINOR | Privilege test didn't cover functions (PUBLIC execute default). | Exact list of executable non-trigger `public` functions asserted. |
| 3 | MINOR | Artist text could close `<campaign_content>` and forge a trusted block. | `blocks.ts` escapes `<`, `>`, `&` as JSON unicode escapes in every block. Test. |
| 4 | MINOR | `artist_identity_status` (a KYC outcome) reached the model; the column test was a denylist. | Column dropped (submission already requires verified identity). Exact column list asserted per view. |
| 5 | MINOR | Test gaps: lease reclaim, backoff timing, `/v1/config`, timeout, agent UPDATE on runs, status filter. | All six added. |
| 6 | MINOR | Spec drift: this gate file missing; `agents-privileges.test.ts` references; design §2 details. | This file; references point to `agents.test.ts`; design §2–§4 updated. |
| 7 | MINOR | A repeat or unknown-id verdict left a failed privileged action (and an unknown id got the wrong error). | Route checks first: 404 unknown, 409 already judged. Test asserts no new action. |
| N1 | NIT | Flag read once per tick. | Re-read before each task after the first; unrun claims are given back. |
| N2 | NIT | `agent_v_weekly_actions.subject_id` could be a person's id. | Dropped. |
| N3 | NIT | Owner-rights views will show as `security_definer_view` in Supabase's advisor. | Noted in ADR-008. |
| N4 | NIT | `as never` cast hid the request body from the compiler. | Removed; typecheck clean. |
| N5 | NIT | 120 s timeout vs. `effort: high`, 16k max tokens, non-streaming. | Deferred: measure on first real runs (backlog). |
| N6 | NIT | Keep the enqueue trigger trivial (it runs inside `submit_campaign`). | Unchanged; noted. |

## After the fixes
API 358/358 (28 files), shared green, `pnpm -r typecheck` clean.

## Pass 2 nits
| # | Finding | Fix |
|---|---|---|
| P2-1 | The agent session could set `aal` (and the correlation id) on its proposal audit rows. | The audit trigger writes `aal` null. Correlation ids stay the task's, documented as self-reported. |
| P2-2 | A judged proposal could be superseded (status change not audited). | Guard and runtime supersede only unjudged proposals. Test. |
| P2-3 | A failed run rolls back when the lease is lost. | Documented in design §4. |
| P2-4 | A flag-check error mid-batch left the rest of the batch leased for 30 min. | Caught; the rest is given back. |
| P2-5 | Migration edited in place. | Safe: never on `main`, so never applied to a hosted database. |
| P2-6 | Supavisor may cache credentials; add a check. | SETUP D3: pooler restart hint and `select current_user` check. |

