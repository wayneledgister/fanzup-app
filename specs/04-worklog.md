# Worklog · M1 walking skeleton
Labels: ✅ built and verified here (how) · 🟡 partial (what remains) · ⏳ not started · ⛔ blocked (on what)

## 2026-10-03
- Spec: G1 decisions recorded; M1 scope moved into requirements; design + ADR-003..006; G2 pass 1 (REVISE, doc fixes) → pass 2 APPROVE WITH CONDITIONS; plan written.

## 2026-10-11
- PR #6 review round 1: merged `main` (4a18c1b Vercel API entry as CommonJS `dist/server.cjs`, fixes hosted /api 500; c38ffe1 gitignore) into `spec/m1-skeleton`; design, tasks and M1 table revised (see the PR's "Review round 1 fixes"); seed removed from the hosted deploy path.

- PR #6 review round 2: design/tasks aligned with what PRs #7–#9 build (seed metadata, payout-account readiness, refund sizing, refund-confirmation events, webhook list); behaviour the code doesn't have yet specified and added to tasks as "review fix — implement in PR #N" (stray captures, terminal `checkout_expired`, null-ref hold lookup, delayed-refund deadline check, staff `payouts` queue, seed-version sync test, operator script T-024). G2 record gains a post-gate delta. D-001 moved to open decisions for Wayne.

- PR #6 review round 3: deterministic PaymentIntent params from the stored backing (`metadata.correlation_id = backings.correlation_id`); `backer_liability` invariant incl. `captured_minor` and open stray captures, strays resolved by their refund op (aged → `stray_capture_aged` break); unknown-connected-account webhooks stored `ignored` in one insert, 200; client re-keys after stored 4xx; FR-PRV-001 M1 row trimmed (G-1); carried G1/G2 conditions in `backlog.md`; hosted seed check (design §12.7, SETUP B3a); "Done when" on T-015/016/018/021/022/023. Code items tracked as review fixes for PR #7 (T-005, T-006, T-009) and PR #9 (T-021, T-023).

## Open decisions (Wayne)
| # | Question | Default in M1 until you decide | Where |
|---|---|---|---|
| D-001 | Should a payment Stripe captured **before** the deadline but processed **after** it count, or be refunded? It is fan-facing: the fan sees "backed" in Stripe's flow, then gets a refund-started email with an apology. | Processing time decides; such payments are refunded in full (D-001 below) | design §3.5, FR-BCK-004 row |
| G2/G3 | Sign off the design (including the post-gate delta) and the light plan check | Work proceeds | `gates/G2-design.md` |

## Decisions
| # | Date | Decision | Why | Revisit |
|---|---|---|---|---|
| D-001 | 2026-10-11 (**open — needs Wayne's confirmation**) | **Late-capture timing is judged at processing time (M1 simplification).** `apply_payment_captured` checks the deadline against `now()` when the provider event is processed, not Stripe's capture timestamp. A payment Stripe captured before the deadline but processed after it is refunded in full automatically, and the fan's "refund started" email apologises and gives the reason. | One clock we control; no trust in event timestamps; the failure mode is a full refund, never a stranded or unaccounted payment (FR-PAY-003). Rare at M1 volume (webhooks usually arrive in seconds). | With the custodian (FR-PAY-010): whether capture time should decide, and how much grace to allow. |

## Evidence
| Suite | How run | Last result | Date |
|---|---|---|---|
| shared + API (baseline before M1) | `pnpm test`, local Postgres 16 | 29/29 green | 2026-10-03 |
| shared (PR-B) | `pnpm --filter @fanzup/shared test` | 7/7 green | 2026-10-03 |
| API (PR-B) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 61/61 green | 2026-10-03 |
| CI PR-A #6, PR-B #7 | GitHub Actions (Postgres 17) | web ✅ api ✅ | 2026-10-03 |
| API (PR-C) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 81/81 green | 2026-10-03 |
| shared (PR #7 review fixes) | `pnpm --filter @fanzup/shared test` | 7/7 green | 2026-10-11 |
| API (PR #7 review fixes) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 91/91 green (7 files) | 2026-10-11 |
| typecheck | `pnpm -r typecheck` | clean | 2026-10-11 |
| API (PR #8 review fixes, after merging main) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 143/143 green (11 files) | 2026-10-11 |
| shared, typecheck, copy lint (PR #8 review fixes) | `pnpm --filter @fanzup/shared test`, `pnpm -r typecheck`, `pnpm --filter @fanzup/web lint:copy` | 7/7, clean, clean | 2026-10-11 |
| API (PR #9 review fixes, after merging main) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 151/151 green (13 files) | 2026-10-11 |
| shared, typecheck, copy lint, web build (PR #9) | `pnpm --filter @fanzup/shared test`, `pnpm -r typecheck`, `lint:copy`, `pnpm --filter @fanzup/web build` | 33/33, clean, clean, built | 2026-10-11 |
| CI PR #9 at `aa1d310` | GitHub Actions: Web, API (Postgres 17, 13 files), **E2E · golden journey** (Supabase CLI 2.119.0 stack: operator smoke 6/6, Playwright 1 passed first attempt), GitGuardian | all ✅ | 2026-10-11 |

## Not run here
- `supabase start` (no Docker here) — runs only in CI; locally the e2e ran against GoTrue built from source.
- Anything against Stripe's real test API (no keys): adapter calls, Connect onboarding, Payment Element.

## 2026-10-03 · PR-B money path
- T-001 ✅ policy keys (Appendix A) — shared tests 7/7, run here
- T-002 ✅ migrations 0100–0300 apply on a fresh DB after the existing three — every API suite runs them, run here
- T-003 ✅ request context + correlation ids — `money-flow` "correlation ids", `checkout` NFR-OPS-04 tests, run here
- T-004 ✅ provider adapter (sandbox + Stripe test), fail-closed env — `money-flow` env tests + Stripe adapter contract tests, run here. Stripe adapter against the real Stripe API: **not run** (no keys; exit test 8)
- T-005 ✅ webhook inbox — duplicate/unmatched/dead-letter tests + Stripe signature/livemode/foreign-account route test, run here
- T-006 ✅ checkout holds + claim-first idempotency — last-unit race (6 fans), 5× same key, provider-failure resume, hold expiry, open-checkout cap, run here
- T-007 ✅ capture / late capture / refunds via two-phase ops — late capture after deadline, amount mismatch + break, "provider acted then timed out" lookup, dead letter at 8, staff refund, run here
- T-008 ✅ settlement → refunds and tranche releases — funded (both tranches) and failed (3 backers) journeys, wait_funds/permanent classes, one failing campaign isolated, run here
- T-009 ✅ reconciliation — zero diff after both journeys; stray provider movement → breaks + payout pause; override; business days, run here
- T-010 ✅ worker tick + heartbeat + `/api/health` age, run here
- Deviation D-004 (was numbered D-001 before main's D-001 took the number): design §3 split migrations as 0300 money / 0400 staff+recon; built recon tables and tranche evidence in 0300 (they belong to the money path in PR-B) and identity/staff in 0400. Spec impact: design §3 table updated.
- Deviation D-005: `payment.failed` events don't mark the backing failed (Stripe lets the fan retry the same payment; the hold expiry cleans up). Design §5 didn't specify; no requirement impact.
- Deviation D-006: the sandbox's "available balance" for transfers is platform-wide, like Stripe's. No requirement impact.

## 2026-10-11 · PR #7 brought up to the revised spec (PR #6 merged) + review round 1 fixes
- Merged `main` (PR #6) into `feat/m1-money-path`; spec/doc conflicts resolved to main's text (design §3 migration table and SETUP C4 keep the as-built notes).
- T-001 ✅ new policy keys `checkout.abandonedClaimMinutes` (2), `checkout.expiryLookupGraceMinutes` (5), `recon.inflightGraceMinutes` (30) — shared tests, run here
- T-002 ✅ migrations edited in place (unmerged): `provider_events` `processing` + `lease_until`, `api_idempotency.claimed_at`, `backings.captured_currency`, `outbound_ops.payment_ref` — every API suite applies them, run here
- T-004 ✅ `findPayment` (Stripe `paymentIntents.search` on metadata; sandbox lookup) + contract test on a recorded search payload; `isDeployed`: platform signals win over `DEPLOY_ENV` (test), `stripe-test` with `stripe-dev` alias — run here. Real Stripe API: **not run** (no keys)
- T-005 ✅ atomic inbox claim (parallel-processing test: one posting, backing held); capture match by `payment_ref` first; `capture:<payment_ref>`; stray captures (`apply_stray_capture`, own refund op, `record_stray_refund_confirmed`) — second PaymentIntent, replay, campaign-only stray tests; foreign-account webhook inserted `ignored` in one statement, 200, never processed — run here
- T-006 ✅ claim + hold in one transaction; stored rule violations; 2-minute abandoned claims; resume guard (stored `checkout_expired`); conditional step 4 + cancel; `paymentParamsFor`; tests (a)–(f) + hold dying during the provider call + null-ref expiry lookup + deadline releasing open holds — run here
- T-007 ✅ counter rule (`leave_held_for_refund`); `record_refund_confirmed` requires `refund_pending`; lock-then-check in `apply_payment_captured`; `amount_mismatch`/`currency_mismatch`; mismatch test asserts captured 1500 / fee / refund 1500 / liability debit 1500 / confirm(1000) raises; outbound looks up before every call, keeps provider refs, amount mismatches fail + break, permanent = failed + alert only, confirmed ops never moved back (`transfer.created` race test), refund-event amount mismatch → op failed + break — run here
- T-008 ✅ revised `settle_campaign` (+ `settled_raised_minor`/`settled_backers_count`); refund pending at the deadline: artist credited Σ held only, refund finishes, conservation + recon zero; failed branch counters fall at settlement — run here; README money-path rules added
- T-009 ✅ liability invariant (`liability_mismatch`), `stray_capture_aged`, in-flight allowance, explicit payout-pausing kinds (design §7) — T-009 (a)–(e) + in-flight + pausing-kinds tests, run here
- T-010 ✅ unchanged (worker order per §6; heartbeat; health)
- Deviation D-007: migrations `…0200`/`…0300` were edited in place rather than adding a fix-up migration — PR #7 is unmerged and nothing outside local/CI has applied them. If a preview branch ever applied them, reset it.
- Deviation D-008: the sandbox gained a `topUp()` test hook (platform money for the fees FanZuP absorbs on refunds; a platform-wide balance holding only backers' money runs short by those fees, so payouts would wait for funds). Test-only; no requirement impact.
- Note: `settle_campaign` now raises (and the worker logs `settlement.failed` for that campaign only) if `raised_minor` ≠ Σ held — a counter drift stops settlement instead of paying a wrong amount.

## 2026-10-11 · PR #7 review round 2 fixes (independent review of ab023a2)
- [major] Render worker no longer crash-loops: `loadEnv(src, { requireWebhookSecret })` — only the API (`server.ts`) requires `STRIPE_WEBHOOK_SECRET` when deployed; `worker.ts` doesn't. `render.yaml` comment and SETUP D2 list exactly what the worker needs (no webhook secret). Tests: the Render worker env (render.yaml + D2 vars + `RENDER`) loads; the deployed API env without the secret still throws — run here
- [minor] Lock order campaign → backing(s) → perk in `apply_payment_captured`, `leave_held_for_refund`, `request_backing_refund`, `record_refund_confirmed` (campaign_id read unlocked first) and `create_backing_hold` (`for key share` on the campaign before the perk), matching `settle_campaign`. Test: with the campaign locked (settlement's first step), a capture waits on the campaign and the backings can still be locked `nowait` — run here
- [minor] `isDeployed`: `VERCEL_ENV` counts only as `production`/`preview` (`vercel dev` sets `development`) — test, run here
- [minor] Backfill of pre-M1 rows in migrations 0200/0300: `counted`, `units_held` (held/released only — pre-M1 claimed units at capture, so a pre-M1 `pending_payment` row reserved none; deviates from the review's suggested `pending_payment` = true, which would double-return units), `captured_minor`/`captured_currency`, expiry for pre-M1 pending rows, `settled_raised_minor`/`settled_backers_count` for settled campaigns, failed campaigns' held backings → `refund_pending`, counters recomputed. `migration-backfill.test.ts` (3 tests), run here
- [minor] Fee corrections (`fee.adjusted`, FR-PAY-007 bullet 4) are **not built**: design §7 now says deferred, requirements M1 table says "Not in M1", backlog row added
- [nit] `record_tranche_released` locks campaign → tranche before the idempotency check; concurrent duplicate confirmations all return the amount and post once — test, run here
- [nit] Inbox outcome writes are conditional on `status = 'processing'` and the claim's `claim_token` (new column, fresh per claim); a processor that lost its claim logs `provider_event.claim_lost` and changes nothing — test, run here
- Totals: API 100/100 (8 files), shared 7/7, `pnpm -r typecheck` clean, API build OK — run here

## 2026-10-11 · PR #7 review round 3 fixes (independent review of 27167f2)
- [blocker] Stale payout amount: `ensurePayoutOp` creates a tranche's op only once every earlier tranche is released; `record_tranche_released` locks the next tranche and re-queues `tranche.release` if it is verified; `runOp` re-derives `tranche_release_amount()` right before the transfer and updates the op amount in the transaction that sets the new `outbound_ops.call_started_at`; after a call has started a changed amount fails the op (`payout_amount_changed`) instead of sending. Refund ops checked: their amount (`captured_minor` / stray capture amount) can't change after the op exists — no change. Tests (`payout-tranches.test.ts`): the reviewer's scenario (no payout account, tranche 2 verified while tranche 1 waits, account added, balance topped up → transfers = per-tranche amounts, both released, `artist_payable` 0, no break); a stale op created early is re-sized; a started call with a changed amount fails without sending — run here (the first fails on 27167f2)
- [minor] `apply_payment_captured` returns `'duplicate'` when the backing already has this `payment_ref` and is held/released/refund_pending/refunded (pre-M1 captures were keyed `capture:<backing_id>`). Test in `migration-backfill.test.ts` (pre-M1 postings keyed by backing, then replays) — run here (fails on 27167f2). Design backfill paragraph: hand check of pre-M1 refunds in flight before deploy
- Design §3.3, §3.5, §3.5.1, §3.5.2, §5 and README money-path rules updated
- Totals: API 104/104 (9 files), shared 7/7, `pnpm -r typecheck` clean — run here

## 2026-10-03 · PR-C identity, staff, artist
- CI on PR-A (#6) and PR-B (#7): ✅ both jobs green (GitHub Actions, Postgres 17)
- T-011 ✅ identity: attestation trigger, consents, verified-email gate, `/me`, re-acceptance with IP/UA — `identity-staff` tests, run here
- T-012 ✅ staff `aal2`, privileged actions, single-operator delay/limits/cancel, weekly review + sign-off — run here
- T-013 ✅ staff endpoints: review, verify, refund, replay (event/op), recon run/latest/override, queue, trace — run here
- T-014 ✅ artist API: profile, payout onboarding (sandbox), draft CRUD, perks, tranches, submit, publish, evidence; cross-artist isolation — run here. Stripe Connect onboarding against Stripe: **not run** (no keys)
- T-015 ✅ notifications: 6 templates (5 M1 messages + "refund started" for auto/staff refunds), versioned, log transport, test-mode footer; `lint:copy` now scans API templates — run here
- T-016 ✅ funnel events: account_created (trigger), checkout_started + backing_confirmed (backing trigger), perk_selected (`POST /events`, bounded) — run here
- T-017 ✅ column allowlists (artists, profiles) + no client access to any new internal table + clients can't call workflow functions — `rls` tests, run here
- Deviation D-009 (numbered D-004 before the merge with main): FR-ID-004 (M1) — the artist's identity status becomes `verified` when the provider reports the payout account ready (Stripe Connect performs KYC in its hosted onboarding; the sandbox connects at once). Design §4.2 implied it; now explicit. Spec impact: none (FR-ID-004 already says identity and payout setup run through the provider's hosted flow).
- Deviation D-010 (numbered D-005 before the merge with main): `checkout_started` is recorded server-side when the backing hold is created; the web app only sends `perk_selected` (Pragmatist G2 nit). Spec impact: none.

## 2026-10-11 · PR #8 brought up to `main` (PRs #6, #7 merged) + review round 1 fixes and tracked spec changes
- Merged `origin/main` into `feat/m1-identity-staff`. Only `specs/04-worklog.md` conflicted (kept main's sections; PR-C deviations renumbered D-009/D-010). PR #8 doesn't redefine any money function PR #7 rewrote (`request_backing_refund`, settlement, captures stay PR #7's; notifications hang off PR #7's outbox rows), so no money SQL needed re-applying. All 124 tests green right after the merge.
- [major] 1 · Atomic claims: new `privileged_actions.status` `executing`; immediate actions inserted `executing`; `executeDueActions` claims `scheduled → executing` with `for update skip locked`; final updates conditional on `executing`; cancel only from `scheduled` (one transaction with its audit row). Tests: cancelled → never executed; claimed → cancel 409 and not re-picked; cancel racing the executor ×5 → exactly one wins; two concurrent executors → one run — run here
- [minor] 2 · Reason test uses a real held backing → 400 `reason_required`, no action row, backing still `held` — run here
- [minor] 3 · Tests added: milestone verification above $1,000 → scheduled for `delayHours`, then executed; failed-campaign settle → `campaign_failed_refund_started` + `refund_completed` (not to a backer refunded earlier); staff refund → `refund_started` + `refund_completed`; failed action → `staff.<action>.failed` — run here
- [minor] 4 · `staff.<action>.failed` audit event with `{ error_code }` only (NFR-COMP-11) — run here
- [minor] 5 · `GET /staff/queue` returns `singleOperatorMode` — run here
- [minor] 6 · `artists_no_staff_owner` trigger (insert or owner change) refuses a staff owner while single-operator mode is on; `staff_cannot_own` → 403. Test: insert as the staff user through `authenticated` (the Supabase REST path) refused; a non-staff user can still insert — run here
- [minor] 7 · Daily-limit check + insert in one transaction under `pg_advisory_xact_lock(hashtext('privileged_actions:<action>'))`; `executing` counts toward the limit. Test: two concurrent refunds that each fit but not together → one 200, one `daily_limit` — run here
- [minor] 8 · Notifications: redelivery re-sends unless `sent`. Failed-campaign recipients = backings with `captured_minor` whose settlement refund was queued with reason `campaign_failed` (outbox), whatever their refund status. **Found while fixing:** the old query (`status in ('held','released')`) matched nobody after PR #7's settlement moves backings to `refund_pending`, so no backer got the failed-campaign email — now tested — run here
- [minor] 9 · `POST /events` accepts only `perk_selected`; design §4.2/§4.4 updated — run here
- [nit] 10 · Weekly sign-off requires a typed `reason`; the `weekly_review.signoff` executor inserts the sign-off row (duplicate → action `failed` + 409 `already_signed`) — run here
- [nit] 11 · Design §3.7: three consent rows (attestation, terms, privacy) and `privacy_version` required
- [nit] 12 · `trustProxy` trusts one hop (`TRUSTED_PROXY_HOPS = 1`, Vercel); a function form because Fastify's types here don't accept a number. Test: `X-Forwarded-For: <client-written>, <proxy-seen>` → consent IP is the right-most — run here. Design §9
- 13 · Delayed `backing.refund` with `now() + delayHours >= ends_at` → 409 `refund_after_deadline`, no row; both sides tested — run here
- 14 · `payouts` queue branch (`Payout waiting (<waiting>)`) + `StaffQueueType` in `packages/shared/src/schemas.ts` (unknown type → 400) — run here
- 15 · `sync.test.ts` parses `supabase/seed.sql` (every `auth.users` row) against `POLICY.legal`; `createUser()` uses `POLICY.legal` — run here
- 16 · Guard test in `rls.test.ts`: no workflow passes `--include-seed`; no migration inserts into `public.staff` — run here
- 17 · Requirements M1 table: FR-ID-006 → bullet 1 only, bullets 2–3 "Not in M1" + backlog row; FR-BCK-001 trim reworded (physical perks may exist, no address collected, test-mode perks aren't owed — FR-PLT-006); no code change, tracked in T-014
- Also: `currency_mismatch` refund reason has a sentence in `refund_started` (PR #7 added the code)
- Deviation D-011: single-operator mode is visible (`GET /staff/queue`) but toggling it stays a SQL-only change (`update platform_settings set value = 'false' where key = 'single_operator_mode'`) with no audit row of its own. FR-ID-007 asks for "a visible, audited platform setting"; an audited toggle endpoint is M2 with the second staff member. Spec impact: none beyond the M1 trim noted here.
- Deviation D-012: migration `…0400` edited in place (status `executing`, `single_operator_mode()`, staff-owner trigger) rather than a fix-up migration — PR #8 is unmerged and nothing outside local/CI has applied it (same reasoning as D-007).
- Not done: an action left `executing` by a crashed process is not re-run automatically (by design — it may have moved money); it shows on the `scheduled` queue as "stuck executing" after 15 minutes and is resolved by hand.
- Totals: API 143/143 (11 files), shared 7/7, `pnpm -r typecheck` clean, `lint:copy` clean — run here

## 2026-10-03 · PR-D (#9) web + e2e (as first opened; deviations renumbered after the merge with main)
- T-018 ✅ M1 contracts as zod schemas in `packages/shared/src/schemas.ts`, used by the API (requests) and the web client (types) — typecheck, run here
- T-019 ✅ Supabase Auth in the web app: sign-up (name, email, password, 18+, terms), verify-email (link → back to `next`; resend; cross-device "continue"), log in (+ TOTP step for staff), reset password, session context, guards — run in a local e2e harness against GoTrue built from source
- T-020 ✅ Explore and campaign page on the API (live/funded tabs, type filter, paging; artist's own story/risks/milestones only; local-time deadline; test-mode notice; refund-promise copy without "escrow") — run here (e2e + screenshots at Pixel 7 width)
- T-021 ✅ checkout route (hold countdown, quantity, total, charge timing, re-acceptance, Stripe Payment Element / sandbox card form, failure categories, confirmation) and My backings on the API — run here (e2e)
- T-022 ✅ Playwright golden journey — passed locally 3× from a fresh database (GoTrue + mail sink + gateway harness mirroring the Supabase CLI stack)
- Bug found by e2e and fixed: `Intl.DateTimeFormat` rejects `dateStyle` + `timeZoneName` → campaign page crashed; new `formatInstant()`.
- Bug found by screenshots and fixed: My backings refund line overflowed at phone width.
- Deviation D-013 (was D-006 in the first PR #9): FanZuP absorbs the processing fee on refunds (E1-C default), so the processor balance runs short of what artists are owed unless FanZuP keeps a float there; design §12.1 tells Wayne to keep one on Stripe. Spec impact: none (setup step added). (After the merge with main the sandbox models this with main's `topUp()` hook, D-008, exposed to the e2e as `POST /dev/sandbox/topup` — see the review-fix section below.)
- Deviation D-014 (was D-007): added `GET /artist/campaigns/:id` (milestone ids are needed to submit evidence). Design §4.2 updated.
- Deviation D-015 (was D-008): `/checkout/:slug` lives in the public shell (a signed-out fan arriving from a link sees the same chrome as the campaign page); guarded inside the page. Design §11 updated.

## 2026-10-11 · PR #9 brought up to `main` (PRs #6, #7, #8 merged) + review fixes
- Merged `origin/main` (merge commit `5193b40`). Conflicts: `.gitignore`, `apps/api/src/routes/me.ts`, `apps/api/src/staff.ts`, `packages/shared/src/schemas.ts`, `specs/02-design.md`, `specs/04-worklog.md`, `specs/session-state.md`. Main kept for `apps/api`/specs; #9's intent re-applied: `correlationId` on staff `action` results, `GET /artist/campaigns/:id` design row, checkout in the public shell, platform-float note. #9's hard-coded sandbox float dropped for main's `topUp()` (D-008) + a dev `topup` route. `FunnelEventRequest` narrowed to `perk_selected` (PR #8 review fix 9). CI's API entry is now `dist/server.cjs` (main's build).
- [major] 1 · Checkout Idempotency-Key lifecycle: `packages/shared/src/checkout-key.ts` (new key after any 4xx; after expired/canceled/payment_failed/refund_pending/refunded; kept after 502, 409 `in_progress`, network, other 5xx) — 23 unit cases in `checkout-key.test.ts`, run here. `Checkout.tsx` re-reads the backing after a failed payment and while polling; a dead backing → review step with a new key. E2E: an expired hold (sandbox tick +20 min) → pay fails "expired" → "Continue to payment" sends a different key and gets a different backing — green in CI
- [minor] 2 · "Recently funded" = `funded`, `released`, or `closed` with a released tranche — `discovery.test.ts`, run here
- [minor] 3 · Live order `ends_at asc, created_at desc, id asc`; cursor carries the full sort key; `limit` 1–24. **Found while testing:** postgres.js turned a timestamptz parameter into a JS `Date` (milliseconds), so a row never equalled its own cursor and paging repeated the first page — cursor values are now bound as text. Paging-with-ties test at page sizes 1, 2, 3 — run here
- [minor] 4 · `staffToken()` deletes the seed reviewer's verified TOTP factors through the Auth admin API (`SUPABASE_SERVICE_ROLE_KEY`, local stack) and enrols afresh; retries stay at 1 in CI. Exercised in CI: the operator smoke leaves a verified factor before the journey runs
- [minor] 5 · Verify-email polls `GET /me` every 5 s while signed in and unverified (stops on success/unmount); "continue" checks `GET /me` too. No automated test (needs a second session in the e2e)
- [minor] 6 · T-023 ✅ — CI at `aa1d310`, all jobs green (Evidence table)
- [minor] 7 · My backings error copy: "This is a display problem; your backings haven't changed."
- [nit] 8 · Exit test 4 traces added (e2e + `trace.test.ts`): each settlement has its own correlation id (returned by the tick) — funded: `campaign.settled` → payout op confirmed → `campaign.funded` + `tranche.released`; failed: `campaign.settled` → refund op confirmed → `backing.refunded`; verification → tranche-2 payout → `tranche.released`
- 9 · `GET /config.legal` (`POLICY.legal`); sign-up reads it; checkout re-acceptance uses `GET /me.legal` — API test, run here
- 10 · `supabase/config.toml` redirect patterns `http://{localhost,127.0.0.1}:{5173,4173}/**` (already in #9); the sign-up link `<origin>/verify-email?next=<path>` is covered; the CI e2e runs the link → checkout path on 4173
- 11 · FR-BCK-004: `timeLeft()` in `packages/shared/src/campaign.ts` (unit-tested: days from 24 h, `Xh Ym` under 24 h, ended at the instant); the campaign page re-renders every 30 s and exactly at the deadline; the progress bar's "Nd left" hides under 24 h
- 12 · T-024 operator script + `pnpm m1:operator` + `docs/SETUP.md` Part F + CI smoke (6/6 green). Not exercised automatically: `artist-setup`, `publish`, `evidence`, staff write commands (the same endpoints are covered by the golden journey)
- 13 · Physical perks: checkout and confirmation say no shipping address is collected in the test-money beta and test-mode perks aren't owed; no shipping promise
- **Found by the e2e and fixed (`aa1d310`):** the platform float (sandbox top-up) appeared as the total recon diff (+$1,000; +$2,000 on the retry). Unattributed `adjustment` balance transactions are now excluded from `providerTotalMinor`/`diffMinor` and reported as `platformAdjustmentsMinor` (design §7). Same effect on Stripe for exit test 8. Test in `money-flow.test.ts`, run here
- Totals: API 151/151 (13 files), shared 33/33, typecheck clean, `lint:copy` clean, web build OK — run here; CI all green at `aa1d310`
- Not done: exit test 8 itself (needs Stripe test keys and the hosted app — Wayne); Payment Element path never run; the e2e job is still not a required check.

## 2026-10-11 · PR #9 review round 2 fixes (independent review of e01e9cf)
- [major] 1 · Recon float narrowed: Stripe `topup` and the sandbox top-up map to `platform_topup`, the only type excluded from the total diff; payout/`stripe_fee`/dispute/fee corrections stay `adjustment`, count in the total diff and open `unmatched_provider_txn` breaks. New migration `20261011000100_m1_recon_platform_float.sql` (`recon_runs.platform_adjustments_minor`, returned by `/staff/recon/latest`). Tests: `mapBalanceTxn` topup vs payout vs stripe_fee (`money-path.test.ts`), injected payout + fee → total diff and breaks, float persisted and returned (`money-flow.test.ts`) — run here. `docs/SETUP.md` C8: manual payout schedule for the test-mode run. Design §7/§12.1.
- [minor] 2 · Checkout pay-step errors (5xx/network/unknown) → "Payment not confirmed … check My backings before trying again; you won't be charged twice." "Nothing was charged" only for `POST /backings` errors and declines. Design §4.3.
- [minor] 3 · After `POST /backings` (incl. a replayed 201 after reload) the page reads `GET /backings/:id`: `held`/`released` → key dropped, confirmation; dead → review with a new key.
- [minor] 4 · `safeNext` moved to `packages/shared/src/safe-next.ts` (raw + decoded checks, `new URL` same-origin) with unit tests (`/%09/evil.com`, `//evil.com`, `/\evil.com`, `https://evil.com`, valid paths) — run here; shared tests now run in the CI web job.
- [minor] 5 · Verify-email `GET /me` poll removed (no session before confirmation). Same-browser tabs: supabase-js broadcast + `storage` event. Another device: the first device logs in after confirming elsewhere (design §11). No automated test.
- [minor] 6 · `perk_selected` carries `source`. [minor] 7 · Explore: AbortController per (tab, type); failed "Show more" keeps the list, retry resumes from `cursor`. [minor] 8 · Hold countdown no longer `aria-live`; hidden live region at 5 min / 1 min / expired. [minor] 9 · Test-mode notice names `4000 0000 0000 0077` on `stripe-test`; generic otherwise (sandbox form names its own card). `lint:copy` clean.
- [nit] 10 · SETUP Part F moved after Part E. [nit] 11 · `qty` dropped from the design route; e2e viewport stated as 412 px (Pixel 7) in design §2.
- Totals: API 153/153 (13 files), shared 39/39 (3 files), typecheck clean, `lint:copy` clean, web build OK — run here; CI all green at `1dcede4` (Web, API, E2E golden journey + operator smoke).

## 2026-10-11 · L2 PR #11 (DB + mock rails) brought up to `main` (PR #10 merged) + review fixes
- Merged `origin/main` (`c90d9b6`, no conflicts: `specs/`, `docs/` and M1 code from `main`; this PR's L2 files kept).
- **SQL (`961b10e`)** — migrations `20261011000300…000600` rewritten to the merged design: one clock (`p_now` on every money function); lock order investor → owner's artists → pool → investment → tranche and lock-then-check everywhere; flag on entry paths only; issuer cap on the maximum aggregated by owner with attestation + backstop (L2-T-019); 21–60 days (L2-T-020); terms frozen outside `draft`/`revisions_requested` with `terms_sha256` checked at approve/launch (final review); counted reservations in usage, backstop, settlement and `l2_maybe_mark_refunded` (L2-T-042, L2-T-045); `l2_reservation_live` shared by `mark_investment_funding` (`'dead'` only for a dead `reserved` row, current status otherwise) and `record_investment_funded` (L2-T-028); fund-move matching, strays, `funded_received_minor`, `pool_ops` unique by key, key scheme (L2-T-032, L2-T-040); `cancel_pending` (L2-T-031, L2-T-043); expiry candidates + lookup grace (L2-T-026); `claim_token`/`call_started_at`, `l2_op_start_call`, in-order disburse ops (L2-T-027); notices with dedupe (L2-T-039, L2-T-044); period windows, zero-cash statements never collected, incremental top-ups, REMEDIATION by staff only, maturity, fans equality (L2-T-022, L2-T-024, L2-T-034); recon break kinds (L2-T-033, L2-T-036); rule details in dollars; no client grants (L2-T-037).
- **Shared (`46a019b`)** — `regCf.minOfferingDays`, `l2.deadlineDays.min = 21`, `l2.expiryLookupGraceMinutes`, `l2.refundDirectBusinessDays`; submit/launch attestation bodies.
- **Rails (`19a8513`)** — `getTrade`/`findTrade`/`cancelTrade`/`listTransactions` in the interface, engine, HTTP service and both adapters (L2-T-041); idempotency keys permanent (README, ADR-007 prerequisites).
- **Tests (`4835528`, `bb4035d`)** — `apps/api/test/l2-money.test.ts` (33), `l2-money-revenue.test.ts` (16), `l2-regcf-adapter.test.ts` (1) on `freshDb()`; mock-escrow 14 (5 new); shared 59 (6 new). Run here.
- Totals run here: API 202/203 (16 files) — the one failure is M1's weekly-review test, which fails only because this machine's Postgres runs in `America/Chicago` and the run crossed Monday 00:00 UTC (the route compares `created_at` to a `date`); untouched by this PR and green in CI (UTC). shared 59/59, mock-escrow 14/14, typecheck clean, `lint:copy` clean, web and API builds OK.
- Not done here (by the task table, PR #12/#13): the API worker steps (`expireReservations`, maturity, recon counters/liability/ref matching, pause rule), the purchase resume guard, routes and their flag scope, notice templates, seed/fixture, web. SQL signatures changed (every money function now takes `p_now`; `expire_investment_reservations(pool, ids, now)`; `submit_pool`/`launch_pool` take the attestation; `record_investment_refunded` returns text), so PR #12/#13 need updating when rebased.

## 2026-10-11 · L2 PR #12 (API) brought up to `main` (PR #11 merged) + review fixes
- Merged `origin/main` (`de7c234`): `specs/`, `docs/`, every migration (the old-named `20261005*` L2 files are gone; the merged `20261011000200…000600` are untouched), shared, `regcf/`, `apps/mock-escrow/` and M1 code from `main`; this PR's API re-applied on top.
- **Rails (`680110f`)** — `refundFundMove(fundMoveId, {amount}, idem)` in `RegCfProvider`, both adapters, the mock engine and HTTP service (stray refunds by fund ref, #11 review note). Tests: engine, HTTP route, both adapters.
- **DB (`b87fede`)** — new migration `20261011000700_l2_api_helpers.sql`: `l2_start_provider_call(inv, now)` (pool → investment lock, only for `l2_reservation_live`), service role only (#11 review note).
- **API (`8fb4248`)** — one clock into every money function; `invest()` claim + reservation in one transaction with stored 4xx, the resume guard (a)/(a′)/(b)–(e) with lookups only for dead reservations (L2-T-028); `expireReservations` worker step (L2-T-026); `pool_ops` runner on claim tokens + `l2_op_start_call`, disburse after the confirmed close, pause rule `L2_PAYOUT_PAUSING_KINDS` (L2-T-027, L2-T-030); webhooks only through main's claimed inbox, flag-independent; fund-move matching by fund ref then externalId, strays (L2-T-032); L2 recon with in-flight allowance, refs, counters, liability, aged strays, `refund_overdue` (L2-T-023, -033, -036, -039, -042); flag on entry paths only (L2-T-038); L2 staff actions in main's executor with delay + daily limits, deposit trigger as a staff action, stale commit hash refused at request time; Form C built under the submit locks, launch end date from stored values, `state_locked`, creator failed-Pool notice (round-1 findings); notices with the D-2 line, 227.303(d)/(f) fields (L2-T-039, -044); Form C intermediary pending L2-Q3 (L2-T-025); error codes mapped.
- **Seed (`3cd4efe`)** — seed on the merged SQL (one clock, attestation, 30-day offerings, `SELF_REPORTED` statements on expected windows); Demo Tape EP 12-month maturity with every period collected; fixture regenerated.
- **Tests (`f854ec5`)** — new `l2-purchase` (14), `l2-recon` (9), `l2-ops` (3); `l2-platform` (20), `l2-revenue` (14), `l2-offering` (15), `l2-seed` (4) rewritten for the merged SQL. Run here.
- Totals run here: API 282/283 (23 files) — the one failure is M1's weekly-review test (this machine's Postgres runs in `America/Chicago` and the run crossed Monday 00:00 UTC; green in CI on UTC). mock-escrow 15/15, shared 59/59, typecheck clean (api, shared, web, mock-escrow), `lint:copy` clean, API build OK.
- Left for PR #13: the web parts of L2-T-012/-013/-014/-015/-016 (lint rule)/-017/-018/-019/-020/-021/-022/-025/-031/-034/-038/-043/-044.

## 2026-10-11 · L2 PR #12 review round 2 fixes
- [major] 1 · `pool_op.replay` staff action (`apps/api/src/staff.ts`) + flag-free `POST /staff/l2/pool-ops/:id/replay`; failed/dead pool ops in `/staff/queue` as `pool_dead_letters` (shared `StaffQueueType`). L2-T-046.
- [minor] 2 · `invest()` guard passes use a fresh clock `max(now, clock())` (injectable for tests). L2-T-047.
- [minor] 3 · Migration `20261011000800_l2_launch_deadline.sql`: `pools.launch_ends_at`, `l2_plan_launch`, `launch_pool(…, p_ends_at default null)`; launch sends that value as the offering `endDate`. L2-T-048.
- [minor] 4 · Investment refunds via `refundFundMove(provider_fund_ref)` for the op amount (= `funded_received_minor`); mock engine test hook `setPendingFundMoveAmount`. L2-T-049.
- [nit] 5 · PR description corrected (no `db-deploy.yml` change; hosted deploys never seed); design §9 flag-scope list completed.
- [nit] 6 · Per-tick L2 recon skips finished Pools with nothing open; `refund.overdue` logged once per break. L2-T-050.
- Tests: new `apps/api/test/l2-review-round2.test.ts` (5); `l2-ops`, `l2-recon`, `l2-seed` updated. Totals run here: API 287/288 (24 files) — the one failure is M1's weekly-review test (local Postgres in `America/Chicago`, run crossed Monday 00:00 UTC; green in CI). shared 59/59, mock-escrow 15/15, typecheck clean, `lint:copy` clean.

## 2026-10-11 · L2 PR #12 review round 3 fixes
- [major] 1 · Launch window (`f9ba3e2`): every live Pool has `ends_at − starts_at ≥ min_offering_days`. `l2_plan_launch` (amended `20261011000800_l2_launch_deadline.sql`, unmerged) re-plans when less than `min_offering_days` remain or the plan has passed; `launch_pool` refuses `launch_window_too_short` (replaces `launch_deadline_passed`). `RegCfProvider.findOffering`/`updateOffering` (mock engine, HTTP route, both adapters); launch looks the offering up and moves its end date to a new plan, key `offering_end:<pool>:<deadline>`. The round-2 test that kept a shortened window is replaced. L2-T-051.
- [minor] 2 · Lost confirmations (`f9ba3e2`): `pool_ops.sent_at` (new `20261011000900_l2_recon_sent_ops.sql`, also admits `op_unconfirmed`); a `sent` op is in flight for `recon.inflightGraceMinutes` only, then looked up — settled → recorded through the webhook's SQL path (`applyPoolOpSettled`), not found → `op_unconfirmed`; `refund_overdue` counts `sent` refunds. L2-T-052.
- [minor] 3 · `pool_op.replay` refuses `409 replay_requires_resolution` for an op failed by `amount_mismatch` until its break is resolved; the runner looks a movement up before any re-call once a call started. L2-T-053.
- [nit] 4 · Per-tick L2 recon sweeps closed Pools every `recon.closedPoolSweepHours` (24). L2-T-054.
- [nit] 5 · Design text: ops queued by `l2_queue_op`, outbox only `l2.notify`. L2-T-055.
- **M1 follow-up (`80e7a40`) — a follow-up fix to merged M1 code, found during the L2 review (round 3):** `apps/api/src/recon.ts` treated an `outbound_ops` row in `sent` as in flight forever, so a lost refund confirmation was never noticed. The allowance now lasts `recon.inflightGraceMinutes` (from the op's `updated_at`); after it recon looks the op up (`findRefund`/`findTransfer`) before reading the ledger and records the confirmation (`confirmRefundOrFlag`, shared with the inbox, or `confirmPayout`), or opens the new non-pausing, run-derived `op_unconfirmed` break (migration `20261011001000_m1_recon_op_unconfirmed.sql`). M1 design §7 updated. Tests: `recon.test.ts` (+2).
- Tests: new `l2-review-round3.test.ts` (10); `l2-regcf-adapter` (+2), mock `engine.test.ts` (+1), `l2-seed` (sweep), `recon.test.ts` (+2); `l2-review-round2.test.ts` now 4 (launch test moved); shared `rules.test.ts` lists `recon.closedPoolSweepHours`. Totals run here: API 300/301 (25 files) — the one failure is M1's weekly-review test (local Postgres in `America/Chicago`, run crossed Monday 00:00 UTC; green in CI). shared 59/59, mock-escrow 16/16, typecheck clean, `lint:copy` clean.
- Follow-up (coordinator, before re-review): staff action `pool_break.resolve` (`POST /staff/l2/pool-breaks/:id/resolve`, flag-free, staff + aal2 + typed reason, reviewer ≠ Pool owner, not a money action, audited) for `amount_mismatch` / `unapplied_funding` only; open Pool breaks in `/staff/queue` (`pool_breaks`); `pool_op.replay` also takes a `sent` op with an open `op_unconfirmed` (otherwise such an op could never be retried). The round-3 test now resolves through the endpoint. L2-T-056. API 300/301 again (same weekly-review local-timezone failure), shared 59/59, typecheck and `lint:copy` clean.
