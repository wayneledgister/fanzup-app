# FanZuP v2 — Plan & tasks · Milestone M1 (walking skeleton)
**Implements:** `01-requirements.md` §Milestone M1 scope · **Design:** `02-design.md` (G2 pass 2: APPROVE WITH CONDITIONS, plus the post-gate delta from PR #6 review rounds 1–3) · **Date:** 2026-10-11
**Shape:** four reviewable PRs, stacked in this order. Each PR targets the previous branch so its diff shows only its own slice; GitHub retargets each to `main` as the one below it merges. Merge order: PR-A → PR-B → PR-C → PR-D.

| PR | Branch | Delivers | Tasks |
|---|---|---|---|
| PR-A (#6) | `spec/m1-skeleton` | G1 decisions, M1 scope, design, ADR-003..006, G2 record, this plan (+ `main` merged into the v2 spec work) | — |
| PR-B (#7) | `feat/m1-money-path` | Money path: policy keys, migrations, request context, provider adapter (sandbox + Stripe test), webhook inbox, checkout holds + claim-first idempotency, late-capture refunds, two-phase outbound, settlement wiring, reconciliation, worker | T-001 … T-010 |
| PR-C (#8) | `feat/m1-identity-staff` | Full-account identity (attestation, consents, verified-email gate), staff API with single-operator mode, artist API, notifications, funnel events, column allowlists | T-011 … T-017 |
| PR-D (#9) | `feat/m1-web-e2e` | Web wiring (explore, campaign, sign-up/in/verify, checkout, My backings), test-mode notice, Playwright golden journey + CI job, operator script for exit test 8 | T-018 … T-024 |

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
- **Money path against real Postgres** (Vitest, `apps/api/test`): every SQL function through the API or worker; concurrency (parallel backings, last unit, concurrent retries of one key, crash between claim and hold and between hold and provider call); duplicate, late and out-of-order events; staff refund pending across the deadline (conservation holds, artist not paid refunded cents); dead-letter and replay; many campaigns with one failing; reconciliation diffs; correlation traces. Money logic tests are written **before** the code they cover (red → green).
- **Shared rules** (`packages/shared/test`): policy keys and schemas; DB ⇄ code sync tests for policy-derived constraints and legal versions.
- **Adapter contract tests:** Stripe adapter mapping on recorded Stripe payload shapes (no network).
- **E2E** (Playwright, CI only): the golden journey (M1 exit test 7).
- **Copy rules:** `pnpm lint:copy` over web + API email templates.
- Load tests, a11y automation and security scanning are M2 (not in M1 scope).

## Tasks

### PR-B — money path
#### T-001: Policy keys for M1
**Status (2026-10-11):** ✅ built and verified in PR #7 (`packages/shared/test/rules.test.ts`), incl. the review-fix keys `checkout.abandonedClaimMinutes`, `checkout.expiryLookupGraceMinutes`, `recon.inflightGraceMinutes`.
**Implements:** Appendix A (accepted), FR-PAY-001/004/007, FR-ID-007, FR-PRV-001 · **Depends on:** — · **Size:** S
**Done when:** every key in design §3.9 exists in `packages/shared/src/policy.ts` with its basis; shared tests assert values. **Visible result:** test output.

#### T-002: Migrations — enums, context, inbox, outbound, heartbeats, settings
**Status (2026-10-11):** ✅ PR #7: migrations `…0100`–`…0300` apply on a fresh DB after the existing three (every API suite); truncate blocked; context defaults tested.
**Implements:** FR-PAY-002/004, NFR-OPS-04/06, NFR-COMP-11/12 · **Depends on:** T-001 · **Size:** M
**Done when:** migrations `…0100`, `…0200` apply on a fresh DB after the existing three; truncate blocked on ledger/audit; context defaults fill audit/ledger/outbox rows. **Visible result:** test output.

#### T-003: Request context + correlation ids in API and worker
**Status (2026-10-11):** ✅ PR #7 (`checkout.test.ts` NFR-OPS-04, `money-flow.test.ts` exit test 4).
**Implements:** NFR-OPS-04, NFR-COMP-11, ADR-005 · **Depends on:** T-002 · **Size:** S
**Done when:** `x-correlation-id` accepted/generated and echoed; `asUser`/`asService` set `fanzup.*`; logs JSON with redaction (NFR-SEC-12). **Visible result:** test asserting an audit row carries the request's id.

#### T-004: Provider adapter (sandbox + Stripe test) and fail-closed env
**Status (2026-10-11):** ✅ PR #7: adapter + contract tests, `findPayment` (Stripe search / sandbox) with a recorded-payload contract test, fail-closed env with platform signals winning over `DEPLOY_ENV` (`money-rules.test.ts`), `stripe-test` + `stripe-dev` alias. Not run against the real Stripe API (no keys; exit test 8).
**Implements:** FR-PAY-008, NFR-SEC-04, ADR-003 · **Depends on:** T-002 · **Size:** M
**Done when:** `PaymentProvider` interface; sandbox emits events into the inbox; Stripe adapter maps payloads and error classes (contract tests); `loadEnv` refuses deployed+sandbox, non-test keys; dev routes only when sandbox and not deployed; `ESCROW_PROVIDER` value `stripe-dev` renamed `stripe-test`, with `stripe-dev` still accepted as an alias (env schema, adapter `name`, `/config.provider`, `.env.example`, `docs/SETUP.md` C3/D1) — design §2, §12.1. **Review round 2 (review fix — implement in PR #7):** `PaymentProvider.findPayment({ backingId })` — Stripe `paymentIntents.search` on `metadata['backing_id']`, sandbox reads its own payments — with a contract test on a recorded search payload (design §5). **Visible result:** test output.

#### T-005: Webhook inbox + event processing
**Status (2026-10-11):** ✅ PR #7: inbox + atomic claim (parallel-processing test), capture matching by `payment_ref`, `capture:<payment_ref>`, stray captures with their own refund op (second PaymentIntent, replay, campaign-only tests), foreign-account events stored `ignored` in one insert and never processed.
**Implements:** FR-PAY-002, FR-PAY-003 (unmatched) · **Depends on:** T-004 · **Size:** M
**Done when:** signed events stored before processing; duplicates processed once; bad signature / livemode / foreign account rejected or ignored; failures retried, dead after max, replayable. **Review round 2 (review fix — implement in PR #7):** `payment.succeeded` matches the backing by `payment_ref` first, then by `metadata.backing_id` only when that backing's `payment_ref` is null or equal; capture idempotency key is `capture:<payment_ref>` (today `capture:<backing>` in `apps/api/src/inbox.ts`); a stray capture (backing already has a different payment, or no backing but our `campaign_id`) goes to `apply_stray_capture` with its own refund op keyed `refund:pay:<payment_ref>` (design §3.5.1). Tests: second, different PaymentIntent for a `held` backing → refunded in full by its own op, the backing untouched, ledger balanced, recon zero; same event twice → one posting. **Review round 3 (review fix — implement in PR #7):** an event whose `account` isn't one of our artists' `payout_account_ref` is inserted with `status='ignored'`, `last_error='account_not_ours'`, `processed_at=now()` **in the same insert** (today `apps/api/src/routes/webhooks.ts` inserts it `received` via `ingestEvent` and then calls `ignoreEvent` in a second statement), answered 200; only bad signature / livemode get 400 (design §4.2, §5). Test: foreign-account event → 200, one row `ignored`, never picked up by `processPendingEvents`. **Visible result:** tests.

#### T-006: Checkout holds + claim-first idempotent backing creation
**Status (2026-10-11):** ✅ PR #7: claim + hold in one transaction, stored rule violations, 2-minute abandoned claims, terminal `checkout_expired`, conditional step 4, deterministic params; tests (a)–(f), a hold dying during the provider call, null-ref expiry lookup, deadline releasing open holds (`checkout.test.ts`).
**Implements:** FR-PAY-001, FR-PAY-006, FR-BCK-004, FR-TAX-004 (cap) · **Depends on:** T-005 · **Size:** M
**Done when:** stock held at checkout; last-unit race → exactly one; parallel same-key → one backing (the second request blocks on the unique index, then replays); claim + `create_backing_hold` in one transaction (design §4.4); rule violations (`perk_sold_out`, `campaign_closed`, caps) stored as `done` with the error and replayed identically on retry; **crash-between-steps test:** (a) failure injected after the claim insert but before the hold commits → nothing persisted, a retry with the same key creates exactly one backing; (b) process stops after the hold commits but before the provider call → a retry resumes with the stored `resource_id` and gets one PaymentIntent; (c) an `in_progress` claim with no `resource_id` older than 2 minutes is re-claimed, a younger one returns 409 `in_progress`; provider failure → resume with same key; holds expire and cancel; deadline releases holds; open-checkout cap. **Review round 2 (review fix — implement in PR #7):** (d) resume when the hold has expired (`hold_expires_at <= now()`, not yet released by the worker) or the backing is no longer `pending_payment` → terminal `409 checkout_expired`, stored as `done`, replayed on the next retry, and **no** `createPayment` call (design §4.4 step 3); (e) worker expiry of a hold with `payment_ref` null looks the PaymentIntent up by metadata and cancels it before releasing the units (design §5) — test: PaymentIntent created, ref never stored, hold expires → `findPayment` + `cancelPayment` called, then units returned. **Review round 3 (review fix — implement in PR #7):** (f) **deterministic PaymentIntent params** (design §4.4 step 3, ADR-005): one helper builds every `createPayment` input from the stored backing — `amountMinor = backings.amount_minor`, `campaignId = backings.campaign_id` (not `body.campaignId`), `description` from the backing's campaign + perk titles, `correlationId = backings.correlation_id` (not `currentCtx()?.correlationId`, `apps/api/src/checkout.ts` ~L81) — and both the first pass and the resume branch use it. Test: create a backing, make the first `createPayment` fail (502), retry the same key under a **different** `x-correlation-id` → the provider spy receives two calls whose arguments are deep-equal (same idempotency key, amount, campaign, description, `correlationId` = the first request's id). Tests first. **Visible result:** concurrency test output.

#### T-007: Capture, late capture, refunds through two-phase outbound
**Status (2026-10-11):** ✅ PR #7: counter rule, `refund_pending`-only confirmation, lock-then-check capture, `amount_mismatch`/`currency_mismatch`, mismatch assertions (1500 captured/refunded, confirm(1000) raises), outbound lookup before every call, refs kept, amount-mismatch break, confirmed ops never moved back (`checkout.test.ts`, `money-rules.test.ts`, `money-path.test.ts`).
**Implements:** FR-PAY-003, FR-PAY-004, FR-DSP-001 (SQL part), FR-PAY-009 (counting) · **Depends on:** T-006 · **Size:** L→ split into capture/late-capture (T-007a) and outbound ops (T-007b)
**Done when:** captures apply only when valid; late/mismatched captures refunded in full with ledger in and out (deadline judged at processing time, D-001; apology reason in the refund-started notification); refund op initiated before call, lookup before retry, exact amount, dead-letter at max; distinct backer counting; **counter rule** (design §3.5): `request_backing_refund` decrements `raised_minor`/`backers_count` and returns perk units when the backing moves `held → refund_pending`, `record_refund_confirmed` changes no counters and requires `refund_pending`. **Review round 2 — amount-mismatch capture (the sizing is built in PR #7; the extra column and assertions are a review fix — implement in PR #7):** add `backings.captured_currency` and set it in both branches of `apply_payment_captured`; split the reason into `amount_mismatch` / `currency_mismatch` (both open a break); extend the existing test "captured amount differs from the backing" (`apps/api/test/checkout.test.ts`) to assert `captured_minor = 1500`, `captured_currency = 'usd'`, `processing_fee_minor` = the provider fee, the provider refund call's `amountMinor = 1500` (not 1000), the `backing.refunded` posting debits `backer_liability` by 1500, and that `record_refund_confirmed(..., 1000, ...)` raises `refund_amount_mismatch`. Tests first. **Visible result:** tests.

#### T-008: Settlement → refunds and tranche releases via outbound ops
**Status (2026-10-11):** ✅ PR #7: revised `settle_campaign` + `settled_*` columns; refund-pending-at-deadline test (artist credited Σ held only, conservation, recon zero); failed-branch counters; README money-path rules (`money-rules.test.ts`, `money-flow.test.ts`).
**Implements:** FR-PAY-005, NFR-OPS-05 · **Depends on:** T-007 · **Size:** M
**Done when:** revised `settle_campaign` per design §3.5 — funded branch releases only `held` backings and moves Σ `held` (= `raised_minor`) to `artist_payable`; failed branch moves `held → refund_pending` and the campaign reaches `refunded` only when nothing is `held` or `refund_pending`; failed campaign refunds every backer through ops; funded campaign releases tranche 1 via payout op; payout amount asserted; one failing campaign doesn't block others; `wait_funds` doesn't consume attempts; **test: staff refund requested on a live campaign, deadline passes before the refund confirms** → campaign settles on the remaining `held` total, the artist is credited none of the refunded cents, the refund then confirms, ledger conservation holds (every account balances; `backer_liability` returns to 0 for that backing) and recon diffs to zero; README money-path rules updated (design §3.5). **Visible result:** tests.

#### T-009: Reconciliation (processor slice)
**Status (2026-10-11):** ✅ PR #7: liability invariant, `stray_capture_aged`, in-flight allowance, payout-pausing kinds (design §7); tests (a)–(e) + in-flight + pausing kinds (`recon.test.ts`), exit-test-3 zero diff (`money-flow.test.ts`).
**Implements:** FR-PAY-007, FR-PAY-009 (counters) · **Depends on:** T-008 · **Size:** M
**Done when:** per-campaign + total diff; unmatched refs both ways; counter check; breaks dedupe/auto-resolve; payout pause on material/aged break; zero diff after both journeys. **Review round 3 (review fix — implement in PR #7; `apps/api/src/recon.ts` has no liability check today):** per campaign, ledger `backer_liability` balance = Σ `coalesce(captured_minor, amount_minor)` over `held` + `refund_pending` backings + Σ open stray captures (a `payment.captured_stray` with no `payment.stray_refunded`); mismatch → `liability_mismatch` break that pauses payouts (add it to the auto-resolve kinds); a stray whose refund op is unconfirmed past `recon.maxBreakAgeBusinessDays` → `stray_capture_aged` money break, none before (design §3.5, §3.5.1, §7). Tests: (a) clean journeys incl. an unapplied amount-mismatch capture (captured 1500 vs expected 1000) → no liability break; (b) a hand-posted ledger entry that moves `backer_liability` without a backing → `liability_mismatch` with the exact amount and `isPayoutPaused` true; (c) stray capture with its refund op `sent`, inside the age → no break, liability matches; (d) the same stray aged past the limit → `stray_capture_aged`; (e) after the stray refund confirms → liability matches and the aged break auto-resolves. **Visible result:** a recon run printed by the test.

#### T-010: Worker loop + heartbeat + health
**Status (2026-10-11):** ✅ PR #7 (`money-flow.test.ts` health/heartbeat; worker order per design §6).
**Implements:** NFR-OPS-05/06 · **Depends on:** T-009 · **Size:** S
**Done when:** steps in design §6 order, bounded; heartbeat; `/api/health` reports age. **Visible result:** health response in a test.

### PR-C — identity, staff, artist
#### T-011: Identity: attestation trigger, consents, verified-email gate, `/me`
**Implements:** FR-ID-001 (server), FR-ID-006, FR-PRV-001, FR-BCK-002 (server) · **Depends on:** T-006 · **Size:** M
**Done when:** `handle_new_user()` refuses users without `adult_attested`, current `terms_version` and `privacy_version` and writes consents + `account_created`; **every inserter of `auth.users` carries that metadata (design §3.7):** `supabase/seed.sql` (done in PR #8 — every seeded user has the three keys), `apps/api/test/helpers.ts` `createUser()` (done; review fix — implement in PR #8: take the versions from `POLICY.legal` instead of the literal `"2026-10-03-beta"`); `apps/api/test/supabase-shim.sql` needs no change (it only creates the table; the trigger comes from migrations). **Sync test (review fix — implement in PR #8):** besides `platform_settings.legal_versions = POLICY.legal`, parse `supabase/seed.sql` and assert every seeded user's `terms_version`/`privacy_version` equals `POLICY.legal`, so a version bump that forgets the seed fails with a clear message rather than a trigger error inside `freshDb()`. Verified-email gate and `/me`.
#### T-012: Staff auth (aal2), privileged actions, single-operator delay/limits, weekly review
**Implements:** FR-ID-002 (staff), FR-ID-003, FR-ID-007 · **Depends on:** T-011 · **Size:** M
**Review round 2 (review fix — implement in PR #8):** a `backing.refund` that would be delayed is refused with `409 refund_after_deadline` when `now() + singleOperator.delayHours >= campaigns.ends_at`, and no action row is written (design §9). Test: refund above `delayAboveMinor` on a campaign ending in < 24 h → 409; the same refund on a campaign ending in > 24 h → `scheduled`.
#### T-013: Staff endpoints: review, verify, refund, replay, recon, queue, trace
**Implements:** FR-CMP-002, FR-PAY-005, FR-DSP-001, FR-PAY-002/004/007, FR-ADM-001 (API slice), exit test 4 · **Depends on:** T-012 · **Size:** M
**Review round 2 (review fix — implement in PR #8):** `GET /staff/queue?type=payouts` lists payout ops that are `initiated` with a `waiting` reason (`payout_account`, `funds`, `recon_pause`, `earlier_tranche`) so a release waiting on an artist's payout account is visible (design §3.5.2); add `payouts` to the queue-type schema.
#### T-014: Artist API: artist, drafts, perks, tranches, submit, publish, evidence, payout onboarding
**Implements:** FR-CMP-001/002, FR-PAY-005, FR-ID-004 · **Depends on:** T-011 · **Size:** M (thin, G2 C9)
**Behaviour (built in PR #8, `apps/api/src/routes/artist.ts`; design §3.5.2):** `POST /artist/payout-account` sets `identity_status` to `verified` when the provider reports the account ready (`payouts_enabled`; sandbox immediately), else `pending` with an onboarding URL; the artist calls it again after onboarding. Submit therefore requires a ready payout account. No `account.updated` handling in M1. A payout op with no payout account waits (`waiting='payout_account'`), never a break. Test to keep: release with `payout_account_ref` null → op stays `initiated`/waiting, attempts unchanged, no recon break, other campaigns' payouts proceed.
#### T-015: Notifications (5 templates, log transport) + copy lint over templates
**Implements:** FR-NTF-001 (M1), FR-PLT-006 · **Depends on:** T-008 · **Size:** S
**Done when:** the five `notify.*` topics each produce one `notifications` row with template + version via the log transport (no address stored), the refund-started email carries the reason (incl. `captured_after_deadline`), and `pnpm lint:copy` scans the templates and passes.
#### T-016: Funnel events
**Implements:** FR-ANL-001 (events) · **Depends on:** T-011 · **Size:** S
**Done when:** `perk_selected`, `checkout_started` (via bounded `POST /events`), `account_created` and `backing_confirmed` (server-emitted) land in `funnel_events` with sanitised `source`, and a test rejects oversized bodies, unknown names and non-public campaigns.
#### T-017: Column allowlists + revoke client execute on workflow functions + tests
**Implements:** NFR-SEC-01 (slice), NFR-SEC-02 (slice), NFR-SEC-07, FR-PRV-004 direction · **Depends on:** T-014 · **Size:** S
**Done when:** column-set test per role; internal tables unreadable; guard test that no file in `.github/workflows/` passes `--include-seed` and no migration inserts into `public.staff` (NFR-SEC-07, design §9).

### PR-D — web + e2e
#### T-018: Shared contracts (zod) for M1 endpoints; typed web API client
**Implements:** G2 C11 · **Depends on:** T-013/T-014 · **Size:** S
**Done when:** every M1 request/response in design §4.2 is a zod schema in `packages/shared/src/schemas.ts` used by both the API routes and the typed web client, and `pnpm typecheck` passes across the workspace.
#### T-019: Auth in the web app (Supabase): sign-up, sign-in, verify, reset, session, guards
**Implements:** FR-ID-001, FR-ID-005, FR-BCK-002, G2 C17 · **Depends on:** T-018 · **Size:** M
**Done when:** the four auth pages work against Supabase Auth with `next` preserved; guards on checkout and My backings; **G2 C17:** `supabase/config.toml` `additional_redirect_urls` includes `http://127.0.0.1:5173/**` and `http://localhost:5173/**` (design §12.2), so a confirmation link carrying a `next` path redirects locally and in CI.
#### T-020: Explore + campaign page on the API; test-mode notice; escrow copy on M1 paths
**Implements:** FR-CMP-003, FR-CMP-008, FR-PLT-006, FR-BCK-004 (display) · **Depends on:** T-018 · **Size:** M
**Done when:** explore and campaign page read the API (design §11); campaign page shows the deadline in local time with the zone and, **under 24 h, hours and minutes left**, updating each minute (FR-BCK-004); test-mode notice and FR-PLT-006 copy on M1 paths.
#### T-021: Checkout route + confirmation; My backings on the API
**Implements:** FR-BCK-001/002/004/005, FR-PAY-009 (fan) · **Depends on:** T-019, T-020 · **Size:** M
**Done when:** checkout creates, pays and confirms a backing (sandbox form / Payment Element), shows the §4.3 failure categories, and `/backed` renders `GET /me/backings`; **review round 3 (review fix — implement in PR #9):** the Idempotency-Key lifecycle of design §11 — today `apps/web/src/pages/fan/Checkout.tsx` clears the `sessionStorage` key only on confirmation, so a stored 4xx is replayed forever for that campaign/perk/qty; clear it in the `api.back` catch on any 4xx and when polling sees the backing expired/canceled/refunded — a unit test on the checkout key helper asserts a new key after each stored 4xx (`checkout_expired`, `acceptance_required`, `too_many_open_checkouts`, `perk_sold_out`, `campaign_closed`) and after the backing is expired/canceled/refunded, and the same key after 502 `provider_unavailable`, 409 `in_progress` or a network error.
#### T-022: Playwright golden journey
**Implements:** NFR-QA-02, exit tests 1–7 · **Depends on:** T-021 · **Size:** M
**Done when:** one Playwright spec walks sign-up → email confirm (Mailpit) → checkout → held → deadline tick → settled outcome → `/backed` shows the money state, green locally against the CLI stack.
#### T-023: CI `e2e` job (Supabase CLI stack, Mailpit, API + worker + preview) — separate job, not yet required (G2 C10)
**Implements:** ADR-006 · **Depends on:** T-022 · **Size:** M
**Done when:** the `e2e` GitHub Actions job starts the Supabase CLI stack, API, worker and web preview, runs T-022's spec plus a re-key e2e assertion (an expired checkout retried in the browser gets a new Idempotency-Key and a new backing — review fix, implement in PR #9), uploads the trace on failure, and is green on PR #9.
#### T-024: Operator script for exit test 8 (review round 2 — review fix, implement in PR #9)
**Implements:** exit test 8, FR-ID-002 (staff), FR-ID-007 · **Depends on:** T-022 · **Size:** S
**Done when:** `pnpm m1:operator` (`scripts/m1-operator.ts`) runs the commands in design §12.6 against `--api <url>`: `totp-enrol`, `token`, `artist-setup`, `publish`, `evidence`, `staff review|verify|refund|recon|trace`. It reuses `e2e/support.ts`'s Supabase MFA flow but reads the email from a flag and the password/TOTP code from a prompt (nothing secret in the repo or shell history), keeps tokens in memory only, prints correlation ids, and is documented in `docs/SETUP.md` (exit test 8). A CI smoke run against the local stack exercises `token` + one staff read. **Visible result:** a recorded run in the worklog.

## Traceability check
Every requirement in the M1 table maps to ≥ 1 task above (exit test 8 → T-024) (design §13 gives the component view); every task cites ≥ 1 requirement or G2 condition. Items the M1 table marks "not in M1" have no task by design.

## G3 (plan) — light check
Run as a single-pass self-check rather than a full council (the brief asks for a council at G2; G3 is recorded here so it isn't silently skipped): traceability complete; T-000 lists every external dependency; the largest task (T-007) is split; the riskiest piece (T-023, CI Supabase stack) is isolated in its own job. **Wayne's G3 sign-off is pending** with G2's.
