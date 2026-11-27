# ADR-010: Services marketplace — no money in MKT-1, one money boundary for MKT-2

**Status:** Accepted (CR-005; Wayne chose "ask counsel first, then in-app" and "free in beta", 2026-11-27) · **Date:** 2026-11-27 · **Decider:** Wayne · **Requirements:** NFR-MKT-01/02, FR-MKT-014…016

## Context
Wayne wants a marketplace where artists hire third-party providers (producers, engineers, video, marketing). Paying a provider on an artist's behalf is a payment to a third party. Whether FanZuP may take that money, hold it until delivery and pay it out, and under whose licence, is unanswered (discovery MKT-Q1…Q4) and sits beside the custody question already on the critical path. Fees for FanZuP are TBD (`docs/brand/fees.html`).

## Decision
1. **MKT-1 moves no money.** Directory, listings, requests and responses only. Artist and provider agree and pay outside FanZuP, and the app says so. No marketplace code may call `PaymentProvider`, write `ledger_*`, or read campaign balances (test-enforced).
2. **MKT-2, when allowed, reuses the existing money rails rather than adding a second path:**
   - a `booking` is a ledger subject; its charge goes through `PaymentProvider` and the event inbox (ADR-003 inbound);
   - funds sit in a booking-held ledger account until the artist confirms delivery or staff decide a dispute;
   - the provider is paid by a two-phase `outbound_ops` transfer to a verified payout account (ADR-003 outbound), after tax-info and sanctions checks;
   - any FanZuP fee is a separate ledger line, never netted silently;
   - clients never compute amounts; they show what the API returns.
3. **Campaign funds are not a payment method in MKT-2** unless counsel says otherwise (MKT-Q3). Backer money still held for a campaign is never paid to a provider directly; an artist pays from their own card or from funds already released to them.
4. **Which legal flow of funds** (processor-led marketplace where the processor is the licensed party, the chosen custodian, or referral-only) is chosen after counsel, as a new adapter behind the same interface, not a new set of money rules.

## Consequences
- MKT-1 can ship dark now without touching M2/M3's critical path.
- Revenue from the marketplace waits for counsel and Wayne's fee decision.
- Off-platform payment in MKT-1 means no protection for either side and some leakage after MKT-2 starts; accepted for the experiment.
