# Layer 2 · Album royalty Pool (CR-002) — Plan and tasks
**Status:** built (all tasks ✅ — evidence in `specs/04-worklog.md` §CR-002) · **Date:** 2026-10-03 · **Requirements:** `01-requirements.md` · **Design:** `02-design.md` · **Gate:** `../gates/L2-G1G2.md` (APPROVE WITH CONDITIONS)

Delivery as stacked PRs (base = the branch below; never `main`):
1. **Spec** — CR-002, requirements, design, ADR-007, gate record, this plan.
2. **DB + mock rails** — migrations, shared rules (policy, limit, badge, Waterfall), `apps/mock-escrow`, `RegCfProvider` + adapters, money tests.
3. **API** — routes, service, worker steps, webhooks, staff actions, seed, API tests.
4. **Web + e2e** — Layer 2 screens on real data, banner, copy lint, Playwright journeys, CI.

| ID | Task | Done when | Covers |
|---|---|---|---|
| L2-T-000 | Preflight: local Postgres for tests, `node:sqlite` under vitest, CI job layout | tests run locally; decision recorded | — |
| L2-T-001 | Shared rules: `POLICY.regCf` (verified limits, date), `POLICY.l2`, `regCfLimitMinor()`, risk badge, `allocateWaterfall()` + canonical JSON | shared tests: limit table cases, badge matrix, Waterfall W1/W2/W4 properties | FR-L2-INV-003, CR-004, WF-001 |
| L2-T-002 | Migrations: enums, core tables, ledger `pool_id` dimension, flag functions | migrations apply on fresh DB; sync tests | D-1, NFR-L2-03 |
| L2-T-003 | Offering money functions (workflow, limit, reserve, fund, settle, refund, tranches) | money tests: I1, I2, I5, E1–E5 | FR-L2-INV-003/004, ESC-001 |
| L2-T-004 | Revenue + Waterfall SQL (deposits, statements, recon, default, commit, payouts, 1099 rows) | money tests: R1–R4, R8, W3, W6; default transitions | REV-001/002, WF-001 |
| L2-T-005 | `apps/mock-escrow`: engine, HTTP server, signed webhooks, triggers, admin clock, fixtures | mock-escrow tests: auth, idempotency, async, triggers, signature | NFR-L2-02 |
| L2-T-006 | `RegCfProvider` + HTTP and in-process adapters; webhook route into the inbox; L1 recon unaffected (cond. 1) | webhook signature + idempotency tests; L1 recon zero with L2 activity | NFR-L2-01 |
| L2-T-007 | Worker: reservations expiry, settle due Pools, `l2.*` outbox, `pool_ops` runner, revenue recon, L2 recon (escrow/collection vs provider) | flow tests through ticks | ESC-001 |
| L2-T-008 | API routes (fan, creator, staff), zod contracts, rule codes, flag gate (cond. 3, 4, 6, 7) | API tests incl. flag-off 404s, authz negatives | all FR-L2 |
| L2-T-009 | Mock Form C generation + hash | test: deterministic hash; reviewer ≠ owner | CR-005 |
| L2-T-010 | Staff actions via `privileged()` (review, collection execute, KYC decide, tranche verify, distribution commit, collection state, flag) | staff tests incl. single-operator delay | ADM |
| L2-T-011 | Seed `seed_layer2.sql` + mock-escrow fixture; agreement test (cond. 8) | seed loads; L2 recon diff zero against fixture | NFR-L2-05 |
| L2-T-012 | Web: API client + `Layer2DemoBanner` + FeatureRoute integration + config flag | typecheck | D-2 |
| L2-T-013 | Web fan: `/pools`, `/pools/:id`, Form C, investor onboarding, documents → purchase, confirmation, portfolio, holding | e2e | INV-001…005 |
| L2-T-014 | Web creator: Pool wizard (one page), Pool page (submit, launch, statements, evidence) | e2e | CR-001…005 |
| L2-T-015 | Web staff: queue, Pool money view, investors | e2e (API for aal2 actions) | ADM |
| L2-T-016 | `lint:copy` for Layer 2 routes + notices | `pnpm lint:copy` clean | D-4 |
| L2-T-017 | Playwright: happy path + failed-Pool refund; CI starts mock-escrow | CI e2e green | NFR-L2-04 |
| L2-T-018 | `pnpm dev` runs mock-escrow; README/SETUP demo section | docs | — |
