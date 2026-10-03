# FanZuP v2 — Requirements
**Tier:** Enterprise · **Status:** G1 approved **for M1 only** (Wayne, 2026-10-03; PRD trace gates M2) · **Date:** 2026-10-03
**Inputs:** `00-brief.md`; council E1 (`gates/E1-enterprise-readiness.md` + seat notes); README money rules; council D1; CR-001.
**Priorities** (revised at G1 pass 1):
- **P0a** — required before real people use the product with **test-mode money** (the closed beta and the walking-skeleton milestone, `00-brief.md` §Milestones)
- **P0b** — required before **any live money** moves (after E1 card B is settled)
- **P1** — required for general availability (GA)
- **P2** — after GA, or when its trigger condition is met

A P0a requirement never depends on a P0b, P1 or P2 one. Numbers called "policy" are listed in Appendix A and must exist in `packages/shared/src/policy.ts` before the requirement is built.

**Constraints vs requirements:** a few acceptance criteria name an implementation detail because E1 found the defect there (e.g. "stored before processing", "derived from the ledger"). Those are marked *(E1 constraint)*.

**Source tags:** `E1 B<n>` = E1 blocker, `E1 C<n>` = E1 condition, `<Seat> <id>` = a seat finding (e.g. `Sec S4`, `Comp F5`, `Critic 8`). Requirements derived from repo docs cite them. Every requirement still needs a PRD trace (brief Q1).

**ID scheme:** `FR-<AREA>-NNN`. Areas: PAY (money path), BCK (backing & checkout), CMP (campaigns), FUL (fulfillment), DSP (disputes & refunds), ID (identity & access), TAX (tax & sanctions), ADM (staff console), NTF (notifications), COM (community), GRO (growth), ANL (analytics), PRV (privacy & legal), PLT (platform). NFR IDs: SEC, COMP, OPS, PERF, A11Y, QA, I18N.

---

## Milestone M1 scope — walking skeleton (binding)
Approved by Wayne at G1 (card G1-C option 1, 2026-10-03). Moved here from the council note `gates/.G1-pragmatist.md` so it binds (G1 pass-2 N6). M1 is a **subset of P0a**: where an M1 line trims a requirement, only the trimmed part is due at M1 and the rest stays due at M2. Nothing here relaxes a P0a requirement for M2.

**Goal:** on Stripe **test mode** only (E1 card B default; FR-PAY-008), one Fund My Show campaign goes from draft to both tranches released and another from live to every backer refunded, driven from the browser where a fan touches it, with every step audited and traceable by one correlation id.

**Exit test (all must pass, automated in CI unless marked):**
1. A campaign funds and releases **both** tranches (tranche 1 on funding, tranche 2 after verified milestone evidence).
2. A campaign fails and **every** backer is refunded in full.
3. Reconciliation of ledger ↔ processor (Stripe test balance transactions; the sandbox provider in CI) **diffs to zero**, per campaign and in total.
4. Every step of (1) and (2) is traceable by one correlation id: checkout → capture for a backing; settlement → every refund or release it caused.
5. Real Supabase Auth sign-up and sign-in, **full account first**: a signed-out fan who picks a perk signs up, verifies email, and lands back on checkout with the same campaign and perk (FR-BCK-002).
6. The web app's campaign list, campaign page, back (checkout) flow and My backings read and write through the API; no mock data on those paths.
7. A Playwright test of the golden journey runs in CI (fan sign-up → verify → back → confirmation → My backings; then settle → release and settle → refund visible to the fan).
8. *(Manual, Wayne)* The same journey once against Stripe test mode with real test keys; the reconciliation report for that run shows zero difference.

**Requirements in M1** (ID → what M1 delivers; "full" = every acceptance criterion):
| ID | M1 delivers |
|---|---|
| FR-PAY-001 | Full: checkout hold with expiry (`checkout.holdMinutes`), stock held at checkout start, last-unit race, expiry cancels the payment attempt, deadline releases holds |
| FR-PAY-002 | Full: provider events stored (unique) before processing; duplicates processed once; wrong signature / live mode / account rejected; failed events visible and replayable by staff (API) |
| FR-PAY-003 | Full for late captures and amount mismatch; unmatched captures listed in the staff unmatched-money view (API). The fan email for the auto-refund reason is the "refund started" template |
| FR-PAY-004 | Full: initiated record before the provider call, provider lookup before any retry, exact-amount check, dead-letter after `outbound.maxAttempts` (paging = alert log line + staff queue in M1) |
| FR-PAY-005 | Evidence as text and links (file uploads wait for FR-PLT-005 at M2); verification under FR-ID-007 single-operator rules; automatic in-order release |
| FR-PAY-006 | Full, with the parallel-request test in CI |
| FR-PAY-007 | Against the processor only: daily run + on-demand run, per-campaign and total diff, breaks with amount and age, payouts pause on an aged or material break (refunds continue), staff override with reason |
| FR-PAY-008 | Bullets 1–2 (sandbox/dev adapters refuse to start when deployed as production; live keys refused); bullet 3 via FR-PLT-006 |
| FR-PAY-009 | Fan view only (money state per backing derived from the ledger) |
| FR-BCK-001 | Card checkout (Stripe Payment Element; a labelled sandbox card form in CI); charge at backing; failure categories; confirmation |
| FR-BCK-002 | Full (card G1-B option 3) |
| FR-BCK-004 | Full |
| FR-BCK-005 | Without PDF receipts (P1); perk status "Not yet shipped" until FR-FUL-002 |
| FR-CMP-001/002 | Through the API (draft CRUD with perks and tranches, submit, review, publish). Wiring the 26-route web wizard to the API is **M2** |
| FR-CMP-003 | Campaign page renders only the artist's own fields; empty sections hidden; milestone progress with dates |
| FR-CMP-008 | List of live campaigns, default order ending soonest then newest; filters by type; never ordered by money |
| FR-TAX-004 | Unconfirmed-checkout cap per user (`checkout.maxUnconfirmedPerUser`) only |
| FR-DSP-001 | Single-backing full refund of a backing on a live campaign, with reason, under FR-ID-007 (no threshold second approver while single-operator mode is on) |
| FR-ID-001 | Email + password with confirmation link (Supabase Auth); sign out; reset-password and expired-link states. Magic link at M2, passkeys P1 |
| FR-ID-002 | Staff only: second-factor (TOTP, Supabase `aal2`) session required for every privileged action, checked by the API |
| FR-ID-003 | Actor and factor taken from the verified session and recorded; reviewer ≠ owner |
| FR-ID-004 | Stripe Connect (test) onboarding link for the artist's payout account; sandbox account in CI |
| FR-ID-005 | Guards on checkout and My backings (sign in and return); staff API refuses non-staff |
| FR-ID-006 | Full |
| FR-ID-007 | Full except the break-glass suspension (FR-CMP-007 is M2) |
| FR-NTF-001 | Five templates (receipt, funded, failed + refund started, refund completed, milestone released), outbox-driven, logged with template version; the delivery provider is an open setup step (log transport until Wayne picks one) |
| FR-PRV-001 | Mechanics: versioned placeholder documents, acceptance recorded with version, time, IP, user agent; re-acceptance blocks backing |
| FR-PLT-006 | Full |
| FR-ANL-001 (events) | First-party server-side funnel events: perk selected, checkout started, account created, backing confirmed, source (`ref`) |
| NFR-SEC-01 | Column allowlist for `artists` and `profiles` (payout/identity refs never public) + automated test; full allowlist over every object at M2 |
| NFR-SEC-02 | Every M1 write goes through the API |
| NFR-SEC-04 | Fail closed: deployed environments refuse to start with the sandbox provider or without required config |
| NFR-SEC-07 | Seed never loaded outside local/CI; no seeded staff outside local/CI |
| NFR-SEC-12 | Logs redact the listed fields |
| NFR-COMP-11 | Audit events carry actor kind, request/correlation id, factor level; ids only in payloads |
| NFR-COMP-12 | Reject update/delete/truncate on ledger and audit tables |
| NFR-OPS-04 | Correlation id on every request, job, provider call and audit row; structured logs. Error-tracker (Sentry) hookup is a setup step for Wayne |
| NFR-OPS-05 | Bounded attempts, dead-letter, replay; no lock held across a provider call; one failing campaign never blocks others |
| NFR-OPS-06 | Worker heartbeat row + `/api/health` reports its age; the external 5-minute check is a setup step |
| NFR-QA-01 | Core: parallel backings, last-unit race, concurrent retries, duplicate and late events, refunds, many campaigns with one failing |
| NFR-QA-02 | The golden journey above (other journeys M2) |

**Not in M1** (still P0a, due at M2 unless re-prioritised): FR-CMP-007 suspension, FR-ADM-001 web queues (M1 has API queues only), FR-ADM-003 money view UI, FR-PLT-001 server flags, FR-PLT-002 route pruning, FR-PLT-005 uploads, FR-PRV-004, FR-TAX-004 per-user limits beyond the unconfirmed-checkout cap, NFR-SEC-03/05/06/09/13/14, NFR-OPS-01/02/07/08/09/11, NFR-PERF-03/04 as measured SLOs, NFR-A11Y-01..04 automation, NFR-QA-03/05. All P0b, P1, P2 work. The PRD trace (brief Q1) must be done before M2 starts.

---

## 1. Money path (FR-PAY)

### FR-PAY-001: Reserve perk stock at checkout
**Story:** As a fan, I want the perk I'm paying for to be held for me, so that I'm never charged for something that sold out while I was typing my card number.
**Acceptance criteria:**
- Given a fan starts checkout for any perk, then a checkout hold is created for a fixed window (policy `checkout.holdMinutes`); for a perk with a quantity limit, the held units come off the remaining count shown to other fans immediately.
- Given N fans start checkout for the last unit at the same moment, then exactly one reservation succeeds and the others see "Sold out" before any payment is created.
- Given any checkout hold expires without a confirmed payment, then held units return to stock and the payment attempt is cancelled with the processor, so it can no longer be paid.
- Given a campaign's deadline passes, then every open reservation for it is released and its payment attempt cancelled.
**Priority:** P0a · **Source:** E1 B1; Skeptic, Sec S4, Comp F4

### FR-PAY-002: Store every provider event before acting on it
**Story:** As finance, I want every event from the processor or custodian recorded exactly once, so that money state can be audited and replayed.
**Acceptance criteria:**
- Given a signed provider event arrives, then it is stored (unique on provider event id) and acknowledged before any business processing *(E1 constraint)*.
- Given the same event is delivered twice, then it is processed once.
- Given an event's signature, live/test mode or account doesn't match configuration, then it is rejected and logged, and never processed.
- Given a stored event failed processing, then staff can see the error and replay it.
**Priority:** P0a · **Source:** E1 B1, C4; Sec S8, Comp F4, Architect

### FR-PAY-003: Never strand a captured payment
**Story:** As a fan, I want any payment the platform can't accept to come back to me automatically, so that I'm never charged for nothing.
**Acceptance criteria:**
- Given a capture arrives for a campaign that is no longer accepting backings (past deadline, suspended, settled), then a full refund is initiated automatically within 1 hour (policy `refunds.autoInitiateMinutes`) and the fan is emailed the reason.
- Given a capture's amount or currency differs from the backing, then the payment is held, refunded in full, and raised as a reconciliation break.
- Given any capture can't be matched to a backing, then it appears in the staff "unmatched money" queue within 15 minutes.
- In every case above, the ledger records the money in and the money out, and an audit event exists.
**Priority:** P0a · **Source:** E1 B1; Architect, Skeptic, Comp F4

### FR-PAY-004: Each outbound money movement executes at most once
**Story:** As finance, I want refunds and payouts to be impossible to send twice, so that a retry or outage can't double-pay anyone.
**Acceptance criteria:**
- Given a refund or payout is about to be sent, then an "initiated" record exists before the provider call.
- Given a retry happens at any time after the first attempt (including after the provider's idempotency window), then the provider is queried for the original attempt before any new call, and no second movement executes.
- Given the amount sent to the provider, then the ledger records that exact amount; a mismatch fails the operation and opens a break.
- Given an outbound attempt fails a bounded number of times (default 8), then it is dead-lettered into a staffed queue and on-call is paged.
**Priority:** P0a · **Source:** E1 B3; Skeptic, Comp F14, NIT tranche amount

### FR-PAY-005: Milestone releases follow verification
**Story:** As an artist, I want each milestone payment to arrive once my evidence is verified, so that I can pay for the show on time.
**Acceptance criteria:**
- Given an artist submits milestone evidence (files, links, notes) for a tranche, then it enters the staff verification queue with the evidence attached.
- Given milestone evidence, then verification follows FR-ID-003: a verifier not linked to the campaign, plus a second verifier when the tranche exceeds policy `approvals.secondVerifierAboveMinor`.
- Given a tranche is verified, then its release is scheduled automatically with no further approval, and pays within 1 business day unless a hold applies (FR-PAY-007, FR-CMP-007, FR-DSP-004, FR-TAX-001, FR-TAX-003). *(The two-person control sits on verification, not on release.)*
- Given tranches must release in order, then a later tranche never releases before an earlier one.
- Given the last tranche releases, then the campaign moves to its released state and the artist's and backers' timelines show it.
**Priority:** P0a · **Source:** E1 B4; Architect, Skeptic

### FR-PAY-006: Atomic, retry-safe backing creation
**Story:** As a fan on a flaky mobile connection, I want tapping "Back" twice to create one backing, so that I'm never charged twice.
**Acceptance criteria:**
- Given two requests with the same idempotency key arrive concurrently, then exactly one backing and one payment attempt exist, and both requests receive the same response (or the second receives "in progress").
- Given the same key is reused with a different request body, then the request is rejected.
- Given the payment-provider call fails after the backing is created, then a retry with the same key reuses the same backing and payment attempt.
- A parallel-request test proves the above in CI.
**Priority:** P0a · **Source:** E1 B5; Architect, Skeptic, Sec S4

### FR-PAY-007: Daily reconciliation against the custodian
**Story:** As finance, I want the ledger checked every day against what the custodian and processor say they hold and moved, so that I can prove "FanZuP never holds cash".
**Acceptance criteria:**
- Given a business day ends, then by 10:00 ET the next day a reconciliation compares, per campaign and in total: custodian/processor balances and movements ↔ ledger balances ↔ backing and tranche states.
- Given any difference, then a break is opened with amount, age, owner and the transactions involved.
- Given any break older than 1 business day or larger than $1 is open, then all outbound releases pause automatically (refunds to fans continue) until it is resolved or a finance approver overrides with a reason.
- Given processing fees reported by the provider change after capture, then the ledger is adjusted by a correcting transaction, never an edit.
**Priority:** P0a (against the processor) / P0b (against the custodian) · **Source:** E1 B6; Comp F2, NFR-COMP-02, Architect, Skeptic

### FR-PAY-008: Live money only under an approved custody model
**Story:** As Wayne, I want the system to refuse real payments until the flow of funds is approved, so that FanZuP never holds or transmits money it shouldn't.
**Acceptance criteria:**
- Given a deployed environment (staging or production), then sandbox and developer payment adapters refuse to start.
- Given no custody configuration has been marked approved (with a link to the counsel memo), then live payment keys refuse to start.
- Given campaign and checkout copy, then the custodian is named and the word "escrow" appears only if counsel approved it.
**Priority:** P0a · **Source:** E1 B6; Comp F1, NFR-COMP-01, Sec S11 · **Depends on:** E1 card B

### FR-PAY-009: Ledger answers per-person questions
**Story:** As support, I want to see from the ledger what is owed to or held for a specific fan or artist, so that I can answer "where's my money?" without assembling it from several tables.
**Acceptance criteria:**
- Given a fan, then the system shows each of their backings with its money state (held, released to artist, refunded, disputed), derived from the ledger *(E1 constraint)*.
- Given an artist, then the system shows per campaign: raised, fees, held back, released, pending, disputed.
- Public counters (raised, backers) match the ledger for every campaign; a nightly check alerts on any mismatch.
- A fan who backs twice counts as one backer in public counts.
**Priority:** P0a (fan view) / P1 (artist statement) · **Source:** E1 C5; Architect, NIT backers_count

### FR-PAY-010: Custody provider integration
**Story:** As Wayne, I want the chosen custodian connected so that fan money is held, refunded and released by them, not by FanZuP.
**Acceptance criteria:**
- Given the custodian chosen under E1 card B, then backings are collected into, refunded from and released from accounts the custodian controls, with each campaign's funds identifiable.
- Inbound custodian events follow FR-PAY-002; outbound movements follow FR-PAY-004; statements feed FR-PAY-007.
- Swapping the custodian requires no change to campaign, backing or ledger rules (the money rules in the README hold for any provider).
- Until a custodian is live, the test-mode processor plays this role and FR-PAY-008 prevents live keys.
**Priority:** P0b · **Source:** G1 condition 9; Skeptic (custody had a kill switch but no integration requirement)

### FR-PAY-011: Refunds that can't be delivered
**Story:** As finance, I want a plan for refunds that bounce, so that a fan's money never sits unclaimed with nobody responsible.
**Acceptance criteria:**
- Given a refund fails (closed card, expired account), then the fan is contacted to provide another route, and the case appears in the refunds queue.
- Given a refund stays unclaimed past policy `refunds.unclaimedDays`, then it is handled under the state unclaimed-property procedure counsel approves, and the ledger shows it.
**Priority:** P0b · **Source:** G1 Compliance

---

## 2. Backing & checkout (FR-BCK)

### FR-BCK-001: A real checkout
**Story:** As a fan, I want one screen that shows exactly what I'm backing and what happens to my money, so that I can back with confidence.
**Acceptance criteria:**
- Given a fan picks a perk, then the checkout shows: the perk and its delivery date, quantity, an optional extra amount, total in USD, shipping address (physical perks only), the payment method, and the custody/refund promise.
- Given the fan pays, then a confirmation screen shows their backing, the campaign deadline in their local time, what happens if the goal is or isn't met, and a share prompt.
- Given the payment fails, then the fan stays on checkout with a message that states the reason category (declined, expired, authentication failed, network) and the next step, and nothing is charged.
- Cards are supported at P0a; Apple Pay and Google Pay at P0b. Delayed-settlement bank methods stay off until FR-PAY-003 has run in production for one full campaign cycle. [NEEDS CLARIFICATION: confirm ACH stays off at launch]
- Checkout states when the card is charged. P0a builds **charge at backing**: the payment is captured when the fan backs and refunded in full if the campaign fails. Moving to charge-at-success is a change request once the custodian answers (FR-PAY-010). *(G1 pass-2 N8, resolved 2026-10-03.)*
**Priority:** P0a (card) / P0b (wallet pay) · **Source:** E1 B11; Critic 1, Pragmatist P1

### FR-BCK-002: Choice survives sign-up
**Story:** As a new fan arriving from a link, I want my chosen perk to still be selected after I create an account, so that I don't have to start over.
**Acceptance criteria:**
*(Card G1-B option 3, "full account first", Wayne 2026-10-03.)*
- Given a signed-out fan picks a perk, when they choose "Back", then they are asked to sign up or sign in, with the campaign and perk they chose shown on that screen.
- Given the fan signs up, then the account is created with email, password, 18+ attestation and acceptance of the current terms (FR-ID-006, FR-PRV-001), and a verification link is emailed; checkout stays unavailable until the email is verified (FR-ID-001).
- Given the fan opens the verification link (on the same device), then they land on checkout with the same campaign and perk selected, already signed in.
- Given a fan signs in with an existing verified account, then they land on checkout with the same campaign and perk selected.
- Given a signed-in fan whose email isn't verified opens checkout, then checkout explains that the email must be verified first and offers to resend the link; the chosen perk is kept.
- Given a fan is already signed in and verified, then "Back" goes straight to checkout.
- Given the chosen perk sold out or the campaign closed while the fan was signing up, then checkout says so and offers the campaign page; nothing is charged.
- A bot challenge on sign-up arrives at P0b (FR-TAX-004).
**Priority:** P0a · **Source:** Critic 1, Critic feature 1; card G1-B (Wayne)

### FR-BCK-003: Manage a pledge while the campaign is live
**Story:** As a fan, I want to change my perk, add to my pledge, or cancel before the deadline, so that I'm in control of my money.
**Acceptance criteria:**
- Given a campaign is live, when a fan changes perk or quantity, then stock and amounts update and any difference is charged or refunded.
- Given a campaign is live, when a fan cancels, then their payment is refunded in full and the campaign totals update immediately.
- Given the deadline has passed, then the pledge can no longer be changed, and the screen says why.
**Priority:** P0b (restored to E1 level: fan cancel is part of closing E1 B2) · **Source:** Critic 8; Skeptic (no cancel path)

### FR-BCK-004: One deadline for everyone
**Story:** As a fan, I want the deadline to be one exact moment shown in my time zone, so that I don't miss the last day.
**Acceptance criteria:**
- Given a campaign, then its deadline is a single instant, shown in the viewer's local time with the time zone.
- Given less than 24 hours remain, then the campaign shows hours and minutes left and stays open for backing until the instant passes.
- Given the instant passes, then backing closes on every surface within 1 minute.
**Priority:** P0a · **Source:** E1 B12; Critic 13

### FR-BCK-005: My backings
**Story:** As a fan, I want one place for everything I've backed, so that I know each campaign's status, my money's status, and my perk's status.
**Acceptance criteria:**
- Given a fan has backings, then each shows campaign status, money state (FR-PAY-009 fan view), perk status (until FR-FUL-002 ships: "Not yet shipped" or "Delivered" as reported by the artist) and next expected event with a date.
- Given a backing is refunded, then the refund amount, date and reference are shown.
- Receipts can be downloaded as PDF.
**Priority:** P0a (PDF receipts P1) · **Source:** Pragmatist P1; Critic 8

---

## 3. Campaigns (FR-CMP)

### FR-CMP-001: Create and edit a campaign that persists
**Story:** As an artist, I want my campaign draft saved as I build it, so that I can come back to it and submit when ready.
**Acceptance criteria:**
- Given an artist, then they can create, edit and delete a draft with title, type, goal, duration, story, use of funds (line items summing to the goal), risks, media, perks and optional milestone tranches.
- Given a field fails a rule (tier cap, minimum goal, tranche split ≠ 100%, duration outside policy), then the error shows on that field before submission.
- Given an artist returns later on any device, then the draft is exactly as they left it.
**Priority:** P0a · **Source:** E1 B11; Pragmatist P2

### FR-CMP-002: Submit, review, publish
**Story:** As an artist, I want a clear path from draft to live, so that I know what's happening at each step.
**Acceptance criteria:**
- Given a complete draft and a verified artist, when submitted, then it enters the review queue and the artist sees the expected review time from policy.
- Given a reviewer requests revisions, then the artist sees each note against the field it refers to.
- Given approval, then the artist chooses when to go live, and the deadline is set from that moment.
- Every transition is audited with actor and time.
**Priority:** P0a · **Source:** Pragmatist P2; existing SQL workflow

### FR-CMP-003: The campaign page tells the truth
**Story:** As a fan, I want the campaign page to show what this artist actually wrote and did, so that I can judge the campaign on its own merits.
**Acceptance criteria:**
- Given a campaign, then its public page renders the artist's own story, use of funds, risks, perks and milestones, and shows nothing generic or invented. The updates section appears once FR-COM-001 ships.
- Given a section has no content, then the section is hidden, not filled in.
- The wizard preview and the public page use the same rendering, so "exactly as fans will see it" is true.
- Milestone progress is visible to fans: funded → evidence submitted → verified → released, with dates.
**Priority:** P0a · **Source:** E1 B12; Critic 6, Pragmatist feature 5

### FR-CMP-004: Stretch goals
**Story:** As an artist, I want to set stretch goals that unlock extras, so that fans keep sharing after we hit the goal.
**Acceptance criteria:**
- Given an artist adds stretch goals (amount + what unlocks), then they appear on the progress bar and unlock visibly when passed.
- Urgency and scarcity shown anywhere (countdowns, "N left", stretch goals) reflect real data only (FTC fake-urgency guidance).
- Stretch goals never change the funding goal used for target-or-refund.
**Priority:** P1 · **Source:** Pragmatist feature 3, Critic feature 4

### FR-CMP-005: Pre-launch page and "notify me"
**Story:** As an artist, I want a page before launch where fans can sign up to be told when it goes live, so that I start with momentum.
**Acceptance criteria:**
- Given an approved campaign not yet live, then a public pre-launch page collects follows.
- Given the campaign goes live, then every follower who opted in is notified within 5 minutes (FR-NTF-001).
**Priority:** P1 · **Source:** Critic feature 8

### FR-CMP-006: Final-48-hours mode
**Story:** As an artist, I want the last two days to feel urgent, so that late backers act.
**Acceptance criteria:**
- Given under 48 hours remain, then the page shows an hour-level countdown and followers who haven't backed get one reminder.
- Reminders respect notification preferences and are sent at most once per campaign per person.
**Priority:** P1 · **Source:** Critic feature 4

### FR-CMP-007: Staff can suspend a campaign
**Story:** As compliance, I want to stop a campaign that looks fraudulent or broken, so that no more money goes in or out until we know.
**Acceptance criteria:**
- Given a live or funded campaign, when two different staff members approve a suspension with a reason, then new backings are refused and all releases stop.
- Given a suspension is lifted or converted to "cancel and refund all", then that also requires two staff approvals and is audited.
- Fans and the artist see a status that says the campaign is paused, that no money moves while it is paused, and the date of the next update.
**Priority:** P0a (under FR-ID-007 single-operator rules) / P0b (dual control) · **Source:** E1 B2; Comp F5, NFR-COMP-06

### FR-CMP-008: Discover campaigns
**Story:** As a fan, I want to browse and search live campaigns by type, genre and city, so that I can find artists to back.
**Acceptance criteria:**
- Explore lists live campaigns (and, on a separate tab, recently funded ones) with paging, filters (type, genre, city, ending soon) and text search over title, artist and genre.
- Order is never by money raised, money left, or anything return-like (PRD 02 §8); default order is ending soonest, then newest.
- Campaigns not accepting backings are never shown as backable.
**Priority:** P0a (list + filters) / P1 (text search) · **Source:** E1 C7; G1 Architect/Pragmatist

---

## 4. Fulfillment (FR-FUL)

### FR-FUL-001: Backer survey after funding
**Story:** As an artist, I want to collect what I need to deliver (address, size, variant) after the campaign funds, so that I can ship correctly.
**Acceptance criteria:**
- Given a campaign funds, then backers of perks that need details receive a survey; answers can be edited until the artist locks them.
- Shipping addresses are visible to the artist only after funding, only for physical perks, and every view or export is audited (NFR-SEC-08). Artists may use them only to deliver that campaign's perks (FR-PRV-006).
- The artist can export a fulfillment file through a link that expires.
**Priority:** P0b (P0a if any P0a campaign has physical perks) · **Source:** Critic 8, Sec S16

### FR-FUL-002: Fulfillment hub
**Story:** As an artist, I want to mark perks as shipped or redeemed in bulk with tracking, so that backers know where their perk is.
**Acceptance criteria:**
- Given perks, then the artist can update status singly or in bulk and import tracking numbers.
- Given a status change, then the backer is notified and sees it on My backings.
- A physical perk counts as delivered only on carrier confirmation or backer confirmation, not on the artist's word alone.
**Priority:** P0b · **Source:** Pragmatist feature 9, Comp F5

### FR-FUL-003: Late perks give fans a choice
**Story:** As a fan, I want to be told when a perk is late and be offered my money back, so that I'm not left waiting forever.
**Acceptance criteria:**
- Given a perk passes its promised date undelivered, then the artist is required to give a new date within policy `fulfillment.newDateDays`, and backers are notified with the new date and the option to cancel for a full refund.
- Given a backer cancels, then the refund comes from money not yet released to the artist first, then from the holdback (FR-DSP-005).
- [NEEDS CLARIFICATION: counsel on 16 CFR 435 applicability (brief Q6)]
**Priority:** P0b (restored to E1 level) · **Source:** Comp F5, NFR-COMP-07

### FR-FUL-004: Show tickets as perks
**Story:** As an artist running a show campaign, I want ticket perks to come with a scannable code, so that I can check fans in at the door.
**Acceptance criteria:**
- Given a funded campaign with a ticket perk, then each backer gets a unique code per ticket in the app and by email.
- Given the artist scans a code, then it shows valid, already used, or invalid, and works offline for the door session; offline scans sync and duplicates are flagged.
- Codes are signed and single-use, can't be forged or guessed, are revoked when the backing is refunded, and reveal no personal data when scanned by anyone but the artist's door app.
**Priority:** P1 · **Source:** Pragmatist feature 10

---

## 5. Disputes & refunds (FR-DSP)

### FR-DSP-001: Refund any backing in any state
**Story:** As support, I want to refund a single backing at any stage, so that I can fix real problems.
**Acceptance criteria:**
- Given a backing in any money state, when support issues a full or partial refund with a reason, then it executes once (FR-PAY-004) and the ledger shows where the money came from (held funds, holdback, or platform).
- Refunds above a policy threshold need a second staff approval.
- Refunds made directly in the provider's dashboard are matched, recorded and flagged for review, not ignored.
**Priority:** P0a · **Source:** E1 B2; Skeptic, Comp F4

### FR-DSP-002: Chargebacks are tracked end to end
**Story:** As finance, I want every chargeback recorded with its deadline and outcome, so that losses are known and we respond in time.
**Acceptance criteria:**
- Given the provider reports a dispute, then a case opens with the backing, amount, reason, evidence deadline and money held.
- Given the outcome (won/lost), then the ledger records it and the case closes.
- Staff can attach evidence (perk status, backer messages, delivery proof) from within the case.
**Priority:** P0b · **Source:** E1 B2; Skeptic, Comp F3

### FR-DSP-003: Fan-raised problems
**Story:** As a fan, I want to report a problem with a perk from my backings page, so that someone acts before I have to call my bank.
**Acceptance criteria:**
- Given a fan reports a problem, then a case opens visible to the artist and support, with a timeline both sides can add to.
- Given the case isn't resolved within the policy SLA, then support is alerted.
**Priority:** P0b (restored to E1 level) · **Source:** Critic 9

### FR-DSP-004: Disputes hold releases
**Story:** As finance, I want releases paused for a campaign with too many disputes, so that we don't pay out money that's being clawed back.
**Acceptance criteria:**
- Given a campaign's open-dispute ratio exceeds a policy threshold, then its pending releases pause and staff are alerted.
**Priority:** P0b · **Source:** Comp F3, NFR-COMP-04

### FR-DSP-005: Loss allocation follows the policy
**Story:** As Wayne, I want dispute losses and refund costs charged where the policy says, so that the ledger and the artist agreement agree.
**Acceptance criteria:**
- Given the chosen policy (E1 card C), then dispute losses, dispute fees and refund processing costs post to the specified party, and the artist's statement shows each deduction.
- Holdback amount and window come from policy, not code.
**Priority:** P0b · **Source:** Comp F3 · **Depends on:** E1 card C, brief Q5

---

## 6. Identity & access (FR-ID)

### FR-ID-001: Real sign-in
**Story:** As any user, I want to sign up and sign in for real, so that my backings and campaigns are mine.
**Acceptance criteria:**
- Email + password, magic link and passkeys are supported; email is verified before the first backing (card G1-B option 3; FR-BCK-002). M1 ships email + password only.
- Sessions expire and can be revoked; signing out everywhere works.
- Password reset, locked-account and expired-link states are handled with human messages.
**Priority:** P0a (passkeys P1) · **Source:** E1 B11; Pragmatist P1

### FR-ID-002: Step-up for sensitive actions
**Story:** As a user, I want a second factor required for actions that move money or change where it goes, so that a stolen password isn't enough.
**Acceptance criteria:**
- Staff must enroll MFA before their first privileged action, and every staff action requires a second-factor session.
- Artists must have MFA to submit a campaign, change a payout account, submit milestone evidence or view shipping addresses.
- Changing email, password or payout account requires recent re-authentication.
- Server-side checks enforce this; the UI alone never does.
**Priority:** P0a (staff) / P0b (artists) · **Source:** E1 B7; Sec S3

### FR-ID-003: Staff roles and separation of duties
**Story:** As Wayne, I want each staff member to have only the powers their job needs, and nobody approving their own work, so that the platform passes due diligence.
**Acceptance criteria:**
- Roles exist for at least: campaign reviewer, milestone verifier, KYC/sanctions reviewer, support, finance, admin. Each permission is granted to roles, not people.
- A staff member can't review, verify or refund anything for a campaign they own or are linked to.
- Granting or removing a role requires an admin, a reason, and (for finance/admin) a second admin; every change is audited.
- Milestone verification and refunds above policy thresholds need two distinct approvers; releases follow verification automatically (FR-PAY-005).
- For every privileged action, the acting staff id and second-factor level are taken by the server from the verified session, never from request input, and recorded in the audit event.
- While FR-ID-007 single-operator mode is active, its rules replace the two-approver requirements above.
- An access review lists everyone's roles quarterly and records sign-off.
**Priority:** P0a (actor/factor recording, reviewer ≠ owner) / P0b (separate roles, second approvers) · **Source:** E1 B7; Sec S2, Comp F15, NFR-COMP-17

### FR-ID-004: Artist identity and payout onboarding
**Story:** As an artist, I want to verify who I am and connect where I get paid in one guided step, so that I can launch without a pile of forms.
**Acceptance criteria:**
- Identity verification and payout-account setup are completed through a hosted flow from the payment or custody provider; FanZuP stores only references and statuses, never documents.
- The artist sees one status (not started / in progress / action needed / verified) with the next step.
- Identity status is rechecked before each release (FR-TAX-003).
**Priority:** P0a (processor test mode) / P0b (live) · **Source:** Pragmatist P9, E1 C16

### FR-ID-005: Guarded screens
**Story:** As Wayne, I want staff, creator and account screens to be unreachable without the right session and role, so that nobody sees tools they shouldn't.
**Acceptance criteria:**
- Signed-out users who open a protected screen are sent to sign in and returned afterwards.
- Users without the role see a "not available" page, not the tool.
- Staff tools are served separately from the public app and require staff single sign-on. [NEEDS CLARIFICATION: staff identity provider — Google Workspace?]
- Design-system and demo-only pages aren't served in production.
**Priority:** P0a (guards) / P1 (separate staff origin + SSO) · **Source:** Sec S10, E1 C2

### FR-ID-006: Adults only, enforced
**Story:** As compliance, I want every account holder to have attested they're 18 or older, recorded server-side, so that the platform stays clear of minors' data rules.
**Acceptance criteria:**
- Account creation without an 18+ attestation is rejected by the server; the attestation's time and method are stored.
- Artists' age is confirmed by identity verification.
- Accounts reported as belonging to a minor can be suspended and handled per a written procedure.
**Priority:** P0a · **Source:** Comp F10, NFR-COMP-15

### FR-ID-007: Single-operator mode
**Story:** As Wayne, while I'm the only staff member, I want controls that still protect fans without needing a second person, so that the safety controls are real rather than nominal.
**Acceptance criteria:**
- Single-operator mode is a visible, audited platform setting. While it is on:
  - every privileged action needs a typed reason and a second-factor session;
  - money actions above policy `singleOperator.delayAboveMinor` (refunds, verifications, suspension lifts) take effect only after a delay of policy `singleOperator.delayHours`, during which they can be cancelled;
  - per-day limits apply to refunds and verifications (policy `singleOperator.dailyLimits`);
  - a weekly review lists every privileged action taken, and Wayne's sign-off on it is recorded;
  - the operator can't own or be linked to any campaign.
- Break-glass: an emergency suspension (FR-CMP-007) can be applied instantly by the single operator; lifting it follows the delay rule.
- **Exit condition:** single-operator mode must be off before any live money moves (P0b). Turning it off requires at least two people holding staff roles with MFA, a named on-call backup, and the dual-control rules of FR-ID-003, FR-CMP-007 and FR-DSP-001 active. *(Card G1-A option 1, Wayne 2026-10-03.)*
**Priority:** P0a · **Source:** G1 blocker 2 (Architect, Skeptic, Pragmatist)

### FR-ID-008: Payout-account changes are slowed down
**Story:** As an artist, I want a new payout account to take effect only after a waiting period with alerts, so that someone who steals my login can't redirect my money.
**Acceptance criteria:**
- Given a payout account is added or changed, then it requires step-up authentication (FR-ID-002), the artist is notified on every channel, and releases to the new account wait policy `payouts.newAccountCoolingHours`; the artist can cancel the change from the alert.
**Priority:** P0b · **Source:** G1 Security

---

## 7. Tax & sanctions (FR-TAX)

### FR-TAX-001: No payout without tax identity
**Story:** As finance, I want every artist's tax form and TIN match done before their first payout, so that FanZuP never owes withholding it didn't collect.
**Acceptance criteria:**
- Given an artist has no certified W-9 (or W-8) on file with the tax vendor, or the TIN match failed, then releases to them are blocked and they're told exactly what to do.
- FanZuP stores only the vendor reference and status.
- Backup withholding can be applied when required.
**Priority:** P0b · **Source:** E1 B9; Comp F6, NFR-COMP-08

### FR-TAX-002: Year-end information returns
**Story:** As an artist, I want my year-end tax form available in the app, so that I can file on time.
**Acceptance criteria:**
- Given the filing responsibility settled in the custody contract (brief Q7), then the required forms are generated or retrieved by January 31 and shown under Tax documents, with corrections supported.
- Fans backing reward campaigns get no tax forms (D1).
**Priority:** P1 · **Source:** Comp F6; D1 · **Depends on:** brief Q7

### FR-TAX-003: Sanctions screening
**Story:** As compliance, I want everyone we pay and everyone who pays screened against sanctions lists, so that FanZuP never moves money for a sanctioned person.
**Acceptance criteria:**
- Artists are screened (sanctions + PEP) before campaign submission and again within 24 hours before each release.
- All users are re-screened when lists update; a potential match blocks money movement for that person and opens a review case.
- Backers are screened at checkout by the provider or FanZuP at least on name and country. [NEEDS CLARIFICATION: which party screens backers — depends on the custodian]
- A confirmed match freezes the person's money movements and follows a written block-and-report procedure, including any required report to OFAC within its deadline; staff actions on the case are audited.
**Priority:** P0b · **Source:** E1 B9; Comp F7, NFR-COMP-09

### FR-TAX-004: Fraud and abuse limits on backing
**Story:** As finance, I want card-testing and fake-account abuse stopped, so that the processor relationship survives.
**Acceptance criteria:**
- Backing attempts are rate-limited per user, per IP and per payment instrument (policy limits); limits hold across server instances.
- Sign-up and checkout are protected by a bot challenge.
- A user can have at most a policy-set number of unconfirmed checkouts at once.
- Linked accounts (shared payment instrument, device or address with the artist) can't back that artist's campaign, and don't count toward badges.
**Priority:** P0a (per-user limits, unconfirmed-checkout cap) / P0b (bot challenge, instrument limits, linked accounts) · **Source:** E1 B8; Sec S5, Comp F7, NFR-COMP-10

### FR-TAX-005: Sales tax on taxable perks
**Story:** As finance, I want sales tax handled correctly where perks are taxable goods or tickets, so that FanZuP and artists don't build up liabilities.
**Acceptance criteria:**
- Given counsel's answer on marketplace-facilitator obligations for physical perks and tickets, then perks are classified as taxable or not, and taxable checkouts calculate, show and collect tax by destination when FanZuP (or the custodian) is the collecting party.
- Collected tax is held separately in the ledger and remitted on schedule; artists' statements show it.
- [NEEDS CLARIFICATION: counsel — is FanZuP a marketplace facilitator for reward perks, and which perk kinds are taxable?]
**Priority:** P0b · **Source:** G1 blocker 5 (Compliance/Ops)

---

## 8. Staff console (FR-ADM)

### FR-ADM-001: Real queues
**Story:** As staff, I want every queue to be a real worklist with assignment and SLA timers, so that nothing waits unseen.
**Acceptance criteria:**
- Queues exist for: campaign review, milestone verification, identity/sanctions hits, refunds, disputes, fan-raised problems, fulfillment problems, unmatched money, reconciliation breaks, dead-lettered money operations, privacy requests, comment reports.
- Each item can be claimed or assigned, shows an SLA timer from policy, and alerts the owner at 75% of SLA.
- Filters for "mine", status and age; keyboard triage on desktop.
**Priority:** P0a (review, verification, refunds, unmatched money, dead letters) / P0b (disputes, breaks, identity/sanctions, privacy requests, fan problems) / P1 (comment reports) · **Source:** Critic 9, Pragmatist P10, Comp F18, NFR-OPS-08

### FR-ADM-002: 360° search
**Story:** As support, I want to find a person, backing or campaign from one search box, so that I can answer a fan in one minute.
**Acceptance criteria:**
- Search by email, name, backing id, campaign, payment reference or card last four.
- A person view shows profile, backings, campaigns, money states, cases, notifications sent and audit trail.
- Every staff view of personal data is audited.
**Priority:** P0b (search by email/backing id + person view) / P1 (full) · **Source:** Critic feature 10, Sec S13

### FR-ADM-003: Money view per campaign
**Story:** As finance, I want one screen showing a campaign's money, so that I can answer "where is it?" without SQL.
**Acceptance criteria:**
- Shows ledger balances by account, backings by state, refunds, disputes, tranches with status and evidence, outbound attempts, reconciliation status and holds.
- Read-only; actions link to the relevant queue.
**Priority:** P0a · **Source:** Pragmatist P10

---

## 9. Notifications (FR-NTF)

### FR-NTF-001: Transactional messages
**Story:** As a fan or artist, I want to be told when something happens to my money or campaign, so that I never have to wonder.
**Acceptance criteria:**
- Emails go out within 5 minutes for at least: backing receipt, backing changed/cancelled, campaign funded, campaign failed + refund initiated, refund completed, perk status changed, perk late (FR-FUL-003), milestone released (artist and backers), campaign submitted/approved/revisions requested, payout sent/failed, dispute opened (artist), security events (new sign-in, password/email/payout change).
- Transactional messages can't be switched off; marketing messages can.
- Every message sent is logged with template version.
**Priority:** P0a (receipt, funded, failed + refund started, refund completed, milestone released) / P0b (full list) · **Source:** Pragmatist P8, Critic 4

### FR-NTF-002: Notification center
**Story:** As a user, I want an in-app inbox of what happened, so that I can catch up in one place.
**Acceptance criteria:**
- Unread count on the bell; grouped list with deep links; mark one or all read; empty state.
- Preferences page controls each optional category by channel (email, push, in-app).
**Priority:** P1 · **Source:** Critic 4

### FR-NTF-003: Web push and digests
**Story:** As a fan, I want an optional weekly digest of the artists I follow, so that I come back between campaigns.
**Acceptance criteria:**
- Opt-in web push on supported browsers; opt-in weekly digest by email.
**Priority:** P2 · **Source:** Critic feature 6

---

## 10. Community (FR-COM)

### FR-COM-001: Campaign updates
**Story:** As an artist, I want to post updates (public or backers-only) that reach my backers, so that they stay with me through the campaign and fulfillment.
**Acceptance criteria:**
- Updates support text, images and links; backers-only updates are hidden from others.
- Backers are notified per their preferences; the update count shows on the campaign page.
- Posting is copy-linted against banned language before publishing (Layer 1 rules).
**Priority:** P1 · **Source:** Pragmatist feature 2, Critic 6

### FR-COM-002: Comments and "Ask the artist"
**Story:** As a fan, I want to comment and ask questions, so that I can connect with the artist and other fans.
**Acceptance criteria:**
- Comments on campaigns and updates show a backer badge for backers; the artist can reply, pin, and turn answers into FAQ entries.
- Comments are rate-limited per user (NFR-SEC-13).
- Users can report comments; reports go to a moderation queue; staff can hide and restrict accounts.
- User-written text is rendered safely (NFR-SEC-14).
**Priority:** P1 · **Source:** Critic 7

---

## 11. Growth (FR-GRO)

### FR-GRO-001: Every page shares well
**Story:** As an artist, I want my campaign link to show a rich preview with live progress, so that fans click it.
**Acceptance criteria:**
- Campaign, artist and pre-launch pages have their own title, description and social card image showing artwork, title, % funded and time left, refreshed at least hourly.
- Crawlers receive the metadata without running JavaScript.
- Every route has its own document title; a sitemap and robots file exist.
**Priority:** P0b · **Source:** Critic 2, Pragmatist feature 1

### FR-GRO-002: Share kit and native share
**Story:** As an artist or fan, I want one tap to share with a good message, so that sharing is effortless.
**Acceptance criteria:**
- Share uses the device share sheet when available, otherwise copies the link with visible and screen-reader confirmation.
- Artists get a share kit: story/square/link images, suggested posts, a QR code and an embeddable progress widget. The widget is served from a separate origin with its own security policy, carries no session, and shows only public data.
**Priority:** P1 · **Source:** Critic 3, Critic feature 2

### FR-GRO-003: Referral attribution
**Story:** As an artist, I want to know which fans and channels brought backers, so that I can thank them and double down.
**Acceptance criteria:**
- Each fan gets a personal link per campaign; backings arriving through it are attributed (last-touch within a policy window).
- The artist sees backers and amount by source; fans see how many backers they brought.
- Attribution earns badges only, never money (Layer 1 rule; D1 condition 3).
- Referral links contain an opaque code; they never reveal the referring fan's identity to anyone unless that fan has made their profile public.
**Priority:** P1 · **Source:** Pragmatist feature 7, Critic feature 3

### FR-GRO-004: Follow artists
**Story:** As a fan, I want to follow an artist, so that I hear about their next campaign.
**Acceptance criteria:**
- Follow/unfollow from artist and campaign pages; followers are notified of launches (FR-CMP-005).
- Artists see follower counts, not follower identities, unless the fan opts in.
**Priority:** P1 · **Source:** Critic feature 8

### FR-GRO-005: Backer wall and engagement badges
**Story:** As a fan, I want to be recognized for supporting artists, so that backing feels like belonging.
**Acceptance criteria:**
- Opt-in public backer list per campaign.
- Badges count engagement only (campaigns backed, shows attended, backers referred, update streaks); never amounts, and never Layer 2 holdings; self-backing and linked accounts are excluded (D1 condition 3).
**Priority:** P2 · **Source:** Pragmatist feature 6

---

## 12. Analytics (FR-ANL)

### FR-ANL-001: Artist funnel
**Story:** As an artist, I want to see views → checkout → backed by source and perk, so that I know what to change mid-campaign.
**Acceptance criteria:**
- Dashboard shows daily views, checkout starts, backings, conversion, top sources and conversion by perk, with no more than 1 hour of lag.
- No personal data about individual viewers is shown.
**Priority:** P1 (events captured from P0a) · **Source:** Pragmatist feature 8, Critic feature 9

### FR-ANL-002: Platform metrics
**Story:** As Wayne, I want the brief's success metrics on one dashboard, so that I know whether v2 is working.
**Acceptance criteria:**
- Every success metric in `00-brief.md` is computed daily and shown with its target.
- Product analytics respects consent where state law requires it.
**Priority:** P1 · **Source:** 00-brief success metrics

---

## 13. Privacy & legal (FR-PRV)

### FR-PRV-001: Recorded acceptance of real documents
**Story:** As Wayne, I want every user's acceptance of the current terms recorded, so that our policies are enforceable.
**Acceptance criteria:**
- Terms of Use, Privacy Notice, Artist Campaign Agreement and Backer Pledge Terms are published from counsel-approved versions.
- Each acceptance stores user, document, version, time, IP and user agent; a new version that Wayne marks "re-acceptance required" blocks the user's next relevant action (backing, submitting, payout) until accepted.
- Checkout shows the refund policy and the artist's delivery commitment.
**Priority:** P0a (mechanics, placeholder documents) / P0b (counsel-approved documents) · **Source:** E1 B9; Comp F11, NFR-COMP-16

### FR-PRV-002: Export my data
**Story:** As a user, I want a copy of my data, so that I can see what FanZuP holds.
**Acceptance criteria:**
- A request produces a downloadable archive (profile, backings, campaigns, messages, consents, notifications) within the legal deadline, tracked as a case.
**Priority:** P0b (restored to E1 level) · **Source:** Sec S15, Comp F9, NFR-COMP-14

### FR-PRV-003: Delete my account
**Story:** As a user, I want to delete my account, so that my personal data is gone except what the law makes FanZuP keep.
**Acceptance criteria:**
- After the policy grace period, personal data is removed or pseudonymised; financial and audit records are kept under legal hold, linked to a pseudonymous id.
- The UI states exactly what is kept and why before the user confirms.
- Data held by vendors (identity, tax) is deleted through their processes where permitted.
- Deletion is blocked while the user has a live campaign, open money movements or open cases, and the UI says what must finish first.
**Priority:** P0b (restored to E1 level) · **Source:** Sec S15, Comp F9, NFR-COMP-13

### FR-PRV-004: Public profile is opt-in
**Story:** As a fan, I want my profile private unless I choose otherwise, so that I'm not discoverable just for backing an artist.
**Acceptance criteria:**
- New fan profiles are private; only the owner sees city and join date; public profiles show only chosen fields.
**Priority:** P0a · **Source:** Sec S7

### FR-PRV-005: Consent for marketing and tracking
**Story:** As a user, I want to choose whether I get marketing emails and whether I'm tracked, so that FanZuP respects my choices.
**Acceptance criteria:**
- Every message type is classified transactional or marketing; marketing messages have an unsubscribe that works within 10 business days, a physical address and an accurate sender (CAN-SPAM); transactional messages carry no promotional content beyond what the law allows.
- Non-essential cookies and trackers load only after consent where required; browser opt-out signals (Global Privacy Control) are honoured as an opt-out of sale/sharing.
- Artist digests and follower notifications count as marketing unless they are about a campaign the fan backed.
**Priority:** P0b (P0a: no non-essential trackers and no marketing email at all) · **Source:** G1 Compliance

### FR-PRV-006: What artists may do with backer data
**Story:** As a fan, I want artists to use my details only to deliver what I backed, so that backing doesn't put me on a mailing list I didn't choose.
**Acceptance criteria:**
- Checkout discloses which details the artist receives and why.
- The Artist Campaign Agreement limits use of backer data to delivering that campaign's perks and communicating about it; exports carry the same notice.
- Artists receive only the fields a perk needs (no email unless the fan opts in to hear from the artist directly).
**Priority:** P0b · **Source:** G1 Compliance

---

## 14. Platform (FR-PLT)

### FR-PLT-001: Server-enforced feature flags
**Story:** As Wayne, I want regulated and unfinished features controlled on the server, so that nobody can switch them on with a URL.
**Acceptance criteria:**
- Flags are evaluated per environment, per cohort and per user on the server, and enforced by the API and the database for any data they guard.
- URL flag overrides work only in development and for signed-in staff.
- Production bundles don't contain Layer 2 or post-Beta screens unless their flag is on in production.
- Every flag change is audited.
**Priority:** P0a · **Source:** E1 C1; Sec S9, Architect

### FR-PLT-002: Honest production scope
**Story:** As a fan, I want every screen I can reach to actually work, so that I trust the product.
**Acceptance criteria:**
- Each route is tagged core / later / demo-only; production serves only core routes (and later routes whose backend is live); navigation never links to an unavailable route.
- Mock data is never served in production.
**Priority:** P0a · **Source:** Pragmatist P11, E1 card A

### FR-PLT-003: Locale-aware display
**Story:** As an international fan, I want numbers and dates in my format and an estimate in my currency, so that I understand the price.
**Acceptance criteria:**
- Dates, numbers and money render through one locale-aware formatter.
- Checkout shows "Charged in USD" plus an approximate local amount when the viewer's locale currency differs.
- All UI strings are extractable for translation.
**Priority:** P1 (formatter + estimate) / P2 (translations) · **Source:** Critic 14

### FR-PLT-004: Installable app
**Story:** As a mobile fan, I want to add FanZuP to my home screen, so that I can check my backings quickly.
**Acceptance criteria:**
- The web app is installable, launches to My backings for signed-in fans, and shows a useful offline message.
**Priority:** P2 · **Source:** brief (no native apps)

### FR-PLT-005: Safe uploads and downloads
**Story:** As Wayne, I want every file people upload or download handled safely, so that files can't leak data or attack users.
**Acceptance criteria:**
- Uploads (campaign media, milestone evidence, dispute evidence, avatars) accept only allowed types and sizes (policy `uploads`), verified by content, not file name; files are scanned for malware before anyone else can open them.
- Uploaded files are served from a separate origin, never as active content (no HTML or script; SVG served as images only), with private files reachable only through links that expire (policy `downloads.linkMinutes`) and are tied to the requester's permission.
- Every download of a private file (evidence, exports, addresses) is audited.
- Image metadata (location) is stripped from public images.
**Priority:** P0a · **Source:** G1 blocker 4 (Security)

### FR-PLT-006: What test-money participants are promised
**Story:** As a fan or artist in the test-money beta, I want to know that no real money moves and what that means for perks, so that nobody is misled or left out of pocket.
**Acceptance criteria:**
- Given the payment provider is in test mode, then every money surface (campaign page, checkout, confirmation, My backings, receipts and every money email) shows a persistent notice: test mode, no real money moves, use a test card.
- Given a backing made in test mode, then the artist owes no perk for it; delivering anything is voluntary, and the campaign page and checkout say so.
- Given no custodian is live (FR-PAY-010), then no screen or email names a custodian or says "escrow"; the promise is stated as "if the goal isn't met by the deadline, every backer is refunded in full".
- Given the provider is switched to live mode, then the notice disappears only because FR-PAY-008 allowed live keys; nothing else turns it off.
**Priority:** P0a · **Source:** G1 pass-2 N9 (Skeptic, Compliance/Ops)

---

## Non-functional requirements

### Security (NFR-SEC)
| ID | Requirement | Pri | Source |
|---|---|---|---|
| NFR-SEC-01 | Anonymous and signed-in clients can read only an explicit allowlist of columns from every table, view, function and realtime channel; identity references, payout references, verification flags and internal ids are never readable by anyone but the owner and authorised staff. An automated test asserts this for every exposed object and fails CI on drift. | P0a | E1 B7; Sec S1; G1 Security |
| NFR-SEC-02 | All writes go through the API; direct database writes from clients are disabled. | P0a | E1 C3; Architect |
| NFR-SEC-03 | Production web responses carry a strict Content-Security-Policy (no inline script; payment-provider origins only), HSTS with preload, frame-ancestors none, nosniff, a strict Referrer-Policy and a restrictive Permissions-Policy. CSP runs in report-only for ≥ 7 days before enforcement. | P0a (report-only) / P0b (enforced) | E1 B8; Sec S6 |
| NFR-SEC-04 | Deployed environments fail closed: missing configuration stops the service rather than defaulting to sandbox or developer behaviour; developer routes exist only in local development; public error responses never include configuration detail. | P0a | Sec S11, S13; Comp F19 |
| NFR-SEC-05 | Each runtime (API, worker, migrations) uses its own least-privilege database role and credentials; none uses the database owner; credentials rotate at least every 90 days and on staff departure. Payment-provider keys are restricted to the operations each runtime needs. | P0a | Sec S12 |
| NFR-SEC-06 | Access tokens are verified for issuer, audience and algorithm; staff sessions expire within 15 minutes of inactivity and are revocable immediately. | P0a | Sec S17 |
| NFR-SEC-07 | No internet-reachable environment contains accounts with published passwords; no seeded account holds a staff role anywhere. | P0a | Sec S12, Comp F12 |
| NFR-SEC-08 | Shipping addresses and other PII beyond email are encrypted at rest, unreadable through general table access, revealed only through an audited, purpose-checked path, and purged after the later of 90 days post-delivery and the close of the card-dispute window for that backing (policy `retention.addressDays`). | P0b (P0a if physical perks in a P0a campaign) | Sec S16; G1 Architect |
| NFR-SEC-09 | CI enforces: least-privilege workflow tokens, actions pinned to commit SHAs, pinned tool versions, static analysis (JS/TS), dependency review and audit gate (high+ blocks), secret scanning with push protection, an SBOM per release, and CODEOWNERS review on migrations, money code, auth and CI. | P0a | Sec S14 |
| NFR-SEC-10 | A threat model covers backing, payout, milestone verification, uploads, staff tools and identity flows, and is updated with each major feature. An external penetration test is completed before live money and annually after. | P0a (threat model) / P0b (pen test) | Sec baseline; G1 Security |
| NFR-SEC-12 | Logs redact authorization headers, cookies, webhook signatures, idempotency keys, payment client secrets, email addresses and query strings; provider error text is stored only after redaction. | P0a | Sec S13; G1 Security |
| NFR-SEC-13 | Every write endpoint (not only backing) is rate-limited per user and per IP with limits shared across instances (policy `rateLimits`); auth endpoints follow the identity provider's limits plus a bot challenge on sign-up at P0b. | P0a | Sec S5; G1 Security |
| NFR-SEC-14 | All user-written content (campaign story, updates, comments, profile, perk text, evidence notes) is rendered as sanitised text or a safe rich-text subset; no user content can execute script in any FanZuP origin. | P0a | Sec S6; G1 Security |
| NFR-SEC-11 | A security contact (`/.well-known/security.txt`) and a vulnerability-disclosure policy are published. | P1 | Sec baseline |

### Compliance (NFR-COMP)
Adopted from the Compliance/Ops seat (`gates/.E1-compliance-ops.md`), where each has its full wording; summarised here.
| ID | Requirement (summary) | Pri | Covered by |
|---|---|---|---|
| NFR-COMP-01 | No live payment before counsel approves the flow-of-funds memo (custodian, merchant of record, settlement entity, state money-transmission analysis, "escrow" wording). | P0b | FR-PAY-008 |
| NFR-COMP-02 | Daily three-way reconciliation; breaks tracked; releases auto-pause on aged/material breaks. | P0a (processor) / P0b (custodian) | FR-PAY-007 |
| NFR-COMP-03 | Outbound money recorded as an intent before the provider call; provider looked up before any retry. | P0a | FR-PAY-004 |
| NFR-COMP-04 | Dispute lifecycle ingested and posted; releases held above a dispute-ratio threshold; losses allocated per the artist agreement. | P0b | FR-DSP-002/004/005 |
| NFR-COMP-05 | Provider events stored before processing and replayable; any payment that can't be applied is refunded automatically — initiated within 1 hour, confirmed within 5 business days; checkout holds expire. | P0a | FR-PAY-001/002/003 |
| NFR-COMP-06 | Staff dual-control suspension blocks backings and releases. | P0a (single operator) / P0b (dual control) | FR-CMP-007 |
| NFR-COMP-07 | Late perks trigger notices and cancel-for-refund; post-funding refunds possible; physical final tranche needs delivery evidence. | P0b | FR-FUL-002/003 |
| NFR-COMP-08 | No artist release without a certified W-9/W-8 and passing TIN match; withholding and year-end forms supported. | P0b | FR-TAX-001/002 |
| NFR-COMP-09 | Sanctions/PEP screening before submission and within 24 h before each release; daily re-screen; hits block money. | P0b | FR-TAX-003 |
| NFR-COMP-10 | Velocity limits and fraud rules on backing; linked-account self-backing detection before badges count backings. | P0a (per-user) / P0b (full) | FR-TAX-004 |
| NFR-COMP-11 | Every state change to money, campaign, identity, staff, fulfillment or consent data emits an audit event with actor (user / staff / `system:<component>`), request id, IP, user agent, second-factor level and before/after. Audit payloads refer to people by id only and never contain free-text personal data, so deletion (FR-PRV-003) pseudonymises them by removing the id-to-person link. | P0a | FR-ID-003; G1 Architect/Compliance |
| NFR-COMP-12 | Audit and ledger tables reject update, delete and truncate; daily export to object-locked storage retained ≥ 7 years with a signed daily digest. | P0a (reject update/delete/truncate) / P0b (locked export + digest) | — |
| NFR-COMP-13 | Written retention schedule per data class, in place before the first real user's data is collected; deletion pseudonymises PII and retains financial/audit records under legal hold. | P0a (schedule) / P0b (deletion) | FR-PRV-003 |
| NFR-COMP-14 | Data-subject access, deletion and correction requests (incl. vendor-held data) tracked and answered within 45 days; opt-out preference signals honoured where required. | P0b | FR-PRV-002/003/005 |
| NFR-COMP-15 | 18+ attestation enforced server-side; artist age verified by the identity provider. | P0a | FR-ID-006 |
| NFR-COMP-16 | Counsel-approved Terms, Privacy, Artist Agreement and Backer Terms; acceptances recorded with version, time, IP, UA. | P0a (recording) / P0b (approved documents) | FR-PRV-001 |
| NFR-COMP-17 | Reviewer ≠ owner; evidence + two approvers above threshold for verification; audited role changes; quarterly access review. | P0a (reviewer ≠ owner, audited roles) / P0b (two approvers, access review) | FR-ID-003 |
| NFR-COMP-19 | A breach-response procedure meets state notification laws (who decides, who is told, deadlines), with counsel on call; it is tested once before live money. | P0b | G1 Compliance |
| NFR-COMP-20 | Card-data scope is validated (target: no card data touches FanZuP systems; hosted payment fields only) and the processor's self-assessment is filed annually. | P0b | G1 Compliance |
| NFR-COMP-21 | A data-processing agreement is signed with every vendor that receives personal data, and the vendor list is published in the Privacy Notice. | P0b | G1 Compliance; Sec baseline |
| NFR-COMP-22 | A written AML/fraud risk assessment exists and is reviewed annually, even if FanZuP isn't itself a money-services business. | P0b | Comp F7; G1 Compliance |
| NFR-COMP-23 | Promotional claims follow FTC endorsement and fake-urgency rules: no invented scarcity, countdowns, testimonials or social proof. | P0a | G1 Compliance |
| NFR-COMP-18 | WCAG 2.2 AA verified by automated checks in CI and a manual assistive-technology pass on core journeys; vendor VPATs. | P0a | NFR-A11Y |

### Operations (NFR-OPS)
| ID | Requirement | Pri | Source |
|---|---|---|---|
| NFR-OPS-01 | Production runs on its own database project (point-in-time recovery on), its own web/API environment and its own worker; seed data is never loaded there. | P0a | Comp F12 |
| NFR-OPS-02 | RPO ≤ 5 minutes, RTO ≤ 4 hours for API + database; a quarterly restore drill re-verifies ledger invariants and reconciliation on the restored copy, and its result is logged. | P0a (PITR on) / P0b (RTO proven by drill) | Comp F12 |
| NFR-OPS-03 | Daily logical backups of ledger, audit, backings, campaigns and tranches to storage outside the database provider (separate account and region). | P0b | Comp F12 |
| NFR-OPS-04 | API, worker and web report errors to an error tracker; metrics exist for queue depth and oldest-item age, dead letters, campaigns past deadline still live, webhook lag, reconciliation breaks, and refund/release success rates; every request, job and provider call carries one correlation id end to end. | P0a | Comp F13, Architect |
| NFR-OPS-05 | Background jobs have per-type concurrency, bounded attempts (default 8), a dead-letter state, and replay; no database lock is held across an external call; one failing campaign never stops the others from settling. | P0a | Comp F13/F19, Architect, Skeptic |
| NFR-OPS-06 | The worker writes a heartbeat checked externally every 5 minutes; 10 minutes missing pages on-call. | P0a | Comp F13 |
| NFR-OPS-07 | Exactly one migration path to production, gated by required reviewers, pinned tooling, expand → deploy → contract for money tables; changes to ledger or audit tables need two approvers. | P0a | Comp F16 |
| NFR-OPS-08 | Operational queues are database-backed with assignment, SLA timers from policy and audit. | P0a | FR-ADM-001 |
| NFR-OPS-09 | A severity matrix, on-call rota, runbooks for the top five failure modes (worker down, webhook backlog, provider outage, reconciliation break, suspected fraud campaign) and a postmortem template exist before real users (P0a, single operator); a named backup on-call exists before live money (P0b). | P0a / P0b | Comp F18; G1 |
| NFR-OPS-10 | A public status page reports checkout, settlement/refunds and payouts separately; SEV1/2 incidents are posted within 30 minutes. | P0b | Comp F18 (restored to E1 level) |
| NFR-OPS-12 | Each single point of failure (one database region, one worker, one processor/custodian) has a written degrade mode (read-only site, queued settlement, "pledges paused" banner) that can be switched on in under 5 minutes; a custodian-outage game day runs before live money and semi-annually after. Production deploys freeze during the final hour and settlement of any campaign above policy `ops.freezeAboveMinor`. | P0b | Comp baseline; G1 Compliance |
| NFR-OPS-13 | Support requests go into a helpdesk that links each ticket to the user and backing; first response within 1 business day. | P0b | Comp F18 |
| NFR-OPS-11 | Alerting thresholds follow the operational baseline in `gates/.E1-compliance-ops.md` (ledger/recon break, dead-lettered money op, heartbeat, past-deadline campaigns, outbox age, webhook failures, checkout 5xx, dispute ratio, SLA at 75%, error-budget burn). | P0a | Comp baseline |

### Service levels & performance (NFR-PERF)
28-day rolling objectives, sized for the brief's volume assumptions (Q4).
| ID | Requirement | Pri |
|---|---|---|
| NFR-PERF-01 | Checkout API availability ≥ 99.9%; p95 server time for creating a backing < 800 ms at 50 backings/second sustained for 10 minutes. | P0b |
| NFR-PERF-02 | Public campaign and discovery reads: availability ≥ 99.9%; p95 < 400 ms at 500 requests/second; campaign pages cacheable at the edge for anonymous viewers with ≤ 60 s staleness for progress. | P0b |
| NFR-PERF-03 | Campaigns settle within 15 minutes of their deadline (99.5%); failed-campaign refunds are initiated within 1 hour of settlement (99.9%) and confirmed within 5 business days (99%); refunds for a 5,000-backer campaign are all initiated within 1 hour. | P0a |
| NFR-PERF-04 | Verified tranches release within 1 business day (99%, excluding policy holds); provider events are applied within 5 minutes of receipt (99.9%). | P0a |
| NFR-PERF-05 | Web: Largest Contentful Paint < 2.5 s and Interaction to Next Paint < 200 ms at p75 on a mid-range phone over 4G for landing, campaign and checkout; initial JS for those routes ≤ 200 KB compressed. | P1 |
| NFR-PERF-06 | Discovery lists are paginated (≤ 50 per page), filterable by status, type, genre and city, and never ordered by money raised or anything return-like (PRD 02 §8). | P0a |

### Accessibility (NFR-A11Y)
| ID | Requirement | Pri |
|---|---|---|
| NFR-A11Y-01 | Every user-facing flow meets WCAG 2.2 AA. Automated checks run on every production route in CI; serious and critical violations fail the build. | P0a |
| NFR-A11Y-02 | Motion is reduced or removed when the user prefers reduced motion. | P0a |
| NFR-A11Y-03 | Borders of interactive controls have ≥ 3:1 contrast against adjacent colours. | P0a |
| NFR-A11Y-04 | Sign-up, checkout, identity hand-off, refund status and the staff review queue pass a manual screen-reader and keyboard-only test before Beta, recorded with date and tester. | P0a |
| NFR-A11Y-05 | A public accessibility statement with a contact route exists; a light theme is available as an accessibility setting. | P1 |

### Quality (NFR-QA)
| ID | Requirement | Pri |
|---|---|---|
| NFR-QA-01 | Money-path tests cover, against real Postgres: concurrency (parallel backings, last-unit races, concurrent retries), late and out-of-order provider events, duplicate events, refunds in every state, disputes, retries beyond the provider idempotency window, and settlement of many campaigns with one failing. | P0a |
| NFR-QA-02 | End-to-end browser tests cover the golden journeys: discover → back → confirm → perk status; sign-up with a chosen perk; create → submit → approve → publish; settle → release; settle → refund; dispute → resolve. They run on every PR against an isolated database. | P0a (dispute journey P0b) |
| NFR-QA-03 | Every page defines loading, empty and error states; money screens' error states say the money is safe and offer retry. | P0a |
| NFR-QA-04 | Preview deployments use isolated databases seeded with synthetic data. | P1 |
| NFR-QA-05 | Unused code and dependencies are removed (the 46 unused generic UI components and their packages); one data-access layer serves both mock and real data during migration. | P0a |

### Internationalisation (NFR-I18N)
| ID | Requirement | Pri |
|---|---|---|
| NFR-I18N-01 | All money, number and date formatting goes through one formatter keyed by locale; no literal currency strings in UI code. | P1 |
| NFR-I18N-02 | UI strings live in message catalogs; adding a language needs no code change. | P2 |

---

## Traceability: E1 blockers → requirements
| E1 blocker | Requirements | Fully closed at |
|---|---|---|
| B1 stranded captures | FR-PAY-001, 002, 003; NFR-COMP-05; NFR-QA-01 | P0a |
| B2 no remedy after funding | FR-CMP-007; FR-DSP-001..005; FR-BCK-003; FR-FUL-003 | P0b (P0a: single-backing refund + single-operator suspension) |
| B3 double execution | FR-PAY-004; NFR-OPS-05 | P0a |
| B4 tranches 2+ | FR-PAY-005 | P0a |
| B5 idempotency race | FR-PAY-006 | P0a |
| B6 custody & recon | FR-PAY-007, 008, 010; NFR-COMP-01, 02 | P0b (P0a: processor recon + live keys refused) |
| B7 data exposure & privileged actions | NFR-SEC-01; FR-ID-002, 003, 007 | P0a (exposure, actor recording, single-operator controls) / P0b (dual control) |
| B8 abuse & hardening | FR-TAX-004; NFR-SEC-03, 04, 13, 14 | P0a / P0b (bot challenge, enforced CSP) |
| B9 regulated perimeter | FR-TAX-001, 003, 005; FR-PRV-001, 005, 006 | P0b |
| B10 prod & operability | NFR-OPS-01..13; NFR-SEC-05, 07, 12 | P0a (prod stack, alerts, runbooks) / P0b (drill, backup on-call, status page) |
| B11 not wired | FR-ID-001; FR-BCK-001, 002, 005; FR-CMP-001, 002, 008; FR-PLT-002 | P0a |
| B12 trust-breaking UX | FR-CMP-003; FR-BCK-004 | P0a |

## Traceability: E1 conditions → requirements
| E1 condition | Requirements |
|---|---|
| C1 server-side flags | FR-PLT-001 |
| C2 route guards, staff origin + SSO | FR-ID-005 |
| C3 API owns all writes | NFR-SEC-02 |
| C4 escrow boundary covers inbound events | FR-PAY-002, FR-PAY-010 |
| C5 owner-scoped ledger, derived counters | FR-PAY-009 |
| C6 durable job backbone | NFR-OPS-05 |
| C7 paginated, cacheable discovery + search | FR-CMP-008; NFR-PERF-02, 06 |
| C8 audit context, truncate block, locked export | NFR-COMP-11, 12 |
| C9 deletion, DSAR, retention, 18+ | FR-PRV-002, 003; FR-ID-006; NFR-COMP-13, 14 |
| C10 encrypted shipping addresses | NFR-SEC-08; FR-FUL-001 |
| C11 CI supply chain, one migration path | NFR-SEC-09; NFR-OPS-07 |
| C12 WCAG 2.2 AA | NFR-A11Y-01..05; NFR-COMP-18 |
| C13 loading/error states, web tests | NFR-QA-02, 03 |
| C14 per-route titles, social cards, sitemap | FR-GRO-001 |
| C15 remove dead UI kit; one data-access seam | NFR-QA-05 |
| C16 processor-hosted artist identity | FR-ID-004 |
| C17 one locale-aware formatter | FR-PLT-003; NFR-I18N-01 |

## Out of scope (restated)
Layer 2 investing and all `layer2`/`postBeta` builds (CR-001 stays spec-first: T-HV-01/02 only); general ticketing (show-perk QR codes are FR-FUL-004, P1), merch store, live streaming and backstage (each needs its own spec; routes hidden in production); native apps; multi-currency settlement; multi-tenant accounts.

## Appendix A — Policy defaults (accepted)
Every threshold a requirement calls "policy". **Accepted as a set by Wayne, 2026-10-03.** Each must be added to `packages/shared/src/policy.ts` before the requirement that uses it is built. Keys marked "per counsel" or "per card" stay undecided until that answer arrives.
| Key | Proposed default | Used by | Basis |
|---|---|---|---|
| `checkout.holdMinutes` | 15 | FR-PAY-001 | Common checkout hold; long enough for 3-D Secure |
| `checkout.maxUnconfirmedPerUser` | 3 | FR-TAX-004 | Limits card-testing |
| `refunds.autoInitiateMinutes` | 60 | FR-PAY-003, NFR-COMP-05 | E1 Compliance |
| `refunds.secondApprovalAboveMinor` | 50000 ($500) | FR-DSP-001 | Policy default |
| `refunds.unclaimedDays` | per counsel (state unclaimed-property rules) | FR-PAY-011 | Counsel |
| `approvals.secondVerifierAboveMinor` | 500000 ($5,000) | FR-PAY-005, FR-ID-003 | Policy default |
| `singleOperator.delayAboveMinor` | 100000 ($1,000) | FR-ID-007 | Policy default |
| `singleOperator.delayHours` | 24 | FR-ID-007 | Policy default |
| `singleOperator.dailyLimits` | refunds $5,000/day; verifications 3/day | FR-ID-007 | Policy default |
| `outbound.maxAttempts` | 8 | FR-PAY-004, NFR-OPS-05 | E1 Compliance |
| `recon.materialityMinor` | 100 ($1) | FR-PAY-007 | E1 Compliance |
| `recon.maxBreakAgeBusinessDays` | 1 | FR-PAY-007 | E1 Compliance |
| `disputes.campaignHoldRatio` | 1% of a campaign's backings | FR-DSP-004 | Below network monitoring thresholds |
| `disputes.holdback` | per card E1-C (size and window) | FR-DSP-005 | Founder + counsel |
| `fulfillment.newDateDays` | 7 | FR-FUL-003 | Policy default |
| `payouts.newAccountCoolingHours` | 72 | FR-ID-008 | Policy default |
| `retention.addressDays` | later of delivery + 90 and expected-delivery + 180 | NFR-SEC-08 | Covers card-dispute windows |
| `rateLimits` | backing 5/min & 20/h per user; all writes 60/min per user, 120/min per IP | NFR-SEC-13, FR-TAX-004 | E1 Security |
| `uploads` | images ≤ 10 MB (jpg/png/webp/gif), video ≤ 200 MB (mp4), documents ≤ 20 MB (pdf) | FR-PLT-005 | Policy default |
| `downloads.linkMinutes` | 15 | FR-PLT-005, FR-FUL-001 | Policy default |
| `referrals.attributionDays` | 30 | FR-GRO-003 | Policy default |
| `ops.freezeAboveMinor` | 2500000 ($25,000) goal | NFR-OPS-12 | Policy default |
| `staff.idleTimeoutMinutes` | 15 | NFR-SEC-06 | E1 Security |

## Open items
G1 is approved for M1 only. Before M2:
1. **PRD trace (brief Q1)** — gates M2: attach or commit the doc set; every FR/NFR gets a PRD source or "new in v2".
2. Founder cards still open: E1-A (scope), E1-B (custody posture; default "no live money" holds), E1-C (dispute/refund-fee allocation; M1 keeps FanZuP absorbing refund fees). G1-A, G1-B and Appendix A were decided 2026-10-03.
3. `[NEEDS CLARIFICATION]` items: ACH at launch (FR-BCK-001); staff identity provider (FR-ID-005); who screens backers (FR-TAX-003); sales-tax facilitator status (FR-TAX-005); 16 CFR 435 (FR-FUL-003); settlement entity for 1099-K (FR-TAX-002).
4. Success-metric targets and volume assumptions (brief Q3, Q4).

## Change log
- 2026-10-03: v2 draft created from council E1 (Claude, on Wayne's request "evaluate and come up with an improvement spec … enterprise level"). Scope per E1 card A default.
- 2026-10-03: revised after G1 pass 1. P0 split into P0a (test-mode beta) / P0b (live money). Added FR-PAY-010 custody integration, FR-PAY-011 undeliverable refunds, FR-CMP-008 discovery, FR-ID-007 single-operator mode, FR-ID-008 payout-account cooling-off, FR-TAX-005 sales tax, FR-PRV-005 marketing/tracking consent, FR-PRV-006 artist use of backer data, FR-PLT-005 safe uploads; NFR-SEC-12..14, NFR-COMP-19..23, NFR-OPS-12..13. System-derived actor + factor on privileged actions; two-person control placed on milestone verification, not release. Restored E1 levels for fan cancel, late-perk remedy, fan problems, export/deletion and status page (P0b). One number per obligation (auto-refund initiated ≤ 1 h, confirmed ≤ 5 business days). Audit payloads carry ids only; address purge outlasts dispute windows. Added E1-conditions trace and Appendix A policy defaults. Checkout per card G1-B default (light account).
- 2026-10-03: G1 decisions recorded (Wayne): G1-C option 1 (M1 only; PRD trace gates M2), G1-A option 1, G1-B option 3 (full account first), Appendix A accepted. Added §Milestone M1 scope (from `.G1-pragmatist.md`). Rewrote FR-BCK-002 for full account first and aligned FR-ID-001 (N2). FR-BCK-001 charge at backing (N8). New FR-PLT-006 test-money promise (N9).
