# ADR-005: Correlation ids via AsyncLocalStorage and Postgres settings

**Status:** Proposed (G2, M1) · **Date:** 2026-10-03 · **Decider:** Wayne · **Requirements:** NFR-OPS-04, NFR-COMP-11, M1 exit test 4

## Context
M1 must show every step of a funding or refund traceable by one id, across the API, the worker, provider calls and the SQL money functions that write audit and ledger rows themselves.

## Decision
- The API accepts or generates an `x-correlation-id` per request; the worker creates one per settlement and reuses the stored id of the backing, outbox row or outbound op it is working on.
- The id, actor id, actor kind and `aal` sit in Node `AsyncLocalStorage`. Every transaction opened by `asUser`/`asService` starts with `set_config('fanzup.<key>', …, true)`.
- `audit_events`, `ledger_transactions` and `outbox` get columns whose **defaults read those settings**, so existing SQL functions record the id without signature changes. Outbox rows carry the id forward; provider metadata carries the backing's id.
- **Provider metadata uses the stored id, never the current request's (review round 3).** `metadata.correlation_id` on a PaymentIntent is `backings.correlation_id` — the id of the request that created the backing — and every other create parameter is likewise read from the stored backing. A resumed checkout (same Idempotency-Key, new request, new request id) therefore sends byte-identical parameters, which Stripe requires for an idempotent replay; the resuming request's id appears only on its own audit rows and logs (design §4.4 step 3, §8).
- `GET /staff/trace/:id` returns everything with that id in time order.

## Consequences
- No money function signatures change; a missing context degrades to `null`/`system:db`, never to a failure.
- Transaction-local settings are safe with Supabase's transaction pooler.
- Refunds caused by a settlement belong to the settlement's trace; a backing's own trace (checkout → capture) is reachable from the backing id. Both are asserted in CI.
