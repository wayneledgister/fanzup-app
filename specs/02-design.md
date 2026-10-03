# FanZuP v2 — Technical Design · Milestone M1 (walking skeleton)
**Tier:** Enterprise · **Scope:** M1 only (G1 card G1-C) · **Status:** G2 pass 2 (revised after pass 1) · **Date:** 2026-10-03
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
| Payments | Stripe **test mode** only: PaymentIntents + Payment Element, Refunds, Connect Express transfers ("separate charges and transfers") | E1-B default; already integrated as `stripe-dev` |
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
| `20261004000300_m1_checkout_and_money.sql` | Checkout holds; revised capture; late-capture + refund functions; staff refund; fan money-state function; distinct-backer counting |
| `20261004000400_m1_staff_and_recon.sql` | `privileged_actions`, `review_signoffs`, `tranche_evidence`, `recon_runs`, `recon_breaks`, `notifications`, `funnel_events`, `consents`; revised workflow functions |
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
`id uuid pk · kind text ('refund','payout') · subject_id uuid (backing or tranche) · amount_minor bigint > 0 · idempotency_key text unique · status text ('initiated','sent','confirmed','failed','dead') · provider_ref text · attempts int · next_attempt_at · last_error · correlation_id · created_at · updated_at` · **unique (kind, subject_id)** so one backing can never have two refund operations and one tranche two payouts.

### 3.4 Checkout holds (FR-PAY-001, FR-PAY-006)
- `perks.claimed` now counts **held + captured** units. `create_backing_hold(...)` does `update perks set claimed = claimed + q where id = … and (quantity_limit is null or claimed + q <= quantity_limit)`; zero rows → `perk_sold_out`. The row lock makes the last-unit race serialise; the check constraint is the backstop.
- `backings.hold_expires_at = now() + POLICY.checkout.holdMinutes`. `release_backing_hold(backing, reason)` sets `canceled`, returns the units, audits. Called by the worker when the hold expires or the campaign deadline passes, after the provider confirms the payment attempt is cancelled.
- Unconfirmed-checkout cap: `create_backing_hold` refuses when the user already has `POLICY.checkout.maxUnconfirmedPerUser` unexpired `pending_payment` backings (FR-TAX-004 slice).
- `api_idempotency` gains `resource_id uuid` and `state text ('in_progress','done')` for claim-first idempotency (§4.4).

### 3.5 Money functions (new or replaced; all `security definer`, `search_path = ''`, execute granted to `service_role` only)
| Function | Does |
|---|---|
| `apply_payment_captured(backing, payment_ref, amount, currency, fee, idem) → text` | If the backing is `pending_payment`, the campaign is `live`, `now() < ends_at`, and amount/currency match: post `backing.captured` (as today), mark `held`, add to `raised_minor`, add to `backers_count` **only if this backer has no other held/released backing on the campaign** (FR-PAY-009), queue `notify.backing_receipt`, record `backing_confirmed` funnel event → `'applied'`. Otherwise post `backing.captured_unapplied` (escrow_cash + fee clearing vs backer_liability, no counters), mark `refund_pending`, queue `backing.refund` with the reason, open a recon break when the amount differs → `'refund:<reason>'`. Idempotent on `idem`. |
| `record_refund_confirmed(backing, refund_ref, amount, idem)` | Replaces `record_backing_refunded` for every refund path. Requires the backing `held` or `refund_pending` and `amount = backings.amount_minor` (else raises; caller opens a break). Posts `backing.refunded` exactly as today: FanZuP absorbs the non-refundable processing fee on **every** refund in M1, including staff refunds — the E1-C default, revisited when card C is decided (G2 condition 8). If the backing was `held` on a **live** campaign (staff refund) it also takes the amount off `raised_minor` and recounts distinct backers; perk units return unless the backing was already `canceled`. Closes a failed campaign to `refunded` when nothing `held` or `refund_pending` remains. |
| `request_backing_refund(backing, reason)` | Staff refund (FR-DSP-001 M1 slice): backing `held` on a `live` or `failed` campaign → `refund_pending`, queue `backing.refund`. Funded-campaign refunds (from artist payable/holdback) are M2. |
| `settle_campaign` | Unchanged logic; refunds it queues now flow through `outbound_ops`. |
| `verify_tranche(tranche, reviewer)` | Adds reviewer ≠ owner, `evidence_submitted` required for tranche ≥ 2, queues `tranche.release`. |
| `record_tranche_released(tranche, payout_ref, amount, idem)` | Replaced: takes the payout op's amount and raises unless it equals `tranche_release_amount()` (G2 condition 1); called only after the payout op is confirmed. |
| `fan_backings(user) → setof record` | FR-BCK-005 / FR-PAY-009 fan view; money state derived from the ledger: `pending` (no capture), `held` (captured, campaign live), `refunding` (refund_pending), `refunded` (a `backing.refunded` transaction exists), `with_artist` (campaign funded; shows the **campaign-level** released share = Σ tranche releases ÷ artist net — not a per-backing figure, G2 condition 4), `released` (campaign released). |

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
| `POST /artist/payout-account` | artist | — | `{ status, onboardingUrl\|null }` (Stripe Connect Express account link in test mode; sandbox sets a test account) | 409 |
| `POST /artist/campaigns` | artist | `{ slug, title, type, blurb?, story?, risks?, goalMinor, durationDays, milestoneRelease }` | 201 campaign | 400, 409 |
| `PATCH /artist/campaigns/:id` | artist (draft or revisions) | partial of the above | 200 | 404, 409 |
| `PUT /artist/campaigns/:id/perks` | artist (draft) | `[{ id?, title, description?, kind, priceMinor, quantityLimit?, fulfillBy, shipsTo? }]` | 200 | 400 |
| `PUT /artist/campaigns/:id/tranches` | artist (draft) | `[{ seq, pct, milestone?, evidenceRequired?, targetDate? }]` (Σ pct = 100, 2–3 tranches) | 200 | 400 |
| `POST /artist/campaigns/:id/submit` · `/publish` | artist | — | 200 `{ status, endsAt? }` | 409 rule |
| `POST /artist/tranches/:id/evidence` | artist (funded campaign) | `{ notes, links: url[] ≤ 10 }` | 201 | 409 |
| `GET /staff/queue?type=review\|verification\|refunds\|unmatched\|dead_letters\|breaks\|failed_events\|scheduled` | staff | — | `{ items: [{ type, id, subjectId, summary, ageSeconds, correlationId }] }` (one table-backed list, Pragmatist NIT) | 403 |
| `POST /staff/campaigns/:id/review` | staff | `{ decision, notes?, reason }` | 200 | 403 not-linked rule, 409 |
| `POST /staff/tranches/:id/verify` | staff | `{ reason }` | 200 `{ action: {id, status, executeAfter} }` | 403, 409 daily limit |
| `POST /staff/backings/:id/refund` | staff | `{ reason }` | 200 `{ action }` | 403, 409 daily limit / state |
| `POST /staff/actions/:id/cancel` | staff | `{ reason }` | 200 | 409 already executed |
| `POST /staff/provider-events/:id/replay` · `/staff/outbound-ops/:id/replay` | staff | `{ reason }` | 200 | 409 |
| `POST /staff/recon/run` · `GET /staff/recon/latest` | staff | — | run + open breaks | — |
| `POST /staff/recon/override` | staff | `{ reason }` | 200 `{ action }` (delayed per FR-ID-007, N4) | — |
| `GET /staff/trace/:correlationId` | staff | — | `{ audit[], ledger[], outbox[], providerEvents[], outboundOps[], actions[], notifications[] }` ordered by time | — |
| `GET /staff/weekly-review?weekStart=` · `POST /staff/weekly-review/signoff` | staff | `{ weekStart, note }` | list / 201 | 409 already signed |
| `POST /webhooks/stripe` | Stripe signature | raw body | 200 `{received:true}` after the row commits; 400 bad signature; 400 `livemode_rejected`; 400 `account_mismatch` | — |
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
1. Verify token, require verified email; hash `{user, body}`.
2. **Claim** `api_idempotency(key = backings:<user>:<key>)` with `insert … on conflict do nothing returning`. If it already exists: different hash → 422; `state='done'` → replay the stored response; `in_progress` with no `resource_id` → 409 `in_progress`; `in_progress` with `resource_id` → resume at step 4 with that backing.
3. In one transaction: `create_backing_hold(...)` (campaign live and before deadline, not self-backing, current terms accepted, open-checkout cap, stock reserved, backing `pending_payment` with `correlation_id`, `hold_expires_at`, `source`); write `resource_id`. Commit — no lock is held past this point.
4. `provider.createPayment({ idempotencyKey: payment:<backing>, metadata: { backing_id, campaign_id, correlation_id } })`. On failure return 502; the claim stays `in_progress` with the backing, so a retry with the same key resumes here and Stripe returns the same PaymentIntent.
5. Store `payment_ref`; mark the claim `done` with the response; record `checkout_started` if the client didn't.

## 5. Payment provider flow (Stripe test mode; ADR-003)
**Charge timing (N8):** charge at backing — the PaymentIntent captures immediately (`capture_method: automatic`); a failed campaign refunds in full.

| Step | Stripe test mode | Sandbox (local/CI) |
|---|---|---|
| Create payment | `paymentIntents.create` (USD, `automatic_payment_methods`, `transfer_group = campaign_<id>`, metadata) with idempotency key | ref `sbx_pi_<backing>`, client secret is opaque |
| Fan pays | Payment Element `confirmPayment` in the browser | labelled test card form → `POST /dev/sandbox/pay` → sandbox emits `payment.succeeded`/`payment.failed` into `provider_events` |
| Capture known | webhook `payment_intent.succeeded` → stored → processed: fee read from the charge's balance transaction (retrieve with expand) | fee = `processingFeeMinor(amount)` |
| Hold expiry | `paymentIntents.cancel`; if it already succeeded, the late-capture path refunds | same semantics |
| Refund | `refunds.create({payment_intent, amount, metadata.outbound_op_id})`, idempotency key `refund:<backing>`; retry looks up `refunds.list({payment_intent})` by metadata first | emits `refund.succeeded` |
| Refund confirmed | webhook `refund.updated`/`charge.refunded` with status `succeeded` → `record_refund_confirmed` | same event shape |
| Payout | `transfers.create({destination: acct, amount, transfer_group, metadata.outbound_op_id})`, idempotency key `release:<tranche>`; retry looks up `transfers.list({transfer_group})` by metadata | emits `transfer.created` |
| Balance list (recon) | `balanceTransactions.list` (+ expand source for metadata) | derived from its own stored events |

**Webhook handling.** Verify the signature against the raw body; reject `livemode = true` (FR-PAY-008); platform events must carry no `account`; an event carrying a connected `account` is stored as `ignored` unless that account is one of our artists' `payout_account_ref` (G2 condition 16); insert into `provider_events`; return 200; then try processing once inline, best-effort. The worker processes anything `received` or retryable `failed`, oldest first, `for update skip locked`, bounded attempts (`outbound.maxAttempts`) then `dead` + alert log line. Processing runs under the correlation id of the backing or outbound op the event belongs to. There is no per-object ordering guarantee (G2 condition 3): a refund or transfer confirmation applies by its `outbound_op_id` metadata whatever state the op is in (the webhook can beat our own commit of `sent`); a `payment.succeeded` whose backing isn't visible yet is retried for 10 minutes before it becomes `unmatched`. Events with no matching backing/op after that become `unmatched` and appear in the staff unmatched queue (FR-PAY-003 bullet 3) and as recon breaks.

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
2. Expire holds (≤ 100): pending backings past `hold_expires_at` or campaign deadline → provider cancel → `release_backing_hold`.
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
- **Public counters** (G2 condition 2): each run also checks every campaign's `raised_minor` against Σ captured-and-not-refunded amounts in the ledger and `backers_count` against distinct backers with a held/released backing; a mismatch opens a `counter_mismatch` break (no payout pause — it isn't money).
- **Fee corrections:** a provider fee change after capture is posted as a correcting transaction (`fee.adjusted`), never an edit. (Stripe test mode rarely changes fees; the path exists and is unit-tested.)

## 8. Correlation ids (NFR-OPS-04, exit test 4; ADR-005)
- Accept `x-correlation-id` matching `^[A-Za-z0-9._:-]{8,64}$`, else generate a UUID; echo it on the response and in every error body.
- A request's context (`correlationId`, `actorId`, `actorKind`, `aal`) lives in `AsyncLocalStorage`; `asUser`/`asService` set `fanzup.*` with `set_config(…, true)` at the start of every transaction, so audit, ledger and outbox rows inherit it.
- **Propagation:** backing → PaymentIntent metadata → its events are processed under the backing's id. Settlement runs under a new id per campaign settlement; the outbox rows it writes carry it; the refund ops and their events run under the op's id (= the outbox row's). A verification action's id flows to the `tranche.release` outbox row, the payout op and the release posting. Logs are JSON lines with `correlationId`.
- **Trace:** `GET /staff/trace/:id` returns every row carrying the id, in time order. The CI money-flow test asserts that a failed campaign's settlement id returns the settle audit, every refund op and every `backing.refunded` posting, and that a backing's id returns checkout → capture.

## 9. Security
**Trust boundaries:** browser ↔ API (untrusted input, bearer tokens); API ↔ Postgres (service role only for money functions); Stripe → webhook (signature); API/worker → Stripe (restricted test key); staff ↔ API (aal2).

**Authorisation model.** Reads by fans and artists run as `authenticated` under RLS (`asUser`), so user A can't read user B's backings (existing tests plus new ones for `GET /backings/:id`). Money functions are executable only by `service_role` (tests). Staff endpoints derive actor and factor from the verified token, never the body (FR-ID-003). Reviewer ≠ owner is enforced in SQL (`review_campaign`, `verify_tranche`, `request_backing_refund` refuse when the actor owns the campaign's artist), and a staff member can't create an artist while single-operator mode is on.

**Single-operator mode (FR-ID-007, card G1-A).** Every privileged action (review, verify, refund, replay of events or ops, recon override, weekly sign-off) requires `aal2`, a typed reason (≥ 10 chars) and is written to `privileged_actions` + audit. Money actions above `singleOperator.delayAboveMinor` are `scheduled` for `delayHours` and cancellable; daily limits (refund total, verification count) are counted over scheduled + executed actions in the UTC day. The weekly review lists all actions in the week; sign-off is itself recorded. Break-glass suspension is M2 (FR-CMP-007). N3 (change management for one maintainer) is handled in the plan: required CI checks on PRs, a recorded agent review in each PR, and Wayne as the only merger; a second human reviewer is due at P0b.

**Fail closed (NFR-SEC-04, FR-PAY-008).** `DEPLOY_ENV` (`local` | `ci` | `staging` | `production`; treated as deployed when `DEPLOY_ENV` is staging/production **or** `VERCEL_ENV`, `RENDER` is set **or** `NODE_ENV=production` — G2 condition 15). Deployed + `sandbox` provider → refuse to start (the misconfigured app returns 503 naming the variable). Any Stripe key not starting `sk_test_`/`rk_test_` → refuse. Dev routes register only when `sandbox` and not deployed. Webhook rejects live events. *Consequence:* the hosted deployment needs `ESCROW_PROVIDER=stripe-test` and test keys before `/api` works (§12).

**Input validation.** zod on every body/query; slugs, URLs (evidence links must be `https:`), lengths; Idempotency-Key bounds; correlation-id pattern. User text is stored as plain text and rendered by React as text (no `dangerouslySetInnerHTML` on M1 paths).

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
| `/campaigns/:slug` | Reads `GET /campaigns/:slug`; renders only present fields (FR-CMP-003); perk selection; `ref` captured from the URL; "Back" → guard (§ below); FR-PLT-006 notice; FAQ reworded (charge at backing; no "escrow") |
| `/signup`, `/login`, `/verify-email`, `/reset-password` | Real Supabase Auth; `next` (same-origin path only) carries campaign + perk; sign-up collects display name, email, password, 18+ and terms checkboxes; verify page completes the session from the link and forwards to `next`. Cross-device (G2 condition 13): opening the link on another device verifies the email and signs that device in, forwarding it to the same checkout; the first device keeps asking the fan to sign in or to continue after verification (its page polls `GET /me` and offers "I've verified — continue") |
| `/checkout/:slug?perk=&qty=` **(new route, fan shell)** | Guard: signed out → `/signup?next=…`; unverified → `/verify-email?next=…`. Shows perk, delivery date, quantity, total, when the card is charged, the refund promise and the test-mode notice; re-acceptance checkbox when `needsAcceptance`; creates the backing (one Idempotency-Key per checkout attempt, kept in `sessionStorage` so a reload resumes); pays with the Payment Element (Stripe) or the labelled sandbox card form; polls `GET /backings/:id` until `held`, then shows the confirmation (deadline in local time, what happens either way, share prompt) |
| `/backed` | Reads `GET /me/backings`; shows campaign status, money state, released share, refund amount/date/reference, perk status "Not yet shipped", next event |
| Shared | `src/lib/supabase.ts`, `src/lib/session.tsx` (session context), `src/lib/api.ts` (typed client, correlation id per call), `TestModeNotice` in `components/brand/compliance.tsx`; `EscrowNotice` copy changed to the FR-PLT-006 promise |

Every other route keeps its mock data until M2. **Remaining "escrow" copy outside the M1 paths** (Trust, Fees, For Artists, Landing, creator wizard/payouts, settings payments; found with `grep -ril escrow apps/web/src/pages`) is tracked to M2 with FR-PLT-002 route pruning (G2 condition 19). `pnpm lint:copy` runs on the web app and now also scans the API's email templates.

## 12. Setup steps that need Wayne (no secrets in the repo)
1. **Stripe (test mode):** add `STRIPE_SECRET_KEY` (`sk_test_…`, ideally a restricted key), `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT_ID` and `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) to Vercel/Render; set `ESCROW_PROVIDER=stripe-test`; enable Connect (Express) in test mode; point a webhook at `/api/v1/webhooks/stripe` for `payment_intent.*`, `charge.refunded`, `refund.updated`, `transfer.created`. Optional: the same values as GitHub Actions secrets to turn on the Stripe test-mode CI job. Pay with test card `4000 0000 0000 0077` so funds are available for transfers immediately. **Expect hosted `/api` to answer 503 "misconfigured" (fail closed, FR-PAY-008) from the moment M1 merges until these are set** (G2 condition 6).
2. **Supabase Auth (hosted):** confirm email confirmations on; add redirect URL patterns `https://<site>/**` (G2 condition 17; local and CI patterns are in `supabase/config.toml`); enable TOTP MFA. **Create your own account through the app's sign-up page** — the new-user trigger refuses accounts without the 18+ attestation, so "Add user" in the Supabase dashboard fails by design (G2 condition 5). Then enrol TOTP and grant yourself staff with one SQL insert (never via seed).
3. **Error tracking and email delivery:** choose Sentry (or similar) and an email provider (Postmark/Resend); M1 logs both.
4. **Uptime check:** an external monitor on `/api/health` that alerts when `worker.ageSeconds > 600`. Until alerting exists, check `GET /api/v1/staff/queue?type=dead_letters` and `/api/health` once a day (G2 condition 20).
5. **Keep the hosted environment unadvertised** (test users only) until M2 replaces the placeholder Terms/Privacy with a real privacy notice (G1 N5; G2 condition 22).

## 13. Requirements coverage (M1)
| Requirement | Component(s) |
|---|---|
| FR-PAY-001 | `create_backing_hold`, `release_backing_hold`, worker step 2, provider `cancelPayment` |
| FR-PAY-002 | `provider_events`, webhook route, worker step 3, staff replay |
| FR-PAY-003 | `apply_payment_captured` (late/mismatch → refund + break), unmatched queue, `notify.refund_started` with reason |
| FR-PAY-004 | `outbound_ops` state machine, provider `find*`, dead-letter queue, staff replay |
| FR-PAY-005 | `tranche_evidence`, `verify_tranche`, `tranche.release` outbox, payout op, `record_tranche_released` |
| FR-PAY-006 | claim-first `api_idempotency`, §4.4, parallel-request test |
| FR-PAY-007 | §7 recon job, `recon_runs/breaks`, payout pause, override action |
| FR-PAY-008 | env fail-closed rules, live-key refusal, webhook livemode check |
| FR-PAY-009 (fan) | `fan_backings()`, distinct-backer counting |
| FR-BCK-001 | checkout route, Payment Element / sandbox form, failure categories, confirmation |
| FR-BCK-002 | auth pages with `next`, checkout guard, verify-email forwarding |
| FR-BCK-004 | `ends_at` instant; checks in `create_backing_hold` and `apply_payment_captured`; local-time display; holds released at deadline |
| FR-BCK-005 | `/backed` + `GET /me/backings` |
| FR-CMP-001/002 | artist API (asUser + RLS), `submit_campaign`, `review_campaign` (staff API), `publish_campaign` |
| FR-CMP-003 | campaign page renderer, `GET /campaigns/:slug` |
| FR-CMP-008 | `GET /campaigns` ordering/filters, explore page |
| FR-DSP-001 (M1) | `request_backing_refund`, staff refund action, refund op |
| FR-ID-001 | Supabase Auth pages; server verified-email check |
| FR-ID-002 (staff) | `aal2` check in `requireStaff` |
| FR-ID-003 | context actor/aal from token; SQL reviewer ≠ owner |
| FR-ID-004 | `POST /artist/payout-account` (Stripe Connect Express test / sandbox) |
| FR-ID-005 | checkout and `/backed` guards; staff 403 |
| FR-ID-006 | `handle_new_user` attestation check, `consents` |
| FR-ID-007 | `privileged_actions`, delay/limits, weekly review + sign-off |
| FR-NTF-001 | `notify.*` outbox topics, `notifications`, templates with version, log transport |
| FR-PRV-001 | `consents`, `/me/acceptances`, `needsAcceptance`, checkout block |
| FR-PLT-006 | `TestModeNotice`, `EscrowNotice` copy, email footer, `/config.testMode` |
| FR-TAX-004 (cap) | `create_backing_hold` open-checkout cap |
| FR-ANL-001 (events) | `funnel_events`, `POST /events`, server-emitted events |
| NFR-SEC-01 (slice) | migration 0500 + column test |
| NFR-SEC-02 (slice) | API-only money/workflow writes; revoked client execute |
| NFR-SEC-04 | `loadEnv` deploy rules |
| NFR-SEC-07 | seed only in local/CI (unchanged), no staff in migrations |
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
3. **Hosted `/api/*` returns 500 (known issue)** — M1 is proven in CI and locally; the hosted deployment is not part of the exit test until that is diagnosed with runtime logs.

## Change log
- 2026-10-03: first draft for G2 (M1 only).
- 2026-10-03: revised after G2 pass 1: provider error classes and `wait_funds` (blocker 1); conditions 1–8, 11–22 applied in place; 9–10 recorded in ADR-006 and the plan.
