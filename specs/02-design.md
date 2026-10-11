# FanZuP v2 — Technical Design · Milestone M1 (walking skeleton)
**Tier:** Enterprise · **Scope:** M1 only (G1 card G1-C) · **Status:** G2 pass 2 APPROVE WITH CONDITIONS (2026-10-03) + post-gate delta from PR #6 review rounds 1–3 (2026-10-11), listed in `gates/G2-design.md` §"Post-gate delta"; **Wayne's G2 sign-off covers the design including that delta** · **Date:** 2026-10-11
**Inputs:** `00-brief.md`; `01-requirements.md` §Milestone M1 scope (binding) and the FR/NFR text it cites; G1 record and pass-2 notes; E1 record; README money rules; ADR-001, ADR-002; council D1; CR-001.
**ADRs added by this design:** [ADR-003](../docs/adr/ADR-003-payment-provider-boundary.md) payment-provider boundary · [ADR-004](../docs/adr/ADR-004-full-account-auth.md) full-account auth and staff second factor · [ADR-005](../docs/adr/ADR-005-correlation-ids.md) correlation ids · [ADR-006](../docs/adr/ADR-006-e2e-harness.md) end-to-end harness.

Nothing in this design touches Layer 2. The `layer2` and `postBeta` flags stay off. CR-001 (holder votes) is untouched.

---

## 1. Architecture overview

```
 Browser (apps/web, Vite SPA)                      Supabase Auth (GoTrue)
   │  supabase-js: sign-up / sign-in / verify ───────────►│  email+password, confirm link, TOTP MFA
   │  fetch /api/v1/* with Bearer access token            │
   ▼                                                      │ JWKS / HS256
 apps/api  (Fastify, Vercel function)  ◄──────────────────┘
   ├─ public reads       campaigns, config
   ├─ fan writes         backings (claim-first idempotency), acceptances, funnel events
   ├─ artist writes      drafts, perks, tranches, submit, publish, evidence, payout onboarding
   ├─ staff (aal2)       review, verify, refund, replay, recon, trace, weekly review
   ├─ webhooks           Stripe → provider_events (store, ack) ──────────┐
   └─ dev (sandbox only) pay / tick                                      │
            │ postgres.js, one transaction per unit of work              │
            ▼                                                            ▼
 Supabase Postgres ── ledger (double-entry, append-only) · audit · outbox · provider_events
            ▲         outbound_ops · privileged_actions · recon_runs/breaks · notifications
            │         funnel_events · consents · worker_heartbeats · platform_settings
 apps/api worker (Render; same bundle)  — every `WORKER_INTERVAL_MS` (default 30 s):
   heartbeat → expire holds → process provider events → settle due campaigns
   → drain outbox (refunds, releases, notifications) → execute due privileged actions
   → reconcile (daily, or on demand)
            │
            ▼
 PaymentProvider adapter ── stripe-test (Stripe test mode: PaymentIntents, Refunds, Connect transfers)
                         └─ sandbox (no network; emits provider events into the same inbox) — local + CI only
```

**Responsibilities.** The database owns every money rule and every state transition (SQL functions, constraints, triggers). The API authenticates, authorises, validates input and sequences calls to the provider; it never computes a ledger amount. The worker owns everything time-based or retried. The provider adapter is the only code that talks to Stripe. The web app is a client of the API for every M1 path and of Supabase Auth for identity only.

**What changes from today's code.** The money core (ledger, settle, refund, release functions; RLS) stays. M1 adds: the event inbox, two-phase outbound operations, checkout holds, late-capture refunds, reconciliation, correlation ids, single-operator staff actions, artist and staff APIs, notifications, funnel events, column grants, and the web wiring for four paths.

## 2. Tech stack (unchanged unless noted)
| Piece | Choice | Why |
|---|---|---|
| DB | Supabase Postgres 17 | Existing; money rules live in SQL so every caller obeys them |
| Auth | Supabase Auth: email + password with confirmation; TOTP MFA for staff | Card G1-B option 3; `aal2` claim gives a server-checkable second factor (ADR-004) |
| API / worker | Fastify 5, postgres.js, zod, jose; tsup bundle | Existing (ADR-001/002) |
| Payments | Stripe **test mode** only: PaymentIntents + Payment Element, Refunds, Connect Express transfers ("separate charges and transfers") | E1-B default; already integrated as `stripe-dev`, renamed `stripe-test` in PR #7 (T-004) with `stripe-dev` kept as an accepted alias |
| Web | Vite + React 18 + react-router 7; **adds** `@supabase/supabase-js` and `@stripe/stripe-js` (loaded only on checkout when the provider is Stripe) | Auth client and hosted card fields (no card data touches FanZuP, NFR-COMP-20 direction) |
| E2E | Playwright (Chromium) against the Supabase CLI local stack in GitHub Actions; Mailpit for the confirmation email | Real Supabase Auth in CI (ADR-006) |
| Request context | Node `AsyncLocalStorage` + Postgres `set_config` | Correlation id and actor reach every SQL row without threading parameters (ADR-005) |

No new hosted services. Sentry and an email delivery provider are **setup steps for Wayne** (§12); M1 ships structured logs and a log transport for email.

## 3. Data model changes
All changes are **new migrations** (the three existing ones are never edited). Money is `bigint` cents. Every new table has RLS enabled; internal tables have no client policies and no client grants.

| Migration | Contents |
|---|---|
| `20261004000100_m1_enums.sql` | `backing_status` gains `refund_pending`. Separate file because a new enum value can't be used in the transaction that adds it. |
| `20261004000200_m1_context_and_inbox.sql` | Request context helpers; correlation/actor columns; `provider_events`; `outbound_ops`; `worker_heartbeats`; `platform_settings` |
| `20261004000300_m1_checkout_and_money.sql` | Checkout holds; revised capture; late-capture + refund functions; staff refund; distinct-backer counting; revised `settle_campaign` and `campaigns.settled_raised_minor`/`settled_backers_count` (§3.5 counter rule); stray captures; `tranche_evidence` + `submit_tranche_evidence`; revised `verify_tranche`/`record_tranche_released`; `recon_runs`/`recon_breaks` + `recon_ledger_by_campaign()` *(as built, D-001)* |
| `20261004000400_m1_identity_and_staff.sql` | `privileged_actions`, `review_signoffs`, `notifications`, `funnel_events`, `consents`, identity trigger, `fan_backings()` (fan money-state function); revised workflow functions *(as built, D-001)* |
| `20261004000500_m1_grants.sql` | Column allowlists for `artists`/`profiles`; revoke client execute on workflow functions; grants for new functions to `service_role` |

### 3.1 Request context (ADR-005)
- `public.ctx(key text) returns text` → `nullif(current_setting('fanzup.' || key, true), '')`.
- Columns added with defaults read from the context, so existing SQL functions pick them up without edits:
  - `audit_events`: `correlation_id text default ctx('correlation_id')`, `actor_kind text default coalesce(ctx('actor_kind'),'system:db')`, `aal text default ctx('aal')`. `actor_id` keeps its explicit value; a trigger fills it from `ctx('actor_id')` when null.
  - `ledger_transactions.correlation_id`, `outbox.correlation_id` (same default).
  - `backings.correlation_id` (set at creation), `backings.hold_expires_at timestamptz`, `backings.source text` (sanitised `ref`, ≤ 40 chars).
- The audit and ledger append-only triggers also fire on `TRUNCATE` (statement-level) — NFR-COMP-12.

### 3.2 Provider event inbox — `provider_events` (FR-PAY-002)
`id uuid pk · provider text · event_id text · type text · livemode bool · account text · object_ref text · payload jsonb · status text ('received','processed','ignored','unmatched','failed','dead') · attempts int · last_error text · correlation_id text · received_at · processed_at` · **unique (provider, event_id)**.
Insert is `on conflict do nothing`; the HTTP 200 is returned only after the row commits. Processing happens afterwards (inline once, then by the worker). `payload` holds the provider's event object minus nothing sensitive (Stripe events carry no card data); `last_error` is redacted (NFR-SEC-12).

### 3.3 Two-phase outbound — `outbound_ops` (FR-PAY-004)
`id uuid pk · kind text ('refund','payout') · subject_id uuid (backing, tranche, or — for a stray-capture refund, §3.5.1 — the provider event) · payment_ref text (set only for a stray-capture refund) · waiting text · amount_minor bigint > 0 · idempotency_key text unique · status text ('initiated','sent','confirmed','failed','dead') · provider_ref text · attempts int · next_attempt_at · last_error · correlation_id · created_at · updated_at` · **unique (kind, subject_id)** so one backing can never have two refund operations and one tranche two payouts.

### 3.4 Checkout holds (FR-PAY-001, FR-PAY-006)
- `perks.claimed` now counts units of unexpired `pending_payment` holds plus `held`/`released` backings (counter rule, §3.5). `create_backing_hold(...)` does `update perks set claimed = claimed + q where id = … and (quantity_limit is null or claimed + q <= quantity_limit)`; zero rows → `perk_sold_out`. The row lock makes the last-unit race serialise; the check constraint is the backstop.
- `backings.hold_expires_at = now() + POLICY.checkout.holdMinutes`. `release_backing_hold(backing, reason)` sets `canceled`, returns the units, audits. Called by the worker when the hold expires or the campaign deadline passes, after the provider confirms the payment attempt is cancelled.
- Unconfirmed-checkout cap: `create_backing_hold` refuses when the user already has `POLICY.checkout.maxUnconfirmedPerUser` unexpired `pending_payment` backings (FR-TAX-004 slice).
- `api_idempotency` gains `resource_id uuid`, `state text ('in_progress','done')` and `claimed_at timestamptz` for claim-first idempotency (§4.4); `response`/`status_code` also store error outcomes.

### 3.5 Money functions (new or replaced; all `security definer`, `search_path = ''`, execute granted to `service_role` only)
**Counter rule (review round 1, finding 1 — fixes a staff-refund double spend at settlement).** `campaigns.raised_minor`, `campaigns.backers_count` and `perks.claimed` count **only backings in `held` or `released`** (plus, for `perks.claimed`, units reserved by `pending_payment` holds — §3.4). The decrement of `raised_minor`/`backers_count` and the return of perk units happen **at the moment a backing leaves `held` for `refund_pending`**, in the same transaction, in every function that makes that move (`request_backing_refund`, the failed branch of `settle_campaign`). They never happen at refund confirmation. Invariants checked by tests and by reconciliation (§7):
- `raised_minor = Σ amount_minor` and `backers_count = count(distinct backer_id)` over the campaign's `held` + `released` backings;
- **Liability invariant (review round 3):** the ledger balance of `backer_liability(campaign)` = Σ `coalesce(captured_minor, amount_minor)` over the campaign's `held` + `refund_pending` backings **+** Σ captured amount of its **open stray captures** (a `payment.captured_stray` posting with no `payment.stray_refunded` posting yet, §3.5.1). Released backings' liability has moved to `artist_payable`; `refunded` backings and confirmed stray refunds contribute 0. `captured_minor` is used because an unapplied amount-mismatch capture owes the backer what was actually captured; `amount_minor` covers an applied capture (where they are equal) and older rows with no `captured_minor`. A `pending_payment` or `canceled` backing contributes 0 (no capture posted).

| Function | Does |
|---|---|
| `apply_payment_captured(backing, payment_ref, amount, currency, fee, idem) → text` | Idempotent on `idem = capture:<payment_ref>` (keyed by the **payment**, not the backing — review round 2). The caller matches the event to a backing as in §3.5.1. If the backing is `pending_payment`, its `payment_ref` is null or equals `payment_ref`, the campaign is `live`, `now() < ends_at`, and amount/currency match: post `backing.captured` (as today), mark `held`, add to `raised_minor`, add to `backers_count` **only if this backer has no other held/released backing on the campaign** (FR-PAY-009), queue `notify.backing_receipt`, record `backing_confirmed` funnel event → `'applied'`. Otherwise post `backing.captured_unapplied` (escrow_cash + fee clearing vs backer_liability, no counters), mark `refund_pending`, return the backing's perk units if it still held them (a `pending_payment` hold; a `canceled` backing already returned them), queue `backing.refund` with the reason, open a recon break when the amount or currency differs → `'refund:<reason>'`. **What is stored on an unapplied capture (review round 2):** `backings.payment_ref`, `captured_minor` = the amount the provider actually captured (not `amount_minor`), `captured_currency` = the provider's currency, `processing_fee_minor` = the provider's fee; the break records `expected_minor`, `captured_minor` and both currencies. The refund op is sized from `captured_minor` (`ensureRefundOp`, `apps/api/src/outbound.ts`, already does this) and `record_refund_confirmed` checks the provider's refunded amount against `captured_minor` (migration `…0300`, already does this). Reasons: `hold_expired`, `campaign_closed` (incl. `captured_after_deadline`, D-001), `amount_mismatch`, `currency_mismatch` (a PaymentIntent we create is always USD, so this is a can't-happen guard). The deadline check uses **processing time** (`now()` when the event is processed), not Stripe's capture time — an accepted M1 simplification, worklog **D-001**: a payment Stripe captured just before the deadline but processed after it is refunded in full, and the fan's "refund started" email apologises and gives that reason (`captured_after_deadline`). Revisit with the custodian. |
| `record_refund_confirmed(backing, refund_ref, amount, idem)` | Replaces `record_backing_refunded` for every refund path. Requires the backing `refund_pending` and `amount = backings.captured_minor` — the amount actually captured, which equals `amount_minor` for an applied capture and differs for an amount-mismatch capture (else raises `refund_amount_mismatch`; the event goes `failed` → dead-letter and the op shows in the staff queue). Posts `backing.refunded` exactly as today (debits `backer_liability`, credits `escrow_cash` with amount − fee and `platform_funding` with the fee): FanZuP absorbs the non-refundable processing fee on **every** refund in M1, including staff refunds — the E1-C default, revisited when card C is decided (G2 condition 8). Marks the backing `refunded`. **Does not touch `raised_minor`, `backers_count` or perk units** (already adjusted when the backing left `held`). Works whatever the campaign's status is now (a staff refund requested while `live` may confirm after the campaign settled `funded`). Closes a `failed` campaign to `refunded` when no `held` and no `refund_pending` backing remains. |
| `request_backing_refund(backing, reason)` | Staff refund (FR-DSP-001 M1 slice): backing `held` on a `live` campaign → `refund_pending` (a failed campaign's backings are already `refund_pending` from settlement); in the same transaction subtract its amount from `raised_minor`, recount distinct held/released backers into `backers_count`, return its perk units; queue `backing.refund`. Funded-campaign refunds (from artist payable/holdback) are M2. |
| `settle_campaign` | Revised. Decides on `raised_minor` (held + released only, by the counter rule). **Funded branch:** releases **only `held`** backings to `released` and posts `backer_liability → artist_payable` for Σ `held` amounts (which equals `raised_minor`), with fees Σ over the same `held` backings; `refund_pending` backings are left alone and finish refunding from `backer_liability` / `escrow_cash` through their outbound op, so the artist is never credited refunded cents. Writes `settled_raised_minor`/`settled_backers_count` (new `campaigns` columns, the public figure for a settled campaign). **Failed branch:** moves every `held` backing to `refund_pending` (counter rule: counters fall as it does), queues one `backing.refund` per backing (→ `outbound_ops`), and moves the campaign to `refunded` only when **no `held` and no `refund_pending`** backings remain — otherwise it stays `failed` and the refund-confirmed path completes it. |
| `verify_tranche(tranche, reviewer)` | Adds reviewer ≠ owner, `evidence_submitted` required for tranche ≥ 2, queues `tranche.release`. |
| `record_tranche_released(tranche, payout_ref, amount, idem)` | Replaced: takes the payout op's amount and raises unless it equals `tranche_release_amount()` (G2 condition 1); called only after the payout op is confirmed. |
| `fan_backings(user) → setof record` | FR-BCK-005 / FR-PAY-009 fan view; money state derived from the ledger: `pending` (no capture), `held` (captured, campaign live), `refunding` (refund_pending), `refunded` (a `backing.refunded` transaction exists), `with_artist` (campaign funded; shows the **campaign-level** released share = Σ tranche releases ÷ artist net — not a per-backing figure, G2 condition 4), `released` (campaign released). |

**README "Money-path rules" additions** (the README lists only rules the code enforces, so PR #7 adds these lines when the functions above land, T-007/T-008):
- Public counters (`raised_minor`, `backers_count`, perk units sold) count only `held` and `released` backings. A backing stops counting the moment its refund is requested, not when the refund confirms.
- A funded campaign pays the artist only from `held` backings; a refund already in progress at the deadline finishes refunding and is never paid to the artist.
- A failed campaign becomes `refunded` only when no backing is `held` or `refund_pending`.
- A backing request is claimed and its hold created in one transaction; the same Idempotency-Key always gets the same outcome, including the same error.
- A capture is refunded from what was actually captured, never from what the backing expected.

#### 3.5.1 Matching a capture to a backing; captures that match nothing (review round 2, FR-PAY-003)
Today `apps/api/src/inbox.ts` (`payment.succeeded`) finds the backing by `metadata.backing_id` **or** `payment_ref` and calls `apply_payment_captured` with `idem = capture:<backing>`; a second, different payment for a backing that already has a capture is therefore swallowed as `'duplicate'` and never refunded. Required behaviour:
1. **Match by `payment_ref` first:** the backing whose `payment_ref` equals the event's PaymentIntent id.
2. **Else by `metadata.backing_id`**, but only if that backing's `payment_ref` is null (the webhook beat step 4 of §4.4) or equal.
3. **Same payment again** (same `payment_ref`, same capture) → `idem = capture:<payment_ref>` already posted → `'duplicate'`, nothing moves.
4. **Stray capture** — a payment that names a backing which already has a *different* `payment_ref`, or whose backing is `held`/`released`/`refund_pending`/`refunded` under another payment, or that names no backing but carries our `campaign_id` metadata: it is money we hold for nobody. `apply_stray_capture(campaign, payment_ref, amount, currency, fee)` posts `payment.captured_stray` (escrow_cash + fee clearing vs `backer_liability(campaign)`, `external_ref = payment_ref`, no counters, no backing state change), and creates **its own refund op keyed by the payment**: `outbound_ops(kind 'refund', subject_id = the provider_events row id, payment_ref = <payment_ref>, amount_minor = captured amount, idempotency_key = refund:pay:<payment_ref>)`. Its confirmation posts `payment.stray_refunded` (same legs as `backing.refunded`, FanZuP absorbs the fee) via `record_stray_refund_confirmed(payment_ref, refund_ref, amount, idem)`, which checks the amount against the stray capture. The event is marked `processed`; the op shows in the staff `refunds` queue and an alert log line `capture.stray` is written. **Reconciliation treatment (review round 3, agrees with §7):** a stray capture resolves through its refund op. While that op is open (not `confirmed`) and younger than `recon.maxBreakAgeBusinessDays`, the stray capture counts in the campaign's expected `backer_liability` (§3.5 liability invariant) and in the expected provider balance, so it produces **no** money break and no payout pause. Once the op is `confirmed` the stray contributes 0 again. **Only if the op ages beyond `recon.maxBreakAgeBusinessDays` without confirming** (including an op that went `dead` or `failed`) does the run open a `stray_capture_aged` money break (dedupe key = the payment ref), which pauses payouts like any aged break until the refund confirms or staff overrides.
5. A payment with no `backing_id` **and** no `campaign_id` metadata that matches no backing after the 10-minute grace stays `unmatched` (§5) for staff.
The worker's refund step (`runOp`) reads the PaymentIntent from `outbound_ops.payment_ref` when set, else from the backing.

#### 3.5.2 Artist identity and payout account (FR-ID-004; review round 2)
- **What sets `artists.identity_status = 'verified'` in M1:** only `POST /artist/payout-account` (`apps/api/src/routes/artist.ts`, PR #8). It creates or reuses the Connect Express account (`provider.payoutOnboarding`), asks the provider whether it is ready (`provider.payoutAccountReady` = Stripe `accounts.retrieve(...).payouts_enabled`; the sandbox is ready at once), stores `payout_account_ref`, and sets `identity_status` to `verified` when ready, else `pending`, returning `{ status, onboardingUrl }`. After finishing Stripe's hosted onboarding the artist calls the endpoint again (Stripe's return URL lands on `/creator/payouts?onboarding=done`); that second call finds the account ready and sets `verified`. M1 does **not** listen to Connect `account.updated` (no Connect webhook endpoint; such events would be stored as `other` → `ignored`), and nothing downgrades `verified` if Stripe later disables the account — both M2 (FR-ID-008).
- **Consequence for submit/publish:** `submit_campaign` requires `identity_status = 'verified'`, so in M1 **a ready payout account is required to submit**. Publish adds no further check.
- **Tranche release with no payout account:** the payout op **waits, no break**: `runOp` (`apps/api/src/outbound.ts`) defers it with `waiting = 'payout_account'` and retries every 15 min without counting an attempt; no recon break, so payouts for other campaigns are never paused. If the account exists but Stripe rejects the transfer (e.g. capability disabled), the error is `permanent`: the op goes `failed` with an alert log line — **no recon break, no pause** — and staff replays it with a reason after the artist fixes onboarding. Waiting payout ops must be visible to staff: `GET /staff/queue?type=payouts` lists `kind='payout'` ops that are `initiated` with a `waiting` reason (review fix — implement in PR #8).

### 3.6 Staff and operations tables (FR-ID-007, FR-PAY-007, FR-NTF-001, FR-ANL-001, FR-PRV-001)
- `platform_settings(key pk, value jsonb, updated_at, updated_by)`: `single_operator_mode = true` at migration; `recon_override_until`.
- `privileged_actions(id, action, subject_id, actor_id, aal, reason (≥ 10 chars), amount_minor, params jsonb, status ('scheduled','executed','cancelled','failed'), execute_after, executed_at, error, correlation_id, created_at)`. Every status change is also an audit event.
- `review_signoffs(id, week_start date unique, actor_id, note, action_count, created_at)` — weekly review (FR-ID-007).
- `tranche_evidence(id, tranche_id, submitted_by, notes, links text[], created_at)` — append-only.
- `recon_runs(id, provider, started_at, finished_at, status, ledger_total_minor, provider_total_minor, diff_minor, correlation_id)`; `recon_breaks(id, dedupe_key unique-when-open, kind, campaign_id, amount_minor, refs jsonb, first_run_id, last_run_id, opened_at, resolved_at, resolution)`.
- `notifications(id, template, template_version, user_id, subject_id, status ('queued','sent','failed'), transport, error, correlation_id, created_at, sent_at)` — the address is resolved at send time and never stored here.
- `funnel_events(id bigserial, name, campaign_id, perk_id, user_id, anon_id, source, correlation_id, created_at)` — first-party, server-side only (N16).
- `consents(id, user_id, kind ('terms','privacy','adult_attestation'), version, method ('signup','api'), ip inet, user_agent text, created_at)` — append-only.
- `worker_heartbeats(worker pk, beat_at, info jsonb)`.

### 3.7 Identity (FR-ID-006, FR-PRV-001)
`handle_new_user()` is replaced: it raises unless `raw_user_meta_data.adult_attested = true` and `terms_version` equals the current version, then inserts the profile, two `consents` rows (`adult_attestation`, `terms`; method `signup`; IP/UA null — see §9 gap G-1) and an `account_created` funnel event. Current document versions live in `packages/shared/src/policy.ts` (`legal.termsVersion`, `legal.privacyVersion`) and are mirrored to `platform_settings` by migration; a sync test keeps them equal.

**Every path that inserts into `auth.users` must carry the metadata** (review round 2). As built in PR #8 (`supabase/migrations/20261004000400_m1_identity_and_staff.sql`) the trigger also requires `privacy_version`. Callers:
- `supabase/seed.sql` — PR #8 adds `"adult_attested":true,"terms_version":"2026-10-03-beta","privacy_version":"2026-10-03-beta"` to every seeded user's `raw_user_meta_data`. The seed on `main`/this branch (display name only) would be refused once migration `…0400` runs, so the seed change must merge with or before that migration (it does: same PR).
- `apps/api/test/supabase-shim.sql` only **creates** `auth.users` (no rows, no trigger — the trigger comes from the migrations), so it needs no change.
- `apps/api/test/helpers.ts` `createUser()` (PR #8) sends the same three keys; it must take the versions from `POLICY.legal`, not literals.
- The web sign-up form (PR #9) sends them from `GET /config.legal`.
- **Sync test:** `identity-staff.test.ts` asserts `platform_settings.legal_versions = POLICY.legal`. A seed with stale versions already fails every DB test (the seed is loaded by `freshDb()` and the trigger raises), but with an opaque error; the sync test is extended to parse `supabase/seed.sql` and assert every seeded user's `terms_version`/`privacy_version` equals `POLICY.legal` (review fix — implement in PR #8).
When `legal.termsVersion` changes, one PR changes `policy.ts`, adds a migration updating `platform_settings`, updates `seed.sql` and the test helper — the sync test fails until all four agree.

### 3.8 Column allowlists (NFR-SEC-01 M1 slice)
`artists`: clients may select `id, owner_id, slug, name, genre, city, bio, tier, identity_status, created_at` only — never `identity_ref`, `payout_account_ref`, `phone_verified`, `ein_verified`, `business_bank_verified`, listener counts. `profiles`: `id, handle, display_name, bio, created_at`; `city` is no longer public (FR-PRV-004 direction). A test asserts the exact allowed column set per role for these two tables and that internal tables are unreadable.

### 3.9 Policy keys added to `packages/shared/src/policy.ts` before use
`checkout.holdMinutes 15`, `checkout.maxUnconfirmedPerUser 3`, `refunds.autoInitiateMinutes 60`, `refunds.secondApprovalAboveMinor 50000`, `approvals.secondVerifierAboveMinor 500000`, `singleOperator.{delayAboveMinor 100000, delayHours 24, dailyLimits {refundsMinor 500000, verifications 3}}`, `outbound.maxAttempts 8`, `recon.{materialityMinor 100, maxBreakAgeBusinessDays 1}`, `rateLimits` (recorded; enforcement M2), `legal.{termsVersion, privacyVersion}`. Each carries its Appendix A basis.

## 4. API contracts
Base path `/api/v1`. JSON. **The request and response shapes below are defined once as zod schemas in `packages/shared/src/schemas.ts`** and imported by both apps (G2 condition 11); this table is the readable index. Cursors are opaque base64url of `{endsAt|settledAt, id}` (G2 condition 14). Errors are `{ "error": <code>, "message": <human sentence>, "correlationId": <id> }`. Every response carries `x-correlation-id`. Money fields are integer cents (`…Minor`). Validation is zod at the edge; business-rule violations from SQL map to `409 rule_violation` with the SQL message only when it is one of ours (P0001 with a known prefix), otherwise `500 internal`.

### 4.1 Auth levels
| Level | Check (server-side, ADR-004) |
|---|---|
| public | none |
| user | valid Supabase access token (issuer, audience `authenticated`, algorithm) |
| verified | user + `auth.users.email_confirmed_at is not null` (queried, never trusted from the client) |
| artist | verified + owns the artist/campaign in the path (RLS via `asUser`, plus explicit owner checks) |
| staff | user + row in `staff` + token claim `aal = 'aal2'` → else `403 second_factor_required` |

### 4.2 Endpoints
| Method & path | Level | Request | Response | Errors |
|---|---|---|---|---|
| `GET /config` | public | — | `{ provider: "sandbox"\|"stripe-test", testMode: true, stripePublishableKey: string\|null, legal: {termsVersion, privacyVersion} }` | — |
| `GET /campaigns?type=&tab=live\|funded&cursor=` | public | — | `{ campaigns: CampaignCard[], nextCursor }`, ≤ 24 per page, order `ends_at asc, created_at desc` (live) or `settled_at desc` (funded); never by money | 400 |
| `GET /campaigns/:slug` | public | — | `{ campaign: CampaignCard & {story, risks, startsAt}, perks: [{id,title,description,kind,priceMinor,remaining,fulfillBy}], tranches: [{seq,pct,milestone,status,targetDate,verifiedAt,releasedAt}] }` | 404 |
| `POST /events` | public | `{ name: "perk_selected"\|"checkout_started", campaignId, perkId?, anonId (uuid), source? (≤ 40 chars, `[a-z0-9_-]`) }`; body ≤ 1 KB; the campaign must exist and be public (G2 condition 18) | 202 | 400, 404 |
| `GET /me` | user | — | `{ id, email, emailVerified, displayName, isStaff, isArtist, needsAcceptance: string[] }` | 401 |
| `POST /me/acceptances` | user | `{ documents: [{kind, version}] }` | 201 (IP, UA recorded) | 400, 409 version not current |
| `POST /backings` | verified; header `Idempotency-Key` (8–200 chars) | `{ campaignId, perkId, quantity, source? }` | 201 `{ backingId, amountMinor, holdExpiresAt, clientSecret, provider }` | 400, 401, 403 `email_unverified`/`self_backing`/`acceptance_required`, 404, 409 `campaign_closed`/`perk_sold_out`/`too_many_open_checkouts`/`in_progress`, 422 `idempotency_key_reused`, 502 `provider_unavailable` (retry with the same key) |
| `GET /backings/:id` | owner | — | `{ id, status, moneyState, amountMinor, campaign:{slug,title,endsAt}, perk:{title}, failure? }` | 404 |
| `GET /me/backings` | user | — | `{ backings: [{ id, createdAt, amountMinor, quantity, status, moneyState, releasedPct, refund: {amountMinor, at, ref}\|null, campaign: {slug,title,status,endsAt,goalMinor,raisedMinor}, perk: {title, fulfillBy, status: "Not yet shipped"}, next: {label, at} }] }` | 401 |
| `POST /artist` | verified | `{ slug, name, genre?, city?, bio? }` | 201 artist | 409 slug taken; 403 single-operator staff may not own an artist |
| `GET /artist` | verified | — | artist + `payoutAccount: {status}` + campaigns | 404 |
| `POST /artist/payout-account` | artist | — | `{ status: "verified"\|"pending", onboardingUrl\|null }` (Stripe Connect Express account link in test mode; sandbox sets a test account). Sets `identity_status` from the account's readiness; call again after onboarding (§3.5.2) | 409 |
| `POST /artist/campaigns` | artist | `{ slug, title, type, blurb?, story?, risks?, goalMinor, durationDays, milestoneRelease }` | 201 campaign | 400, 409 |
| `PATCH /artist/campaigns/:id` | artist (draft or revisions) | partial of the above | 200 | 404, 409 |
| `PUT /artist/campaigns/:id/perks` | artist (draft) | `[{ id?, title, description?, kind, priceMinor, quantityLimit?, fulfillBy, shipsTo? }]` | 200 | 400 |
| `PUT /artist/campaigns/:id/tranches` | artist (draft) | `[{ seq, pct, milestone?, evidenceRequired?, targetDate? }]` (Σ pct = 100, 2–3 tranches) | 200 | 400 |
| `POST /artist/campaigns/:id/submit` · `/publish` | artist | — | 200 `{ status, endsAt? }` | 409 rule (submit needs `identity_status = 'verified'`, i.e. a ready payout account, §3.5.2) |
| `POST /artist/tranches/:id/evidence` | artist (funded campaign) | `{ notes, links: url[] ≤ 10 }` | 201 | 409 |
| `GET /staff/queue?type=review\|verification\|refunds\|payouts\|unmatched\|dead_letters\|breaks\|failed_events\|scheduled` | staff | — | `{ items: [{ type, id, subjectId, summary, ageSeconds, correlationId }] }` (one table-backed list, Pragmatist NIT) | 403 |
| `POST /staff/campaigns/:id/review` | staff | `{ decision, notes?, reason }` | 200 | 403 not-linked rule, 409 |
| `POST /staff/tranches/:id/verify` | staff | `{ reason }` | 200 `{ action: {id, status, executeAfter} }` | 403, 409 daily limit |
| `POST /staff/backings/:id/refund` | staff | `{ reason }` | 200 `{ action }` | 403, 409 daily limit / state, 409 `refund_after_deadline` when the single-operator delay would make it run at or after the campaign's `ends_at` (§9) |
| `POST /staff/actions/:id/cancel` | staff | `{ reason }` | 200 | 409 already executed |
| `POST /staff/provider-events/:id/replay` · `/staff/outbound-ops/:id/replay` | staff | `{ reason }` | 200 | 409 |
| `POST /staff/recon/run` · `GET /staff/recon/latest` | staff | — | run + open breaks | — |
| `POST /staff/recon/override` | staff | `{ reason }` | 200 `{ action }` (delayed per FR-ID-007, N4) | — |
| `GET /staff/trace/:correlationId` | staff | — | `{ audit[], ledger[], outbox[], providerEvents[], outboundOps[], actions[], notifications[] }` ordered by time | — |
| `GET /staff/weekly-review?weekStart=` · `POST /staff/weekly-review/signoff` | staff | `{ weekStart, note }` | list / 201 | 409 already signed |
| `POST /webhooks/stripe` | Stripe signature | raw body | 200 `{received:true}` after the row commits — including an event for a connected account that isn't one of our artists', which is stored with `status='ignored'` (§5); 400 `bad_signature`; 400 `livemode_rejected`. No other 4xx (review round 3: there is no `account_mismatch` response) | — |
| `POST /dev/sandbox/pay/:backingId` | **sandbox provider and non-deployed env only** | `{ outcome: "succeed"\|"decline", amountMinor? }` | 200 | 404 when not registered |
| `POST /dev/sandbox/tick?now=` | same | — | `{ settled, processed }` | — |
| `GET /health` | public | — | `{ ok, provider, testMode, worker: { lastBeatAt, ageSeconds } }` | 503 when the DB is unreachable |

### 4.3 Checkout failure categories (FR-BCK-001; G2 condition 12)
| Provider signal | Category shown | Next step shown |
|---|---|---|
| Stripe `card_declined`, `insufficient_funds`, `incorrect_cvc`, sandbox `decline` | declined | try another card |
| `expired_card` | expired | use a card that hasn't expired |
| `authentication_required`, 3-D Secure failed or abandoned | authentication failed | try again and complete your bank's check |
| network error, timeout, API 502 | network | check your connection and try again — nothing was charged |
| hold expired (`409` on confirm) | expired checkout | start again from the campaign page |

### 4.4 Backing creation sequence (FR-PAY-001, FR-PAY-006, claim-first)
**Rule (review round 1, finding 2 — no stuck keys):** the idempotency claim and `create_backing_hold` run in **one transaction**, so a crash before commit leaves neither a claim nor a hold, and a committed claim always has a `resource_id` or a stored outcome.
1. Verify token, require verified email; hash `{user, body}`.
2. **One transaction:**
   a. **Claim** `api_idempotency(key = backings:<user>:<key>, state 'in_progress', claimed_at now())` with `insert … on conflict do nothing returning`. A concurrent request with the same key **blocks on the unique index** until the first transaction commits or rolls back, then sees the row.
   b. If the row already existed, read it: different hash → 422 `idempotency_key_reused`; `state='done'` → replay the stored status and body (success **or** error); `in_progress` with `resource_id` → commit and resume at step 3 with that backing; `in_progress` with no `resource_id` and `claimed_at` older than **2 minutes** → treat as abandoned and re-claim it (`update … set claimed_at = now() where key = … and state = 'in_progress' and resource_id is null and claimed_at < now() - interval '2 minutes' returning`), then continue at 2c; `in_progress` with no `resource_id`, younger → 409 `in_progress`. (With 2a–2d in one transaction this last state should not arise; the 2-minute rule is the backstop for rows from any older code path or a manual edit.)
   c. Under a savepoint, `create_backing_hold(...)` (campaign live and before deadline, not self-backing, current terms accepted, open-checkout cap, stock reserved, backing `pending_payment` with `correlation_id`, `hold_expires_at`, `source`).
   d. **Rule violation** (`perk_sold_out`, `campaign_closed`, `too_many_open_checkouts`, `self_backing`, `acceptance_required`): roll back to the savepoint, store the claim as `done` with the 4xx error response, commit, return it — a retry with the same key gets the same error. **Success:** write `resource_id`, commit. No lock is held past this commit.
3. **Resume guard (review round 2):** before calling the provider — on the first pass and on every resume — re-read the backing. If it is no longer `pending_payment`, or `hold_expires_at <= now()`, or the campaign is past `ends_at`, return the **terminal** `409 checkout_expired` ("This checkout expired. Start again from the campaign page.") and store it on the claim as `state='done'` with that response, so every later retry with the key replays it and no PaymentIntent is created for a dead hold. (As built in `apps/api/src/checkout.ts`, PR #7, the resume branch already returns `checkout_expired` when the status isn't `pending_payment` or `hold_expires_at` is null; it must also test `hold_expires_at > now()` and store the outcome — review fix, PR #7.)
   Then `provider.createPayment({ idempotencyKey: payment:<backing>, metadata: { backing_id, campaign_id, correlation_id } })`. On failure return 502; the claim stays `in_progress` with the backing, so a retry with the same key resumes here and Stripe returns the same PaymentIntent.
   **Deterministic params (review round 3).** Stripe replays an idempotent request only when its parameters are identical; a retry with the same key and different parameters is rejected (`idempotency_error`), which would turn every resume into a 502. So **every** `createPayment` parameter is derived from the stored backing row, never from the current request: `amount = backings.amount_minor`, `currency = 'usd'`, `campaign_id` and `transfer_group = campaign_<backings.campaign_id>`, `description` = the backing's campaign title + perk title as read from the database, and `metadata.correlation_id = backings.correlation_id` (the id of the request that **created** the backing, not the resuming request's id). One helper builds the params from the backing id and is used on the first pass and on every resume. (As built in `apps/api/src/checkout.ts`, PR #7, `correlationId` comes from `currentCtx()?.correlationId` and `campaignId` from the request body — review fix, PR #7.)
4. Store `payment_ref`; mark the claim `done` with the response; record `checkout_started` if the client didn't.

## 5. Payment provider flow (Stripe test mode; ADR-003)
**Charge timing (N8):** charge at backing — the PaymentIntent captures immediately (`capture_method: automatic`); a failed campaign refunds in full.

| Step | Stripe test mode | Sandbox (local/CI) |
|---|---|---|
| Create payment | `paymentIntents.create` (USD, `automatic_payment_methods`, `transfer_group = campaign_<id>`, metadata) with idempotency key | ref `sbx_pi_<backing>`, client secret is opaque |
| Fan pays | Payment Element `confirmPayment` in the browser | labelled test card form → `POST /dev/sandbox/pay` → sandbox emits `payment.succeeded`/`payment.failed` into `provider_events` |
| Capture known | webhook `payment_intent.succeeded` → stored → processed: fee read from the charge's balance transaction (retrieve with expand) | fee = `processingFeeMinor(amount)` |
| Hold expiry | `paymentIntents.cancel(payment_ref)`; if it already succeeded, the late-capture path refunds. **If the backing has no `payment_ref`** (the API crashed between `createPayment` and storing the ref, §4.4 step 4), the worker first looks the PaymentIntent up — `provider.findPayment({ backingId })` = Stripe `paymentIntents.search` on `metadata['backing_id']` (indexed well within the 15-minute hold) — stores the ref if found and cancels it; only when none exists, or it is confirmed cancelled, does it call `release_backing_hold` (review round 2; today `expireHolds` in `apps/api/src/money.ts` releases a null-ref hold without looking — fix in PR #7) | `findPayment` reads the sandbox's own payment table |
| Refund | `refunds.create({payment_intent, amount = op.amount_minor (= captured_minor), metadata.outbound_op_id})`, idempotency key `refund:<backing>` (`refund:pay:<payment_ref>` for a stray capture, §3.5.1); retry looks up `refunds.list({payment_intent})` by metadata first. The synchronous response only moves the op `initiated → sent` and checks the amount; it does **not** confirm the refund | emits `refund.succeeded` |
| Refund confirmed | webhook `refund.created`, `refund.updated` or `refund.failed`; the adapter maps a refund whose `status` is `succeeded` to `refund.succeeded` → `record_refund_confirmed`, and `failed`/`canceled` to `refund.failed` → op `failed` + alert (`normalizeStripeEvent` in `apps/api/src/provider/stripe.ts`, `apps/api/src/inbox.ts`). In test mode a card refund is usually already `succeeded` on `refund.created`. `charge.refunded` is **not** used | same event shape |
| Payout | `transfers.create({destination: acct, amount, transfer_group, metadata.outbound_op_id})`, idempotency key `release:<tranche>`; retry looks up `transfers.list({transfer_group})` by metadata | emits `transfer.created` |
| Balance list (recon) | `balanceTransactions.list` (+ expand source for metadata) | derived from its own stored events |

**Webhook handling.** M1 has **one platform webhook endpoint** (`/api/v1/webhooks/stripe`) subscribed to the events in §12.1; there is no Connect ("events on connected accounts") endpoint — with separate charges and transfers, `transfer.created` is a platform event, and connected-account events such as `account.updated` aren't used in M1 (§3.5.2). Verify the signature against the raw body; reject `livemode = true` (FR-PAY-008); platform events must carry no `account`; an event carrying a connected `account` that is not one of our artists' `payout_account_ref` (G2 condition 16) is inserted **already** `status='ignored'` (`last_error = 'account_not_ours'`, `processed_at = now()`) **in the same insert** — never inserted as `received` and flipped afterwards, so a crash between the two statements can't leave it for the worker to process — and answered 200 like any stored event (review round 3; a 4xx would only make Stripe retry an event we will never act on). Only a bad signature or `livemode = true` gets 400. Every other event is inserted into `provider_events` as `received`; return 200; then try processing once inline, best-effort. The worker processes anything `received` or retryable `failed`, oldest first, `for update skip locked`, bounded attempts (`outbound.maxAttempts`) then `dead` + alert log line. Processing runs under the correlation id of the backing or outbound op the event belongs to. There is no per-object ordering guarantee (G2 condition 3): a refund or transfer confirmation applies by its `outbound_op_id` metadata whatever state the op is in (the webhook can beat our own commit of `sent`); a `payment.succeeded` whose backing isn't visible yet is retried for 10 minutes before it becomes `unmatched`. Events with no matching backing/op after that become `unmatched` and appear in the staff unmatched queue (FR-PAY-003 bullet 3) and as recon breaks.

**Outbound state machine (FR-PAY-004).**
```
initiated ──provider call ok──► sent ──confirmation event──► confirmed
    │  ▲                          │
    │  └── retry: lookup first ───┘ (found → sent; not found → call again)
    └── error → attempts++ / backoff ──(attempts ≥ outbound.maxAttempts)──► dead ──staff replay (reason, aal2)──► initiated
amount reported by provider ≠ op amount → failed + recon break (never "fixed" in place)
```
**Provider error classes** (G2 blocker 1). Every adapter error is classified before the op is updated:
| Class | Examples | Effect |
|---|---|---|
| `retry` | network error, timeout, 429, 5xx | `attempts += 1`, exponential backoff (15 s × 2ⁿ, max 1 h); `dead` at `outbound.maxAttempts` |
| `wait_funds` | Stripe `balance_insufficient` on a transfer | **no attempt counted**; retried every 15 min; op shows `waiting for available balance` in the staff queue; after 7 days it is raised as a recon break |
| `permanent` | invalid destination account, charge already fully refunded by someone else, amount mismatch | `failed` + recon break; never retried automatically; staff replay with a reason after fixing the cause |
In Stripe test mode, use test card `4000 0000 0000 0077` so charges land in the available balance immediately (runbook, §12).

Payouts are confirmed by the synchronous transfer response (Stripe transfers don't settle asynchronously in test mode); the `transfer.created` event is stored and deduplicated. Payouts are skipped (left `initiated`, retried later) while reconciliation pauses releases; refunds never pause.

## 6. Worker and jobs (NFR-OPS-05/06)
One process, one loop, steps run in order every `WORKER_INTERVAL_MS`; each step is idempotent and bounded so a slow step can't starve the next:
1. Upsert `worker_heartbeats('worker')`.
2. Expire holds (≤ 100): pending backings past `hold_expires_at` or campaign deadline → (no `payment_ref`: look the PaymentIntent up by metadata first, §5) → provider cancel → `release_backing_hold`.
3. Process provider events (≤ 100).
4. Settle due campaigns — **one transaction per campaign**; a failure is logged with that campaign's id and the loop continues (one failing campaign never blocks others).
5. Drain outbox (≤ 100): topics `backing.refund` (→ outbound op), `tranche.release` (→ outbound op), `campaign.funded` (→ queue tranche 1 + notifications), `campaign.failed` (→ notifications), `notify.*` (→ notifications), `outbound.retry`.
6. Execute due privileged actions (`scheduled` and `execute_after <= now()`).
7. Reconcile if the last completed run is older than 24 h (and on demand).

No database lock is held across a provider call: each outbound step is "commit `initiated` → call provider → commit result".

## 7. Reconciliation (FR-PAY-007, processor slice)
- **Expected provider balance per campaign** = ledger `escrow_cash(campaign)` + Σ `platform_funding` entries on that campaign's transactions. (Refunds are funded partly by FanZuP covering the non-refundable fee; that cash never moved at the processor, so it is added back. Funded campaigns end at 0; failed ones at −fees on both sides.)
- **Provider balance per campaign** = Σ over balance transactions attributed to the campaign (metadata / `transfer_group`): charges `amount − fee`, refunds `−amount`, transfers `−amount`, fee adjustments `±`.
- **Matching:** every provider transaction must match a ledger transaction by `external_ref` (payment, refund, payout refs) and every ledger transaction with an `external_ref` must match a provider transaction. Misses become `unmatched_provider_txn` / `unmatched_ledger_txn` breaks.
- **Run output:** per-campaign diff, total diff, breaks opened/updated/auto-resolved (a break absent from a later run resolves as `cleared_by_run`). Stored in `recon_runs`/`recon_breaks`; exposed at `/staff/recon/latest`.
- **Schedule:** M1 runs when the last completed run is older than 24 h, plus on demand; FR-PAY-007's "by 10:00 ET next business day" schedule lands at M2 (G2 condition 21).
- **Pause rule:** any open break with `|amount| > recon.materialityMinor` or older than `recon.maxBreakAgeBusinessDays` pauses payouts (refunds continue) until resolved or an override action executes (reason + aal2 + FR-ID-007 delay).
- **Public counters** (G2 condition 2; counter rule §3.5): each run also checks every campaign's `raised_minor` against Σ `amount_minor` of its `held` + `released` backings, `backers_count` against distinct backers with a `held`/`released` backing, and the ledger `backer_liability` balance against the **liability invariant** of §3.5 — Σ `coalesce(captured_minor, amount_minor)` over `held` + `refund_pending` backings + Σ open stray captures (stray refund not yet confirmed). A counter mismatch opens a `counter_mismatch` break (no payout pause — it isn't money); a liability mismatch opens a `liability_mismatch` money break (amount = ledger − expected; pauses payouts under the pause rule).
- **Stray captures** (§3.5.1; review round 3): resolved by their own refund op, not by a break. An open stray refund op inside `recon.maxBreakAgeBusinessDays` is expected state — included in expected liability and expected provider balance, so no break opens. A stray whose refund op is still unconfirmed past that age opens a `stray_capture_aged` money break; it auto-resolves (`cleared_by_run`) once the refund confirms.
- **Fee corrections:** a provider fee change after capture is posted as a correcting transaction (`fee.adjusted`), never an edit. (Stripe test mode rarely changes fees; the path exists and is unit-tested.)

## 8. Correlation ids (NFR-OPS-04, exit test 4; ADR-005)
- Accept `x-correlation-id` matching `^[A-Za-z0-9._:-]{8,64}$`, else generate a UUID; echo it on the response and in every error body.
- A request's context (`correlationId`, `actorId`, `actorKind`, `aal`) lives in `AsyncLocalStorage`; `asUser`/`asService` set `fanzup.*` with `set_config(…, true)` at the start of every transaction, so audit, ledger and outbox rows inherit it.
- **Propagation:** backing → PaymentIntent metadata → its events are processed under the backing's id. The id written to the PaymentIntent is always `backings.correlation_id` (the creating request's id), so a resumed checkout sends the same metadata and Stripe's idempotent replay succeeds (§4.4 step 3); the resuming request's own id appears on its audit rows and logs only. Settlement runs under a new id per campaign settlement; the outbox rows it writes carry it; the refund ops and their events run under the op's id (= the outbox row's). A verification action's id flows to the `tranche.release` outbox row, the payout op and the release posting. Logs are JSON lines with `correlationId`.
- **Trace:** `GET /staff/trace/:id` returns every row carrying the id, in time order. The CI money-flow test asserts that a failed campaign's settlement id returns the settle audit, every refund op and every `backing.refunded` posting, and that a backing's id returns checkout → capture.

## 9. Security
**Trust boundaries:** browser ↔ API (untrusted input, bearer tokens); API ↔ Postgres (service role only for money functions); Stripe → webhook (signature); API/worker → Stripe (restricted test key); staff ↔ API (aal2).

**Authorisation model.** Reads by fans and artists run as `authenticated` under RLS (`asUser`), so user A can't read user B's backings (existing tests plus new ones for `GET /backings/:id`). Money functions are executable only by `service_role` (tests). Staff endpoints derive actor and factor from the verified token, never the body (FR-ID-003). Reviewer ≠ owner is enforced in SQL (`review_campaign`, `verify_tranche`, `request_backing_refund` refuse when the actor owns the campaign's artist), and a staff member can't create an artist while single-operator mode is on.

**Single-operator mode (FR-ID-007, card G1-A).** Every privileged action (review, verify, refund, replay of events or ops, recon override, weekly sign-off) requires `aal2`, a typed reason (≥ 10 chars) and is written to `privileged_actions` + audit. Money actions above `singleOperator.delayAboveMinor` are `scheduled` for `delayHours` and cancellable. **A delayed staff refund must not outlive the campaign** (review round 2): when `backing.refund` would be scheduled with `execute_after >= campaigns.ends_at`, the API refuses with `409 refund_after_deadline` ("This refund would run after the campaign ends. If the campaign misses its goal every backer is refunded automatically; refunds from a funded campaign arrive in M2.") and writes no action row — otherwise it would execute against a `funded` campaign and fail (`request_backing_refund` accepts only `live`/`failed`). If a scheduled refund still meets a settled campaign (e.g. the worker was down past the deadline), the executor's SQL error marks the action `failed` with an alert line, never a partial refund. As built (`apps/api/src/staff.ts` `privileged()`, PR #8) there is no `ends_at` check — review fix, PR #8. Daily limits (refund total, verification count) are counted over scheduled + executed actions in the UTC day. The weekly review lists all actions in the week; sign-off is itself recorded. Break-glass suspension is M2 (FR-CMP-007). N3 (change management for one maintainer) is handled in the plan: required CI checks on PRs, a recorded agent review in each PR, and Wayne as the only merger; a second human reviewer is due at P0b.

**Fail closed (NFR-SEC-04, FR-PAY-008).** `DEPLOY_ENV` (`local` | `ci` | `staging` | `production`; treated as deployed when `DEPLOY_ENV` is staging/production **or** `VERCEL_ENV`, `RENDER` is set **or** `NODE_ENV=production` — G2 condition 15). Deployed + `sandbox` provider → refuse to start (the misconfigured app returns 503 naming the variable). Any Stripe key not starting `sk_test_`/`rk_test_` → refuse. Dev routes register only when `sandbox` and not deployed. Webhook rejects live events. *Consequence:* the hosted deployment needs `ESCROW_PROVIDER=stripe-test` and test keys before `/api` works (§12).

**Input validation.** zod on every body/query; slugs, URLs (evidence links must be `https:`), lengths; Idempotency-Key bounds; correlation-id pattern. User text is stored as plain text and rendered by React as text (no `dangerouslySetInnerHTML` on M1 paths).

**Seed data (NFR-SEC-07).** `supabase/seed.sql` holds demo users with a published dev password, **including a staff reviewer**, so it is for **local and CI only**. It is loaded by `supabase start` / `supabase db reset` on a developer machine and in CI, and nowhere else: the manual `db-deploy.yml` workflow runs plain `supabase db push` with no seed option, and Supabase's GitHub integration applies migrations to production without running the seed. (If Supabase preview branches are ever enabled they do run the seed; they count as CI and must never back a hosted app.) Hosted environments get users only through sign-up; staff is granted by a manual SQL insert.

**Secrets and PII.** No secrets in the repo; `.env.example` only. Logs redact `authorization`, `cookie`, `stripe-signature`, `idempotency-key`, client secrets and query strings (NFR-SEC-12); emails are never logged. Notification rows store the user id, not the address. Audit payloads carry ids only (NFR-COMP-11; N7's IP/UA sidecar is an M2 condition — M1 stores IP/UA only in `consents`).

**Known gaps accepted for M1 (each tracked as a G2 condition):**
- **G-1** Sign-up acceptance rows have no IP/UA because sign-up goes browser → Supabase Auth directly; re-acceptance through the API records both. Fix at M2 with a Supabase "before user created" hook or an API-proxied sign-up.
- **G-2** Clients keep direct write grants on draft tables (RLS still enforces ownership and column grants keep money fields out); revoked at M2 when the wizard is wired.
- **G-3** Rate limiting on writes (NFR-SEC-13) is M2; M1 relies on the unconfirmed-checkout cap and Supabase Auth's own limits.

### Threat model (M1 surfaces)
| Asset / surface | Threat | Mitigation in M1 |
|---|---|---|
| Ledger integrity | Double capture/refund/payout from retries or duplicate events | Unique event ids; idempotency keys on every posting; `outbound_ops` unique per subject; provider lookup before retry; append-only + truncate-blocked ledger |
| Webhook endpoint | Forged or replayed events; live events into test system | Signature on raw body; unique `(provider,event_id)`; livemode and account checks |
| Checkout | Card testing, stock exhaustion via holds | Verified account required; unconfirmed-checkout cap; holds expire in 15 min; bot challenge and instrument limits at P0b |
| Staff powers | Stolen staff password; self-dealing | aal2 required; reason + audit; delay and daily limits; reviewer ≠ owner; no seeded staff outside local/CI |
| Artist payout reference | Read by others; redirected | Column grants hide it; set only through the API from Stripe onboarding; cooling-off is FR-ID-008 (P0b) |
| Fan data | Cross-user reads | RLS on reads; owner checks on `GET /backings/:id`; column allowlists |
| Provider keys | Leak via logs or client | Server-only env; restricted test key; redaction; `VITE_` allowlist unchanged |
| Dev routes | Reachable in a deployment | Registered only when sandbox and not deployed; deployed + sandbox refuses to start |

## 10. Capacity and failure modes
**Load (M1):** ≤ 5 campaigns, ≤ 100 backings, one operator. Design headroom for M2 (beta: ≤ 20 campaigns, ≤ 5k backings): the worker processes ≤ 100 outbox items per tick; at a 30 s tick that's 200/min, so a 5,000-backer failure initiates all refunds in ≈ 25 min (inside NFR-PERF-03's 1 h). Stripe test mode allows ~25 req/s; the worker is sequential (≈ 5 req/s), well under it. Postgres: all hot queries are on indexed status/deadline columns; holds and outbox scans use partial indexes.

| Failure | Blast radius | Behaviour |
|---|---|---|
| Stripe API down | New checkouts, refunds, payouts | Checkout 502 with "nothing was charged, try again" (same key resumes); outbound ops back off then dead-letter; nothing posts to the ledger without a provider result |
| Webhook delivery delayed/out of order | Captures and refund confirmations late | Stored events processed oldest first; confirmations apply by op metadata in any order; late capture after deadline → auto-refund; refund confirmation before op marked `sent` is still applied (op looked up by metadata) |
| Worker down | Settlement, refunds, releases, holds, recon stall | Heartbeat age on `/health`; external monitor (setup step) pages; everything resumes idempotently |
| One campaign's settlement throws | That campaign only | Per-campaign transaction; error logged with id; others proceed |
| Recon break | Payouts for everyone (by design) | Refunds continue; staff resolves or overrides with delay |
| Supabase Auth down | Sign-up/sign-in | Public reads still work; checkout unavailable with a clear message |
| DB down | Everything | `/health` 503; API returns 503; no partial money state because each step is one transaction |

## 11. Web app wiring (exit test 6)
| Path | Change |
|---|---|
| `/explore` | Reads `GET /campaigns` (live tab + funded tab, type filter, paging); loading/empty/error states; cards link to `/campaigns/:slug` |
| `/campaigns/:slug` | Reads `GET /campaigns/:slug`; renders only present fields (FR-CMP-003); deadline in the viewer's local time with the zone, and **hours and minutes left when under 24 h**, updating each minute, backing open until the instant passes (FR-BCK-004); perk selection; `ref` captured from the URL; "Back" → guard (§ below); FR-PLT-006 notice; FAQ reworded (charge at backing; no "escrow") |
| `/signup`, `/login`, `/verify-email`, `/reset-password` | Real Supabase Auth; `next` (same-origin path only) carries campaign + perk; sign-up collects display name, email, password, 18+ and terms checkboxes; verify page completes the session from the link and forwards to `next`. Cross-device (G2 condition 13): opening the link on another device verifies the email and signs that device in, forwarding it to the same checkout; the first device keeps asking the fan to sign in or to continue after verification (its page polls `GET /me` and offers "I've verified — continue") |
| `/checkout/:slug?perk=&qty=` **(new route, fan shell)** | Guard: signed out → `/signup?next=…`; unverified → `/verify-email?next=…`. Shows perk, delivery date, quantity, total, when the card is charged, the refund promise and the test-mode notice; re-acceptance checkbox when `needsAcceptance`; creates the backing (one Idempotency-Key per checkout attempt, kept in `sessionStorage` so a reload resumes; **review round 3:** because the server stores and replays 4xx outcomes (§4.4), the client discards the stored key and mints a new one after **any** 4xx response to `POST /backings` — including `checkout_expired`, `acceptance_required` (after the fan re-accepts), `too_many_open_checkouts`, `perk_sold_out`, `campaign_closed` — and whenever the backing it points at is no longer payable: hold expired, payment cancelled, or the backing is `canceled`/`refund_pending`/`refunded`. Only a 502 `provider_unavailable`, a 409 `in_progress` or a network error keeps the key, so the retry resumes the same backing); pays with the Payment Element (Stripe) or the labelled sandbox card form; polls `GET /backings/:id` until `held`, then shows the confirmation (deadline in local time, what happens either way, share prompt) |
| `/backed` | Reads `GET /me/backings`; shows campaign status, money state, released share, refund amount/date/reference, perk status "Not yet shipped", next event |
| Shared | `src/lib/supabase.ts`, `src/lib/session.tsx` (session context), `src/lib/api.ts` (typed client, correlation id per call), `TestModeNotice` in `components/brand/compliance.tsx`; `EscrowNotice` copy changed to the FR-PLT-006 promise |

Every other route keeps its mock data until M2. **Remaining "escrow" copy outside the M1 paths** (Trust, Fees, For Artists, Landing, creator wizard/payouts, settings payments; found with `grep -ril escrow apps/web/src/pages`) is tracked to M2 with FR-PLT-002 route pruning (G2 condition 19). `pnpm lint:copy` runs on the web app and now also scans the API's email templates.

## 12. Setup steps that need Wayne (no secrets in the repo)
1. **Stripe (test mode):** add `STRIPE_SECRET_KEY` (`sk_test_…`, ideally a restricted key), `STRIPE_WEBHOOK_SECRET` and `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`; read by the API and served to the web app through `GET /config`, so no `VITE_` variable) to Vercel/Render — the variables `apps/api/src/env.ts` reads in PR #7; set `ESCROW_PROVIDER=stripe-test` (PR #7 introduces `stripe-test` and keeps `stripe-dev` as an accepted alias; until #7 merges the only accepted value is `stripe-dev`, T-004); enable Connect (Express) in test mode; add **one platform webhook endpoint** (not a Connect endpoint, §5) at `/api/v1/webhooks/stripe` subscribed to `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `refund.created`, `refund.updated`, `refund.failed` and `transfer.created` — the list in `docs/SETUP.md` C4 as PR #9 updates it, and the types `normalizeStripeEvent` maps. Optional: the same values as GitHub Actions secrets to turn on the Stripe test-mode CI job. Pay with test card `4000 0000 0000 0077` so funds are available for transfers immediately. **Expect hosted `/api` to answer 503 "misconfigured" (fail closed, FR-PAY-008) from the moment M1 merges until these are set** (G2 condition 6).
2. **Supabase Auth (hosted):** confirm email confirmations on; add redirect URL patterns `https://<site>/**` (G2 condition 17); enable TOTP MFA. For local and CI, `supabase/config.toml` `additional_redirect_urls` must include `http://127.0.0.1:5173/**` and `http://localhost:5173/**` — today it lists only the exact origins; PR #9 adds the patterns (T-019). **Create your own account through the app's sign-up page** — the new-user trigger refuses accounts without the 18+ attestation, so "Add user" in the Supabase dashboard fails by design (G2 condition 5). The real sign-up page exists only once PR #9 is merged and deployed (before that `/signup` is the prototype's mock), and the trigger only once PR #8's migration runs — so do this after both. Then enrol TOTP and grant yourself staff with one SQL insert (never via seed — the hosted database never gets `seed.sql`, §9). M1 has no staff or artist UI and no TOTP enrolment screen, so enrolment and the API calls for exit test 8 use the operator script (§12.6).
3. **Error tracking and email delivery:** choose Sentry (or similar) and an email provider (Postmark/Resend); M1 logs both.
4. **Uptime check:** an external monitor on `/api/health` that alerts when `worker.ageSeconds > 600`. Until alerting exists, check `GET /api/v1/staff/queue?type=dead_letters` and `/api/health` once a day (G2 condition 20).
5. **Keep the hosted environment unadvertised** (test users only) until M2 replaces the placeholder Terms/Privacy with a real privacy notice (G1 N5; G2 condition 22).
6. **Exit test 8 without a staff UI (review round 2):** `pnpm m1:operator` (`scripts/m1-operator.ts`, T-024, PR #9) drives the non-fan half of the journey against any API URL. It reuses the flow already proven in `e2e/support.ts` (`staffToken`: password sign-in → `mfa.enroll` TOTP → `mfa.challengeAndVerify` → aal2 access token) but takes the email from a flag and the password and TOTP codes from a prompt, never from the repo. Commands: `totp-enrol` (prints the `otpauth://` URI / secret to add to an authenticator app, then verifies one code), `token` (password + current TOTP code → aal2 token kept in memory for the session), `artist-setup` (artist profile, `payout-account` — prints the onboarding URL and re-checks until `verified` — campaign, perks, tranches, submit), `staff review|verify|refund|recon|trace` (each asks for the typed reason), `publish`, `evidence`. The artist must be a second account (reviewer ≠ owner; staff may not own an artist in single-operator mode).
7. **Check the hosted database was never seeded (review round 3).** `supabase/seed.sql` publishes one dev password (`FanzupDev123`, `docs/SETUP.md` A3) for every demo user, including `reviewer@fanzup.test`, a staff row. If the seed ever reached a hosted project (a manual `db reset --linked`, a preview branch that later backed an app, a pasted script), anyone could sign in as that reviewer with the published password, **enrol their own TOTP factor on it** (the account has none) and reach `aal2` staff powers — refunds, verifications, replays. Before granting yourself staff (§12.2), run in the hosted project's SQL Editor: `select email from auth.users where email like '%@fanzup.test';` and `select * from public.staff;`. Both must return no seeded rows (`staff` may hold only your own row once you've added it). If any exist, delete the `staff` rows of those users first (removes the staff power at once), then the users; if the delete is refused because seed artists/campaigns/backings reference them, the seed ran in full — replace the project with a fresh one and push migrations to it (`docs/SETUP.md` B1, B3; never `db reset --linked`, which loads the seed again). Step B3a in `docs/SETUP.md`.

## 13. Requirements coverage (M1)
| Requirement | Component(s) |
|---|---|
| FR-PAY-001 | `create_backing_hold`, `release_backing_hold`, worker step 2, provider `cancelPayment` |
| FR-PAY-002 | `provider_events`, webhook route, worker step 3, staff replay |
| FR-PAY-003 | `apply_payment_captured` (late/mismatch → refund sized from the captured amount + break), stray captures refunded by a payment-keyed op (§3.5.1), unmatched queue, `notify.refund_started` with reason |
| FR-PAY-004 | `outbound_ops` state machine, provider `find*`, dead-letter queue, staff replay |
| FR-PAY-005 | `tranche_evidence`, `verify_tranche`, `tranche.release` outbox, payout op, `record_tranche_released` |
| FR-PAY-006 | claim-first `api_idempotency` with claim + hold in one transaction, stored error outcomes, 2-minute abandoned-claim rule (§4.4); parallel-request and crash-between-steps tests |
| FR-PAY-007 | §7 recon job, `recon_runs/breaks`, payout pause, override action |
| FR-PAY-008 | env fail-closed rules, live-key refusal, webhook livemode check |
| FR-PAY-009 (fan) | `fan_backings()`, distinct-backer counting |
| FR-BCK-001 | checkout route, Payment Element / sandbox form, failure categories, confirmation |
| FR-BCK-002 | auth pages with `next`, checkout guard, verify-email forwarding |
| FR-BCK-004 | `ends_at` instant; checks in `create_backing_hold` and `apply_payment_captured` (processing time, D-001); local-time display with zone; hours-and-minutes countdown under 24 h (§11); holds released at deadline |
| FR-BCK-005 | `/backed` + `GET /me/backings` |
| FR-CMP-001/002 | artist API (asUser + RLS), `submit_campaign`, `review_campaign` (staff API), `publish_campaign` |
| FR-CMP-003 | campaign page renderer, `GET /campaigns/:slug` |
| FR-CMP-008 | `GET /campaigns` ordering/filters, explore page |
| FR-DSP-001 (M1) | `request_backing_refund`, staff refund action, refund op |
| FR-ID-001 | Supabase Auth pages; server verified-email check |
| FR-ID-002 (staff) | `aal2` check in `requireStaff` |
| FR-ID-003 | context actor/aal from token; SQL reviewer ≠ owner |
| FR-ID-004 | `POST /artist/payout-account` (Stripe Connect Express test / sandbox) sets `identity_status` from account readiness; payouts wait for an account (§3.5.2) |
| FR-ID-005 | checkout and `/backed` guards; staff 403 |
| FR-ID-006 | `handle_new_user` attestation check, `consents` |
| FR-ID-007 | `privileged_actions`, delay/limits (delayed refund refused past `ends_at`), weekly review + sign-off; operator script for aal2 calls (§12.6) |
| FR-NTF-001 | `notify.*` outbox topics, `notifications`, templates with version, log transport |
| FR-PRV-001 | `consents`, `/me/acceptances`, `needsAcceptance`, checkout block |
| FR-PLT-006 | `TestModeNotice`, `EscrowNotice` copy, email footer, `/config.testMode` |
| FR-TAX-004 (cap) | `create_backing_hold` open-checkout cap |
| FR-ANL-001 (events) | `funnel_events`, `POST /events`, server-emitted events |
| NFR-SEC-01 (slice) | migration 0500 + column test |
| NFR-SEC-02 (slice) | API-only money/workflow writes; revoked client execute |
| NFR-SEC-04 | `loadEnv` deploy rules |
| NFR-SEC-07 | Hosted environments never load `seed.sql`: it runs only via `supabase start`/`db reset` locally and in CI; `db-deploy.yml` has no seed option and runs plain `supabase db push`; Supabase's GitHub integration applies migrations only (no seed) to production; no migration inserts into `staff`; Wayne's account is made by sign-up and staff is granted by one manual SQL insert (§9, §12.2). Guard test (T-017): no workflow contains `--include-seed` and no migration inserts into `public.staff` |
| NFR-SEC-12 | logger redaction + error redaction helper |
| NFR-COMP-11/12 | context columns on audit; truncate triggers |
| NFR-OPS-04/05/06 | §6, §8, heartbeat |
| NFR-QA-01/02 | API test suites; Playwright golden journey |

## 14. Rejected alternatives
- **Call Stripe directly in tests (`stripe-mock`)** — stateless fixtures can't exercise refunds, transfers or reconciliation; the sandbox provider that writes real events through the inbox tests more of our code. Stripe behaviour is covered by adapter unit tests on recorded payloads and the manual exit test 8.
- **Process webhooks synchronously in the request** — ties Stripe's retry behaviour to our processing errors and makes "stored before processed" untestable; we store, ack, then process.
- **Charge at success (authorise now, capture at deadline)** — card authorisations expire after ~7 days, campaigns run 7–60; would need re-authorisation flows. Charge at backing is current design and N8's resolution.
- **API-proxied sign-up** — records IP/UA at acceptance but routes all sign-ups through one IP for Supabase's rate limits; deferred to M2 (G-1).
- **Magic link as the only method (Pragmatist NIT)** — card G1-B chose a full account first; password + confirmation is the closest match and magic link stays an M2 add.
- **A job queue product (pg-boss, Inngest, Vercel Queues)** — the outbox + `skip locked` loop already meets NFR-OPS-05 at M1/M2 volume; revisit with ADR-002's triggers.
- **Correlation id as an explicit SQL function parameter** — would change every money function's signature; GUC + column defaults reaches existing functions untouched.
- **Separate ledger account for unapplied captures** — the money is owed to the backer either way; reusing `backer_liability` with a distinct transaction kind keeps the chart of accounts small and recon simpler.

## 15. Riskiest assumptions
1. **The sandbox provider is faithful enough to Stripe test mode** that a green CI run predicts a clean Stripe run (event ordering, fee availability via balance transactions, transfers needing available balance — in test mode, use card `4000 0000 0000 0077` so funds are available immediately). Mitigation: adapter unit tests on recorded Stripe payloads; manual exit test 8; optional Stripe CI job once keys exist.
2. **Supabase CLI local stack runs reliably in GitHub Actions** (image pulls, ~2–3 min startup). Mitigation: exclude unused services; cache nothing secret; the e2e job is separate from the fast API/web jobs so a flaky stack doesn't hide unit failures.
3. **Hosted `/api/*` stays healthy through M1.** The earlier hosted 500 was fixed on `main` by 4a18c1b (the Vercel API entry is now built as CommonJS `dist/server.cjs`). The remaining risk is the intended fail-closed 503 once M1 merges and before Stripe test keys are set (§9, §12.1). M1 is still proven in CI and locally; the hosted run is exit test 8 (manual).

## Change log
- 2026-10-03: first draft for G2 (M1 only).
- 2026-10-03: revised after G2 pass 1: provider error classes and `wait_funds` (blocker 1); conditions 1–8, 11–22 applied in place; 9–10 recorded in ADR-006 and the plan.
- 2026-10-11: PR #6 review round 1: §3.5 counter rule (counters/perk units adjust when a backing leaves `held` for `refund_pending`; `settle_campaign` funded branch releases only `held`; failed campaign closes only when nothing `held`/`refund_pending`); §4.4 claim + hold in one transaction, stored error outcomes, 2-minute abandoned-claim rule; §9 seed is local/CI only; NFR-SEC-07 row corrected; §12.1 `stripe-test` alias note; §12.2 redirect patterns land in PR #9; §11 under-24 h countdown; D-001 processing-time deadline; §15.3 hosted 500 fixed on main (4a18c1b).
- 2026-10-11: PR #6 review round 2 (post-gate delta, see `gates/G2-design.md`): §3.7 seed/test-helper/shim metadata and seed-version sync test; §3.5.2 artist identity = ready payout account via `POST /artist/payout-account`, payouts wait (no break) without an account, staff `payouts` queue; §12.1 one platform webhook endpoint with the event list SETUP and the adapter use, env names corrected; §3.5/§3.5.1 unapplied captures store captured amount/currency/fee and refund from `captured_minor`, captures matched by `payment_ref`, stray captures refunded by a payment-keyed op, capture idempotency keyed by payment; §4.4 step 3 terminal `checkout_expired`; §5 hold expiry looks up a PaymentIntent before releasing a null-ref hold, refund confirmation by `refund.*` events only (no `charge.refunded`); §9 delayed staff refund refused past `ends_at`; §12.2/§12.6 sign-up after PR #9 and the operator script for exit test 8.
- 2026-10-11: PR #6 review round 3 (post-gate delta): §4.4 step 3/§8/ADR-005 deterministic PaymentIntent params from the stored backing (`metadata.correlation_id = backings.correlation_id`); §3.5/§3.5.1/§7 liability invariant incl. `captured_minor` and open stray captures, stray captures resolve via their refund op (`stray_capture_aged` break only past `recon.maxBreakAgeBusinessDays`), `liability_mismatch` money break; §4.2/§5 unknown-connected-account events stored `ignored` in the same insert and answered 200 (no `account_mismatch`); §11 new Idempotency-Key after any stored 4xx or a dead backing; §12.7 hosted seed check.
