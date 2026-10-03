# Layer 2 · Album royalty Pool (CR-002) — Technical design
**Status:** G1+G2 combined pass (`specs/gates/L2-G1G2.md`) · **Date:** 2026-10-03 · **Requirements:** `specs/l2/01-requirements.md`
**ADR added:** [ADR-007](../../docs/adr/ADR-007-regcf-provider-and-mock-escrow.md) Reg CF provider boundary + mock escrow service.
**Reuses (doesn't fork):** M1 ledger + `ledger_post`, SQL money functions with idempotency keys, `provider_events` inbox, two-phase outbound pattern, `privileged()` single-operator staff actions, correlation ids (ADR-005), outbox + notifications, Supabase Auth.

## 1. Architecture
```
 apps/web (layer2 routes, banner)  ──fetch /api/v1/{pools,investor,investments,portfolio,creator/pools,staff/l2}──►  apps/api
                                                                                                                   │
   apps/api ── l2/routes.ts  (gate: flag on in DB AND REGCF_PROVIDER=mock; else 404 layer2_disabled)               │
            ── l2/service.ts (sequencing; never computes ledger amounts except the Waterfall allocation, which      │
                              SQL re-verifies)                                                                      │
            ── regcf/types.ts RegCfProvider ─┬─ regcf/http.ts   → apps/mock-escrow (HTTP, API key, idempotency)    │
                                             └─ regcf/inprocess.ts → MockEscrowEngine in-process (unit tests)       │
            ── webhooks/regcf (HMAC verify → provider_events → ack → process) ◄── signed webhooks ── mock-escrow ◄──┘
            ── worker: expire reservations · settle due Pools · drain l2.* outbox → pool_ops · run pool_ops · revenue recon
 Postgres: pools, pool_tranches, collection_mechanisms, investor_profiles, investments, pool_documents,
           revenue_sources, revenue_statements, settlement_lines, revenue_recon_runs, pool_breaks,
           distribution_runs, distribution_payouts, tax_1099_rows, pool_ops  +  ledger (new kinds, pool_id dimension)
 apps/mock-escrow: Fastify + node:sqlite; issuers, offerings, parties, accounts, links, trades, fund moves, escrow,
           refunds, disbursements, collection accounts, deposits, payouts, jobs (virtual clock), signed webhook outbox
```

## 2. Flag enforcement (FR-PLT-001 slice for `layer2`)
- **Database:** `platform_settings['flag.layer2']` (default `false`, audited changes through staff action `flag.set`). `public.l2_enabled()` reads it; every Layer 2 money/workflow function starts with `perform public.l2_assert_enabled()` → raises `layer2_disabled`.
- **API:** Layer 2 route plugins register a `preHandler` that returns 404 `layer2_disabled` unless `REGCF_PROVIDER=mock` **and** the DB flag is on. `REGCF_PROVIDER=mock` is refused at startup in a deployed environment (same rule as the M1 sandbox), so Layer 2 can't be on in production by construction.
- **Web:** `/v1/config` reports `flags.layer2` from the server. Layer 2 pages that read data render the "isn't open yet" state when the API says `layer2_disabled`; the client `?flags=` override only reveals mock-only screens (unchanged), never data. Every `layer2` route renders `Layer2DemoBanner` (inside `FeatureRoute`).

## 3. Data model (migrations `20261005000100…000500`, all new)
| Migration | Contents |
|---|---|
| `…0100_l2_enums` | enum values for ledger kinds (own file: new enum values can't be used in the adding transaction) |
| `…0200_l2_core` | enums (pool_status, investment_status, kyc_status, collection_mechanism, risk_badge, collection_state); `pools`, `pool_tranches`, `pool_tranche_evidence`, `pool_reviews`, `pool_documents`, `collection_mechanisms`, `investor_profiles`, `investments`; `ledger_accounts.pool_id`, `ledger_transactions.pool_id`; `pool_account()`; flag functions; policy rows (`regcf_limits`, `l2_policy`) |
| `…0300_l2_offering_money` | workflow (`submit_pool`, `review_pool`, `execute_collection_mechanism`, `launch_pool`), investor limit (`regcf_investor_limit`, `regcf_usage`), `reserve_investment`, `mark_investment_funding`, `record_investment_funded`, `record_investment_returned`, `expire_investment_reservations`, `cancel_investment`, `settle_pool`, `record_investment_refunded`, tranches (`submit_pool_tranche_evidence`, `verify_pool_tranche`, `pool_tranche_release_amount`, `record_pool_tranche_released`), `pool_ops` |
| `…0400_l2_revenue_waterfall` | `revenue_sources`, `revenue_statements`, `settlement_lines`, `revenue_recon_runs`, `pool_breaks`; `record_collection_deposit`, `reconcile_pool_revenue`, `set_collection_state`; `distribution_runs`, `distribution_payouts`, `tax_1099_rows`; `commit_distribution_run`, `record_pool_payout_confirmed` |
| `…0500_l2_grants_rls` | RLS on every new table; no client grants on money/PII tables; public read view `pool_cards` for live+ Pools (no investor identities); revoke/grant execute (service_role only) |

**Ledger** (debit +, credit −, Σ = 0 per transaction). New account kinds, all per Pool (`pool_id` not null): `pool_escrow` (asset: mirror of the provider's offering escrow), `pool_investor_liability`, `pool_issuer_payable`, `pool_collection` (asset: mirror of the provider's collection account), `pool_revenue_suspense` (cash received, not yet reconciled), `pool_revenue_unallocated` (collected, distributable), `pool_distributions_payable`, `pool_creator_payable`, `pool_platform_payable`. The M1 check that ties campaign kinds to `campaign_id` is extended: Pool kinds ↔ `pool_id`.

| Event | Posting |
|---|---|
| Fund move settled | +escrow / −investor_liability |
| Refund settled | +investor_liability / −escrow |
| Pool closes (funded) | +investor_liability / −issuer_payable (total raised) |
| Tranche disbursed | +issuer_payable / −escrow |
| Collection deposit settled | +collection / −revenue_suspense |
| Statement reconciled to cash (collected) | +revenue_suspense / −revenue_unallocated |
| Distribution run committed | +revenue_unallocated (run total) / −distributions_payable (fans) −creator_payable −platform_payable |
| Payout settled (investor / creator / platform) | +the payable / −collection |

Invariants (tests): AC-E1 `escrow == Σ funded-not-refunded (pre-close)` and `escrow == provider escrow`; AC-E5 escrow ≥ 0 and 0 at the end; `collection == provider collection balance`; unallocated only grows from reconciliation (AC-W3/R1).

**Investments** state machine: `reserved → funding → funded → issued`; `reserved → expired | cancelled`; `funding → returned`; `funded → refund_pending → refunded`. Limit usage counts `reserved` (unexpired), `funding`, `funded`, `issued`, `refund_pending`.

**Pool** status: `draft → in_review → (revisions_requested → in_review) → approved → live → funded | failed → refunded`; `funded → matured` (cap reached or maturity) ; `draft|… → withdrawn`. Collection state separate: `COLLECTING, AT_RISK, DEFAULT, REMEDIATION, CHARGED_OFF`.

## 4. Concurrency: the investment limit (01a §3, AC-I1/I2/I5)
`reserve_investment` runs in one transaction: lock `investor_profiles` row (`for update`) → lock `pools` row → check KYC, state, flag, deadline, self-investment, min Units, availability (`units_committed + n ≤ units_total`) → usage = Σ amount of the investor's counted investments created in the trailing 12 months + self-reported elsewhere → refuse `regcf_limit_exceeded` if usage + amount > limit → insert `reserved` with `reserve_expires_at = now() + l2.reserveMinutes`. Lock order is always investor → pool, so no deadlocks; the investor lock serialises one person's purchases across all offerings, so N concurrent purchases admit exactly those that fit. Expiry (worker) and returned fund moves free the headroom (AC-I2). The limit formula and thresholds live in `packages/shared/src/policy.ts` (`regCf`) and are mirrored in `platform_settings['regcf_limits']` (sync test).

## 5. Provider boundary and flows (ADR-007)
`RegCfProvider` (TransactAPI-shaped): `createIssuer`, `createOffering`, `updateOfferingStatus`, `createParty`, `setPartyKyc`, `createAccount`, `createLink`, `createTrade`, `fundTrade` (fund move into escrow), `getTrade`, `getEscrow`, `closeOffering`, `disburseToIssuer`, `refundTrade`, `createCollectionAccount`, `getCollectionAccount`, `payoutFromCollection`, `simulateDeposit` (mock-only test trigger), `parseWebhook` (HMAC verify). Every mutating call carries an idempotency key derived from our row id, so a retry returns the original object (the two-phase op only needs "call again with the same key").

- **Launch:** API calls `createIssuer`/`createOffering`/`createCollectionAccount` (keys `issuer:<artist>`, `offering:<pool>`, `collection:<pool>`), then `launch_pool(refs)`. Retry-safe.
- **Purchase:** `reserve_investment` → `createTrade` (key `trade:<investment>`) → `fundTrade` (key `fund:<investment>`) → `mark_investment_funding`. Fund move settles asynchronously → webhook `fund_move.settled` → `record_investment_funded`. Returned → `record_investment_returned`. Idempotency-Key at the HTTP layer (claim-first, M1 pattern).
- **Settlement:** worker `settle_pool(now)` after the deadline (waits up to `l2.settleGraceMinutes` for in-flight fund moves). Funded → ledger close, Units issued (lock-up end = close + 12 months), tranche 1 verified, outbox `l2.op` close + disburse. Failed → `l2.op` refund for every funded investment.
- **Outbound:** `pool_ops` (kinds `refund`, `disburse`, `payout`, `close_offering`), same states as M1 `outbound_ops`. `close_offering` confirms on the response; the others are `sent` until the webhook confirms; the SQL confirm function asserts the exact amount.
- **Webhooks:** `POST /api/v1/webhooks/regcf`, header `x-mock-escrow-signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + rawBody)>`, 5-minute tolerance. Stored in `provider_events` (`provider='mock-escrow'`, unique event id) before processing; duplicate deliveries are no-ops; processing failures retry with the M1 inbox backoff.

## 6. Revenue ingestion and default (01b §3, §5)
- **Statement** (`API_VERIFIED` mock distributor statement): period label, period dates, lines by revenue type; `covered_minor` = Σ lines of the Pool's revenue types; SHA-256 over canonical JSON; unique per (Pool, period).
- **Settlement line** (`BANK_RECONCILED`): created only from the provider's `deposit.settled` webhook into the Pool's collection account; reference = period label.
- **Reconciliation** (`reconcile_pool_revenue(pool, now)`, idempotent): for each unreconciled statement, matched cash = Σ settlement lines with the same reference; collected = min(cash, covered); shortfall → `pool_breaks(revenue_shortfall)`; overage stays in suspense with a `revenue_overage` break; no cash → "reported, not collected". Posts `revenue.collected:<statement>` once.
- **Default:** expected periods are consecutive `l2.periodMonths` windows from close. A period is past due when `period_end + l2.settlementDueDays < now` and it isn't fully collected → `AT_RISK`; at risk longer than `l2.cureDays` → `DEFAULT`; cured → `COLLECTING`. Staff move `DEFAULT → REMEDIATION | CHARGED_OFF`, `REMEDIATION → CHARGED_OFF`. Each transition writes an outbox notice to every holder.

## 7. Waterfall (01a §4)
- **Pure function** `allocateWaterfall()` in `packages/shared/src/waterfall.ts` (tested in shared and API). Input: run total C (= the Pool's entire `pool_revenue_unallocated` balance), split bps, holdings `[investmentId, units, capRemainingMinor]`. Fans pool F = ⌊C·fans/10000⌋; platform P = ⌊C·platform/10000⌋; creator gets the rest. F is split pro-rata by Units with **largest remainder** (ties: investment id ascending); any allocation above an investment's remaining cap is clipped and the excess re-split among uncapped holders; when every holder is capped, the remaining excess goes to the creator (`capOverflowMinor`). Σ(payouts) + creator + platform + overflow == C exactly.
- **Hash:** SHA-256 of canonical JSON of {inputs, outputs} (API side). Dry-run and commit compute the same allocation from the same DB state, so the same hash (AC-W1).
- **Commit** (`commit_distribution_run(pool, label, hash, allocation, now)`) re-verifies in SQL: run total == current unallocated balance (collected-only, AC-W3), conservation (AC-W4), every payout ≤ remaining cap (AC-W2); posts the allocation, creates payouts and outbox ops; unique (Pool, label) → a second commit with the same hash returns the first run, a different hash is refused (AC-W6). If every investment reaches its cap, or the run's `now` is past maturity, the Pool becomes `matured`.
- **Tax:** each investor payout records `tax_characterization = 'dividend'` (form `1099-DIV`, Mechanism 04 default, **counsel item L2-Q6**) and upserts `tax_1099_rows(year, investor, pool)`.

## 8. Collection mechanism → risk badge (Mechanism 01, 01b §1.1)
Strength: `DISTRIBUTOR_REDIRECT`=3, `SPLIT_PAYEE`=3, `LOCKBOX`=2, `LETTER_OF_DIRECTION`=2, `SELF_REPORT`=1. Revenue-type ceiling: master=3, sync=2, publishing=1 ("Trust-based — pending counsel"). Effective = min over the Pool's revenue types of min(mechanism, ceiling). Badge: 3 → `SECURED_ISH` ("More secure — still unsecured"), 2 → `VERIFIED`, 1 → `TRUST_BASED`. Computed in `packages/shared/src/l2.ts` and by SQL at submission (sync test).

## 9. API surface (all behind the `layer2` gate)
Fan: `GET /pools`, `GET /pools/:slug`, `GET /pools/:slug/form-c`, `GET /investor/me`, `POST /investor/kyc`, `POST /investor/certification`, `POST /pools/:id/investments` (Idempotency-Key), `GET /investments/:id`, `POST /investments/:id/cancel`, `GET /portfolio`.
Creator: `POST/GET /creator/pools`, `GET/PATCH /creator/pools/:id`, `POST /creator/pools/:id/{submit,launch}`, `POST /creator/pools/:id/statements`, `POST /creator/pool-tranches/:id/evidence`.
Staff (`/staff/l2`, aal2 + `privileged()`): `GET queue`, `GET pools/:id/money`, `POST pools/:id/review`, `POST pools/:id/collection/execute`, `POST investors/:userId/kyc`, `POST pool-tranches/:id/verify`, `POST pools/:id/recon`, `POST pools/:id/deposits` (mock trigger), `POST pools/:id/distributions/{dry-run,commit}`, `POST pools/:id/collection-state`, `POST flags/layer2`.
Dev (mock only, not deployed): `POST /dev/l2/advance {seconds}` (mock clock + one worker tick).

## 10. Web
Rebuilt on real data: `/pools`, `/pools/:id`, `/pools/:id/form-c` (new), `/investor/certification` (KYC + attestation), `/invest/:id/documents`, `/invest/:id/confirmation`, `/portfolio`, `/portfolio/:poolId`. New: `/creator/pools`, `/creator/pools/new`, `/creator/pools/:id`, `/admin/pools`, `/admin/pools/:id`, `/admin/investors`. `Layer2DemoBanner` on every `layer2` route. `lint:copy` extended: Layer 2 notice templates (`apps/api/src/l2/notices.ts`) scanned with the Layer 2 rule set.

## 11. Mock escrow service (`apps/mock-escrow`)
Fastify on `MOCK_ESCROW_PORT` (8790), `node:sqlite` file store (`.data/mock-escrow.sqlite`; `:memory:` in tests). API key (`x-api-key`), `Idempotency-Key` on every POST (same key + same body → same response; different body → 422). Virtual clock: `now = real + offset`; `POST /admin/advance {seconds}` moves it and runs due jobs; `POST /admin/reset {fixtures?}`; `GET /admin/state`. Jobs: KYC decision 2 s, fund move 3 s, refund/disbursement/payout 2 s, deposit 1 s. Triggers: party last name `KYCFAIL` → rejected, `AMLHOLD` → manual_review; fund move whose whole-dollar amount ends in 13 → returned (R01). Webhooks signed (§5), retried with backoff. Fixture file `apps/mock-escrow/fixtures/layer2-seed.json` matches `supabase/seed_layer2.sql` (a test proves both sides reconcile).

## 12. Security & compliance notes
- No PII stored by FanZuP for Layer 2 beyond state and the investor's own attested income/net-worth figures (needed for the limit; service-role only, never returned to other users). Legal names go to the provider only.
- Clients have no grants on Layer 2 money/PII tables; reads go through the API (owner- or staff-scoped).
- Reviewer ≠ owner for Form C review, tranche verification, collection execution; staff can't decide their own KYC.
- The mock provider and dev routes can't run deployed; webhook secret and API key come from env (dev defaults only when not deployed).

## 13. Risks
| Risk | Mitigation |
|---|---|
| Mock fidelity drifts from TransactAPI | Interface mirrors the documented workflow; adapter boundary; L2-Q4 sandbox access |
| Rounding disputes in distributions | Documented largest-remainder rule; conservation tested to the cent |
| Demo mistaken for an offer | Server-gated flag, banner on every screen, can't run deployed |
| Legal structure changes (SPV, 1099) | Every such rule is a policy value or labelled counsel item |
