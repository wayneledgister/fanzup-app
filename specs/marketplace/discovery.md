# Artist services marketplace — Discovery
**Date:** 2026-11-27 · **Provisional tier:** Enterprise (inherits v2; touches third-party payments) · **Verdict:** PROCEED (directory + requests, no money) · INSUFFICIENT EVIDENCE (paid bookings)
**Source:** Wayne, 2026-11-27: "now what about the 3rd party marketplace for artists who need various services and providers? That is a key feature and needs integration."

Facts carry a source. *Estimate* = labelled with its basis. *Hunch* = our judgement, unverified.

## Existing specs (checked 2026-11-27)
None. Searched `specs/` (brief, requirements, design, backlog, CR-001…004, Layer 2, agents, mobile), `docs/` (ADRs, consolidation, brand), the project knowledge set (v2 Brief and Requirements, Council D1/E1/G1, mockup consolidation, backend setup guide) and Wayne's OneDrive `OMW` folder (a different product). The only "marketplace" mentions are the fan discovery feed (`docs/CONSOLIDATION.md` "Marketplace & discovery") and the counsel question on sales-tax *marketplace facilitator* status for perks (Q8, FR-TAX-005). This document is the first spec of the feature.

## Hypothesis
We believe **independent artists running or planning a FanZuP campaign** need to hire **producers, mixing/mastering engineers, videographers, designers and marketing/PR help** to deliver what their backers paid for, and that finding a trustworthy provider *inside the place where the project's budget and milestones already live* is valuable enough that **they send a request through FanZuP rather than through DMs or another marketplace**.

**We are wrong if:** in a closed beta with at least 20 listed providers, fewer than 1 in 5 artists with an active or funded campaign sends a service request within 30 days, or providers report that FanZuP requests are lower quality than their existing channels.

## Problem evidence
- **Fact:** artists already pay for these services through dedicated marketplaces: SoundBetter (studio professionals: producers, mixing, mastering, session players), AirGigs (session musicians and engineers), Vocalizr (vocalists and producers), and general freelance sites with music and video categories. Sources: [SoundBetter on American Songwriter](https://americansongwriter.com/soundbetter-pairs-music-creators-with-studio-professionals-to-get-the-song-to-the-finish-line/), [AirGigs about](https://airgigs.com/about), [Vocalizr fees](https://support.vocalizr.com/article/179-fees-charges-commissions), [overview of hire-a-musician sites](https://websiteplanet.com/blog/best-websites-hire-musicians).
- **Fact (FanZuP's own model):** every FanZuP campaign is a show, tour, album, music video or documentary with milestone tranches (`specs/01-requirements.md` FR-CMP-001/002). Each type needs paid third-party work (engineering, video, design, promotion) to reach its milestones.
- **Hunch:** an artist who just raised money has a budget and a deadline at the same moment, which is the best moment to match them with a provider. No competitor sits at that moment.
- **Gap:** we have no interviews with FanZuP artists or providers yet. Demand inside FanZuP is unproven.

## Competitive landscape
| Who | What | Money model | Gap FanZuP claims |
|---|---|---|---|
| SoundBetter | Directory + quotes for studio pros; storefront for sounds | Commission on jobs (rates to verify) | Not tied to a funded project, budget or milestones |
| AirGigs | Session musicians and engineers, fixed-price gigs | Commission (fee change notice 2019) | Same |
| Vocalizr | Vocalists, producers, contests | Commission and subscription | Same |
| General freelance sites | Music, audio, video, design categories | Commission + buyer fee | Broad, not music-specific trust |
| **Status quo** | Instagram DMs, friends, local studios, paid by Venmo/Zelle/cash | None | No vetting, no record, no protection; this is the real competitor |

## Market shape
- Customer group = FanZuP artists (all campaign types) and, on the supply side, independent providers. Reachability is through FanZuP's own artist funnel, so the market is bounded by FanZuP's artist count. *Estimate:* useful only once there are dozens of live campaigns; before that, supply matters more than demand.
- Enterprise-tier sizing (TAM/SAM/SOM) is deferred: the feature's value is retention and campaign success, not a standalone market. Recorded as an open question for the brief.

## Regulatory scan (questions for counsel, not answers)
Taking money from an artist and paying a provider is **paying a third party on someone else's behalf**. That sits right next to the custody question already on FanZuP's critical path. None of these are answered here.

| # | Question | Why it matters |
|---|---|---|
| MKT-Q1 | If FanZuP collects an artist's payment and pays the provider (with or without holding it until delivery), is that money transmission in the states we serve, or covered by an agent-of-payee exemption or the processor's licence? | Some states (e.g. California) narrowed or clarified agent-of-payee for online platforms ([Cooley](https://www.cooley.com/news/insight/2021/2021-06-28-california-rulemaking-agent-of-a-payee-exemption-money-transmission-licensing), [MoFo](https://mofo.com/resources/insights/200921-california-agent-payee-exemption-shrinking), [DFPI](https://dfpi.ca.gov/wp-content/uploads/sites/337/2019/10/Agent-of-Payee-Exemption-Online-Platform-for-Goods-or-Services-10-10-19.pdf)). Decides whether bookings can be paid in-app at all. |
| MKT-Q2 | Can a booking hold funds until the provider delivers, and what may we call it? | "Escrow" wording is already an open counsel item (Brief Q-list); milestone holds are custody. |
| MKT-Q3 | May an artist pay a provider directly from released campaign funds, or from funds still held for backers? | Released tranches are the artist's money; held funds are backers' until release. Paying a vendor straight from held funds would change the custody posture. |
| MKT-Q4 | Who issues 1099s to providers (FanZuP or the processor as settlement entity), and what tax info must we collect? | Same 1099-K question as artist payouts (Brief Q-list). |
| MKT-Q5 | Are any services taxable (sales tax on digital deliverables varies by state), and are we a marketplace facilitator for them? | Extends existing Q8 / FR-TAX-005. |
| MKT-Q6 | Platform terms: who owns deliverables (work-for-hire vs licence of masters, mixes, footage); dispute handling; provider is an independent business (worker classification). | Needs counsel-approved Provider Terms before providers sign up for real. |
| MKT-Q7 | Reviews and ratings must follow the FTC rule on fake reviews and testimonials (16 CFR 465). | Affects how and when reviews can be collected (MKT-3). |
| MKT-Q8 | Sanctions screening and identity for providers before any payout. | Same perimeter as artists (E1 finding 9). |

## Assumption register
| # | Assumption | Impact if wrong | Evidence | Tested how |
|---|---|---|---|---|
| A1 | Artists with campaigns want to hire through FanZuP | Kills | None | Closed-beta request rate (experiment E1) |
| A2 | Enough good providers will list before there's demand | Kills | None | Concierge supply seeding (E2) |
| A3 | Requests convert to real jobs off-platform even without in-app payment | Wounds | None | Follow-up with both sides 14 days after a request (E1) |
| A4 | In-app payment is legally possible without a new licence | Wounds (removes the revenue model, not the feature) | None | Counsel MKT-Q1…Q3 |
| A5 | Providers accept a FanZuP fee later | Wounds | Hunch: competitors charge commissions | Ask in E2 interviews |
| A6 | Vetting by staff is enough to stop bad actors at beta scale | Inconveniences | Same model as campaign review | Staff review queue (FR-MKT-008) |

**Riskiest assumption:** A1 + A2 together (two-sided cold start). Phase MKT-1 is built to test them cheaply: no money, no new partner, flag off in production.

## Experiments & results
| ID | Design | Pass threshold (set now) | Cost | Status |
|---|---|---|---|---|
| E1 | Turn `flag.marketplace` on for the closed beta (M2). Count service requests per artist with an active/funded campaign. | ≥ 20% of those artists send ≥ 1 request within 30 days; ≥ 30% of requests are accepted by the provider | MKT-1 build (this PR) | Pending M2 |
| E2 | Concierge supply: Wayne recruits 20 providers across at least 4 categories from his network; 5 short interviews about where their work comes from today and what they'd pay | 20 listed and approved before E1 starts; ≥ 3 of 5 say they'd accept a fee for qualified requests | Wayne's time | Pending Wayne |
| E3 | Counsel answers MKT-Q1…Q3 | An approved flow of funds for paid bookings | One counsel engagement (can share the custody opinion) | Pending; bundle with the existing custody/MTL question |

## Verdict & reasoning
**PROCEED with Phase MKT-1:** a directory of vetted providers and listings, service requests from artists to providers, provider responses, and staff vetting, on web and mobile, behind `flag.marketplace` (off in production). It moves no money and needs no partner, so it can't touch the custody critical path, and it is exactly the instrument that tests A1/A2.

**INSUFFICIENT EVIDENCE for paid bookings (MKT-2):** the flow of funds depends on counsel (MKT-Q1…Q3) and on which processor/custodian FanZuP ends up with. We design the boundary now (ADR-010) so MKT-2 is a new adapter and ledger accounts, not a rewrite, and we build none of it.

**Bear case (Skeptic):** this is a second two-sided marketplace inside a platform that hasn't launched its first; it competes for founder time with M1 close and M2; SoundBetter-type players already own supply. Answer: MKT-1 is small, flag-gated and reuses identity, review and RLS patterns; it ships dark and only runs as an experiment once M2 has artists. If E1 fails, we delete the flag and the tables. The production-readiness review recommended freezing new money-adjacent builds until M2; MKT-1 respects that because it has no money path.

**What would change the verdict:** E1 below threshold → KILL or pivot to a curated partner list (no product); counsel says in-app payment needs a licence → MKT-2 stays referral-only.

## Seeds for the brief
- **Problem:** artists with a funded project need trusted providers at the moment they have budget and deadlines; today they rely on DMs and unprotected payments.
- **Users:** artists (buyers), service providers (sellers; a new role), staff (vetting, takedowns), fans (none in MKT-1; later, provider credits on campaign pages).
- **Success-metric candidates:** request rate per active artist (E1), provider acceptance rate, time to first response, share of funded campaigns that hire through FanZuP, provider approval backlog.
- **Constraints:** no money in MKT-1; money only through the API, ledger and provider adapter (ADR-003) when it comes; brand copy rules (no invented fees, no investment words); web and native are both first-class (CR-004); Apple/Google rules — services performed outside the app are not in-app purchases (App Store guideline 3.1.3(e)/3.1.5 for person-to-person services; to verify at MKT-2).
- **Scope edges:** MKT-1 = directory, listings, requests, responses, vetting. MKT-2 = quotes and paid bookings (counsel-gated). MKT-3 = reviews/ratings, campaign integration (link a booking to a campaign milestone, provider credits), in-app messaging threads, notifications.
- **Open questions carried forward:** MKT-Q1…Q8, A1/A2, fee model (Wayne), sizing.
