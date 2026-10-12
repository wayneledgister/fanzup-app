# @fanzup/mock-escrow

Mock Reg CF escrow/offering provider shaped like North Capital TransactAPI (ADR-007). Local development and CI only: it
refuses to start in a deployed environment. Layer 2 is a demo on these rails ("Demo — not an offer of securities. Mock
escrow and data.").

- `src/engine.ts` — the domain logic (`MockEscrowEngine`), used by the HTTP server and in-process by API tests.
- `src/server.ts` — Fastify service on `MOCK_ESCROW_PORT` (8790), `x-api-key` on every request.
- `src/signing.ts` — webhook signatures (`x-mock-escrow-signature: t=<unix>,v1=<hmac>`).

## Behaviour the money rules depend on

- **Idempotency keys are permanent.** Every POST needs an `Idempotency-Key`. The same key with the same body returns the
  original object; the same key with a different body is refused `422 idempotency_conflict`. Keys never expire — not
  with real time, not when the virtual clock advances, not across restarts (they live in the sqlite file). Only
  `POST /admin/reset` clears them. FanZuP derives each key from a row id so that one key names one money movement ever
  (design §5), so a real provider must keep keys at least as long (ADR-007, prerequisites).
- **Lookups never create anything:** `GET /v1/trades?externalId=<investment id>` (trade + fund moves),
  `GET /v1/trades/:id`.
- **Void:** `POST /v1/trades/:id/cancel` cancels a trade with no fund move; refused `409 trade_funded` once a fund move
  exists; `fundTrade` on a cancelled trade is refused `409 trade_cancelled`.
- **Transaction lists** for ref matching (design §5.1): `GET /v1/offerings/:id/transactions` (fund moves incl. returned,
  refunds, disbursements) and `GET /v1/collection-accounts/:id/transactions` (deposits, payouts), each with id, kind,
  status, amount and `externalId`; `?since=<ISO>` filters.
- Asynchronous steps run on a virtual clock (`POST /admin/advance {seconds}`) and are announced by signed webhooks.
  Triggers: party last name `KYCFAIL` → rejected, `AMLHOLD` → manual review; a fund move whose whole-dollar amount ends
  in 13 is returned (R01); `POST /admin/refunds/:id/fail {returnCode?}` makes a pending refund fail at the bank
  (`refund.failed`; nothing leaves escrow, a trade goes back to `funded`; the refund's key keeps returning it, so a
  retry needs a new key — FanZuP's attempt generations, L2 design §5 Outbound).

`pnpm --filter @fanzup/mock-escrow test` runs the engine and HTTP tests.
