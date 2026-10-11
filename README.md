# FanZuP

Direct-to-fan funding for independent artists. *Fund the culture. Own the future.*

| Path | What | Hosted on |
|---|---|---|
| `apps/web` | React app (Brand v2.0, 93 routes) | Vercel service `web` at `/` |
| `apps/api` | Fastify API: backings, escrow orchestration, settlement, refunds, milestone releases | Vercel service `api` at `/api`; worker on Render ([ADR-002](docs/adr/ADR-002-hosting.md)) |
| `packages/shared` | Rules shared by web and API: creator tiers (PRD 01 §6.3), policy defaults, money, campaign state machine, request schemas | — |
| `supabase/` | Postgres schema: double-entry ledger, RLS, money functions, seed | Supabase |

**Start here:**
- **[docs/SETUP.md](docs/SETUP.md):** step-by-step setup, including everything that needs your accounts.
- [docs/adr/ADR-001-monorepo.md](docs/adr/ADR-001-monorepo.md): why this is one repo.
- [docs/CONSOLIDATION.md](docs/CONSOLIDATION.md): how the Figma mockups became this app.
- [docs/council/](docs/council/): decision records.
- [specs/](specs/): change requests and backlog.

## Everyday commands
```bash
pnpm install
pnpm db:start && pnpm db:reset   # local Supabase (Docker) with migrations + seed
pnpm dev:web                     # http://localhost:5173
pnpm dev:api                     # http://localhost:8787/api  (or `npx vercel dev` for both)
pnpm --filter @fanzup/api worker # settlement + outbox worker
pnpm test                        # needs TEST_DATABASE_URL (see SETUP.md A6)
pnpm typecheck && pnpm lint:copy
```

## Money-path rules (enforced in the database, tested in CI)
- FanZuP never holds cash itself. No custodian is live yet (FR-PAY-010), so only test money moves: the payment processor in test mode holds the test funds, and live payment keys are refused (FR-PAY-008, FR-PLT-006). The ledger mirrors what the processor holds.
- Amounts are integer cents. The ledger is double-entry, append-only, and every transaction balances.
- Every money operation is idempotent. Retries can't double-charge or double-pay.
- Clients can't write money fields or call money functions. RLS and column grants stop them; only the API's service role can.
- Funding is target-or-refund. Failed campaigns refund backers in full.
- Public counters (`raised_minor`, `backers_count`, perk units sold) count only `held` and `released` backings. A backing stops counting the moment its refund is requested, not when the refund confirms.
- A funded campaign pays the artist only from `held` backings; a refund already in progress at the deadline finishes refunding and is never paid to the artist.
- A failed campaign becomes `refunded` only when no backing is `held` or `refund_pending`.
- A backing request is claimed and its hold created in one transaction; the same Idempotency-Key always gets the same outcome, including the same error.
- A capture is refunded from what was actually captured, never from what the backing expected. A payment that belongs to no backing (a second payment, or one naming only a campaign) is recorded once and refunded by its own operation.
- Milestone payouts release strictly in order, and each transfer sends exactly what the ledger will accept at confirmation: a tranche's payout is created only after every earlier tranche is released, and its amount is re-checked against the ledger right before the transfer and never changed after the first call.

## Feature flags
`layer2` (Reg CF investing) and `postBeta` (soft transfers, holder votes) are off by default. Set `VITE_FLAG_LAYER2=true` or `VITE_FLAG_POSTBETA=true`, or append `?flags=layer2,postBeta` to a URL for review.
