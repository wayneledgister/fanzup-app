# FanZuP v2 — Brief: enterprise-grade Fund My Show
**Tier:** Enterprise — money custody, consumer protection, tax and sanctions obligations, partner due diligence, and staff operations. (Requested by Wayne; confirmed by council E1.)
**Version:** v2 (the v1 prototype is the 93-route mock app + money core at commit `a165610`)
**Date:** 2026-10-03 · **Owner:** Wayne · **Status:** G1 approved for M1 only (Wayne, 2026-10-03)
**One-liner:** Independent artists raise money for shows, tours and records from their own fans; every dollar waits with a third-party custodian and is refunded in full if the goal isn't met, and the platform is built to the standard a custodian, an auditor and a card network would expect.

## How this brief was made
- **Source:** council evaluation E1 (`specs/gates/E1-enterprise-readiness.md`, six seats) of the repo at `a165610`, plus the repo's own docs (README money rules, `docs/CONSOLIDATION.md`, council D1, `docs/SETUP.md`, CR-001).
- **Scope reading taken:** E1 card A default — *enterprise-grade core, then growth*. If Wayne picks "full breadth" or "hardening only", the requirement priorities below change, not the IDs.
- **Not yet read:** the FanzUp doc set (PRDs 01–03, Mechanisms 03–07, `products/*.html`) isn't in the repo. Requirements cite PRD sections only where the repo already does. A trace pass against the PRDs is open question Q1.

## Problem
1. **For artists:** raising money for a show or record means trusting fans to trust you. Existing crowdfunding platforms hand the artist the money on success and offer fans little protection or visibility after that.
2. **For fans:** backing an artist is an act of faith with no visibility into where money goes, and no clean remedy when a perk never arrives.
3. **For FanZuP today:** the product promise — custody, full refunds, milestone release — is implemented only on the happy path, and nothing in the browser uses it yet (E1 blockers 1–12). The app can't take a real backing, can't prove its ledger matches the money, and can't be operated safely by a small team.

## Users & personas
| Persona | Who | Needs most |
|---|---|---|
| **Fan / backer** | Mostly mobile, arrives from an artist's social link; never heard of FanZuP | Fast checkout, a clear promise (refund if it fails), proof of progress, the perk actually arriving |
| **Artist (creator)** | Independent musician, Starter–Rising tier, often no business entity yet | Simple campaign setup, getting paid on time, telling fans what's happening, knowing what worked |
| **Staff: reviewer** | Approves campaigns, verifies milestones | A real queue, evidence in one place, can't approve their own work |
| **Staff: support / ops** | Handles refunds, disputes, fulfillment problems | 360° view of a fan or campaign, safe refund tools, SLA timers |
| **Staff: finance / compliance** | Reconciles money, tax, sanctions | Daily recon with breaks, payout gates, audit evidence |
| **External: custodian, processor, auditor, counsel** | Due diligence and ongoing oversight | Flow-of-funds clarity, reconciliation evidence, access reviews, retention |

Volume assumptions for design (to confirm, Q4): Beta = 5–20 campaigns, ≤ 5k backings; GA year 1 = up to 1,000 campaigns, 100k backings/year, peak 50 backings/second in the final hour of a popular campaign.

## Success metrics
Targets are proposed defaults; Wayne confirms at G1 (Q3).

| Metric | Target | Why |
|---|---|---|
| Money correctness incidents (double payout, unrefunded capture, ledger imbalance) | **0** | The product's core promise |
| Daily reconciliation completed with no unexplained break older than 1 business day | 100% of days | Custodian requirement (NFR-COMP-02) |
| Failed-campaign refunds initiated within 1 hour of settlement | ≥ 99.9% | "Refunded automatically" |
| Checkout conversion (perk selected → backing confirmed), mobile | ≥ 45% [proposed]; measured from M1 | Growth runs on social traffic |
| Share of backings that arrive via a shared link | logged from M1 (link source); per-fan attribution from M4; target ≥ 60% by GA [proposed] | Validates the growth features |
| Campaign success rate (funded / settled) | ≥ 40% in Beta [proposed] | Platform health; informs refund-fee cost |
| Perks delivered by their promised date | ≥ 90% [proposed]; measured from M3 | Dispute driver |
| Dispute (chargeback) ratio | < 0.5% of monthly transactions | Card-network monitoring starts near 0.9% |
| Staff queue SLAs met (POLICY.adminSlaBusinessDays) | ≥ 95% | Ops quality |
| WCAG 2.2 AA serious/critical violations on core journeys | 0 | Accessibility obligation |

## Milestones
Added at G1 pass 1. Priorities in `01-requirements.md` map to these.

| Milestone | What's true at the end | Requirements |
|---|---|---|
| **M1 · Walking skeleton** (≈ 6–8 weeks of evenings) | On Stripe **test mode**: one campaign goes draft → review → live → funded → both tranches released; another goes live → failed → everyone refunded. Ledger ↔ processor diff is zero. Every step is audited and traceable with one correlation id. Production stack exists with PITR, alerts and no seeded staff. Funnel and referral-source events are logged from day one. | `01-requirements.md` §Milestone M1 scope (binding; approved at G1, card G1-C) |
| **M2 · Closed beta, test money** | All P0a requirements: 3–5 hand-picked artists and real fans on test cards; single-operator mode on. | All **P0a** |
| **M3 · Live money** | Custodian (or counsel-approved interim posture) live; a second person holds second-approver and backup on-call; tax, sanctions, disputes, legal documents, recon against the custodian. | All **P0b** |
| **M4 · GA** | Growth and community features; full staff console; status page history; pen test passed. | All **P1** |

Calendar-bound work starts now and runs alongside M1–M2: custodian questions (SETUP Part G), one counsel engagement (custody posture and "escrow" wording, sales tax, 16 CFR 435, 1099-K settlement entity, CR-001 T-HV-02), tax and sanctions vendor selection.

## Constraints
- **Team:** solo founder with a day job, plus Claude agents. Calendar time for partners and counsel dominates engineering time. Until a second person joins, staff controls run in single-operator mode (FR-ID-007), which must end before live money.
- **Stack (keep):** Vercel (web + API), Render (worker), Supabase Postgres + Auth, pnpm monorepo, React/Vite, Fastify (ADR-001, ADR-002).
- **Money rules (keep, README):** FanZuP never holds cash; integer cents; double-entry append-only ledger; every money operation idempotent; clients never write money fields; target-or-refund.
- **Brand & copy (keep):** Brand v2.0, `BUILD_CONVENTIONS.md`, banned-language list (`lint:copy`); Layer 1 never says invest/returns/ownership.
- **Doc precedence (keep):** FanzUp doc set > mockups (CONSOLIDATION).
- **External gates not controlled by code:** custodian contract (6–12 months), counsel opinions, tax vendor, sanctions screening vendor, processor underwriting.
- **Decided by Wayne (D1):** policy defaults in `packages/shared/src/policy.ts`; holder votes (CR-001) in scope spec-first, built after the first reward campaign ships.

## Out of scope for v2
- **Layer 2 (Reg CF):** investing, investor KYC, holdings, soft transfers, holder votes build (CR-001 T-HV-03..05). Screens stay frozen, hidden from production, and reachable only by staff.
- **General commerce:** standalone ticketing, merch store, live streaming with tips, backstage subscriptions. Routes hidden in production until each has its own spec. (Show-perk QR tickets *are* in scope at P1, FR-FUL-004.)
- Native mobile apps (responsive web + installable PWA only); multi-currency settlement (display estimates only); multi-tenant org accounts; microservices / multi-region.

## Open questions
| # | Question | Blocks | Who |
|---|---|---|---|
| Q1 | Trace every requirement against PRDs 01–03 and Mechanisms 03–07 (attach the doc folder or add it to the repo) | **M2** (waived for M1, card G1-C) | Wayne |
| Q2 | E1 cards A (scope), B (custody posture), C (dispute/refund-fee allocation) | P0 priorities, FR-PAY-008, FR-DSP-* | Wayne; counsel for B and C |
| Q3 | Confirm the proposed success-metric targets | G1 | Wayne |
| Q4 | Confirm volume assumptions (drives capacity plan in 02-design) | G2 | Wayne |
| Q5 | Holdback size and window for disputes (if card C = artist holdback) | FR-DSP-005 | Wayne + counsel |
| Q6 | Does 16 CFR 435 (mail-order rule) reach physical reward perks? | FR-FUL-003 | Counsel |
| Q7 | Who is the payment settlement entity for 1099-K: processor, custodian or FanZuP? | FR-TAX-002 | Counsel + custodian |
| Q8 | Is FanZuP a marketplace facilitator for sales tax on physical perks and tickets? | FR-TAX-005 | Counsel |
| Q9 | ~~G1 cards~~ **Decided 2026-10-03:** G1-A option 1 (single-operator mode until live money); G1-B option 3 (full account first) | — | — |
| Q10 | ~~Policy defaults~~ **Accepted as a set, 2026-10-03** | — | — |
