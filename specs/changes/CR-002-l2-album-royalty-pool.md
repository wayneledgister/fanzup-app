# CR-002: Layer 2 album royalty Pool, end to end, on mock rails
**Status:** Accepted (v-now, demo on mock rails; `layer2` stays off in production) · **Source:** Wayne (founder), 2026-10-03 · **Date:** 2026-10-03

## Request
Wayne's words (the authority for this change, recorded verbatim):

> "build out a feature for starting an album campaign where the creator offers to share portions of royalties for shares … using mock data at the database level and a mock api for the escrow company if an api with a sandbox env is not available."

The founder's brief that came with it (2026-10-03) adds: build it behind the `layer2` flag, server-enforced; a persistent "Demo — not an offer of securities" banner on every Layer 2 screen; no real money, KYC or filings; a mock escrow/offering service shaped like North Capital's TransactAPI because sandbox keys are not self-serve; "shares" are called **Units** in the product (Brand §7.5).

## Classification
**Scope change.** It doesn't change any Layer 1 requirement or the M1 design, but it contradicts two recorded sequencing decisions:
- v2 requirements §"Out of scope (restated)": "Layer 2 investing and all `layer2`/`postBeta` builds" are out of scope.
- E1 Pragmatist P5 / E1 record: freeze `layer2` UI until after the first reward campaign ships.

The founder's direct request overrides that sequencing **for a demo on mock rails only**. It does **not** change the production posture: no Layer 2 path can run in a deployed environment (the mock provider is refused there, like the M1 sandbox), and the `layer2` flag stays off in production.

## Impact

### Requirements
- **Added:** a new requirements file for the change, `specs/l2/01-requirements.md` (FR-L2-*, NFR-L2-*), derived from PRD 01 §6.2–6.5, §8, §11, §11.1; PRD 01a §2–4; PRD 01b §1, §3, §5; Mechanisms 01, 03, 04, 07 (cited by ID; the PRD text itself is not in this public repo).
- **Modified:** none of the v2 FRs. FR-PLT-001 (server-enforced flags) is **partly implemented** for `layer2` by this change (API + database enforcement; URL overrides still work in the web app for mock-only screens, see design §9).
- **Retired:** none.

### Design
- New design `specs/l2/02-design.md`; new ADR-007 (Reg CF provider boundary + mock escrow service).
- Reuses, does not fork: Supabase Auth, double-entry ledger (new account kinds + a `pool_id` dimension), SQL money functions with idempotency keys, the provider-event inbox, the two-phase outbound pattern (new `pool_ops` table, same state machine), single-operator `privileged()` staff actions, correlation ids, notifications outbox.
- New app `apps/mock-escrow` (standalone Fastify service; local and CI only).
- ADRs contradicted: none. ADR-003's interface (`PaymentProvider`) stays the Layer 1 boundary; ADR-007 adds a sibling boundary for Reg CF.

### Plan
- New task list `specs/l2/03-tasks.md` (L2-T-000…). Size **L** (about 1 focused build session for a demo-grade vertical slice; production-grade Layer 2 is still XL and partner-gated).
- Nothing already built is discarded. The existing `layer2` mock screens are rebuilt on real data; mock-only screens that this change doesn't cover stay as they are.

### Ripple
- **Gates:** G1/G2 for M1 are untouched. This change gets its own combined G1+G2 council pass (`specs/gates/L2-G1G2.md`).
- **Docs going stale:** `README.md` (flags, dev commands), `docs/SETUP.md` (mock escrow), `specs/backlog.md` ("Layer 2 schema migration" item is partly done), `docs/CONSOLIDATION.md` Layer 2 rows (now on real data in local/CI).
- **Open founder cards** E1-A/B/C: unaffected. E1-B (custody) default "no live money" holds; Layer 2 adds its own, larger version of the same question (funding portal + escrow agent + transfer agent), recorded as counsel/partner questions, not decided here.

## What this displaces
Every hour here is an hour not spent on M2 of Fund My Show (the reward-campaign core). The Layer 2 domain is also the riskiest legally; building it before counsel answers risks rework. Mitigation: everything is demo-only, behind the flag and the mock provider, and every counsel-dependent rule is a named policy value or a labelled "pending counsel" item, not a hard-coded assumption.

## Options considered
| Option | Cost / consequence |
|---|---|
| **Do now as a demo on mock rails, server-gated** (recommended) | About one build session. Gives Wayne a working end-to-end demo for partner and counsel conversations. Displaces M2 work by that much. |
| Do now against a real sandbox (North Capital TransactAPI) | Blocked: sandbox keys come only through their integration team. |
| Spec only, build later | Cheapest; contradicts the request. |
| Reject | Contradicts the request. |

## Recommendation
Accept in v-now as a demo on mock rails. Keep the provider boundary shaped like a real Reg CF provider so the mock can be swapped for a `northcapital` adapter without touching domain code.

## Decision
**Accepted (v-now, demo on mock rails): Wayne, 2026-10-03** — direct request (quoted above). Production posture unchanged: `layer2` off in production; the mock provider can't run in a deployed environment.
