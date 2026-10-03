# Layer 2 · Album royalty Pool (CR-002) — Requirements
**Tier:** Enterprise (regulated domain), built as a **demo on mock rails** · **Status:** G1+G2 combined pass (`specs/gates/L2-G1G2.md`) · **Date:** 2026-10-03
**Authority:** [CR-002](../changes/CR-002-l2-album-royalty-pool.md) (Wayne, 2026-10-03).
**Sources:** cited by ID only — PRD 01 (§6.2–6.5, §8, §11, §11.1), PRD 01a (§2–4), PRD 01b (§1, §3, §5), PRD 02 §8, Mechanisms 01, 03, 04, 07, Brand §7.4–7.5. The repo is public; requirements are written here in our own words and don't reproduce the PRD or mechanism text. Where this file cites an acceptance-criterion ID from those documents (e.g. "01a AC-I1"), the test that covers it carries the same ID.

**Trace caveat:** the PRD/mechanism text was not available in the build session; IDs are cited as given in the founder's brief of 2026-10-03. A trace pass against the doc set is open item L2-Q1.

## Demo posture (applies to every requirement below)
- **D-1** Everything is behind the `layer2` flag, enforced by the API (404 `layer2_disabled` on every Layer 2 route) and by the database (every Layer 2 money function refuses when the flag is off). The flag is off by default and can't be on in a deployed environment: Layer 2 requires the mock Reg CF provider, and the API refuses to start with the mock provider when deployed.
- **D-2** Every Layer 2 screen shows a persistent banner: "Demo — not an offer of securities. Mock escrow and data."
- **D-3** No real money, KYC, filings or tax forms. Stripe is never used for Layer 2.
- **D-4** Copy follows Brand §7.4: payouts are always "potential" and paired with risk; the risk disclosure precedes any purchase; Form C link, Reg CF limit and 12-month lock-up are shown; nothing implies liquidity; nothing is sorted or ranked by money or return (PRD 02 §8). Product nouns: Pools, Units, Waterfall. `pnpm lint:copy` covers Layer 2 screens and Layer 2 notices.

---

## 1. Creator: album royalty Pool (FR-L2-CR)

### FR-L2-CR-001: Only Rising and above can create a Pool
**Story:** As a creator at Rising tier or above, I want a separate path to offer fans a share of an album's royalties, so that Layer 2 stays out of the reward-campaign flow.
- Given a creator whose tier is Starter, when they open or call Pool creation, then they're refused with the tier rule (PRD 01 §6.3: Starter has no Reg CF access) and shown what Rising requires.
- The tier is read from `packages/shared` tiers and recorded on the Pool at submission (assessed at submission, not mid-offering).
- The Pool target can't exceed the creator's tier Reg CF cap minus what they raised in other Reg CF offerings in the trailing 12 months.

### FR-L2-CR-002: Album basics, story, use of funds, milestones
- Album title, artist display name, planned release date, tracklist (1–30 tracks), artwork (rendered with `ArtistArt`; no uploads in the demo), story, risks.
- Use of funds as line items; the **funding target equals the sum of line items**. Maximum = Units × Unit price, and must be ≥ target.
- Production milestones: 2–3 tranches whose percentages sum to 100; tranche 1 releases at close; later tranches need evidence and staff verification (same rules as M1 milestones).

### FR-L2-CR-003: Royalty terms
- Revenue types the Pool participates in: **master recording royalties** (default, on), sync (optional), publishing/PRO (selectable but labelled "Trust-based — pending counsel"; Mechanism 01 revenue-type table).
- Split of covered royalties across **fans / creator / platform** in basis points; must sum to 100%. The platform share is a placeholder labelled "pending fee schedule" (fees are TBD per `docs/brand/fees.html`).
- Number of Units, Unit price, minimum Units per investor, deadline (14–60 days), **return cap multiple (default 1.5×)**, **maturity (default 5 years)**, distribution schedule (default quarterly).
- The creator sees a plain-language summary and a potential-payout illustration that always includes the zero case.

### FR-L2-CR-004: Collection mechanism and risk badge
- Mechanism (01b §1.1 enum + SPLIT_PAYEE per Mechanism 01 integration update): `DISTRIBUTOR_REDIRECT`, `SPLIT_PAYEE`, `LOCKBOX`, `SELF_REPORT`, `LETTER_OF_DIRECTION`.
- Each revenue type caps the strongest mechanism allowed for it; the effective tier is the weakest across the Pool's revenue types × mechanism. Derived **risk badge**: `SECURED_ISH` ("More secure"), `VERIFIED`, `TRUST_BASED` (wording in design §8).
- **01b AC-R6:** a Pool can't go live until its collection-mechanism record is **executed** (by staff, after the creator submits it).

### FR-L2-CR-005: Submit → Form C review → launch
- Submit generates a **mock Form C** document from the Pool's data (issuer, offering terms, use of funds, risk factors, collection mechanism, tax characterization note), stored with its SHA-256 hash.
- Staff review: approve or request revisions (reason required). Reviewer ≠ owner; single-operator rules (FR-ID-007) apply.
- Launch (creator, after approval and executed collection mechanism): the provider issuer and offering are created in the mock escrow service; the deadline clock starts.

## 2. Fan: invest (FR-L2-INV)

### FR-L2-INV-001: Discovery
- `/pools` lists live Pools; filters by revenue type, risk badge and genre; ordered by deadline (soonest first) or newest; **never** by money raised, Units sold or anything return-like.
- `/pools/:id`: album, terms in plain language, risk badge with explanation, illiquidity / principal-at-risk / **unsecured claim** disclosures, Form C link, lock-up, maturity, potential-payout illustration that includes zero.

### FR-L2-INV-002: Investor onboarding
- Mock KYC/AML through the provider party (name + state); result arrives asynchronously by webhook: `approved`, `rejected`, or `manual_review` (staff decides).
- Income, net worth and accredited-status attestation; Reg CF investments made elsewhere in the last 12 months (self-reported).
- State eligibility: a demo deny-list (policy `l2.blockedStates`, empty by default) is checked before purchase.

### FR-L2-INV-003: Reg CF investment limit (01a §3)
- Limit per 17 CFR 227.100(a)(2) (policy `regCf.investorLimits`, with source and date verified): non-accredited → if annual income **or** net worth is below the threshold, the greater of the floor amount or the lower percentage of the greater of income/net worth; if both are at or above it, the higher percentage of the greater, capped at the threshold. Accredited → no limit.
- Usage = all of the investor's active and completed Reg CF commitments on FanZuP in the trailing 12 months (reserved, funding, funded, issued) + self-reported elsewhere.
- **01a AC-I1:** concurrent purchases by the same investor across any offerings can never together exceed the limit (exactly the ones that fit succeed).
- **01a AC-I2:** a reservation that isn't funded expires and frees its limit; a returned fund move frees it immediately.
- **01a AC-I5:** limits are computed and enforced transactionally in the database, never only in the client; the API returns the remaining headroom.

### FR-L2-INV-004: Purchase
- Order: risk acknowledgment (versioned) → Units reserved (limit + availability) → provider trade → fund move into the offering escrow → confirmation page. Idempotent per `Idempotency-Key`.
- Units can't oversell the Pool; self-investment by the creator is refused.
- Cancellation allowed until 48 hours before the deadline (full refund through the provider).

### FR-L2-INV-005: Portfolio
- Units held, amount, status, lock-up end date and countdown (12 months from issue; Mechanism 07 P0: no transfers, no prices), potential vs received distributions, return-cap progress, maturity date, documents (Form C, confirmation, distribution statements).

## 3. Escrow and money after funding (FR-L2-ESC, FR-L2-REV, FR-L2-WF)

### FR-L2-ESC-001: Escrow invariants (01a AC-E1…E5)
- **AC-E1** Σ funded-and-held investments == escrow FBO ledger account == provider escrow balance for the offering, after every event.
- **AC-E2** Target-or-refund: at the deadline, funded ≥ target → close; else every investor is refunded in full.
- **AC-E3** Nothing leaves escrow to the issuer before close.
- **AC-E4** After close, money is released only per verified milestone tranches (tranche 1 at close), never more than raised.
- **AC-E5** The escrow FBO account never goes negative and ends at exactly zero once every tranche is released or every investor refunded.

### FR-L2-REV-001: Royalty ingestion (01b §3)
- A mock distributor royalty statement (verification `API_VERIFIED`) can be uploaded per period; a mock lockbox/collection-account settlement (verification `BANK_RECONCILED`) arrives through the provider.
- A reconciliation run matches statements to settlements. **Only bank-reconciled cash becomes `collected`** and distributable (**01b AC-R1, R2**). A statement without cash is "reported, not collected" (**AC-R3**). A settlement short of its statement is collected at the cash amount and opens a shortfall break (**AC-R4**). Reconciliation is idempotent and re-runnable (**AC-R8**).

### FR-L2-REV-002: Default handling (01b §5)
- Collection state machine `COLLECTING → AT_RISK → DEFAULT → REMEDIATION → COLLECTING | CHARGED_OFF`. A period whose settlement is missing or short past its due date moves to AT_RISK; uncured after the cure period moves to DEFAULT; staff move DEFAULT to REMEDIATION or CHARGED_OFF with a reason. Every transition notifies the Pool's holders.

### FR-L2-WF-001: Waterfall (01a §4)
- Distribution runs are **deterministic and replayable**: dry-run and commit produce the same allocation and the same hash for the same inputs (**AC-W1**).
- Pro-rata by Units; each investment's cumulative distributions never exceed its return cap; once the fan class reaches the cap, the rest of the fan share goes to the creator (**AC-W2**).
- Only collected, unallocated revenue is distributed (**AC-W3**).
- Conservation to the cent: fans + creator + platform == collected amount of the run, with the documented rounding rule (largest remainder by Units, ties by investment id) (**AC-W4**).
- Commit is idempotent: committing the same run twice moves money once (**AC-W6**).
- A run whose period reaches maturity closes the Pool (status `matured`).
- Payouts go through the provider; each payout records its tax characterization (default **1099-DIV**, C-corp-taxed issuer, Mechanism 04 — counsel item) and contributes to a per-investor, per-year 1099 data row. Data only; no forms.

## 4. Staff (FR-L2-ADM)
- Form C review queue; collection-mechanism execution; KYC manual-review decisions; Pool money view (escrow, collected, distributed, by investor); distribution dry-run/commit; milestone verification; default transitions. All through `privileged()` (aal2, typed reason, audit, single-operator delay/limits for money actions), reviewer ≠ owner.

## 5. Non-functional (NFR-L2)
- **NFR-L2-01 Provider boundary:** one `RegCfProvider` interface; domain code never calls the mock directly; a `northcapital` adapter can replace it (ADR-007).
- **NFR-L2-02 Mock fidelity:** API-key auth, idempotency keys, asynchronous status changes, signed webhooks (stored before processing), deterministic triggers (`KYCFAIL`, `AMLHOLD`, whole-dollar amount ending in 13 → fund move returned), admin time travel.
- **NFR-L2-03 Money:** integer cents, double-entry, append-only ledger, money only through SQL functions with idempotency keys; clients can't read or write Layer 2 money tables.
- **NFR-L2-04 Tests:** AC-I1, I2, I5, E1, E5, W1–W4, W6, R1–R4 and webhook signature/idempotency have named tests; a Playwright journey covers create → approve → KYC → invest → fund → reconcile → distribute → portfolio, and the failed-Pool refund path.
- **NFR-L2-05 Mock data:** `supabase/seed_layer2.sql` (local/CI only) with Pools in different states, one per risk badge, and matching mock-escrow fixtures; `*@fanzup.test` accounts; no published credential for any staff-like account.

## Open items (for counsel/partners — never decided in code)
L2-Q1 PRD trace · L2-Q2 issuer entity and whether a crowdfunding vehicle (Rule 3a-9 SPV, Mechanism 03) is used · L2-Q3 funding portal / intermediary · L2-Q4 North Capital sandbox access · L2-Q5 publishing letter of direction · L2-Q6 1099 characterization · L2-Q7 platform fee on royalties (Form C disclosure) · L2-Q8 state blue-sky notice filings · L2-Q9 cancellation/reconfirmation mechanics owned by the portal.
