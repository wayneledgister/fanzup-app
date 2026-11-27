# FanZuP Backer Pledge Terms

> **DRAFT FOR ATTORNEY REVIEW — NOT LEGAL ADVICE — NOT FOR PUBLICATION.** First draft, 2026-11-27. Accepted by fans at checkout (the "Campaign Terms for Backers" route in `Legal.tsx`). Written for **charge at backing** (FR-BCK-001: the card is charged when you back and refunded in full if the campaign fails). Custody wording is generic until Brief Q2 / E1 card B is answered; "escrow" must not be used until counsel approves it (FR-PLT-006).

**Version:** [2026-xx-xx] · **Effective:** [date]

These terms apply each time you back a campaign on FanZuP. They add to the [Terms of Service](01-terms-of-service.md) and the [Refund and Cancellation Policy](06-refund-policy.md).

## Summary
- You're backing an artist's project in return for a perk. **It isn't an investment and gives you no share of anything.**
- Your card is charged when you back. **If the campaign doesn't reach its goal by the deadline, you're refunded in full, automatically.**
- If it's funded, money is released to the artist in stages: part on funding, the rest after FanZuP verifies a milestone.
- The artist, not FanZuP, is responsible for delivering your perk. If it's late, you'll be told the new date and can cancel for a full refund.

## 1. Who you're dealing with
When you back a campaign, you're entering into an arrangement with the **artist** who runs it. The artist sets the goal, deadline, perks, delivery dates and milestones, and is responsible for doing what the campaign page says. FanZuP runs the platform, reviews campaigns, works with its payment partners to hold and release funds, and handles refunds as described here. *(Attorney: confirm characterization of the contract — sale of perk by artist vs. conditional gift with reward — and FanZuP's role as agent, if any. Relevant to Brief Q6 and Q8.)*

## 2. How a backing works

2.1 **Checkout.** You choose a perk and quantity (up to [6] tickets per order for ticket perks), may add an extra amount, and see the total in U.S. dollars, the perk's expected delivery date, the payment method and the refund promise before you pay. *(Attorney: add sales tax and shipping lines if FanZuP or the artist must charge them, Brief Q8.)*

2.2 **Charge.** Your payment is charged when you confirm the backing. Your perk is reserved for [15] minutes during checkout so that someone else can't take the last one.

2.3 **Where the money goes.** Your payment is processed by [payment processor] and held for the campaign by [custodian/processor] — not by FanZuP. *(Brief Q2.)*

2.4 **One deadline.** Every campaign has a single deadline shown on its page. A payment processed after the deadline is refunded in full.

2.5 **If the goal isn't met by the deadline, every backer is refunded in full**, including any extra amount. We aim to start refunds within [1 hour] of the campaign closing. *(Attorney: the 1-hour figure is a product target (brief success metric, ≥ 99.9% of failed-campaign refunds), not a spec guarantee; keep it as "aim" or drop the time. Also confirm FanZuP absorbs card fees on failed-campaign refunds so backers get 100% back — E1 card C default.)*

2.6 **If the goal is met,** the campaign is funded and funds are released to the artist in tranches (by default 50% on funding and 50% after FanZuP verifies the milestone the artist set). Stretch goals never change the funding goal.

## 3. Changing or cancelling

3.1 **While a campaign is live** you can change your perk or quantity, or cancel your backing for a full refund, from My backings.

3.2 **After a campaign is funded** you can't cancel just because you changed your mind. You can still get a refund in the situations in the Refund and Cancellation Policy, including a late perk.

## 4. Perks and delivery

4.1 The artist must deliver perks as described, by the date shown, using the information you provide.

4.2 **Physical perks:** after funding you'll be asked for a shipping address through a backer survey. The artist sees it only after funding and only to ship your perk.

4.3 **Ticket perks:** you'll get a unique, single-use code in the app and by email. It's revoked if your backing is refunded. Event terms (venue rules, age limits, dates) are the artist's and the venue's. *(Attorney: what happens if an event is cancelled or rescheduled — refund from unreleased funds/holdback?)*

4.4 **Late perks:** if a perk misses its delivery date, the artist must give a new date within [7] days, and you'll be offered the choice to cancel for a full refund. *(Brief Q6: confirm whether the FTC Mail Order Rule, 16 CFR 435, applies to physical perks and whether its notice and consent timing must be followed.)*

4.5 **Problems:** report a problem with a perk from My backings. A case opens that the artist and FanZuP support can see. Please report to us before disputing a charge with your bank, so we can help faster.

## 5. What backing is not
Backing doesn't give you any ownership, equity, revenue share, royalty, interest, return, voting right or other financial interest in the artist, their music or FanZuP, and you shouldn't back expecting a profit. Your perk is the only thing you receive.

## 6. Your information
The artist receives only what's needed to deliver your perk (for example your name and shipping address for a physical perk). They get your email only if you choose to hear from them directly, and may use your information only to deliver that campaign's perks and to tell you about that campaign. See the [Privacy Notice](02-privacy-notice.md).

## 7. Chargebacks
If you dispute a backing with your card issuer, FanZuP and the artist may provide information about your backing and perk to respond. Fraudulent disputes may lead to account suspension. *(E1 card C: allocation of dispute losses between artist, holdback and FanZuP.)*

## 8. Test-money beta
During a test-mode beta, every money screen says so. No real money moves, you'll use a test card, and **the artist doesn't owe you a perk** for a test backing; anything they send is voluntary.

## 9. When FanZuP may refund or stop a campaign
FanZuP may suspend a campaign that looks fraudulent or broken. While it's paused, no money moves and you'll see the date of the next update. If the campaign is cancelled, backers are refunded under the Refund and Cancellation Policy.

---
**Sources:** `specs/00-brief.md`; `specs/01-requirements.md` FR-PAY-001/003, FR-BCK-001…005, FR-CMP-004/007, FR-FUL-001…004, FR-DSP-001…003, FR-PRV-006, FR-PLT-006; `packages/shared/src/policy.ts` (`campaign.defaultTranchesPct`, `checkout.holdMinutes`, `tickets.maxPerOrder`, `refunds.autoInitiateMinutes`); `specs/01-requirements.md` Appendix A (`fulfillment.newDateDays`); brief success metrics (failed-campaign refund timing); E1 card C.
