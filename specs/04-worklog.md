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

## Not run here
- Anything needing Docker (Supabase CLI stack, e2e) — runs only in CI.
