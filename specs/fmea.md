# FMEA · FanZuP money flows (checkout, settlement, refund, payout)
**Owner:** engineering · **Status:** active · **Date:** 2026-11-27 · **As built on:** `main` after PR #27 · **Inputs:** `specs/02-design.md` §4.4, §5–§7, §10; `apps/api/src/{checkout,inbox,outbound,money,recon,jobs}.ts`; FR-PAY-001…009, NFR-OPS-05/06

Failure Mode and Effects Analysis for the four P0 money flows (DOC audit condition 2). Each row is one way a step can fail, what the user or the ledger sees, what in the code stops or catches it today, and what's still missing. Flow diagrams: `specs/diagrams/README.md` §4–§6. Response steps: `specs/runbooks/incidents.md`.

**Scales (1–10):** **S**everity of the effect (10 = money wrong or lost, 7 = money stuck or late past a promise, 4 = user friction, 1 = cosmetic) · **O**ccurrence (10 = expected weekly, 1 = would need several independent faults) · **D**etection (1 = caught automatically before harm, 10 = nobody would notice). **RPN** = S × O × D. Rows with RPN ≥ 100 or S ≥ 9 with D ≥ 5 need an action before G5. Scores reflect today's controls, including the absence of alerting (readiness O-1/O-5), which is why many D scores are 5–7: the code detects and logs the problem, but nothing tells a human.

## Checkout (backing creation and capture)
| # | Step | Failure mode | Effect | Cause | Current controls | S | O | D | RPN | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Create backing | Double submit / client retry creates two backings or two charges | Fan charged twice | Network retry, double tap | Claim-first idempotency key in one transaction; Stripe idempotent PaymentIntent create with the same key and metadata (FR-PAY-006); tests in `checkout.test.ts` | 9 | 2 | 2 | 36 | — |
| F-02 | Hold stock | Last limited perk sold twice | Over-promised reward | Concurrent checkouts | Stock held in the same transaction; holds expire after 15 min (FR-PAY-001) | 6 | 2 | 2 | 24 | — |
| F-03 | Capture | Payment captured after the deadline or after the hold expired | Money held for a closed campaign | Slow 3-D Secure, late webhook | Late capture → automatic refund (FR-PAY-003); `capture.stray` alert; stray included in recon liability | 8 | 3 | 5 | 120 | Alert routing (R-03) so a stray whose refund stalls pages someone; D → 2 |
| F-04 | Webhook | Webhook rejected (bad secret) and events back up | Fans paid but backings stay pending; Stripe stops retrying (3 days live, sooner in test mode) | Secret rotated, endpoint recreated | Events stored before acting; Stripe retries; worker backstop processing; `failed_events` queue | 8 | 3 | 7 | 168 | Alert on webhook 4xx/5xx > 5 in 10 min (E1 baseline); add a "pending backings older than 30 min" check to `/api/health` or the monitor |
| F-05 | Webhook | Forged or live-mode event accepted | Ledger posts money that never moved | Attacker, misconfigured key | Signature on raw body; unique `(provider, event_id)`; livemode rejected with `webhook.livemode_rejected`; only test keys accepted (FR-PAY-008) | 10 | 1 | 2 | 20 | — |
| F-06 | Checkout | Card testing through the checkout | Processor relationship risk; noise | No rate limits (NFR-SEC-13) | Verified account required; unconfirmed-checkout cap | 6 | 4 | 6 | 144 | Shared write rate limiter (R-06); bot challenge at P0b |
| F-07 | Checkout | 3-D Secure return not handled on mount | Fan paid but sees "Payment not confirmed" | Web doesn't read `payment_intent`/`redirect_status` (backlog, PR #9 review) | Backing still captures via webhook; Backed page shows it later | 4 | 5 | 6 | 120 | Handle the 3DS return in `Checkout.tsx` (backlog item) |

## Settlement (at the campaign deadline)
| # | Step | Failure mode | Effect | Cause | Current controls | S | O | D | RPN | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| F-08 | Settle | Worker down, campaigns stay `live` past the deadline | Refunds/payouts late; NFR-PERF-03 missed | Crash loop, bad env, Render outage | Heartbeat row; `/api/health` reports its age; `/api/internal/tick` fallback; idempotent resume | 7 | 3 | 7 | 147 | External monitor on `worker.ageSeconds` (NFR-OPS-06; R-03); D → 2 |
| F-09 | Settle | One campaign's settlement throws | That campaign stuck | Data edge case | One transaction per campaign; others proceed; `settlement.failed` alert with the campaign id | 7 | 2 | 6 | 84 | Alert routing (R-03) |
| F-10 | Settle | Wrong outcome (funded vs failed) | Money released or refunded wrongly | Bug in goal math or deadline time zone | Rule in SQL (`settle_campaign`), shared rules tested against the DB; late-capture deadline decided at processing time (D-001 pending) | 10 | 1 | 4 | 40 | Wayne to confirm D-001 |

## Refunds (failed campaign, staff refund, stray capture)
| # | Step | Failure mode | Effect | Cause | Current controls | S | O | D | RPN | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| F-11 | Refund op | Refund sent twice | Backer refunded twice; FanZuP loses money | Retry after a lost response, replay | One `outbound_op` per subject; provider lookup before retry; attempt generations (`<key>:r<gen>`) so a replay sends at most one new refund; tests in `money-path.test.ts` | 10 | 1 | 2 | 20 | — |
| F-12 | Refund op | Refund keeps failing and dead-letters | Backer not refunded; the core promise broken | Closed card, provider error | Bounded attempts (8), dead-letter state, `outbound.dead_letter` alert, `dead_letters` queue, replay route; `refund.overdue` alert | 9 | 2 | 6 | 108 | Page on any dead-lettered refund (R-03); undeliverable-refund handling FR-PAY-011 (P0b) |
| F-13 | Refund confirm | Refund sent, confirmation lost | Ledger never shows the refund; backer may think it failed | Webhook lost | Recon looks up `sent` ops past the grace (`findRefund`), records them, or opens `op_unconfirmed` | 6 | 2 | 3 | 36 | — |
| F-14 | Refund funding | Platform float too low to fund the absorbed fee | Artist payouts wait; recon `waiting_funds` | Float not topped up | `waiting_funds` visible, doesn't pause; SETUP C7 | 4 | 4 | 5 | 80 | Monitor float in the weekly review (R-18) |

## Payouts (milestone releases)
| # | Step | Failure mode | Effect | Cause | Current controls | S | O | D | RPN | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| F-15 | Verify | Self-dealing or a stolen staff login verifies a fake milestone | Money released for work not done | Compromised account, insider | `aal2` second factor; reason + audit; delay above the threshold; daily limits under an advisory lock; reviewer ≠ owner in SQL; weekly review | 10 | 2 | 4 | 80 | Second staff approval above a threshold (NFR-COMP-17) at P0b; outside reader for the weekly log (backlog N17) |
| F-16 | Transfer | Payout sent while a recon break is open | Money released that may have been clawed back | Dispute, fee adjustment | Payout-pausing break kinds pause releases (design §7); refunds continue | 9 | 2 | 3 | 54 | Model disputes (R-13) so the break has a cause on the ledger |
| F-17 | Transfer | Payout sent twice | Artist overpaid | Retry, replay | Same `outbound_op` + generation + `findTransfer` controls as F-11 | 10 | 1 | 2 | 20 | — |
| F-18 | Recon | Recon doesn't run (worker down) or a break ages unnoticed | Discrepancy found late; payouts paused for days | Worker down; nobody reading `staff recon` | Runs when the last run is > 24 h old; break ageing pauses payouts | 7 | 3 | 7 | 147 | Schedule "by 10:00 ET next business day" (G2 C21); alert on any new break (R-03) |
| F-19 | Disputes | Chargeback debits the balance with no ledger posting | `escrow_cash` overstates; a later payout uses clawed-back money | Disputes not modelled (NFR-COMP-04) | Shows up as `unmatched_provider_txn`, which pauses payouts | 9 | 3 | 4 | 108 | Dispute lifecycle (R-13); until then any dispute is a SEV1 manual investigation |

## Top actions (by RPN and severity)
1. **Route `alert`-level logs and the heartbeat to a human** (F-03, F-04, F-08, F-09, F-12, F-18). One change lowers D on six rows from 6–7 to 2. → readiness O-1/O-2/O-5, risk R-03.
2. **Rate-limit writes** (F-06). → NFR-SEC-13, risk R-06.
3. **Handle the 3-D Secure return** (F-07). → backlog.
4. **Recon on a business-day schedule with alerting** (F-18). → G2 C21.
5. **Disputes on the ledger** (F-19, F-16). → NFR-COMP-04 (P0b, before live money).

Re-score after each of these lands, and at every gate.
