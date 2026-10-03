# ADR-003: Payment-provider boundary — event inbox, two-phase outbound, sandbox that speaks events

**Status:** Proposed (G2, M1) · **Date:** 2026-10-03 · **Decider:** Wayne · **Requirements:** FR-PAY-002/003/004/007/008, NFR-QA-01

## Context
Until a custodian is chosen (E1 card B), Stripe test mode plays the provider (FR-PAY-010). E1 found the money path trusted the processor's word at the wrong moments: webhooks acted on before being stored (B1), outbound refunds and payouts that could execute twice after a retry (B3), and no way to prove the ledger matches the money (B6). CI can't use Stripe (no keys in the repo, and `stripe-mock` is stateless).

## Decision
1. **One adapter interface** (`PaymentProvider`) is the only code that talks to the processor: create/cancel payment, refund + find refund, transfer + find transfer, parse/verify event, list balance transactions, payout-account onboarding. Implementations: `stripe-test` and `sandbox`.
2. **Inbound = inbox.** Every provider event is verified, stored in `provider_events` (unique per provider event id) and acknowledged; processing happens afterwards, idempotently, with bounded attempts and staff replay.
3. **Outbound = two-phase.** Each refund/payout is an `outbound_ops` row (unique per subject) committed as `initiated` before the provider call; a retry first asks the provider whether the original attempt exists; the ledger posts only on confirmation and only the exact amount.
4. **The sandbox emits events** into the same inbox (it never shortcuts to the ledger), and derives its balance list from those events, so CI exercises the same processing and reconciliation code as Stripe.
5. **Charge at backing** (G1 N8): capture immediately; refunds on failure.

## Consequences
- Duplicate or replayed webhooks are harmless; a crash between "provider called" and "ledger posted" is recovered by lookup, never by a second movement.
- Adds two tables and a worker step; the existing `EscrowProvider` grows to `PaymentProvider` (the old name stays as a type alias for one release).
- Swapping Stripe for the custodian means a new adapter, not new money rules (FR-PAY-010 bullet 3).
- Sandbox fidelity is the main risk (design §15); covered by adapter tests on recorded Stripe payloads and a manual Stripe run.
