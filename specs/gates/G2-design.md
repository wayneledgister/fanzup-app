# G2 — Design gate · FanZuP v2 · Milestone M1 · 2026-10-03
**Tier:** Enterprise · **Seats:** Architect, Skeptic, Pragmatist, Critic, Security, Compliance/Ops
**Artifacts:** `specs/02-design.md` (first draft), `docs/adr/ADR-003..006`, against `specs/01-requirements.md` §Milestone M1 scope.
**Seat notes:** `.G2-<seat>.md` in this folder. Founder away; run unattended per Wayne's brief (stop only for a founder decision).

## Pass 1 · Verdict: REVISE (document fixes only)
One blocker, and it is a design fix, not a founder decision. No seat raised anything that needs Wayne.

### Blockers
| # | Blocker | Raised by | Resolved looks like |
|---|---|---|---|
| 1 | **Payouts would dead-letter on a real Stripe test run.** Transfers need available platform balance; test charges stay pending for days unless paid with the "available balance" test card; every provider error counts toward `outbound.maxAttempts`. | Architect | Provider errors classified (counted retry / waiting-on-funds, not counted / permanent); `balance_insufficient` waits without consuming attempts; runbook names test card `4000 0000 0000 0077`. |

### Conditions proposed (concerns → tracked)
1. `record_tranche_released` takes the payout op's amount and asserts it equals the computed amount. → Architect · design §3.5, task in 03
2. Recon run also checks public counters (raised, distinct backers) against the ledger. → Architect · §7
3. Confirmations apply by `outbound_op_id` regardless of op state; a capture for a not-yet-visible backing retries before going `unmatched`. Drop the "per object order" claim. → Architect, Skeptic · §5
4. Name the released share as a campaign-level ratio. → Architect · §3.5
5. New-user trigger vs dashboard-created users: setup says "create your account through the app's sign-up page"; the trigger's refusal is documented. → Skeptic · §3.7, §12
6. Say in §12 and the PR that merging makes hosted `/api` answer 503 "misconfigured" until Stripe test config is set. → Skeptic · §12
7. The M1 report must not claim Stripe reconciliation until exit test 8 runs. → Skeptic · reporting
8. State "FanZuP absorbs the fee on staff refunds — E1-C default". → Skeptic · §3.5
9. Thin artist API; no staff UI in M1. → Pragmatist · §4.2
10. E2E is a separate job, not a required check until stable. → Pragmatist · ADR-006
11. M1 request/response contracts as zod schemas in `packages/shared`. → Critic · §4.2
12. Provider error → FR-BCK-001 category mapping. → Critic · §4.2
13. Cross-device verification behaviour stated. → Critic · §11
14. Cursor format for `GET /campaigns` specified. → Critic · §4.2
15. `NODE_ENV=production` counts as deployed. → Security · §9
16. Webhook account rule for platform vs Connect events. → Security · §5
17. Redirect allow-list `/**` patterns locally, in CI and hosted. → Security · §11, §12, `supabase/config.toml`
18. `POST /events` bounded (body size, real campaign id, field lengths). → Security · §4.2
19. Remaining "escrow" copy outside M1 paths listed and tracked to M2 (FR-PLT-002). → Compliance/Ops · §11
20. Runbook: daily check of dead-letters and `/api/health` until alerting exists. → Compliance/Ops · §12
21. Recon schedule to "10:00 ET next day" at M2. → Compliance/Ops · §7
22. Hosted environment stays unadvertised (test users only) until M2's real privacy notice. → Compliance/Ops · §12

### Findings
| Voice | Blockers | Concerns | Nits |
|---|---|---|---|
| Architect | 1 | 4 | 1 |
| Skeptic | 0 | 4 | 1 |
| Pragmatist | 0 | 3 | 2 |
| Critic | 0 | 4 | 2 |
| Security | 0 | 4 | 1 |
| Compliance/Ops | 0 | 4 | 1 |

### Dissent
- **How much control machinery belongs in M1.** *Skeptic:* single-operator delays, weekly sign-off, recon override and replay are being built before any fan has tried the full-account checkout. *Pragmatist:* they're each small and API-only; keep them but build no UI. *Security/Compliance:* G1-A made them binding for every privileged action; M1 without them would mean money moves by staff action with no compensating control. Kept as designed; no UI.
- **E2E as a gate.** *Pragmatist:* not a required check until stable. *Critic:* exit test 7 makes it part of M1 acceptance. Both hold: it must be green for M1 sign-off; branch protection is Wayne's call.

### Skeptic's strongest reason not to proceed
M1 proves money correctness in CI but not that a fan finishes a full-account checkout on a phone, and not that the stack runs where users are (hosted `/api` still fails for unknown reasons).

### Decisions the founder must make
None at G2. (E1 cards A/B/C remain open from E1; their defaults hold.)

## Pass 2 · 2026-10-03 · Verdict: APPROVE WITH CONDITIONS
Re-examined blocker 1, conditions 1–22, and the sections the revision touched (`02-design.md` §3.5, §4, §5, §7, §9, §10, §11, §12).

| Pass-1 item | Status | Evidence |
|---|---|---|
| Blocker 1 payouts dead-letter on Stripe | **Resolved** | §5 "Provider error classes": `wait_funds` retries every 15 min without counting attempts, becomes a recon break after 7 days; test card named in §5 and §12.1 |
| C1 payout amount asserted | Resolved | §3.5 `record_tranche_released(…, amount, …)` |
| C2 counters in recon | Resolved | §7 "Public counters" |
| C3 ordering / confirmations by metadata | Resolved | §5 webhook handling; §10 table row |
| C4 campaign-level released share | Resolved | §3.5 `fan_backings` |
| C5 dashboard-created users | Resolved | §12.2 |
| C6 hosted 503 after merge | Resolved | §12.1 (and to repeat in the PR) |
| C7 no Stripe recon claim before exit test 8 | Carried (reporting) | M1 report |
| C8 E1-C default on staff refunds | Resolved | §3.5 `record_refund_confirmed` |
| C9 thin artist API, no staff UI | Carried (plan) | `03-tasks.md` |
| C10 e2e separate job, not required until stable | Carried (plan, ADR-006) | `03-tasks.md`, CI |
| C11 contracts in shared zod | Resolved (design) / carried (build) | §4 preamble; task in 03 |
| C12 failure categories | Resolved | §4.3 |
| C13 cross-device verification | Resolved | §11 |
| C14 cursor format | Resolved | §4 preamble |
| C15 `NODE_ENV=production` = deployed | Resolved | §9 |
| C16 webhook account rule | Resolved | §5 |
| C17 redirect `/**` patterns | Resolved (design) / carried (config) | §12.2; `supabase/config.toml` task |
| C18 bounded `POST /events` | Resolved | §4.2 |
| C19 escrow copy outside M1 | Carried to M2 | §11 |
| C20 daily dead-letter check | Resolved | §12.4 |
| C21 recon 10:00 ET schedule | Carried to M2 | §7 |
| C22 hosted stays unadvertised | Resolved | §12.5 |

New findings from the revision: none. No seat changed position; the pass-1 dissent stands.

**Conditions carried forward** (tracked):
1. C7 — the M1 report states plainly that Stripe reconciliation is shown only after exit test 8. → report
2. C9, C10, C11, C17 — build-time items. → `03-tasks.md`
3. C19, C21, design gaps G-1/G-2/G-3, G1 carry-overs (N1, N3, N4, N5, N7, N10, N14, N11–N17; G1 conditions 1, 2, 4, 6, 10, 12). → M2 scope; one row each in `specs/backlog.md` §"Carried from G1/G2 for M2" (added 2026-10-11, review round 3; N10 and G1 condition 10 share a row)

## User decision
**Council: APPROVE WITH CONDITIONS (pass 2).** No founder decision was needed, so per Wayne's standing instruction for this run (2026-10-03: "if the verdict is APPROVE or REVISE with only document fixes, apply them and continue") the work proceeds to plan + implement. **Wayne's own sign-off on G2 is pending** and is requested in the M1 report.

## Post-gate delta (PR #6 review rounds 1–3, 2026-10-11)
The council approved pass 2 on 2026-10-03. Independent PR review afterwards changed the design's semantics in the ways below. They were applied by the agent as document fixes (no seat was reconvened); **Wayne's G2 sign-off is requested for the design including this delta.**

**Round 1**
- **Counter rule** (§3.5): `raised_minor`, `backers_count` and perk units count only `held`/`released` backings and drop when a backing leaves `held` for `refund_pending`, not at refund confirmation; `settle_campaign` funded branch releases only `held` backings; a failed campaign closes only when nothing is `held`/`refund_pending`.
- **Claim + hold in one transaction** (§4.4): idempotency claim and `create_backing_hold` commit together; rule violations stored as `done` with their error; 2-minute abandoned-claim rule.
- **Seed policy** (§9, NFR-SEC-07): `seed.sql` is local/CI only; no hosted seed path; staff by manual SQL.
- **D-001** (§3.5): the late-capture deadline is judged at processing time — now an **open decision for Wayne** (fan-facing).
- Smaller: `stripe-test` alias, redirect `/**` patterns in PR #9, under-24 h countdown.

**Round 2**
- **Identity metadata on every `auth.users` inserter** (§3.7): seed, test helper, shim (no change), sign-up form; sync test also checks the seed's versions.
- **Artist identity = ready payout account** (§3.5.2): set by `POST /artist/payout-account`; required to submit; payouts without an account wait (no break, no pause); staff `payouts` queue.
- **Webhook endpoint** (§5, §12.1): one platform endpoint; event list = `payment_intent.succeeded|payment_failed|canceled`, `refund.created|updated|failed`, `transfer.created`; no Connect endpoint; `charge.refunded` dropped.
- **Unapplied captures** (§3.5): captured amount, currency and fee stored; refund sized from `captured_minor`; confirmation checked against it.
- **Capture matching** (§3.5.1): by `payment_ref`; capture idempotency keyed by payment; stray captures refunded by their own payment-keyed op.
- **Checkout resume** (§4.4 step 3): terminal, stored `checkout_expired` for a dead hold; **hold expiry** (§5) looks up a PaymentIntent before releasing a hold with no `payment_ref`.
- **Refund confirmation** (§5): by `refund.*` events whose status is `succeeded`; the synchronous response doesn't confirm.
- **Delayed staff refunds** (§9): refused with `409 refund_after_deadline` if they would run at or after `ends_at`.
- **Exit test 8 tooling** (§12.6, T-024): operator script for TOTP enrolment, aal2 token and artist/staff API calls.

**Round 3**
- **Deterministic PaymentIntent params** (§4.4 step 3, §8, ADR-005): every `createPayment` parameter comes from the stored backing; `metadata.correlation_id = backings.correlation_id`, so Stripe's idempotent replay succeeds on resume.
- **Liability invariant** (§3.5, §3.5.1, §7): `backer_liability(campaign)` = Σ `coalesce(captured_minor, amount_minor)` over `held` + `refund_pending` + Σ open stray captures; stray captures resolve via their refund op (no break while open and inside `recon.maxBreakAgeBusinessDays`; `stray_capture_aged` money break after); liability mismatch is a money break.
- **Client Idempotency-Key lifecycle** (§11): new key after any stored 4xx outcome and after the backing stops being payable.
- **FR-PRV-001 M1 row trimmed** (`01-requirements.md`): IP/UA only on API re-acceptance; sign-up rows lack them (G-1 → M2), listed under "Not in M1".
- **Carried conditions** tracked one row each in `specs/backlog.md`.
- **Webhooks for unknown connected accounts** (§4.2, §5): stored `ignored` in the same insert and answered 200; 400 only for bad signature or livemode. `account_mismatch` removed.
- **Hosted seed check** (§12.7, `docs/SETUP.md` B3a): verify no `@fanzup.test` users or seeded staff rows exist before granting staff.
- Plan: T-006/T-009/T-005 review fixes; "Done when" lines on T-015, T-016, T-018, T-021, T-022, T-023.

- 2026-10-03: pass 1 recorded (REVISE, document fixes only). Revising `02-design.md` next; pass 2 re-checks blocker 1 and the conditions.
- 2026-10-03: design revised; pass 2 recorded (APPROVE WITH CONDITIONS). Proceeding to `sdd-plan-implement`.
- 2026-10-11: post-gate delta recorded (PR #6 review rounds 1–2); Wayne's sign-off requested for the design including it.
- 2026-10-11: post-gate delta extended with PR #6 review round 3.
