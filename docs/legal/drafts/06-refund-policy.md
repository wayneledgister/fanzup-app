# FanZuP Refund and Cancellation Policy

> **DRAFT FOR ATTORNEY REVIEW — NOT LEGAL ADVICE — NOT FOR PUBLICATION.** First draft, 2026-11-27. Shown at checkout and in My backings (FR-PRV-001). Where refunds come from after funds have been released depends on E1 card C (holdback) and Brief Q5; where unclaimed refunds go depends on FR-PAY-011 (state unclaimed-property law).

**Version:** [2026-xx-xx] · **Effective:** [date]

This policy explains when backers get money back on FanZuP, and how. It's part of the [Backer Pledge Terms](03-backer-pledge-terms.md).

## When you get a full refund
| Situation | What happens | Timing |
|---|---|---|
| The campaign doesn't reach its goal by the deadline | **Every backer is refunded in full, automatically**, including any extra amount | We aim to start them within [1 hour] of the campaign closing *(product target, not a guarantee; attorney to confirm wording)* |
| You cancel while the campaign is still live | Full refund of your backing | Started at once |
| You reduce your perk or quantity while the campaign is live | The difference is refunded | Started at once |
| Your payment was processed after the deadline, or for a campaign that had stopped accepting backings | Full refund, with an email explaining why | Started within [1 hour] |
| Your payment amount didn't match your backing | Your payment is held and refunded in full | Started within [1 hour] |
| Your perk is late and you choose to cancel | Full refund | Started within [1 business day] of your choice |
| FanZuP cancels a campaign (for example for fraud or a broken promise) | Full refund to every backer | Started within [1 business day] of the cancellation |

## Other refunds
FanZuP support can refund all or part of any backing at any stage to fix a real problem (for example a perk that arrives damaged or not as described, or a cancelled event). Report the problem from My backings; we aim to respond within [3] business days.

**Change of mind after funding** isn't a reason for a refund, because the artist starts spending on the project once it's funded.

## How refunds are paid
- Refunds go back to the payment method you used. Card refunds usually appear within 5–10 business days, depending on your bank.
- You get an email when a refund starts and when it completes, and My backings shows the amount, date and reference.
- **If a refund can't be delivered** (for example your card was closed), we'll contact you for another way to pay you. If we can't reach you after [x] days, the money is handled under the unclaimed-property law of [your state / the applicable state]. *(FR-PAY-011; attorney to set the period and procedure.)*

## Where the money comes from
For a funded campaign, a refund is paid first from money not yet released to the artist, then from [the artist holdback], and otherwise by [the artist / FanZuP]. **This doesn't change what you receive.** *(E1 card C: confirm the default — artist holdback, FanZuP absorbs card fees on failed-campaign refunds.)*

## Test-money beta
In test mode, refunds are test transactions; no real money moves.

## Chargebacks
Please contact us before disputing a charge with your bank. We can usually refund faster than a dispute is resolved, and a dispute can delay the artist's other backers.

## Services marketplace
FanZuP doesn't process payments for marketplace services, so it can't refund them. Refunds for work arranged with a provider are between you and the provider.

---
**Sources:** `specs/01-requirements.md` FR-PAY-003/011, FR-BCK-003/004, FR-FUL-003, FR-DSP-001/003/005, FR-CMP-007; `packages/shared/src/policy.ts` (`refunds.autoInitiateMinutes`, `adminSlaBusinessDays`); `specs/00-brief.md` success metrics.
