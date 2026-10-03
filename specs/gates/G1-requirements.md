# G1 — Requirements gate · FanZuP v2 · 2026-10-03
**Tier:** Enterprise · **Seats:** Architect, Skeptic, Pragmatist, Critic, Security, Compliance/Ops
**Artifacts:** `specs/00-brief.md`, `specs/01-requirements.md` (draft of 2026-10-03, commit `f20b448`)
**Seat notes:** `.G1-<seat>.md` in this folder.
**Verdict (pass 1): REVISE.** Every seat agrees the spec covers E1's blockers in substance. Seven blockers remain; six are document edits, one needs Wayne (the PRD trace).

## Blockers (priority order)
| # | Blocker | Raised by | Resolved looks like |
|---|---|---|---|
| 1 | **"P0" mixes two different milestones.** It's defined as "before real money", but E1 card B's default is no live money for 6–12 months, so the beta real people will use has no requirement set. | Critic, Pragmatist | Split P0 into **P0a** (real users, test-mode money) and **P0b** (before live money), same IDs; name a walking-skeleton first milestone. |
| 2 | **The controls assume a company that doesn't exist.** Two-person approvals, separate staff roles, primary + backup on-call: today there is one founder. Controls one person can only satisfy by pretending to be two are coverage on paper only. | Architect, Skeptic, Pragmatist | A single-operator-mode requirement: what is allowed, what compensating controls apply (time delay, audited reason, post-hoc review, hard limits), break-glass, and the exit condition (second staff member, or before P0b). |
| 3 | **Separation of duties got softened.** No requirement says the system (not the caller) sets who approved and with what second factor — the original E1 S2 defect. Three requirements disagree on where two-person approval sits for milestone money (FR-PAY-005, FR-ID-003, NFR-COMP-17). | Security | System-derived actor + factor on every privileged action; one consistent rule for milestone verification vs release. |
| 4 | **File uploads and exports have no security requirements.** Campaign media, milestone and dispute evidence (P0) and exports (P1) lack access control, link expiry, type checks, malware scanning and safe serving. | Security | An upload/download requirement covering all of the above. |
| 5 | **Sales tax is missing.** Physical perks and tickets may make FanZuP a marketplace facilitator responsible for collecting sales tax, which changes the checkout total and the flow of funds. | Compliance/Ops | A placeholder requirement plus a counsel question; no answer needed to pass. |
| 6 | **E1-required items were moved to P1 without saying so.** Late-perk cancel-for-refund (part of how E1 B2 is closed), retention/export/deletion, the public status page, and fan-raised problems. Fans' own remedies are P1 while staff tools are P0. | Compliance/Ops, Critic, Skeptic | Each restored to its E1 level, or downgraded explicitly with a stated reason the founder accepts. |
| 7 | **The PRD trace hasn't been done.** The brief itself says G1 can't be signed off without it, and under doc precedence the PRDs outrank these FRs. | Skeptic | Wayne attaches or commits the doc set; every FR/NFR gets a PRD source or is marked "new in v2". |

## Conditions (carry into revision or G2)
1. Every "policy default" threshold used by a P0 criterion exists in `policy.ts` with a value (at least eight are missing). → Critic, Skeptic, Architect
2. One number per obligation: auto-refund timing (1 h vs 1 business day), data-export deadline, pen-test timing, tranche count. → all seats
3. A trace table for E1 conditions 1–17; discovery/search (condition 7) gets an FR. → Architect, Pragmatist
4. Deletion vs immutable audit: personal data stays out of audit payloads, or audit is pseudonymisable. Shipping-address purge must outlast card-dispute windows. → Architect, Compliance
5. No P0 depends on a P1 (FR-BCK-005 → FR-PAY-009; campaign updates shown at P0, posted at P1). → Architect, Critic, Pragmatist
6. Checkout friction vs the 45% conversion target: guest or deferred verification is a decision, not an assumption. → Critic, Skeptic
7. Missing obligations get IDs: marketing-email consent (CAN-SPAM), cookie/tracker consent and opt-out signals, artists' permitted use of backer data, breach notification, PCI scope validation, vendor data agreements, AML/fraud risk assessment, sanctions block-and-report, unclaimable refunds. → Compliance
8. Security gaps: rate limits on all writes, cooling-off after payout-account changes, safe rendering for all user text, embed widget vs CSP, referral links can't reveal private fans, log redaction, QR ticket security, visibility tests cover views/functions/realtime. → Security
9. Custody integration gets its own FR; criteria written against unchosen vendors are restated as capabilities. A vendor list and monthly cost estimate land in 02-design. → Architect, Skeptic, Pragmatist
10. Success metrics are measurable at the milestone they're judged (funnel and source events from day one). → Skeptic, Pragmatist
11. Brief scope and priority agree on QR show tickets. → Pragmatist
12. Testability: replace judge-words ("human", "honest", "material") with checkable criteria; label E1-mandated implementation constraints as constraints. → Critic

## Findings (summary — full text in seat files)
| Voice | Blockers | Concerns | Nits |
|---|---|---|---|
| Architect | 1 (single-operator) | 8 | 3 |
| Skeptic | 2 (PRD trace; single-operator) | 8 | 2 |
| Pragmatist | 2 (P0 split; single-operator mode) | 6 | 2 |
| Critic | 1 (P0 split) | 8 | 3 |
| Security | 2 (SoD softened; uploads/exports) | 9 | 1 |
| Compliance/Ops | 2 (sales tax; silent downgrades) | 9 | 1 |

## Dissent
- **How much to freeze now.** *Skeptic:* don't freeze ~85 P0 items as a design contract before a test-mode skeleton shows where real users drop off; finish the PRD trace and the single-operator model first. *Pragmatist:* pass with conditions once the P0 split and single-operator mode are written; the full P0 set is XL (9–14 months of evenings), so the first milestone must be a 6–8-week walking skeleton. *Security and Compliance:* the controls stay; what changes is when they're due (P0a vs P0b), not whether.
- **Checkout friction.** *Critic/Skeptic:* mandatory account + verified email + bot challenge + screening before paying fights the conversion target. *Security/Compliance:* bot challenge and screening are non-negotiable before live money. Likely resolution: friction scales with the milestone (P0a light, P0b full) and with risk signals.

## Skeptic's strongest reason not to proceed
These requirements answer E1's question — what would a custodian, auditor and card network expect — and never ask the brief's own users anything. The PRDs that outrank this document haven't been read, and most P0 controls rely on an operating model (separate reviewers, finance, on-call backup) for a company that doesn't exist yet. Approving now freezes a compliance-heavy funnel nobody has tested with fans, while the one external fact everything depends on, the custody model, is still "not yet". Cheaper: finish the PRD trace, write down the single-operator reality, and let a test-mode walking skeleton show where users actually drop off.

## Pragmatist's estimate
Full P0 as drafted: **XL** (≈ 9–14 months of evenings), with partner/counsel calendars running in parallel. Recommended first milestone: a **6–8-week walking skeleton** on Stripe test mode — one campaign funds and releases both tranches, one fails and refunds everyone, ledger ↔ Stripe diff to zero, every step traceable with one correlation id. (Details in `.G1-pragmatist.md`.)

## Decisions the founder must make
Cards E1-A, E1-B, E1-C (in `E1-enterprise-readiness.md`) remain open. G1 adds:

**Card G1-A — How do approvals work while you're the only staff member?**
- **Decision:** the single-operator rule for controls written for two people. [FR-ID-003, FR-CMP-007, FR-DSP-001, NFR-COMP-17, NFR-OPS-09]
- **Why it matters now:** without it, the spec's biggest safety controls can't be met, or get quietly ignored.
- **Options:**
  1. **Single-operator mode until live money (default).** You approve alone, with a typed reason, a time delay on large money actions, hard limits, and a weekly review of everything you approved. Before live money, a second person (contractor or advisor on retainer) must hold the second-approver and on-call-backup role.
  2. **Single-operator mode with no end date.** Cheapest; a custodian's due diligence will likely flag it.
  3. **Find a second person now.** Strongest; costs money and time before the beta.
- **Default:** option 1.
- **Who decides:** you.

**Card G1-B — Can fans pay before creating a full account?**
- **Decision:** how much sign-up stands between a fan and paying. [FR-BCK-002; brief conversion target]
- **Why it matters now:** most fans arrive on a phone from a social link; every extra step costs backers.
- **Options:**
  1. **Light account at checkout (default).** Email + 18+ + terms at checkout; email verified by the receipt link; full profile after. Bot challenge only when risk signals fire.
  2. **Guest checkout.** No account; claim the backing later from the receipt email. Highest conversion; harder to manage pledges and badges.
  3. **Full account first.** Simplest to build; lowest conversion.
- **Default:** option 1.
- **Who decides:** you.

## User decision
_Pending — Wayne._

## Changelog
- 2026-10-03: pass 1 recorded; summary sent. Founder away; revising blockers 1–6 and conditions in place (blocker 7 needs the doc set).
