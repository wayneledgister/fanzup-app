# ADR-008: Agent layer as an advisory sidecar with its own database role

**Status:** Proposed (CR-003, AGT G1+G2) · **Date:** 2026-11-26 · **Decider:** Wayne · **Requirements:** FR-AGT-F-001…006, NFR-AGT-01

## Context
FanZuP's operator works twelve staff queues alone in single-operator mode. Agentic AI can prepare much of that work (review packets, weekly review packs, later evidence and break investigations). FanZuP's promise rests on deterministic money code and human controls (FR-ID-003), so whatever we add must not be able to move money, change a money record, or count as a human approval.

## Decision
1. **Advisory only.** Agents write proposals; people act through the existing staff API.
2. **Separate process.** `apps/api/src/agent-worker.ts`, never inside `runWorkerTick`.
3. **Postgres role `fanzup_agent`, and the worker logs in as it.** Deployed, the agent worker connects with its own `AGENT_DATABASE_URL` as `fanzup_agent` (on Supabase, `fanzup_agent.<project-ref>` through the pooler) and refuses to start as any other user, so the process never holds the owner credential and `reset role` can't escape. The role reads only `agent_v_*` views and writes only agent tables, with column-limited inserts (no verdict, status or actor columns). Locally and in tests the owner connection switches to it per transaction (`set local role`). Staff verdicts are written by the API as `service_role`.
4. **Trigger-fed task table**, not the money outbox.
5. **Self-hosted Messages API workflows** (deterministic gather → one structured-output call, no tools) behind a `ModelClient` boundary (`none | fake | anthropic`), Claude Opus 5.5 by default with server-side refusal fallback.
6. **Deterministic findings always ship**, with or without the model.

## Consequences
- An agent bug can at worst produce a wrong packet; it can't touch money.
- Every new agent needs a view (reviewed for personal data) and a grant in a migration, which makes data access a visible, reviewable change.
- Running it costs a second worker process and model spend; both are off until Wayne turns them on.
- A future tool-using agent reuses the same role and login, so its database access stays read-only apart from its own tables.
- The `agent_v_*` views run with the view owner's rights (that is how they hide the base tables). Supabase's security advisor will report them as `security_definer_view`; that is expected, and it is why `anon` and `authenticated` have every privilege on them revoked.
- The context settings (`fanzup.actor_kind` and friends) are plain session settings the agent could set, so agent rows don't trust them: `agent_runs.actor_kind` is a generated column and the proposal audit row sets its own actor.
