# Runbooks · FanZuP
**Owner:** Wayne (operator) · **Status:** active · **Date:** 2026-11-27 · **Covers:** NFR-OPS-09 (runbooks, severity matrix, postmortem template), D-2 in `specs/05-readiness.md`

These are the "it's 2am and something is wrong" documents. They describe the system as built on `main`, not as planned. Each one names the exact command, route or dashboard to use. If a step here doesn't match what you see, the runbook is wrong: fix it in the same PR as the change that made it wrong.

| Runbook | Use it when |
|---|---|
| [`deploy-and-rollback.md`](deploy-and-rollback.md) | Shipping a change to staging or production, or undoing one |
| [`incidents.md`](incidents.md) | Something is broken: severity matrix, first five minutes, the top failure modes, postmortem template |

Related: architecture diagrams in [`../diagrams/README.md`](../diagrams/README.md), risk log in [`../risks.md`](../risks.md), failure-mode analysis in [`../fmea.md`](../fmea.md), readiness review in [`../05-readiness.md`](../05-readiness.md). Account setup (one-time, by hand) stays in [`docs/SETUP.md`](../../docs/SETUP.md).

## Where things run (quick reference)
| Piece | Host | Deploys from | Logs | Health signal |
|---|---|---|---|---|
| Web (`apps/web`, Vite SPA) at `/` | Vercel service `web` | merge to `main` (production), every PR (preview) | Vercel → Deployments → Build logs | page loads; `/explore` deep link isn't a 404 |
| API (`apps/api`, Fastify) at `/api` | Vercel service `api` (one function) | same Vercel deployment as the web | Vercel → Logs (filter `api.error`, `api.misconfigured`) | `GET /api/health` → `{"ok":true,…}` |
| Worker (`apps/api/src/worker.ts`) | Render `fanzup-worker` (`render.yaml`) | merge to `main` after CI ("After CI checks pass") | Render → fanzup-worker → Logs (`worker.start`, `worker.tick`, `worker.error`) | `worker.ageSeconds` in `/api/health` (< 60 normal) |
| Agent worker (optional, CR-003) | Render, created by hand (SETUP D3) | same | Render logs (`agent_worker.start`) | proposals appear for submitted campaigns |
| Database + Auth | Supabase (`fanzup-staging`; `fanzup-prod` not created yet) | `supabase/migrations/` via Supabase's GitHub integration on merge to `main`; manual fallback `.github/workflows/db-deploy.yml` | Supabase → Logs | Supabase dashboard status; `/api/health` 503 `database_unavailable` |
| Payments | Stripe **test mode** only (FR-PAY-008; the API refuses live keys) | — | Stripe → Developers → Webhooks / Events | webhook endpoint delivery rate |

## Operator tools
- **`pnpm m1:operator`** (`scripts/m1-operator.ts`, SETUP Part F) — signs you in with password + TOTP and runs staff reads and actions against a hosted API: `staff queue <type>`, `staff review`, `staff verify`, `staff refund`, `staff recon` / `staff recon run`, `staff trace <correlationId>`. Tokens stay in memory; nothing is printed.
- **Not in the operator script yet** (readiness gap D-2a): replaying an outbound op or provider event and flipping a flag. Until it is, call the routes in [`docs/API.md`](../../docs/API.md) (`POST /api/v1/staff/outbound-ops/:id/replay`, `POST /api/v1/staff/provider-events/:id/replay`, `POST /api/v1/staff/flags/:flag`) from a staff session with a second factor, with a typed `reason` of 10+ characters. Every one is an audited privileged action.
- **Staff queue types** (`StaffQueueType` in `@fanzup/shared/schemas`): `review`, `verification`, `refunds`, `payouts`, `unmatched`, `dead_letters`, `breaks`, `failed_events`, `scheduled`, `agent_dead_letters`, `pool_dead_letters`, `pool_breaks`.
- **Correlation ids** (ADR-005): every API response carries `x-correlation-id`, every error body has `correlationId`, and `staff trace <id>` returns every audit, ledger, outbox and op row that carries it. Ask a user for the id on their error screen first.

## On call
FanZuP runs in single-operator mode until a second staff member exists (FR-ID-007, card G1-A). Wayne is primary for every severity. A named backup who can at least read the dashboards and post the user notice is still to be chosen (risk R-07 in `../risks.md`); until then, a SEV1 outside waking hours waits for Wayne, and that is a recorded, accepted risk only for test-money beta.
