# FanZuP v2 — Plan & tasks · Milestone M1 (walking skeleton)
**Implements:** `01-requirements.md` §Milestone M1 scope · **Design:** `02-design.md` (G2 pass 2: APPROVE WITH CONDITIONS) · **Date:** 2026-10-03
**Shape:** four reviewable PRs, stacked in this order. Each PR targets the previous branch so its diff shows only its own slice; GitHub retargets each to `main` as the one below it merges. Merge order: PR-A → PR-B → PR-C → PR-D.

| PR | Branch | Delivers | Tasks |
|---|---|---|---|
| PR-A | `spec/m1-skeleton` | G1 decisions, M1 scope, design, ADR-003..006, G2 record, this plan (+ `main` merged into the v2 spec work) | — |
| PR-B | `feat/m1-money-path` | Money path: policy keys, migrations, request context, provider adapter (sandbox + Stripe test), webhook inbox, checkout holds + claim-first idempotency, late-capture refunds, two-phase outbound, settlement wiring, reconciliation, worker | T-001 … T-010 |
| PR-C | `feat/m1-identity-staff` | Full-account identity (attestation, consents, verified-email gate), staff API with single-operator mode, artist API, notifications, funnel events, column allowlists | T-011 … T-017 |
| PR-D | `feat/m1-web-e2e` | Web wiring (explore, campaign, sign-up/in/verify, checkout, My backings), test-mode notice, Playwright golden journey + CI job | T-018 … T-023 |

## T-000: Environment preflight
Probed 2026-10-03 in the agent sandbox.
| # | Need | Why | Unblocks | Status |
|---|---|---|---|---|
| E1 | Push to `wayneledgister/fanzup-app`, open PRs, read CI | CI is the verification surface | every task | ✅ (git push + `gh api` work) |
| E2 | npm registry | install deps | all | ✅ |
| E3 | Postgres for tests | money-path tests against real Postgres (NFR-QA-01) | T-001…T-017 | ✅ local Postgres 16 here; CI uses Postgres 17 |
| E4 | Docker / Supabase CLI local stack | real Supabase Auth for e2e | T-022, T-023 | ⛔ here (no Docker daemon; GitHub release downloads blocked) → **e2e runs only in CI** (GitHub Actions has Docker) |
| E5 | Playwright browser | e2e | T-022 | to probe at T-022; CI installs its own |
| E6 | Stripe **test** keys (`sk_test`/`rk_test`, `pk_test`, webhook secret, Connect enabled) | exit test 8; hosted `/api` (fail closed) | manual Stripe run | ⏳ **Wayne** — Vercel/Render env + optional GitHub secrets (design §12.1). Never in the repo. |
| E7 | Hosted Supabase Auth settings (redirect `/**`, TOTP on, own account via app sign-up, staff grant) | hosted sign-up and staff actions | after merge | ⏳ **Wayne** (design §12.2) |
| E8 | Error tracker + email provider | alerting, real emails | M2 | ⏳ **Wayne** (design §12.3); M1 uses logs |
| E9 | Uptime monitor on `/api/health` | worker heartbeat paging | after deploy | ⏳ **Wayne** (design §12.4) |

## Test strategy (Enterprise, M1 slice)
- **Money path against real Postgres** (Vitest, `apps/api/test`): every SQL function through the API or worker; concurrency (parallel backings, last unit, concurrent retries of one key); duplicate, late and out-of-order events; dead-letter and replay; many campaigns with one failing; reconciliation diffs; correlation traces. Money logic tests are written **before** the code they cover (red → green).
- **Shared rules** (`packages/shared/test`): policy keys and schemas; DB ⇄ code sync tests for policy-derived constraints and legal versions.
- **Adapter contract tests:** Stripe adapter mapping on recorded Stripe payload shapes (no network).
- **E2E** (Playwright, CI only): the golden journey (M1 exit test 7).
- **Copy rules:** `pnpm lint:copy` over web + API email templates.
- Load tests, a11y automation and security scanning are M2 (not in M1 scope).

## Tasks

### PR-B — money path
#### T-001: Policy keys for M1
**Implements:** Appendix A (accepted), FR-PAY-001/004/007, FR-ID-007, FR-PRV-001 · **Depends on:** — · **Size:** S
**Done when:** every key in design §3.9 exists in `packages/shared/src/policy.ts` with its basis; shared tests assert values. **Visible result:** test output.

#### T-002: Migrations — enums, context, inbox, outbound, heartbeats, settings
**Implements:** FR-PAY-002/004, NFR-OPS-04/06, NFR-COMP-11/12 · **Depends on:** T-001 · **Size:** M
**Done when:** migrations `…0100`, `…0200` apply on a fresh DB after the existing three; truncate blocked on ledger/audit; context defaults fill audit/ledger/outbox rows. **Visible result:** test output.

#### T-003: Request context + correlation ids in API and worker
**Implements:** NFR-OPS-04, NFR-COMP-11, ADR-005 · **Depends on:** T-002 · **Size:** S
**Done when:** `x-correlation-id` accepted/generated and echoed; `asUser`/`asService` set `fanzup.*`; logs JSON with redaction (NFR-SEC-12). **Visible result:** test asserting an audit row carries the request's id.

#### T-004: Provider adapter (sandbox + Stripe test) and fail-closed env
**Implements:** FR-PAY-008, NFR-SEC-04, ADR-003 · **Depends on:** T-002 · **Size:** M
**Done when:** `PaymentProvider` interface; sandbox emits events into the inbox; Stripe adapter maps payloads and error classes (contract tests); `loadEnv` refuses deployed+sandbox, non-test keys; dev routes only when sandbox and not deployed. **Visible result:** test output.

#### T-005: Webhook inbox + event processing
**Implements:** FR-PAY-002, FR-PAY-003 (unmatched) · **Depends on:** T-004 · **Size:** M
**Done when:** signed events stored before processing; duplicates processed once; bad signature / livemode / foreign account rejected or ignored; failures retried, dead after max, replayable. **Visible result:** tests.

#### T-006: Checkout holds + claim-first idempotent backing creation
**Implements:** FR-PAY-001, FR-PAY-006, FR-BCK-004, FR-TAX-004 (cap) · **Depends on:** T-005 · **Size:** M
**Done when:** stock held at checkout; last-unit race → exactly one; parallel same-key → one backing; provider failure → resume with same key; holds expire and cancel; deadline releases holds; open-checkout cap. Tests first. **Visible result:** concurrency test output.

#### T-007: Capture, late capture, refunds through two-phase outbound
**Implements:** FR-PAY-003, FR-PAY-004, FR-DSP-001 (SQL part), FR-PAY-009 (counting) · **Depends on:** T-006 · **Size:** L→ split into capture/late-capture (T-007a) and outbound ops (T-007b)
**Done when:** captures apply only when valid; late/mismatched captures refunded in full with ledger in and out; refund op initiated before call, lookup before retry, exact amount, dead-letter at max; distinct backer counting. Tests first. **Visible result:** tests.

#### T-008: Settlement → refunds and tranche releases via outbound ops
**Implements:** FR-PAY-005, NFR-OPS-05 · **Depends on:** T-007 · **Size:** M
**Done when:** failed campaign refunds every backer through ops; funded campaign releases tranche 1 via payout op; payout amount asserted; one failing campaign doesn't block others; `wait_funds` doesn't consume attempts. **Visible result:** tests.

#### T-009: Reconciliation (processor slice)
**Implements:** FR-PAY-007, FR-PAY-009 (counters) · **Depends on:** T-008 · **Size:** M
**Done when:** per-campaign + total diff; unmatched refs both ways; counter check; breaks dedupe/auto-resolve; payout pause on material/aged break; zero diff after both journeys. **Visible result:** a recon run printed by the test.

#### T-010: Worker loop + heartbeat + health
**Implements:** NFR-OPS-05/06 · **Depends on:** T-009 · **Size:** S
**Done when:** steps in design §6 order, bounded; heartbeat; `/api/health` reports age. **Visible result:** health response in a test.

### PR-C — identity, staff, artist
#### T-011: Identity: attestation trigger, consents, verified-email gate, `/me`
**Implements:** FR-ID-001 (server), FR-ID-006, FR-PRV-001, FR-BCK-002 (server) · **Depends on:** T-006 · **Size:** M
#### T-012: Staff auth (aal2), privileged actions, single-operator delay/limits, weekly review
**Implements:** FR-ID-002 (staff), FR-ID-003, FR-ID-007 · **Depends on:** T-011 · **Size:** M
#### T-013: Staff endpoints: review, verify, refund, replay, recon, queue, trace
**Implements:** FR-CMP-002, FR-PAY-005, FR-DSP-001, FR-PAY-002/004/007, FR-ADM-001 (API slice), exit test 4 · **Depends on:** T-012 · **Size:** M
#### T-014: Artist API: artist, drafts, perks, tranches, submit, publish, evidence, payout onboarding
**Implements:** FR-CMP-001/002, FR-PAY-005, FR-ID-004 · **Depends on:** T-011 · **Size:** M (thin, G2 C9)
#### T-015: Notifications (5 templates, log transport) + copy lint over templates
**Implements:** FR-NTF-001 (M1), FR-PLT-006 · **Depends on:** T-008 · **Size:** S
#### T-016: Funnel events
**Implements:** FR-ANL-001 (events) · **Depends on:** T-011 · **Size:** S
#### T-017: Column allowlists + revoke client execute on workflow functions + tests
**Implements:** NFR-SEC-01 (slice), NFR-SEC-02 (slice), FR-PRV-004 direction · **Depends on:** T-014 · **Size:** S

### PR-D — web + e2e
#### T-018: Shared contracts (zod) for M1 endpoints; typed web API client
**Implements:** G2 C11 · **Depends on:** T-013/T-014 · **Size:** S
#### T-019: Auth in the web app (Supabase): sign-up, sign-in, verify, reset, session, guards
**Implements:** FR-ID-001, FR-ID-005, FR-BCK-002 · **Depends on:** T-018 · **Size:** M
#### T-020: Explore + campaign page on the API; test-mode notice; escrow copy on M1 paths
**Implements:** FR-CMP-003, FR-CMP-008, FR-PLT-006 · **Depends on:** T-018 · **Size:** M
#### T-021: Checkout route + confirmation; My backings on the API
**Implements:** FR-BCK-001/002/004/005, FR-PAY-009 (fan) · **Depends on:** T-019, T-020 · **Size:** M
#### T-022: Playwright golden journey
**Implements:** NFR-QA-02, exit tests 1–7 · **Depends on:** T-021 · **Size:** M
#### T-023: CI `e2e` job (Supabase CLI stack, Mailpit, API + worker + preview) — separate job, not yet required (G2 C10)
**Implements:** ADR-006 · **Depends on:** T-022 · **Size:** M

## Traceability check
Every requirement in the M1 table maps to ≥ 1 task above (design §13 gives the component view); every task cites ≥ 1 requirement or G2 condition. Items the M1 table marks "not in M1" have no task by design.

## G3 (plan) — light check
Run as a single-pass self-check rather than a full council (the brief asks for a council at G2; G3 is recorded here so it isn't silently skipped): traceability complete; T-000 lists every external dependency; the largest task (T-007) is split; the riskiest piece (T-023, CI Supabase stack) is isolated in its own job. **Wayne's G3 sign-off is pending** with G2's.
