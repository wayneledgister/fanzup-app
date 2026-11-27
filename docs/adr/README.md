# Architecture decisions: index and decision log
**Owner:** Wayne (decider) · engineering · **Status:** active · **Date:** 2026-11-27

Consequential, expensive-to-reverse choices get a full ADR in this folder (template: context, decision, alternatives, consequences, revisit trigger). Cheap-to-reverse choices worth remembering go in the decision log below instead. An accepted ADR's decision is never edited: a new ADR supersedes it and both link to each other.

## ADRs
| ADR | Decision | Status | Date | Driver |
|---|---|---|---|---|
| [ADR-001](ADR-001-monorepo.md) | One pnpm monorepo for web, API, mobile, mock escrow and shared rules | Accepted | 2026-10-03 | M1 |
| [ADR-002](ADR-002-hosting.md) | Vercel for web + API, Render for the worker | Accepted | 2026-10-03 | M1 |
| [ADR-003](ADR-003-payment-provider-boundary.md) | Payment-provider boundary: event inbox, two-phase outbound, sandbox that speaks events | Accepted 2026-11-27 (G2, M1; built and merged) | 2026-10-03 | M1 money path |
| [ADR-004](ADR-004-full-account-auth.md) | Full account before checkout on Supabase Auth; staff second factor via `aal2` | Accepted 2026-11-27 (G2, M1; built and merged) | 2026-10-03 | M1 identity |
| [ADR-005](ADR-005-correlation-ids.md) | Correlation ids via AsyncLocalStorage and Postgres settings | Accepted 2026-11-27 (G2, M1; built and merged) | 2026-10-03 | NFR-OPS-04 |
| [ADR-006](ADR-006-e2e-harness.md) | E2E on the Supabase CLI stack in CI, sandbox provider, Mailpit | Accepted 2026-11-27 (G2, M1; built and merged) | 2026-10-03 | M1 exit tests |
| [ADR-007](ADR-007-regcf-provider-and-mock-escrow.md) | Reg CF provider boundary and a standalone mock escrow service | Accepted 2026-11-27 (CR-002, L2 G1+G2; built and merged) | 2026-10-03 | CR-002 |
| [ADR-008](ADR-008-agent-layer.md) | Agent layer as an advisory sidecar with its own read-only database role | Accepted 2026-11-27 (CR-003, AGT G1+G2; built and merged (PR #24)) | 2026-11-26 | CR-003 |
| [ADR-009](ADR-009-mobile-app.md) | Native app with Expo + React Native, sharing business rules with the web through `@fanzup/shared` | Accepted 2026-11-27 (CR-004; built and merged (PR #25)) | 2026-11-27 | CR-004 |
| [ADR-010](ADR-010-services-marketplace-money-boundary.md) | Services marketplace: no money in MKT-1, one money boundary for MKT-2 | Accepted (CR-005; Wayne's decisions D-MKT-1/2) · PR #27 | 2026-11-27 | CR-005 |

**2026-11-27:** Wayne accepted ADR-003…009 (decision card in the docs-audit thread): built, reviewed and merged, so the record now matches what runs. The gate sign-offs (M1 G2/G3, AGT, CR-004/005 self-reviews) are separate and still pending. Changing one of these decisions now needs a superseding ADR.

## Decision log (cheap to reverse)
| ID | Date | Decision | Status | Driver | Revisit when |
|---|---|---|---|---|---|
| DL-001 | 2026-11-27 | Pin `apps/api` to TypeScript `~5.9.3` (the rest of the repo is on 7.x); CI guard checks the API's TypeScript still has the JS API (`transpileModule`); Dependabot ignores TypeScript major-version bumps | Active | PR #26: Vercel compiles `apps/api` with the TypeScript JS API, which TypeScript 7 doesn't ship, so deploys broke after #16 | Vercel's Node builder supports TypeScript 7 (or the API is bundled before upload) |
| DL-002 | 2026-11-27 | `docs/API.md` is the route index and drift guard; `apps/api/test/api-contract.test.ts` fails CI when routes and the table differ | Active | SDD audit: no single wire-contract index existed; routes had drifted from the design tables | An OpenAPI document generated from the zod schemas replaces it |
| DL-003 | 2026-11-27 | `specs/traceability.md` is generated (`pnpm trace`) and CI fails when it's stale (`pnpm trace:check`) | Active | SDD audit: the Enterprise tier requires a matrix and none existed | The matrix moves to a tool (for example a test-management system) |
