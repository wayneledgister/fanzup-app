# FanZuP legal document drafts — for attorney review

**Status:** FIRST DRAFTS, 2026-11-27. Prepared with AI assistance from the product specs in this repository, for FanZuP LLC's attorney to review, correct and finalize. **None of these documents is legal advice, and none may be published or accepted by users until counsel approves it** (FR-PRV-001, NFR-COMP-16).

**Not wired into the product.** No app page, route or build step reads these files. `apps/web/src/pages/public/Legal.tsx` still shows the "being finalized with counsel" placeholder, and `POLICY.legal` versions are unchanged. Publishing a counsel-approved version is a separate code change.

## How to read these drafts
- `[BRACKETS]` are placeholders to fill in (addresses, dates, vendor names, numbers counsel must confirm).
- **Attorney review** boxes flag a clause that is a business assumption, a legal judgement, or a choice between options.
- **Open question** tags (for example `MKT-Q1`, `Brief Q6`) point to the counsel question register below. Clauses that depend on an unanswered question are written for the current product (no live money in beta, no money in the marketplace) and say so.
- Every factual statement about how FanZuP works is taken from the specs named in each document's "Sources" line. If the product changes, the document must change too.
- **Marketplace sources live in PR #27.** The services-marketplace facts (Provider Terms, Privacy Notice §6, Acceptable Use §6, the marketplace lines of the Refund Policy and retention schedule) come from `specs/marketplace/*`, CR-005 and ADR-010 on branch `feat/services-marketplace` (PR #27). Until that PR merges, those files aren't on `main`; if PR #27 changes, re-check these sections.
- Some values cited as `policy.ts` keys (`fulfillment.newDateDays`, `retention.addressDays`, `disputes.holdback`) are defined in `specs/01-requirements.md` Appendix A, not yet in code.
- Fees are **TBD** everywhere. The only fee stated is card processing passed through at cost (`docs/brand/fees.html`, `POLICY.processing`), and even that needs confirming.

## What exists today
| Item | State before these drafts |
|---|---|
| Terms of Service, Privacy Policy, Campaign Terms for Backers | Route placeholders only (`apps/web/src/pages/public/Legal.tsx` shows "being finalized with counsel"). No text. |
| Acceptance mechanics | Built: versioned acceptance records (`POLICY.legal.termsVersion` / `privacyVersion` = `2026-10-03-beta`), 18+ attestation stored at sign-up (FR-PRV-001, FR-ID-006). |
| Fee schedule | Internal only (`docs/brand/fees.html`); every platform fee TBD. |
| Support contact | Placeholder `support@fanzup.example` (`Support.tsx`). |
| Everything else in the table below | Did not exist. |

## What is drafted here
| # | Document | File | Required by | Accepted by / shown to |
|---|---|---|---|---|
| 1 | Terms of Service | [01-terms-of-service.md](01-terms-of-service.md) | FR-PRV-001 ("Terms of Use") | Everyone at sign-up |
| 2 | Privacy Notice (includes the marketplace data section) | [02-privacy-notice.md](02-privacy-notice.md) | FR-PRV-001/005/006, NFR-MKT-04 | Everyone at sign-up; re-acceptance or notice when the marketplace flag goes on |
| 3 | Backer Pledge Terms | [03-backer-pledge-terms.md](03-backer-pledge-terms.md) | FR-PRV-001 | Fans at checkout |
| 4 | Artist Campaign Agreement | [04-artist-campaign-agreement.md](04-artist-campaign-agreement.md) | FR-PRV-001/006 | Artists before submitting a campaign |
| 5 | Provider Terms (services marketplace) | [05-provider-terms.md](05-provider-terms.md) | CR-005, discovery MKT-Q6 | Providers before submitting a profile; artists see the summary when sending a request |
| 6 | Refund and Cancellation Policy | [06-refund-policy.md](06-refund-policy.md) | FR-PRV-001 ("checkout shows the refund policy"), FR-BCK-003, FR-FUL-003 | Linked from checkout and My backings |
| 7 | Acceptable Use and Community Guidelines | [07-acceptable-use-policy.md](07-acceptable-use-policy.md) | Campaign review, staff suspension (FR-CMP-007), marketplace vetting (FR-MKT-008) | Incorporated into Terms |
| 8 | Cookie and Tracking Notice | [08-cookie-notice.md](08-cookie-notice.md) | FR-PRV-005 | Linked from footer and consent banner |
| 9 | Copyright and DMCA Policy | [09-copyright-dmca-policy.md](09-copyright-dmca-policy.md) | User uploads (FR-PLT-005), 17 U.S.C. §512 safe harbor | Incorporated into Terms |
| 10 | Account Deletion and Data Retention (public page + internal schedule) | [10-account-deletion-and-retention.md](10-account-deletion-and-retention.md) | FR-PRV-002/003, NFR-COMP-13/14, FR-MOB-009 (App Store / Google Play) | Public page; schedule is internal |

## Deliberately not drafted
- **Layer 2 (Reg CF) investor documents** (investor terms, Form C disclosures, educational materials, funding-portal or broker-dealer agreements). Layer 2 is out of scope for v2 and frozen; those documents must come from securities counsel and the registered intermediary, not from FanZuP alone. The Terms of Service says plainly that FanZuP offers no investments.
- **Staff-facing policies** (breach response NFR-COMP-19, access review, minors-report procedure FR-ID-006, retention operations runbook). These are internal procedures, not user policies; the retention schedule in document 10 is the start of one.
- **Partner contracts** (custodian, processor, identity, tax and sanctions vendors, AI model vendor DPA AGT-Q1).
- **Paid marketplace terms** (bookings, holds, provider payouts, fees). They wait for counsel on MKT-Q1…Q5 (ADR-010).

## Counsel question register
These are the open legal questions that change the text of one or more drafts. The drafts are written to the current product and mark where an answer would change them.

| Ref | Question | Changes |
|---|---|---|
| Brief Q2 / E1 card B | Custody posture: which third party holds backer funds (custodian, processor-led, interim posture) and what may we call it? "Escrow" wording is banned in copy until counsel approves it. | 1, 3, 4, 6 |
| E1 card C / Brief Q5 | Allocation of chargeback losses, dispute fees and refund costs; artist holdback size and window. | 3, 4, 6 |
| Brief Q6 | Does the FTC Mail, Internet, or Telephone Order Merchandise Rule (16 CFR 435) reach physical reward perks? | 3, 4, 6 |
| Brief Q7 | Who is the payment settlement entity that issues Form 1099-K to artists? | 4 |
| Brief Q8 | Is FanZuP a marketplace facilitator for sales tax on physical perks and tickets? | 3, 4 |
| FR-PAY-011 | Unclaimed refunds: which state's unclaimed-property procedure applies? | 6, 10 |
| MKT-Q1 | If FanZuP later collects an artist's payment and pays a provider, is that money transmission, or covered by agent-of-payee or the processor's licence? | 5 (future section) |
| MKT-Q2 | Can a booking hold funds until delivery, and what may we call it? | 5 (future section) |
| MKT-Q3 | May an artist pay a provider from released campaign funds, or from funds still held for backers? | 4, 5 |
| MKT-Q4 | Who issues 1099s to providers once payments run through FanZuP; what tax info is collected? | 5 |
| MKT-Q5 | Are any services taxable, and would FanZuP be a marketplace facilitator for them? | 5 |
| MKT-Q6 | Provider Terms: deliverable ownership (work-for-hire vs licence), dispute handling, independent-business status (worker classification). | 5 |
| MKT-Q7 | Reviews and ratings under the FTC rule on consumer reviews and testimonials (16 CFR 465). | 5, 7 (future) |
| MKT-Q8 | Sanctions screening and identity checks for providers before any payout. | 5 |
| AGT-Q1 | AI model vendor terms (retention, DPA) for the staff-only advisory agents. | 2 |
| P-1 | Which state privacy laws apply at launch (Virginia VCDPA, California CCPA/CPRA and others) given FanZuP's size; do we offer their rights to everyone anyway? | 2, 8, 10 |
| P-2 | Governing law, venue and whether to use an arbitration clause with a class-action waiver (and mass-arbitration protocol). | 1, 3, 4, 5 |
| P-3 | DMCA designated agent registration with the U.S. Copyright Office. | 9 |
| P-4 | Store and platform rules: Apple App Review 3.1.1/3.1.3(e)/3.1.5 and 5.1.1(v), Google Play payments and account-deletion policies, applied to backings, tickets and marketplace services. | 1, 10 |

## Sources
`specs/00-brief.md`, `specs/01-requirements.md` (FR-PAY, FR-BCK, FR-CMP, FR-FUL, FR-DSP, FR-ID, FR-TAX, FR-PRV, NFR-SEC-08, NFR-COMP-11…19), `specs/marketplace/*` and `docs/adr/ADR-010-*` (CR-005), `specs/mobile/01-requirements.md` (FR-MOB-009), `specs/agents/*` (NFR-AGT-02), `packages/shared/src/policy.ts`, `docs/brand/fees.html`, `docs/SETUP.md`.
