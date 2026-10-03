# D1: Open decisions from the mockup consolidation · FanZuP app · 2026-10-03

**Mode:** Standalone (sdd-evaluate). The artifact is `docs/CONSOLIDATION.md` § Open questions + § Placeholder values, checked against the built app.
**Source of truth:** FanzUp doc set (Brand v2.0, PRD 01/01a/02/03, Mechanisms 03/04/05/07, `products/*.html`). The docs take priority over the mockups.
**Seats:** Architect, Skeptic, Pragmatist, Critic, Compliance/Ops (seated because these decisions are regulated).
**Verdict (pass 1): REVISE.** There are two blockers. Both are cases where the app contradicts the docs. Neither needs a founder decision; both are doc-alignment fixes.

## Blockers (priority order)
1. **Established and Pro tier criteria exist in the docs, but the app treats them as unknown and shows invented numbers.**
   - **Where the docs define them:** PRD 01 §6.3, with the detail in `products/creator-tier3.html` and `creator-tier4.html`:
     - **Established:** everything Rising needs, plus a verified LLC/EIN, a verified business bank account, at least 10,000 monthly listeners, and 12+ months of streaming history. The cap is $1M per 12 months.
     - **Pro:** everything Established needs, plus 2+ years of tax records, at least 50,000 monthly listeners, and a broker-dealer pre-screen call. The cap is $5M per 12 months across all Reg CF offerings.
   - **What the app shows:**
     - The creator dashboard's "Path to Established" uses a 100,000-listener target and other invented criteria.
     - The For Artists page says the criteria aren't published yet.
   - **Resolved looks like:** all three places that list tier rules (`artist/tiers.ts`, `ForArtists.tsx`, `creator/data.ts`) read the doc criteria from one module.
2. **Fan Pool tax forms are labelled 1099-MISC.**
   - Mechanism 04 Decision 1 recommends a C-corp-taxed issuer that issues 1099-DIV/INT, and `regulatory.html` §8 also says 1099-DIV.
   - **Resolved looks like:**
     - The forms say 1099-DIV, with a note that the form type is confirmed by tax counsel for each offering.
     - The investing flow collects a W-9 before purchase (Mechanism 04's hard rule), not only at payout.

## Conditions (tracked concerns)
1. **Milestone release demo:** the creator demo uses a 40/35/25 split. Change it to 50/50 to match the wizard default and Mechanism 05 §2.4. Tracked in `src/components/creator/data.ts`.
2. **Processing-fee disclosure for artists:** the artist-facing screens must say that card processing (2.9% + $0.30) comes out of what they raise. This applies to the campaign wizard Basics and Preview screens and to creator Payouts.
3. **Badge rules:** engagement badges must never count Layer 2 holdings or amounts invested, and they must exclude artist self-backing and linked accounts (PRD 03 market integrity). Tracked in `fan/Profile.tsx`.
4. **Pro cap wording:** "up to $5M per 12 months across all Reg CF offerings", not "per campaign". Tracked in the tiers module.
5. **One policy file:** collect every placeholder value into `src/config/policy.ts`, each labelled as a policy default.
6. **Layer 2 Form C disclosure:** any fee the issuer pays in connection with an offering, including processing, is disclosed in the Form C. Tracked in the Fees page `layer2` section.

## How each open question resolves
| # | Question | Resolution | Basis |
|---|---|---|---|
| 1 | Governance / holder votes | **Decision card A** (see below) | Mechanism 03 is the only basis, and it is gated; its §12(g) relief is disputed |
| 2 | Fan engagement model | **Resolved:** engagement badges, plus an All-Access card as membership identity. No spend tiers. Condition 3 applies. | PRD 02 §8 (never rank by money); PRD 01 §12 engagement metrics; Brand §7.4 |
| 3 | Who absorbs card processing | **Resolved:** the artist, passed through at cost; fan checkout shows the sticker price. Conditions 2 and 6 apply. | `products/fees.html` ("passed through to artists at cost") |
| 4 | Established / Pro criteria | **Resolved by the docs.** See Blocker 1. | PRD 01 §6.3, creator-tier3/4.html |
| 5 | Fan Reg CF tax form | **Resolved by the docs:** 1099-DIV by default. The final income characterization is for counsel (card C). | Mechanism 04 Decision 1, regulatory.html §8 |
| 6 | Landing-page stats | **Resolved:** stay removed until there are live, verified figures. | Brand §10 |
| 7 | Placeholder values | **Decision card B:** accept the council's defaults as a set. | See table in card B |

## Findings
| Voice | Sev | Finding | Ref |
|---|---|---|---|
| Architect | BLOCKER | Established/Pro criteria are defined in the docs, but the app shows invented ones | PRD 01 §6.3; creator/data.ts:251 |
| Architect | CONCERN | Tier gates are defined in three places | artist/tiers.ts, ForArtists.tsx, creator/data.ts |
| Architect | CONCERN | Milestone split 40/35/25 vs the wizard's 50/50 | creator/data.ts:115 |
| Architect | CONCERN | Votes can only be per-SPV; there is no entity for a platform-wide hub | Mechanism 03 (i) |
| Architect | NIT | Placeholder constants are scattered | — |
| Skeptic | BLOCKER | The 1099-MISC label was invented and contradicts Mechanism 04 | settings/TaxDocuments.tsx:22 |
| Skeptic | CONCERN | Even 1099-DIV waits on counsel's income characterization | Mechanism 04 open items |
| Skeptic | CONCERN | Holder votes rest on an SPV that counsel hasn't approved | Mechanism 03 audit note |
| Skeptic | CONCERN | Processing passed through on investment flows may need disclosure in the Form C | fees.html |
| Skeptic | CONCERN | Badges could be gamed by wash-funding | PRD 03 FR-MKT |
| Pragmatist | CONCERN | Drop governance and spend the time on Fund My Show | Mechanism 05 |
| Pragmatist | CONCERN | Card processing is already decided by fees.html; don't reopen it | fees.html |
| Pragmatist | CONCERN | Set the placeholder defaults as a batch; escalate only those with money or legal stakes | — |
| Pragmatist | NIT | The tier and 1099 fixes are mechanical (about 1 hour) | — |
| Critic | BLOCKER | For Artists and the creator dashboard contradict each other on tier rules | ForArtists.tsx:32; Dashboard.tsx:279 |
| Critic | CONCERN | The All-Access card must stay a membership identity, not a status level | fan/Profile.tsx |
| Critic | CONCERN | Artists must see the processing deduction at setup | campaign wizard, Payouts |
| Compliance | BLOCKER | 1099-MISC → 1099-DIV, plus a W-9 gate before purchase | Mechanism 04 |
| Compliance | CONCERN | Verify the W-9 is collected in the investing flow | invest/DocumentReview.tsx |
| Compliance | CONCERN | Any votes must be the SPV's pass-through rights, with FanZuP only delivering them | Mechanism 03 (i) step 3 |
| Compliance | CONCERN | Issuer-paid fees go in the Form C | fees.html |
| Compliance | CONCERN | The $5M Pro cap is per 12 months across all Reg CF offerings | creator-tier4.html |

Seat notes: `.D1-<seat>.md` in this folder.

## Dissent
**Governance.** The seats disagreed, and the disagreement is kept here rather than averaged:
- **Pragmatist:** delete it. It is ceremony for a path the council itself gated.
- **Skeptic:** stop investing in it. Polished UI makes a gated path feel decided.
- **Architect and Compliance:** it's acceptable to keep a scoped stub, but only as per-SPV pass-through voting, with FanZuP as the delivery channel.
- **Critic:** if it stays, users should only be able to reach the gate page.

All five agree it should get no further build effort before the A/B test.

## Skeptic's strongest reason not to proceed
Every Layer 2 and post-Beta decision here sits on top of the reward-vs-profit-share A/B test, which hasn't run (Mechanisms README; Council Findings §10). Specifying tax forms, transfers and votes in polished UI risks making the gated securities path feel decided before demand is proven.

## Decisions the founder must make

**Card A — Should fan voting stay in the product?**
- **Decision:** keep, freeze or remove the "Holder communications & votes" page for investors. [Q1; Mechanism 03]
- **Why it matters now:** it's the only feature with no PRD behind it, and leaving it open invites more build time on the least-proven part of FanZuP.
- **Options:**
  1. **Freeze (default).** It stays hidden behind the post-Beta switch and gets no more work until the profit-share test passes. Costs nothing now and can be revived later.
  2. **Remove.** Delete the page and route. This is the cleanest scope; if it's needed later, the rebuild is about one day.
  3. **Keep building.** Spec it properly in a PRD. That costs product and counsel time on a gated path.
- **Default:** Freeze. Four of five seats accept it, and it loses nothing.
- **Who decides:** you.

**Card B — Accept the council's default policy numbers as a set?**
- **Decision:** adopt these defaults so the prototype stops carrying invented one-off numbers. [Placeholder values]
- **Why it matters now:** these numbers appear in front of artists and fans in the prototype, and some carry money or refund consequences.
- **Options:**
  1. **Accept the set (default).** They go into one policy file, labelled as defaults, and you can change any of them later in one place.
  2. **Accept, but review the money/legal ones yourself.** Those are the tip cap, account-deletion grace period and shipping fee.
  3. **Reject.** Each number stays as an open question, and the prototype shows "TBD".
- **Default:** accept the set.
- **Who decides:** you.

| Policy | Default | Why |
|---|---|---|
| Milestone release | 50/50: half when funded, half on a verified milestone (2–3 stages allowed) | Mechanism 05 §2.4 example |
| Campaign length | 7–60 days | Mirrors Kickstarter's 60-day maximum, a widely used benchmark |
| Campaign review turnaround | "Usually within 2 business days", shown as an estimate | Placeholder until ops staffing is known |
| Admin review targets | Campaigns 2 business days · Identity 1 · Disputes 3 · Refunds 1 | Internal targets; not shown to users |
| Merch shipping | Set by the artist per item; no platform flat rate | fees.html: fulfillment passed through at cost |
| Ticket limit | 6 per order | Common anti-scalping default |
| Tip cap per stream | $500 | Limits fraud and chargeback exposure; PRD 03 |
| Stream replay | 48 hours | Placeholder; artist-configurable later |
| Account deletion grace period | 14 days | Lets a mistaken deletion be undone; counsel to confirm against the data-retention policy |
| Artist subscription price | Set by the artist; the $5/month in the demo is sample data only | — |
| Investor Reg CF limit in the demo | Illustrative only; computed by the intermediary in production | PRD 01 FR-INVEST |

**Card C — How fan Pool payouts are taxed (for tax counsel, not you)**
- **Decision:** is a revenue-share distribution characterized as a royalty, interest, a dividend or a return of capital, and so which 1099 do fans get? [Mechanism 04 open items]
- **Why it matters now:** it decides the form fans receive. It only matters once investing is turned on.
- **Options:**
  1. 1099-DIV from a C-corp-taxed issuer (the Mechanism 04 recommendation)
  2. 1099-INT
  3. K-1, if the issuer is a pass-through
- **Default:** 1099-DIV, with "confirmed by tax counsel" shown in the UI.
- **Who decides:** tax counsel. Ask them: "For a C-corp-taxed Reg CF issuer paying fans a capped revenue share, which information return applies, and does FanZuP or the servicer act as paying agent?"

## User decision
_Pending: sign-off on pass 1 plus Cards A and B._
