# E1 — Enterprise readiness evaluation · FanZuP app · 2026-10-03

**Mode:** Standalone (sdd-evaluate) on the whole repo at `a165610`. Rubric improvised from the founder's goal ("bring it to an enterprise-level app with highly desirable features"), the README money-path rules, and council D1.
**Tier:** Enterprise (as requested) · **Seats:** Architect, Skeptic, Pragmatist, Critic, Security, Compliance/Ops
**Seat notes:** `.E1-<seat>.md` in this folder (full findings, file:line references).
**Limits of this review:** the FanzUp doc set (PRDs 01–03, Mechanisms 03–07, `products/*.html`) is not in the repo and wasn't reachable from this session. PRD references below come from where the repo cites them. A doc-trace pass is still owed.

**Verdict (pass 1): REVISE — not ready for real money or real users.**
The ledger core is genuinely good: balanced, append-only, idempotent, service-role-only, tested against real Postgres. All six seats said so. What's missing is everything around it: the unhappy money paths, the regulated perimeter, privileged-access controls, operability, and a web app that actually uses the API. "Enterprise" features stacked on today's base would be built over a ledger that can drift silently from real money.

## Blockers (priority order, deduplicated across seats)

| # | Blocker | Raised by | Resolved looks like |
|---|---|---|---|
| 1 | **Captured money can be stranded.** A payment that lands after the deadline, after a perk sells out (perk stock isn't reserved at checkout), or out of order makes `record_backing_captured` raise. The webhook then fails, Stripe retries for ~3 days and gives up, and the fan is charged with no backing, no ledger entry and no refund. Delayed methods (ACH) make this routine. | Architect, Skeptic, Security S4/S8, Compliance F4 | Webhook inbox stored before processing (unique on event id); "can't apply" → automatic refund via outbox + audit; perk stock reserved at checkout with expiry; abandoned checkouts expire and their payment intents are cancelled. |
| 2 | **No remedy after funding.** Refunds only work for failed campaigns. Chargebacks, support refunds, a fan cancelling during the live window, an undelivered perk, or a fraudulent campaign have no state, no ledger accounts and no stop button. `charge.refunded` on a funded campaign throws. | Skeptic, Compliance F3/F5, Critic 8 | Dispute lifecycle + ledger accounts (hold, loss, reserve); single-backing refund function for any state; staff `suspended` state (dual control) that blocks backings and releases; fulfillment-overdue flow with cancel-for-refund. |
| 3 | **Outbound money can execute twice.** Payout/refund is called, then recorded in a separate step. Retries continue past the processor's ~24h idempotency window with no lookup, no attempt cap, no dead-letter and no alert, while holding a row lock across the HTTP call. | Skeptic, Architect, Compliance F13/F14 | Two-phase intents (`initiated` row before the call, provider lookup before any retry), bounded attempts → dead-letter → page. |
| 4 | **Milestone tranches 2+ never pay out.** Only `campaign.funded` triggers releases; `verify_tranche` enqueues nothing, and no route calls it. | Architect, Skeptic | Verify → outbox `tranche.verified` → release; evidence submission + verification API; amount passed through, not recomputed. |
| 5 | **Idempotency race on `POST /backings`.** Check-then-act: two concurrent retries create two backings and two payment intents. | Architect, Skeptic, Security S4 | Claim-first idempotency row; partner key derived from the client key; parallel-request test. |
| 6 | **Custody and reconciliation are unproven.** The only real-money adapter routes funds through FanZuP's own processor balance (the opposite of "FanZuP never holds cash"). No reconciliation of ledger vs. partner exists. No partner is chosen. | Compliance F1/F2, Pragmatist P3, Skeptic | Counsel-approved flow-of-funds memo before any live key; deployed environments refuse `stripe-dev`/`sandbox`; daily three-way reconciliation with a break queue that auto-pauses releases. |
| 7 | **Sensitive data and privileged actions are exposed.** Anyone with the public anon key can read every artist's KYC reference and payout account id (`artists_read using (true)` + default SELECT grant). MFA is never enforced. Staff can approve their own campaigns, and `verify_tranche` trusts a caller-supplied reviewer id. | Security S1/S2/S3, Compliance F15 | Column-level SELECT grants + RLS regression tests; `aal2` enforced in DB and API for staff, payout and money actions; reviewer ≠ owner; split staff roles; two-person approval above a threshold. |
| 8 | **No abuse controls or browser hardening on a payments app.** No rate limit or CAPTCHA (open card-testing oracle), no CSP/HSTS/frame-ancestors while tokens sit in localStorage. Dev routes and sandbox escrow fail open if env is missing. | Security S5/S6/S11 | Shared-store rate limits, CAPTCHA on signup + checkout, processor fraud rules, strict CSP + security headers, fail-closed env. |
| 9 | **The regulated perimeter is missing.** No W-9/TIN gate or 1099 design before artist payouts; no OFAC/sanctions screening at onboarding or before release; Terms, Privacy, Artist Agreement and Backer Terms don't exist and consent isn't recorded. | Compliance F6/F7/F11 | Tax vendor + TIN match gating releases; screening before submission and before each release; counsel-approved documents; `legal_acceptances` with version/time/IP. |
| 10 | **No production environment or operability.** One Supabase project (staging) with seeded staff whose password is public; no prod, PITR, restore drill, error tracking, metrics, heartbeat or alerting. | Compliance F12/F13, Security S12, Architect, Pragmatist P8 | Separate prod stack with PITR + quarterly restore drill; least-privilege DB roles; Sentry/OTel, outbox-age and heartbeat alerts, status page, runbooks. |
| 11 | **The product isn't wired.** 0 of 93 routes call the API; there's no checkout screen; the chosen perk is lost at sign-up; there's no API to create, submit, review or publish a campaign; auth pages have no auth behind them. | Pragmatist P1/P2, Critic 1 | One real Fund My Show flow end to end in the browser: sign in → create → review → publish → back (real card, test mode) → settle → release or refund. |
| 12 | **Trust-breaking UX defects.** The public campaign page shows the same invented budget split and updates on every campaign; on its final day a campaign shows "Campaign ended" and disables backing (date-only deadline, `-0` days). | Critic 6/13 | Campaign page renders the artist's real story/use-of-funds/updates (same component as the wizard preview); deadline is a UTC instant with hour-level countdown. |

## Conditions (concerns to carry into the spec)
1. Server-side feature flags; `?flags=` overrides off in production; Layer 2 routes tree-shaken from prod bundles. → Security S9, Architect
2. Web route guards; admin on a separate origin behind SSO; `/ds` out of prod. → Security S10
3. One write surface: the API owns all writes; PostgREST read-only. → Architect
4. Escrow boundary covers inbound events too (`parseEvent/handleEvent`, provider-agnostic `escrow_events`). → Architect
5. Owner-scoped ledger sub-accounts + balance snapshots; counters derived from the ledger, not parallel. → Architect
6. Durable job backbone: per-topic concurrency, max attempts, DLQ, replay; no locks across HTTP. → Architect, Skeptic
7. Paginated, cacheable discovery API + search; first hot path at 10x. → Architect
8. Audit events carry actor/system id, request id, IP, UA, aal, before/after; TRUNCATE blocked; daily export to object-locked storage ≥ 7 years. → Security S13, Compliance F8
9. Account deletion = pseudonymisation; DSAR export; retention schedule; 18+ attestation enforced server-side. → Security S15, Compliance F9/F10
10. Shipping addresses in an encrypted, separately-granted table; reveal-on-need with audit; purge after delivery. → Security S16
11. CI supply chain: least-privilege token, SHA-pinned actions, pinned Supabase CLI, CodeQL, dependency review, secret scanning, CODEOWNERS on money/migrations. One migration path to prod. → Security S14, Compliance F16
12. WCAG 2.2 AA: reduced motion, control-border contrast ≥ 3:1, axe in CI, manual AT pass on checkout/KYC. → Critic 5/10, Compliance F17
13. Loading/error states as part of the page definition of done; web tests (Vitest, Playwright journeys). → Critic 11/12
14. Per-route titles, OG/Twitter cards with live progress, sitemap — sharing is the growth engine. → Critic 2/3, Pragmatist feature 1
15. Remove 5,083 unused lines of `components/ui` and ~20 dead dependencies; one data-access seam (`queries.ts`) for the mock→API swap. → Pragmatist P4/P7
16. Separate Layer 1 artist identity (processor-hosted onboarding) from Layer 2 investor KYC (partner-owned). → Pragmatist P9
17. Locale/currency through one formatter; strings extractable. → Critic 14

## Findings (summary — full text in seat files)
| Voice | Blockers | Concerns | Nits |
|---|---|---|---|
| Architect | 3 (stranded captures, tranches 2+, non-atomic backing create) | 10 | 3 |
| Skeptic | 7 (late capture, oversell, idempotency race, double-pay, tranches 2+, chargebacks, no single-backing refund) | 6 | 1 |
| Pragmatist | 3 (not wired, no create API, custody is the critical path) | 8 | 3 |
| Critic | 4 (no checkout step, no shareability, fabricated campaign content, final-day "ended" bug) | 10 | 1 |
| Security | 6 (S1 anon reads KYC/payout refs, S2 self-approval, S3 no MFA, S4 idempotency, S5 no abuse controls, S6 no CSP) | 10 | 2 |
| Compliance/Ops | 10 (F1 custody, F2 recon, F3 disputes, F4 stranded captures, F5 no post-funding remedy, F6 tax gate, F7 sanctions/AML, F11 legal docs, F12 no prod/backups, F13 no alerting) | 8 | 1 |

## Dissent (kept, not averaged)
- **What "enterprise" means.** *Pragmatist:* one real flow end to end that is observable, auditable and recoverable; cut v1 to ~15 of the 69 base routes; no SSO, microservices or multi-region before ~10k backings/month. *Architect:* agrees on the core, but wants a domain-modular API, an event backbone, search, and owner-scoped ledger accounts designed now so commerce, live and Layer 2 don't land in one flat `routes/` folder. *Critic:* enterprise also means the experience — checkout, notifications, comments, i18n, accessibility — because that's what users and partners judge. *Security/Compliance:* enterprise means the controls a custodian's due diligence and a SOC 2 auditor will ask for.
- **Whether to proceed at all.** *Skeptic:* no new feature work until the unhappy money paths exist, the processor is reconciled, and one real backing has run through the web app. Enterprise demand is unvalidated. *Pragmatist:* proceed, but in strict sequence, starting the calendar-bound items (custodian, counsel) this week.
- **Layer 2 / CR-001.** *Pragmatist:* freeze all `layer2`/`postBeta` UI. This doesn't reopen Wayne's D1 decision (holder votes stay in scope, spec-first); it argues the build stays after the first reward campaign ships, which CR-001 already says.

## Skeptic's strongest reason not to proceed
The money path is proven only on its happy path, against a sandbox that confirms everything instantly and never delivers events late, out of order, or not at all. Every edge a real processor produces — delayed captures, oversold perks, concurrent retries, chargebacks, support refunds, lost refund confirmations, milestone verifications after funding — ends in a webhook 500 loop or an outbox retry that can repeat a payout. Several of these break invariants the README states. The custody partner the design depends on is undecided and may not support the model. Building enterprise features on top now builds polish over a ledger that can drift from real money, for demand nobody has measured.

## Decisions the founder must make

**Card E1-A — What does "enterprise" mean for the next version?**
- **Decision:** choose the scope of the improvement spec.
- **Why it matters now:** it decides whether the next months go into depth (one flow that's real, safe and operable, plus the growth features that drive campaigns) or breadth (wiring tickets, merch, streaming and investing too).
- **Options:**
  1. **Enterprise-grade core, then growth (default).** Harden money, security and ops; wire Fund My Show end to end; then add the highly desirable campaign features (sharing, updates, notifications, stretch goals, fulfillment hub, staff console). Tickets/merch/streaming/backstage stay hidden in production until each gets its own spec.
  2. **Full breadth.** Wire every base route (commerce, live streaming, backstage) to real backends in this version. Roughly 3–4× the work, with each area a product of its own.
  3. **Hardening only.** Fix the blockers and stop; no new features until a beta runs.
- **Default:** option 1. Five of six seats support it; the Skeptic prefers 3.
- **Who decides:** you.

**Card E1-B — How do you take real money before an escrow partner signs?**
- **Decision:** the custody posture for a beta with real money. [Compliance F1; SETUP Part G]
- **Why it matters now:** partner paperwork is 6–12 months; without an interim posture, no real campaign can run, and the current Stripe adapter would make FanZuP the holder of funds.
- **Options:**
  1. **No live money until a custodian signs (default).** Build and run the beta in test mode; start partner talks and counsel now.
  2. **Counsel-approved interim posture.** For example, a processor-held model where the processor (not FanZuP) is the settlement entity, with copy that doesn't say "escrow" until a custodian exists. Faster, but needs a written counsel opinion first.
- **Default:** option 1, with option 2 decided by counsel's answer.
- **Who decides:** you, after counsel. Ask: "Under a Stripe Connect (or equivalent) model where funds are held until a campaign succeeds, who is the payment settlement entity, does FanZuP have money-transmission exposure in any state, and can we use the word 'escrow'?"

**Card E1-C — Who carries chargebacks and refund processing costs?**
- **Decision:** the loss-allocation policy for disputes and refund fees. [Compliance F3; SETUP "decision you should confirm"]
- **Why it matters now:** reward crowdfunding has a structurally high "item not received" dispute rate; the ledger and the artist agreement both need a rule before the first live campaign.
- **Options:**
  1. **Artist holdback (default).** Hold back a share of the first payout for a fixed window to cover disputes on that campaign; FanZuP keeps absorbing card fees on failed-campaign refunds (backers get 100% back). The holdback size is a policy default to confirm with counsel.
  2. **Platform absorbs everything.** Simplest for artists; FanZuP carries all dispute losses and refund fees.
  3. **Artist bears everything.** Disputes and refund fees come out of artist proceeds; failed-campaign refunds net of fees (breaks "refunded in full").
- **Default:** option 1.
- **Who decides:** you; counsel confirms the artist-agreement wording.

## User decision
_Pending — Wayne._

## Changelog
- 2026-10-03: pass 1 recorded. Founder away; proceeding to draft the improvement spec on the defaults of cards E1-A/B/C, which stay open for decision.
