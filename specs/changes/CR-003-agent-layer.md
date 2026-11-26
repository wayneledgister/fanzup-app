# CR-003: Agent layer (agentic AI) — integration strategy and Phase 0
**Status:** Accepted (v-now, Phase 0 only; agents are advisory and ship with `flag.agents` off) · **Source:** Wayne (founder), 2026-11-26 · **Date:** 2026-11-26

## Request
Wayne's words (the authority for this change, recorded verbatim):

> "you are a consultant tasked with anayzing the current Fanzup project its core value propositions and central features and to figure a role for ai in the current achetecture from an agentic prospective and not just a simple qna chatbot."

followed, after the consultant report ("FanZuP Agent Strategy", 2026-11-26), by:

> "create an integration strategy for this and build it using the SDD skills"

## Classification
**New scope.** Nothing in the v2 requirements changes. The agent layer is additive: it reads data the platform already holds and writes only its own tables. It touches no money path, no ledger function, no provider adapter and no existing staff decision.

## Impact
### Requirements
- **Added:** `specs/agents/01-requirements.md` (FR-AGT-*, NFR-AGT-*). The integration strategy is `specs/agents/00-strategy.md`.
- **Modified:** none. FR-PLT-001 (server-enforced flags) gains one flag, `agents`, through the existing `flag.set` staff action.
- **Retired:** none.

### Design
- New design `specs/agents/02-design.md` and ADR-008 (agent layer: advisory sidecar, read-only database role, self-hosted Messages API workflows).
- New migration: role `fanzup_agent`, tables `agent_tasks`, `agent_runs`, `agent_proposals`, read-only views `agent_v_*`, trigger on campaign submission, `flag.agents`.
- New code: `apps/api/src/agents/` and a separate entry point `apps/api/src/agent-worker.ts`. The money worker (`runWorkerTick`) is not changed.
- Staff API: proposal list, verdict, agreement metrics; `/staff/flags/agents`.
- ADRs contradicted: none.

### Plan
- `specs/agents/03-tasks.md` (AGT-T-001…). Size **M**. Delivered as one PR because nothing in it can move money.

### Ripple
- **Gates:** M1 G1/G2 and L2-G1G2 are untouched. This change gets a combined G1+G2 pass (`specs/gates/AGT-G1G2.md`).
- **Docs:** README (agent worker, flag), `docs/SETUP.md` (agent worker env, model vendor terms), `specs/backlog.md` (Phase 1–3 agents).
- **Partners and counsel:** the flow-of-funds memo (NFR-COMP-01) should say that agents are advisory and hold no money-writing credential. The model vendor needs a DPA before real user data reaches it (NFR-COMP-21).
- **Deploys:** merging to `main` applies the migration to the Supabase project through the existing GitHub integration. The migration creates a role, three tables, views and a trigger; it changes no existing table's data. No Render service is added by this change (the agent worker is a manual step, design §9).

## What this displaces
Time on M2 (closed beta of Fund My Show). Mitigation: Phase 0 is the part of the strategy that saves operator time during M2 itself (review packets, weekly single-operator review pack), and everything else is deferred to the milestone it serves.

## Options considered
| Option | Cost / consequence |
|---|---|
| **Phase 0 now: foundation + Ops Steward + Campaign Review Copilot, shadow mode, flag off** (recommended) | About one build session. Usable in M2 as soon as Wayne turns the flag on with a model key. No money risk by construction. |
| All eight agents now | Most need data that doesn't exist until M3 (custodian, disputes, fulfillment, sanctions vendors). Would be built against guesses. |
| A fan-facing chatbot first | Touches the most people, most copy risk, least operator leverage. Rejected in the strategy. |
| Spec only | Cheapest; contradicts "build it". |

## Recommendation
Accept Phase 0 into v-now. Phases 1–3 go to the backlog with origin links, each built when its milestone's data exists.

## Decision
**Accepted (v-now, Phase 0): Wayne, 2026-11-26** — direct request (quoted above). Agents are advisory; `flag.agents` is off by default; the agent worker refuses a fake model in a deployed environment.
