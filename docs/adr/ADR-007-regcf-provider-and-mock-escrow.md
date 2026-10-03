# ADR-007: Reg CF provider boundary and a standalone mock escrow service

**Status:** Proposed (CR-002, L2 G1+G2) · **Date:** 2026-10-03 · **Decider:** Wayne · **Requirements:** NFR-L2-01, NFR-L2-02, FR-L2-ESC-001

## Context
Layer 2 needs an escrow agent, KYC/AML on investors, trades, fund moves, a close/disbursement step, refunds, and a way to pay distributions. North Capital's TransactAPI covers that workflow (issuer → offering → party → account → link → trade → fund move → close) and has a sandbox, but sandbox keys are issued by their integration team, not self-serve (checked 2026-10-03). Wayne asked for a mock API "if an api with a sandbox env is not available". The M1 `PaymentProvider` (ADR-003) models a card processor, not an offering escrow, so stretching it would mix two different money models.

## Decision
1. **A second provider boundary, `RegCfProvider`** (`apps/api/src/regcf/`), shaped after TransactAPI's documented workflow. Domain code (routes, service, worker, SQL) depends only on the interface. Every mutating call takes an idempotency key derived from our row id.
2. **`apps/mock-escrow`**: a standalone Fastify service with its own `node:sqlite` store, API-key auth, idempotency keys, a virtual clock with asynchronous jobs, HMAC-signed webhooks back to the API, deterministic test triggers, and admin endpoints (advance time, reset, load fixtures). It runs in `pnpm dev` and in CI e2e.
3. **One engine, two transports.** The service's domain logic is a class (`MockEscrowEngine`) used by the HTTP server and, in-process, by the API's unit tests (`InProcessRegCf`), so tests exercise the same behaviour without a network.
4. **Inbound reuses the M1 inbox:** signed webhooks are verified, stored in `provider_events` and acknowledged before processing.
5. **Outbound reuses the two-phase pattern** in a Layer 2 table (`pool_ops`), because M1's `outbound_ops` is keyed to campaigns.
6. **Can't run deployed:** `REGCF_PROVIDER=mock` is refused at startup in any deployed environment.

## Consequences
- A `northcapital` adapter can replace the mock without touching domain code; the remaining work is mapping their field names, their webhook signature scheme, and their asynchronous statuses.
- Two services to run locally (`pnpm dev` starts both).
- The mock's behaviour is our reading of a public workflow, not a contract; drift is the main risk (L2-Q4: get sandbox access before any partner demo claims fidelity).
