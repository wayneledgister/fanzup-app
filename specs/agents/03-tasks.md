# Agent layer, Phase 0 (CR-003) — Plan and tasks
**Requirements:** `01-requirements.md` · **Design:** `02-design.md` · **Gate:** `../gates/AGT-G1G2.md` · **Date:** 2026-11-26
**Shape:** one PR (`feat/agents-phase0`). Nothing in it can move money, so it isn't split into a stack.

| ID | Task | Done when | Covers | Status |
|---|---|---|---|---|
| AGT-T-000 | Preflight: local Postgres for tests; `@anthropic-ai/sdk` installs; no model key needed for tests | API tests run locally | — | ✅ |
| AGT-T-001 | Strategy, CR-003, requirements, design, ADR-008, gate record, this plan | files in `specs/` and `docs/adr/` | all | ✅ |
| AGT-T-002 | `POLICY.agents`; shared `copy-rules.ts` + sync test against `apps/web/scripts/copy-rules.mjs`; `reviewChecks`, `weeklyPack`, week helpers | shared tests green | FR-AGT-A1-002, FR-AGT-A8-001 | ✅ `packages/shared/test/agents.test.ts` (7) |
| AGT-T-003 | Migration: role `fanzup_agent`, grants, `flag.agents`, `agents_enabled()`, `agent_tasks`/`agent_runs`/`agent_proposals`, guards, audit trigger, enqueue trigger, `agent_v_*` views | applies on a fresh DB after every earlier migration; privilege tests | FR-AGT-F-001…005, NFR-AGT-02 | ✅ |
| AGT-T-004 | `asAgent` in `db.ts`; `agents/env.ts` (fail closed); `agents/model.ts` (`none`/`fake`/`anthropic`, structured output, refusal fallback, error codes) | env and adapter contract tests (no network) | FR-AGT-F-006 | ✅ |
| AGT-T-005 | Runtime: tick, flag check, heartbeat, weekly schedule, claim/lease, run, retry/backoff, dead letter, deterministic fallback, supersession | runtime tests incl. concurrency | FR-AGT-F-002/003/004, NFR-AGT-03/06 | ✅ |
| AGT-T-006 | A1 Campaign Review Copilot (gather, checks, prompt with untrusted block, schema, body, skip when not in review) | packet test, injection-text test, skip test | FR-AGT-A1-001/002 | ✅ |
| AGT-T-007 | A8 Ops Steward (gather from views, pack, brief) | weekly test | FR-AGT-A8-001 | ✅ |
| AGT-T-008 | Staff API: proposals list, verdict via `privileged()` (reviewer ≠ owner), metrics, `agent_dead_letters` queue, `/staff/flags/agents` | API tests | FR-AGT-F-002/005 | ✅ |
| AGT-T-009 | `agent-worker.ts` entry, tsup bundle, `agent-worker` / `start:agent-worker` scripts | `pnpm --filter @fanzup/api build` emits `dist/agent-worker.js` | NFR-AGT-01 | ✅ |
| AGT-T-010 | Docs: README, `docs/SETUP.md` (agent worker, model key, vendor terms), backlog rows for Phases 1–3, worklog | files updated | — | ✅ |
| AGT-T-011 | Independent review; fix findings; CI green | reviewer APPROVE; CI green | all | see worklog |
| AGT-T-012 | **Wayne:** sign off AGT G1+G2; decide AGT-Q1 (vendor terms); create the Render agent worker; turn the flag on in staging | — | — | ⏳ Wayne |

## Test strategy
- Real Postgres (as every API suite): privilege denial for money/identity/staff tables and functions; exact grant inventory; view column scan; trigger enqueue; runtime paths (flag off, success, invalid output, model outage to deterministic fallback, skip, concurrency, dead letter); staff verdict rules; weekly pack.
- No network: the Anthropic adapter is tested on request shape and response mapping with a stubbed client.
