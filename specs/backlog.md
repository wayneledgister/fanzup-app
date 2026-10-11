# Backlog: FanZuP app

| Item | Origin | Value hypothesis | Size | Added |
|---|---|---|---|---|
| Disputes & refunds full admin queues | CONSOLIDATION (summaries only on /admin) | Fulfillment failure is a named Mechanism 05 risk; ops needs real queues | M | 2026-10-03 |
| Promote shared kit (Modal, Toggle, SegmentedTabs, CopyCode, FileDrop) into `components/brand` | Build agents' reports | Removes 3 near-duplicate implementations across fan, creator and campaign | S | 2026-10-03 |
| Wire admin SLA display to `POLICY.adminSlaBusinessDays` | D1 pass 2 | One source for SLA targets | S | 2026-10-03 |
| Wire the web app to the API (campaign list/detail, back flow, Supabase Auth sign-in) | Backend setup 2026-10-03 | Turns the prototype into a working Fund My Show | M | 2026-10-03 |
| Port the 93-route Playwright sweep into CI | Backend setup 2026-10-03 | Catches visual/overflow regressions on every PR | S | 2026-10-03 |
| Escrow partner adapter (`apps/api/src/escrow/<partner>.ts`) | SETUP.md Part G | Production custody; replaces Stripe dev adapter | M | 2026-10-03 |
| Layer 2 schema migration (offerings, units, Reg CF limits, W-9 tokens) | PRD 01a, council D1 | Needed before `layer2` flag can go on | L | 2026-10-03 |
| Perk fulfillment + disputes API | Mechanism 05 §5 | Fulfillment failure is a named risk | M | 2026-10-03 |

## Carried from G1/G2 for M2 (review round 3, 2026-10-11)
One row per condition carried forward in `gates/G2-design.md` pass 2 ("Conditions carried forward", item 3). Detail is in the origin cited; these rows are the tracking list M2 planning starts from.

| Item | Origin | Value hypothesis | Size | Added |
|---|---|---|---|---|
| Remaining "escrow" copy outside M1 paths (Trust, Fees, For Artists, Landing, creator wizard/payouts, settings payments) reworded with FR-PLT-002 route pruning | G2 C19; design §11 | No page implies custody that doesn't exist | S | 2026-10-11 |
| Recon on FR-PAY-007's schedule ("by 10:00 ET next business day") instead of "older than 24 h" | G2 C21; design §7 | Breaks found before the business day starts | S | 2026-10-11 |
| IP and user agent on sign-up acceptance rows (Supabase "before user created" hook or API-proxied sign-up) | Design §9 G-1; requirements M1 table FR-PRV-001 | Every acceptance carries the evidence FR-PRV-001 requires | M | 2026-10-11 |
| Revoke clients' direct write grants on draft tables once the wizard is wired to the API | Design §9 G-2; NFR-SEC-02 | All writes go through the API; one enforcement point | S | 2026-10-11 |
| Rate limiting on writes | Design §9 G-3; NFR-SEC-13 | Abuse and card-testing resistance beyond the checkout cap | M | 2026-10-11 |
| Size M2 or move volume-only ops/perf items (NFR-PERF-03 at 5,000 backers, NFR-OPS-11 baseline) to P0b | G1 pass 2 N1 | M2 is plannable; first beta isn't the old P0 relabelled | S | 2026-10-11 |
| Single-maintainer change-management rule for NFR-OPS-07 / NFR-SEC-09 (CI invariant suite + recorded agent review + delay on ledger/audit migrations; second human at P0b) | G1 pass 2 N3 | Change controls one person can actually satisfy | S | 2026-10-11 |
| Complete the privileged-action list (recon override, event/dead-letter replay, flags, role grants) and exempt suspension refunds from the daily refund limit | G1 pass 2 N4 | No money action escapes single-operator controls; break-glass isn't throttled | S | 2026-10-11 |
| Real (template-based, founder-reviewed) privacy notice and beta terms before real users | G1 pass 2 N5; G2 C22 | Lawful PII collection at M2 | M | 2026-10-11 |
| Audit PII sidecar: IP, UA and before/after values in an erasable sidecar keyed by audit id | G1 pass 2 N7; NFR-COMP-11 | Deletion actually pseudonymises audit | M | 2026-10-11 |
| Decide how conversion is judged (M3 on live money, or a live-money micro-cohort) | G1 pass 2 N10; G1 cond. 10 | The headline metric becomes falsifiable | S | 2026-10-11 |
| Security-event emails and artist MFA at P0a when addresses are P0a | G1 pass 2 N14 | PII isn't reachable with a password alone and no alert | M | 2026-10-11 |
| Tax line in checkout total when FR-TAX-005 applies | G1 pass 2 N11 | Checkout total stays correct once tax exists | S | 2026-10-11 |
| `disputes.campaignHoldRatio` minimum count (e.g. ≥ 3 disputes and ≥ 1%) | G1 pass 2 N12 | One dispute can't freeze a small campaign | S | 2026-10-11 |
| Criteria cite their policy key instead of hard-coded numbers (FR-PAY-004, FR-PAY-007, NFR-SEC-06) | G1 pass 2 N13 | One number per rule | S | 2026-10-11 |
| Align brief M3 "interim posture" with FR-PAY-010 custodian requirement | G1 pass 2 N15 | M3 exit criteria aren't contradictory | S | 2026-10-11 |
| State that funnel events stay first-party and server-side (FR-PRV-005 vs FR-ANL-001) | G1 pass 2 N16 | The first analytics SDK doesn't break P0a | S | 2026-10-11 |
| Send the weekly single-operator review log to a named outside reader | G1 pass 2 N17; FR-ID-007 | A second pair of eyes before a second staff member exists | S | 2026-10-11 |
| Remaining policy gaps: FR-DSP-003 SLA key, SLA values for verification/unmatched/dead-letter queues | G1 cond. 1 (partly resolved) | Every P0 threshold has a value in `policy.ts` | S | 2026-10-11 |
| One number per obligation: DSAR deadline, pen-test timing, tranche count | G1 cond. 2 (partly resolved) | No contradictory deadlines | S | 2026-10-11 |
| Pseudonymisable audit vs deletion (see N7) and address purge after dispute windows | G1 cond. 4 (partly resolved) | Deletion and immutable audit coexist | S | 2026-10-11 |
| Checkout friction decision revisited with funnel data (G1-B chose full account first) | G1 cond. 6 (partly resolved) | Conversion cost of full account is measured, not assumed | S | 2026-10-11 |
| Replace remaining judge-words with checkable criteria; label E1 constraints | G1 cond. 12 (partly resolved) | Every criterion is testable | S | 2026-10-11 |
