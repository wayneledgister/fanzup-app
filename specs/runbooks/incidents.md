# Runbook: incidents · FanZuP
**Owner:** Wayne · **Status:** active · **Date:** 2026-11-27 · **Requirements:** NFR-OPS-04, NFR-OPS-05, NFR-OPS-06, NFR-OPS-09, NFR-OPS-11, FR-PAY-003, FR-PAY-004, FR-PAY-007 · **Baseline:** `specs/gates/.E1-compliance-ops.md` (alert thresholds)

Covers the five failure modes NFR-OPS-09 names (worker down, webhook backlog, provider outage, reconciliation break, suspected fraud campaign) plus the database, auth and misconfiguration cases that the design's failure table (`specs/02-design.md` §10) lists. Money is Stripe **test mode** until custody is approved, so no real money can be lost today; the procedures are written for when it can.

## Severity matrix
| Sev | Definition | Examples | Response | User notice |
|---|---|---|---|---|
| **SEV1** | Money moved wrongly or can't move; data exposed | ledger invariant error, double refund or payout, a capture with no backing (`capture.stray`), a dead-lettered refund, a cross-user data read, a leaked key | Drop everything. Contain first (§First five minutes). Postmortem required | Within 30 min once a status page exists (NFR-OPS-10, P0b); email affected users |
| **SEV2** | A money flow is degraded but nothing is wrong yet | worker down > 10 min, checkout 5xx > 2% over 5 min, webhook backlog > 15 min, recon break older than 1 business day, campaign `live` > 30 min past its deadline | Same day, within the hour while awake | Banner or post if users are affected for > 30 min |
| **SEV3** | Everything else that's broken | a page error, a non-money flag feature failing, agent worker down, slow pages | Next business day | None |

Any doubt between two levels: pick the higher one.

## Signals and where to see them
There's no error tracker, uptime monitor or pager yet (readiness O-1, O-2, O-5; risk R-03). Until there is, you find incidents by looking. These are the places, and the log lines the code already writes (JSON, one per line, with `correlationId`):

| Signal | Where | What to look for |
|---|---|---|
| Worker alive | `GET /api/health` → `worker.ageSeconds` | > 120 = worker stopped; `null` = never ran |
| Alerts from the code | Vercel and Render logs, filter `"level":"alert"` | `outbound.dead_letter`, `outbound.failed`, `outbound.amount_mismatch`, `settlement.failed`, `refund.overdue`, `capture.stray`, `provider_event.dead_letter`, `webhook.livemode_rejected`, `staff_action.failed`, `staff_action.claim_lost`, and Layer 2 `pool_op.*` / `pool.settlement_failed` |
| Unhandled API errors | Vercel logs, filter `api.error` | 500s; each has a `correlationId` |
| Bad config | Vercel logs `api.misconfigured`; `/api/health` 503 | body names the missing variable |
| Queues | `pnpm m1:operator … staff queue <type>` | `dead_letters`, `failed_events`, `breaks`, `unmatched`, `refunds`, `payouts`, `scheduled` |
| Reconciliation | `staff recon` (latest) / `staff recon run` | total diff ≠ 0, open breaks |
| Webhooks | Stripe → Developers → Webhooks → endpoint | failed deliveries, pending retries |

When an alerting tool is connected, wire it to exactly these signals with the E1 thresholds (heartbeat > 10 min, outbox oldest > 15 min, any dead letter, any recon break, checkout 5xx > 2% over 5 min, webhook failures > 5 in 10 min, campaign live > 30 min past `ends_at`).

## First five minutes (any SEV1 or SEV2)
1. **Write down the time** and what you saw. Start a note; it becomes the postmortem timeline.
2. **Is it from a deploy?** Vercel and Render show the last deploy time. If the problem started within an hour of one, roll back now (`deploy-and-rollback.md` §5) and investigate after.
3. **Contain money.** If money may be moving wrongly: suspend the worker (Render → fanzup-worker → **Suspend**). That stops settlement, refunds and payouts; checkouts still work and captures queue as provider events, which the worker processes when resumed. If checkout itself is the problem, there's no pause switch yet (gap R-3a): roll back, or as a last resort take the API down by removing `STRIPE_WEBHOOK_SECRET` in Vercel and redeploying (it then serves 503 `misconfigured`, nothing is charged) — Stripe keeps retrying failed webhooks (for up to 3 days in live mode, for a shorter period in test mode), and any it gives up on can be resent from the dashboard, so none are lost.
4. **Get a correlation id** from the error (user's screen, `api.error` line, alert line) and run `staff trace <id>`.
5. **Pick the section below** and follow it.

---

## 1. Worker down (SEV2; SEV1 if refunds are overdue)
**Symptom:** `worker.ageSeconds` > 120 in `/api/health`; no `worker.tick` lines; campaigns past deadline still `live`; holds not expiring.
**Impact:** settlement, refunds, payouts, hold expiry, provider-event processing and daily recon all stop. Checkout still works. Nothing is lost: every step resumes idempotently (design §6).
1. Render → fanzup-worker → **Logs**. Look for the last `worker.error` or a crash stack.
2. Crash on start with an env error (`ESCROW_PROVIDER`, `STRIPE_SECRET_KEY`, `DATABASE_URL`): fix the variable in Render → Environment; it restarts. Compare with `render.yaml` and SETUP D2.
3. Crash after a deploy: roll the worker back (`deploy-and-rollback.md` §5.3).
4. `worker.error` every tick with a database error: see §6 (database).
5. Render itself down (status.render.com): as a stopgap, set `CRON_SECRET` (16+ chars) in Vercel, redeploy, and call `GET $SITE/api/internal/tick` with `Authorization: Bearer $CRON_SECRET` every few minutes; it runs one tick (ADR-002 fallback). Remove the secret afterwards (the route is hidden without it).
6. **Check it recovered:** `ageSeconds` < 60; then `staff queue refunds` and `staff queue payouts` drain over the next ticks; campaigns past deadline settle within one tick each.
7. If refunds were due more than 1 hour after settlement (NFR-PERF-03), log it as SEV1 and email affected backers once they're initiated.

## 2. Webhook backlog or failures (SEV2)
**Symptom:** Stripe → Webhooks shows failed deliveries; backings stay `pending_payment` after the fan paid; `failed_events` queue grows; refund/payout confirmations late.
1. Stripe endpoint → a failed attempt → response code:
   - **400 signature:** `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match the endpoint's signing secret (it changes if the endpoint is recreated). Copy it again, redeploy.
   - **503 misconfigured / database_unavailable:** see §7 / §6.
   - **500:** find the `api.error` line by time, trace its correlation id.
2. Once fixed, Stripe retries automatically (up to 3 days in live mode; test mode retries for a shorter period, so check for events it gave up on). To hurry one, or to recover one Stripe stopped retrying: Stripe → the event → **Resend**.
3. Events stored but failing to process (`failed_events` queue; `provider_event.dead_letter` alert): read the error on the row, fix the cause, then `POST /api/v1/staff/provider-events/:id/replay` with a reason.
4. **Late captures are safe:** a capture that lands after its campaign settled is refunded automatically (FR-PAY-003); watch for `capture.stray` and confirm its refund op completes.
5. **Check:** `staff queue failed_events` empty; pending backings move to `held`.

## 3. Payment provider outage (SEV2)
**Symptom:** status.stripe.com incident; checkouts fail with "nothing was charged, try again"; `outbound.failed` with retryable codes; refunds and payouts backing off.
1. Confirm it's Stripe (status page, Stripe API errors in logs), not us.
2. Do nothing to the queues: outbound ops retry with backoff and dead-letter only after 8 attempts (`POLICY` `maxAttempts`, NFR-OPS-05). Nothing posts to the ledger without a provider result, so there's no partial state.
3. If the outage is long enough that ops dead-letter: after Stripe recovers, `staff queue dead_letters`, and for each op check Stripe first (did the refund or transfer actually happen?), then `POST /api/v1/staff/outbound-ops/:id/replay` with a reason. The runner looks the movement up before calling again, and a replay starts a new attempt generation, so a replay can't pay twice (design §5).
4. Campaigns whose deadline passes during the outage still settle (settlement is a database step); only their refunds and payouts wait.
5. **Check:** `staff recon run` after recovery: total diff 0, no `op_unconfirmed` breaks left.

## 4. Reconciliation break (SEV2; SEV1 for a money kind above materiality)
**Symptom:** `staff recon` shows open breaks or a non-zero total diff; artist payouts paused (payout-pausing kinds, design §7).
**Impact:** payouts pause for everyone while a payout-pausing break is open (by design); refunds continue.
1. `staff recon` → list the breaks, their kind and amount.
2. By kind:
   - **`unmatched_provider_txn`** with no campaign: usually a Stripe payout to the bank, a Stripe fee or a dispute. Check the payout schedule is still **Manual** (SETUP C8). A dispute is SEV1 until understood (disputes aren't modelled yet, NFR-COMP-04).
   - **`campaign_diff`**: a Stripe fee adjustment on that campaign (fee corrections aren't posted yet, backlog) or a missing ledger posting. Trace the campaign's refs.
   - **`unmatched_ledger_txn`**: a posting whose Stripe movement isn't there. Look it up in Stripe by its ref.
   - **`amount_mismatch` / `currency_mismatch` / `liability_mismatch`**: SEV1. Suspend the worker, then investigate with `staff trace`.
   - **`op_unconfirmed`**: an op sent with no confirmation. Check Stripe, then replay the op (§3 step 3). Doesn't pause payouts.
   - **`stray_capture_aged`**: a stray capture's refund hasn't confirmed. Check the refund in Stripe.
   - **`counter_mismatch`**: public counters only, not money. Recompute and fix.
3. Breaks recon derives (`campaign_diff`, `unmatched_*`, `counter_mismatch`, `liability_mismatch`, `stray_capture_aged`, `op_unconfirmed`) clear themselves on the next `staff recon run` once the cause is fixed. Breaks the money path raises (`amount_mismatch`, `currency_mismatch`, `waiting_funds`) stay open, and there's **no staff route to resolve a core (non-Layer 2) break yet** (gap D-2b; Layer 2 has `pool-breaks/:id/resolve`): until there is, resolve it with a reviewed SQL update that sets `resolved_at` and a reason, and record it in the worklog. Only override the payout pause if you're sure the money is right: `POST /api/v1/staff/recon/override` (privileged, delayed above the threshold).
4. **Target:** no unexplained break older than 1 business day (brief success metric; NFR-COMP-02). Record each in the worklog until the breaks queue has its own SLA view.

## 5. Suspected fraud campaign (SEV2; SEV1 once money is real)
**Symptom:** reports from fans, odd backing patterns (many small backings from new accounts, card testing), evidence that looks fake, an artist identity that doesn't hold up.
1. **Don't verify any milestone** on it. Tranche 1 is paid automatically when a campaign is funded; every later tranche needs your verification with a second factor (FR-PAY-005), so a campaign that hasn't reached its deadline yet has received nothing. If it's live and suspect, refund its backings before the deadline (step 3) rather than let it fund.
2. Look at it: `staff trace` on its backings, the artist's onboarding status in Stripe Connect, the agent review packet if the agent layer is on (`GET /api/v1/staff/agents/proposals?subjectId=<campaign>`; advisory only).
3. Refund individual backings if needed: `staff refund <backingId>` (privileged, reason, delayed above the threshold; refused if it would run after the deadline — a failing campaign refunds everyone automatically).
4. There's **no suspend or takedown action yet** (break-glass suspension FR-CMP-007 is M2). Until then: don't verify, refund what's needed, and if the campaign must disappear from discovery, remove it with a reviewed SQL change and record it.
5. Card testing: Stripe Radar in test mode won't show real patterns. Rate limiting on writes isn't built (NFR-SEC-13, readiness S-7).

## 6. Database down or slow (SEV1 if it lasts > 5 min)
**Symptom:** `/api/health` 503 `database_unavailable`; `worker.error` with connection errors; Supabase dashboard shows the project unhealthy or **paused**.
1. Supabase dashboard → project status. A **paused** project (free plan, after inactivity) → **Restore project**; it takes a few minutes. The staging project was paused on 2026-11-27.
2. Connection errors only: check pooler limits. Vercel uses the transaction pooler (6543) with `DB_POOL_MAX=3` per instance; the worker uses the session pooler (5432) with 5. Too many connections → lower `DB_POOL_MAX` or restart the pooler (Database settings → Restart pooler).
3. Supabase incident (status.supabase.com): nothing to do but wait. Every money step is one transaction, so there's no partial state (design §10).
4. **Check:** `/api/health` ok, worker ticks, `staff recon run` clean.

## 7. API serves 503 `misconfigured` (SEV2 in production)
The API deliberately refuses to start when configuration is missing or unsafe (NFR-SEC-04, FR-PAY-008): sandbox provider in a deployed environment, a non-test Stripe key, no webhook secret.
1. `curl $SITE/api/health` — the body's `issues` names the variable (names only).
2. Fix it in Vercel → Settings → Environment Variables (right scope: Production vs Preview), then **Redeploy**.
3. Never "fix" it by setting `ESCROW_PROVIDER=sandbox` or a live key: both are refused on purpose.

## 8. Sign-in or sign-up broken (SEV2)
1. Supabase → Authentication → Logs. Rate-limited emails → the built-in sender is for testing only; set custom SMTP (SETUP B2.4).
2. Confirmation links landing on the wrong site → Site URL and Redirect URLs (SETUP B2.1).
3. `401` on every API call → JWKS: `SUPABASE_URL` in Vercel must match the project the web's `VITE_SUPABASE_URL` points at.

## 9. Key or data exposure (SEV1)
1. Rotate first: Stripe → API keys → roll the secret key and webhook secret; Supabase → reset the database password / rotate keys; update Vercel and Render, redeploy.
2. Check `staff trace` and audit rows for actions taken with the exposed credential.
3. Counsel decides notification duties for personal data (state breach laws); note the time you learned of it.

---

## Postmortem template
Write one for every SEV1 and any SEV2 that affected users, within 5 business days. Blameless: describe what the system allowed, not who slipped. Save as `specs/postmortems/YYYY-MM-DD-<slug>.md`.

```markdown
# Postmortem: <title> · <date>
**Severity:** SEV1/2 · **Duration:** <start> → <end> (<minutes>) · **Author:** · **Status:** draft/final

## Summary
Two or three sentences: what broke, who was affected, how it ended.

## Impact
Users affected · backings/refunds/payouts affected (ids, amounts) · money at risk vs money actually wrong · notices sent.

## Timeline (ET)
| Time | What happened / what we did |
|---|---|

## Root cause
The chain of causes, down to the one we can change.

## What went well / what didn't
- Detection: how we found out, how long it took (and what would have found it sooner).
- Response: which runbook steps worked, which were wrong or missing.

## Actions
| Action | Type (prevent / detect / mitigate / runbook) | Owner | Due | Tracked in |
|---|---|---|---|---|

## Spec feedback
Requirements that were wrong or missing → `specs/01-requirements.md` / CR.
```
