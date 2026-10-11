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

## Not run here
- Anything needing Docker (Supabase CLI stack, e2e) — runs only in CI.

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
