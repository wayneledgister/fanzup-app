# Production readiness review · FanZuP web · 2026-11-27
**Skill:** sdd-ready-launch Step 1 · **Tier:** Enterprise (`00-brief.md`; Small + Standard + Enterprise checklists apply) · **Target launch:** M2 closed beta on **test money**, web first (mobile deprioritised by Wayne on 2026-11-27) · **Code reviewed:** `main` at `8c8f44d` (after PR #27) · **Gate:** G5 (not signed off)

**Recommendation: FIX FIRST.** The money core is strong and well tested: idempotent checkout, an append-only double-entry ledger with its rules in SQL, bounded retries with dead letters, reconciliation that pauses payouts, fail-closed configuration and audited staff actions. What isn't ready is everything around it that a beta needs on day one: there is **no production environment or backup**, the **hosted app has never been run end to end**, **nobody gets told when something breaks**, and the artist half of the web app still shows sample data. None of these is large; together they mean a beta user could hit a problem that nobody sees and nobody can undo. Blockers B1–B8 below, in order. Live money (M3) has its own, longer list (counsel, custody, pen test) and isn't assessed for go here.

Evidence was gathered from the repository, CI history, `pnpm audit` and the Supabase connector (read-only). Verdicts: ✅ pass (with evidence) · ❌ fail (with fix) · ⚠️ risk to accept or a partial · N/A (with reason). Requirement ids are in `specs/01-requirements.md`; risk ids in `specs/risks.md`; failure modes in `specs/fmea.md`.

## Small tier
| # | Item | Verdict | Evidence / gap | Fix |
|---|---|---|---|---|
| C-1 | Every P0 FR verified against its acceptance criteria | ❌ | 69 of 220 requirements cite a test; 30 **P0a** rows are "spec only" in `specs/traceability.md` (I-02). Artist screens (`components/creator/data.ts`, `pages/campaign/Basics.tsx`), the landing hero and several fan/settings pages read `@/lib/mock` sample data; FR-PLT-002 (every reachable screen works) isn't met | Live artist screens (separate thread, M2 item 1); FR-PLT-002 route pruning (hide prototype routes behind `postBeta`); triage the 30 P0a rows (B6) |
| C-2 | Core-logic tests exist and pass | ✅ | CI on `main` green (run 46064456403, 2026-11-27): API suite against real Postgres (ledger invariants, RLS, money flow, recon, staff actions; 382 tests on PR #27), shared 97, web 13, mobile 9, mock escrow 18, Playwright golden + Layer 2 + marketplace journeys | — |
| C-3 | Manual smoke checklist executed on the deploy target | ❌ | Exit test 8 (SETUP Part F) never run on the hosted app; the staging database is **paused** (Supabase status `INACTIVE`, I-01) | Restore staging, run Part F, then the probes in `runbooks/deploy-and-rollback.md` §4; record in the worklog (B2) |
| S-1 | Inputs validated at trust boundaries; parameterised queries | ✅ | zod on every body/query (`apps/api/src/routes/*`); postgres.js tagged templates only; 64 KB body limit (`app.ts`); webhook signature on raw body | — |
| S-2 | No secrets in source; config via env | ✅ | `.env.example` only; `env.ts` validates; deployed + sandbox or non-test key refuses to start (FR-PAY-008, tested in `money-rules.test.ts`) | — |
| S-3 | Auth on every non-public route; sensitive data protected | ✅ | Access level per route in `docs/API.md`, enforced by `lib/auth.ts`; RLS on reads; money functions `service_role` only; staff `aal2`. Address encryption (NFR-SEC-08) not triggered: M1 collects no addresses | — |
| S-4 | Dependencies scanned; highs resolved | ❌ | `pnpm audit --prod`: 7 high, 11 moderate, 5 low. Highs: `react-router` 7.13.0 (pinned exactly, so Dependabot range bumps skip it; mostly RSC/framework-mode advisories, one route-matching DoS applies to the SPA), `zod` oversized collections (API; body limit mitigates). No audit gate in CI (R-09) | Bump `react-router` ≥ 7.18.2 and `zod` to a patched line; `pnpm audit --audit-level high` in CI (B7) |
| S-5 | HTTPS end to end | ✅ | Vercel serves HTTPS only; API → Supabase and Stripe over TLS. HSTS **preload** isn't set (see S-8) | — |
| R-1 | Rollback path exists and tested once | ⚠️ | Written now (`runbooks/deploy-and-rollback.md` §5: Vercel Instant Rollback, Render rollback, forward-fix migrations, expand → contract rule). **Not rehearsed** | Run the §7 drill on staging (B5) |
| R-2 | Backups configured and a restore performed | ❌ | Only `fanzup-staging` exists, on a plan with no backups, and it's paused. No `fanzup-prod`; no PITR; no restore ever done (NFR-OPS-01/02, R-01) | Create `fanzup-prod` on Pro + PITR; one restore drill re-checking ledger invariants and recon on the copy (B1, B5) |
| R-3 | Fails gracefully when dependencies are down | ✅ | Design §10 table as built: `/api/health` 503 on DB loss; misconfigured app serves 503 naming the variable (`server.ts`); checkout 502 "nothing was charged"; one transaction per money step; outbound ops back off. **R-3a:** no degrade switch to pause checkout or payouts (NFR-OPS-12, P0b; R-15) | `flag.checkout` / `flag.payouts` (M2, not blocking a test-money beta) |
| O-1 | Errors logged where the owner will see them | ❌ | JSON logs with `level:"alert"` exist for every money failure (`outbound.dead_letter`, `settlement.failed`, `capture.stray`, …), but they go only to Vercel/Render logs. No error tracker (NFR-OPS-04 "Sentry hookup is a setup step") | Error tracker on API, worker, web; log drain alert on `level:"alert"` (B3) |
| O-2 | Uptime check pings the app and notifies | ❌ | `/api/health` reports `worker.ageSeconds`, but no external monitor polls it (NFR-OPS-06) | 5-minute external check; alert when the request fails or `worker.ageSeconds` > 600 (B3) |
| D-1 | README covers setup, deploy, "it's down" | ✅ | `README.md` + `docs/SETUP.md` (setup), `specs/runbooks/` (deploy, rollback, incidents; this PR) | — |

## Standard tier
| # | Item | Verdict | Evidence / gap | Fix |
|---|---|---|---|---|
| C-4 | P0/P1 criteria covered by automated tests; CI green on the release commit | ⚠️ | CI green on `main`. Coverage gaps per C-1. **`main` has no branch protection** (GitHub API: "Branch not protected"), and E2E isn't a required check, so a red commit can reach production (R-11) | Protect `main` with Web + API required (E2E once stable) (B7) |
| C-5 | Integration tests at component boundaries and external contracts | ⚠️ | API tests run against real Postgres; Stripe adapter tests use recorded payloads (`money-path.test.ts`); route drift test (`api-contract.test.ts`). No test runs against Stripe test mode itself (design §15.1, A-02) | Exit test 8 (B2); optional Stripe test-mode CI job once keys exist |
| C-6 | NFR targets measured | ⚠️ | No load test. NFR-PERF-01/02/03 (throughput, p95) are **P0b**; beta volume is inside design §10 headroom (A-01). NFR-PERF-04 (P0a: releases within 1 business day, events applied within 5 min) is unmeasured | Accept for the closed beta; measure NFR-PERF-04 from `outbound_ops`/`provider_events` timestamps in the weekly review; load test before public beta |
| S-6 | Authorization tested negatively | ✅ | `rls.test.ts`, `identity-staff.test.ts` (user A can't read B's backings; reviewer ≠ owner in SQL), marketplace RLS with no client grants | — |
| S-7 | Rate limiting on auth and expensive endpoints | ❌ | `POLICY.rateLimits` is defined but nothing enforces it; only the unconfirmed-checkout cap and the marketplace daily request limit (NFR-SEC-13 P0a; design G-3; R-06; FMEA F-06) | Shared limiter on write routes (B4) |
| S-8 | Security headers / CORS configured deliberately | ❌ | CORS is an explicit allowlist (`CORS_ORIGINS`) and same-origin in production ✅. **No security headers**: `vercel.json` has no `headers`; no CSP, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy (NFR-SEC-03 P0a; R-08). No `/.well-known/security.txt` (NFR-SEC-11, P1) | `headers` for the `web` service; CSP report-only → enforce, allowing Stripe and Supabase origins (B4) |
| S-9 | PII inventory | ⚠️ | E1 and the privacy-notice draft (PR #28) list what's collected; no single inventory of fields, stores, access and deletion; deletion isn't built (FR-PRV-003, R-14) | One-page PII inventory alongside the counsel-approved privacy notice (B8) |
| R-4 | Health-check endpoint; deploys verify it | ⚠️ | `GET /api/health` checks the DB and reports worker age ✅. Vercel doesn't gate a deploy on it and Render has no health check for a worker; verification is the manual probe list (runbook §4) | Run the probes after every production deploy; add the external monitor (B3) |
| R-5 | Zero-downtime deploy | ✅ | Vercel swaps web + API atomically; worker restarts are safe (leases, `SKIP LOCKED`, idempotent steps). Requires expand-only migrations (runbook §1) | — |
| R-6 | Timeouts, retries with backoff, idempotency on external calls | ✅ | `outbound.ts` two-phase ops, backoff, 8 attempts then dead letter, provider lookup before retry, attempt generations; Stripe idempotency keys; tests in `money-path.test.ts` | — |
| R-7 | Migrations tested on production-shaped data | ⚠️ | 22 migrations replay in CI from empty; `migration-backfill.test.ts` covers one backfill. The hosted DB holds no data yet, so nothing to test against (backlog: pre-M1 data upgrade) | Before each beta-era migration, `supabase db push` to a PITR copy or branch of prod first |
| O-3 | Structured logs with request correlation | ✅ | JSON lines with `correlationId` (ADR-005); ids flow into audit, ledger, outbox and ops; `staff trace` (`trace.test.ts`); redaction (NFR-SEC-12) | — |
| O-4 | Dashboards for golden signals | ❌ | None. Vercel/Render show request counts and logs only | Dashboard with checkout 5xx rate, `/api` p95, worker age, outbox depth and oldest age, dead letters, open breaks (with B3's tool) |
| O-5 | Alerts tied to NFRs, routed to a human, each with a response step | ❌ | Thresholds are written (E1 baseline, NFR-OPS-11) and each now has a response step (`runbooks/incidents.md`), but nothing fires | Wire the E1 thresholds (B3) |
| D-2 | Runbook: deploy, rollback, top incidents | ✅ | `specs/runbooks/` (this PR): deploy, rollback, severity matrix, the NFR-OPS-09 top five plus DB, config, auth and key exposure, postmortem template. **D-2a:** the operator script has no command for op/event replay or flags (routes exist). **D-2b:** no staff route to resolve a core (non-Layer 2) recon break raised by the money path | Add `staff replay-op`, `staff replay-event`, `staff flag`, and a core break-resolve route (M2, small) |
| D-3 | Support path and triage owner | ⚠️ | Static support page; no helpdesk (NFR-OPS-13, P0b). Wayne triages | Shared support inbox for the beta cohort, named in the invite |

## Enterprise tier
| # | Item | Verdict | Evidence / gap | Fix |
|---|---|---|---|---|
| G-1 | Regimes identified and mapped to controls | ⚠️ | E1 council mapped custody/MTL, consumer protection, tax, sanctions, privacy, accessibility (`specs/gates/E1-enterprise-readiness.md`); counsel answers pending (D-02, D-03) | Counsel |
| G-2 | Audit logging on sensitive actions, immutable | ✅ | Append-only audit and ledger (truncate blocked); every privileged action in `privileged_actions` + audit with reason, actor and factor | — |
| G-3 | Retention/deletion implemented | ❌ | Not built (FR-PRV-003, E1 F9; R-14). Settings page promises deletion | Pseudonymising deletion + export before **public** beta; for the closed beta, state the retention in the beta terms (accept) |
| G-4 | Required sign-offs | ❌ | M1 G2/G3, AGT G1+G2, CR-004/CR-005 self-reviews pending (I-03); counsel sign-off on user documents pending (R-05) | Wayne signs or rejects; counsel (B8) |
| G-5 | Vendor / data-processing agreements | ❌ | None on file for Supabase, Vercel, Render, Stripe, email sender, Anthropic (R-17) | File DPAs before real users (B8); keep `flag.agents` off until AGT-Q1 |
| S-10 | Threat model revisited against the built system | ⚠️ | M1 threat model (design §9) holds for checkout, webhooks, staff powers; marketplace (CR-005) and agents (CR-003) have their own designs. Not yet revisited as a whole with web headers and rate limits missing | Revisit after B4 |
| S-11 | Pen test / independent security review | N/A (M2) | NFR-SEC-10 requires an external pen test **before live money**; test-money beta exempt | Schedule before M3 |
| S-12 | Least privilege for humans and services; rotation plan | ❌ | API and worker connect as the database owner (NFR-SEC-05; R-10); agent worker has its own role ✅; Stripe key is a full test secret, not restricted | Login roles for API and worker; restricted Stripe key; 90-day rotation (before M3; accept for test money) |
| R-8 | Capacity plan validated at ≥ 2× peak | N/A (closed beta) | Beta ≤ 20 campaigns / 5k backings (A-01); P0b | Load test before public beta |
| R-9 | SLOs with error budgets | ⚠️ | Targets exist (brief metrics, NFR-PERF, E1 baseline); none measured or budgeted | Measure with B3's tool; first budget review after 30 days of beta |
| R-10 | DR plan with RTO/RPO, exercised | ❌ | NFR-OPS-02: RPO ≤ 5 min, RTO ≤ 4 h; no PITR, no drill | B1 + B5 |
| R-11 | Rollback rehearsed and timed | ❌ | See R-1 | B5 |
| O-6 | On-call staffed; escalation path | ⚠️ | Wayne primary; no backup (R-07). Severity matrix in `runbooks/incidents.md` | Name a backup who can read dashboards and post the user notice; accept single-operator for test money |
| O-7 | Change-management notice | ⚠️ | Single maintainer; recorded agent review per PR; no branch protection (R-11) | B7 |
| D-4 | Cross-team dependencies confirmed | ⚠️ | External: attorney (operating agreement, policies), custody partner (not chosen), vendors. Listed in `specs/risks.md` Dependencies | Track in the RAID log |

## Spec checks
- **Worklog deviations:** D-001 (late-capture deadline judged at processing time) still awaits Wayne's decision; FMEA F-10 depends on it.
- **NFRs with numbers:** NFR-PERF-01/02/03 are P0b and unmeasured (accepted for the closed beta). NFR-PERF-04 (P0a) unmeasured. NFR-OPS-06 (heartbeat, 5-minute check) half built: heartbeat ✅, external check ❌.
- **P0a "spec only" rows touched by this review:** NFR-SEC-03 (headers), NFR-SEC-05 (DB roles), NFR-SEC-13 (rate limits), NFR-OPS-01 (prod environment), NFR-OPS-02 (RPO/RTO), NFR-OPS-07 (one migration path, change control), NFR-OPS-09 (runbooks — **met by this PR**), NFR-OPS-11 (alert thresholds).

## Blockers for the closed beta (in order)
| # | Blocker | Items | Size | Who |
|---|---|---|---|---|
| B1 | **Production environment.** `fanzup-prod` on Supabase Pro with PITR (East US); Vercel Production env vars pointing at it, Preview at staging; a production Render worker; staging off a pausing plan (or restored and accepted as disposable) | R-2, R-10, NFR-OPS-01 | S engineering, needs billing | Wayne (accounts), engineering (config, runbook update) |
| B2 | **Exit test 8 on hosted staging** (SETUP Part F) and the runbook probes | C-3, C-5 | S | Wayne with the operator script |
| B3 | **Alerting.** Error tracker on API/worker/web; external `/api/health` monitor with the worker-age rule; alert on `level:"alert"` lines; golden-signal dashboard | O-1, O-2, O-4, O-5, R-4 | M | Engineering (code + config) after Wayne picks the tools |
| B4 | **Web hardening.** Security headers + CSP for the `web` service; rate limiting on write routes | S-7, S-8 | M | Engineering (CR) |
| B5 | **Drills.** Vercel and Render rollback, PITR restore with recon on the copy; times written in the runbook | R-1, R-10, R-11 | S | Wayne + engineering |
| B6 | **Honest web scope.** Live artist screens and landing hero (in progress elsewhere); hide every route that still reads sample data (FR-PLT-002); triage the 30 P0a "spec only" rows | C-1 | M–L | Engineering |
| B7 | **Change control and dependencies.** Protect `main` (required checks); bump `react-router` and `zod`; `pnpm audit --audit-level high` in CI | S-4, C-4, O-7 | S | Wayne (settings), engineering |
| B8 | **People and paper.** Counsel-approved beta terms and privacy notice; DPAs filed; custom SMTP; PII inventory; a named backup operator | G-4, G-5, S-9, O-6 | — | Wayne + counsel |

## Risks proposed for acceptance (closed beta, test money only)
Wayne decides at G5; none is accepted until he does.
- No pen test (S-11), no load test (C-6, R-8), no status page or helpdesk (NFR-OPS-10/13, P0b).
- API/worker on the owner DB role (S-12) and a full Stripe test key, while no real money or real card data is at stake.
- No account deletion (G-3) for an invited cohort told the retention rule in the beta terms.
- Single operator with no backup during waking hours only (O-6).
- No degrade switches (R-3a): rollback or the misconfigured-503 state is the fallback.

## Gate G5
**Status:** not signed off. Re-run this review once B1–B8 are closed or accepted; then write `specs/06-launch.md` (staged rollout: staging → invited cohort of ~5 artists and their fans → the full closed beta, with the rollback triggers in `runbooks/deploy-and-rollback.md` §5) and run the G6 pass on it.
