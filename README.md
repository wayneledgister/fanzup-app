# FanZuP

Direct-to-fan funding for independent artists. *Fund the culture. Own the future.*

| Path | What | Hosted on |
|---|---|---|
| `apps/web` | React app (Brand v2.0, 93 routes) | Vercel |
| `apps/api` | Fastify API + worker: backings, escrow orchestration, settlement, refunds, milestone releases | Render |
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
pnpm dev:api                     # http://localhost:8787
pnpm --filter @fanzup/api worker # settlement + outbox worker
pnpm test                        # needs TEST_DATABASE_URL (see SETUP.md A6)
pnpm typecheck && pnpm lint:copy
```

## Money-path rules (enforced in the database, tested in CI)
- FanZuP never holds cash. A third-party escrow partner does; the ledger mirrors it (Mechanism 05).
- Amounts are integer cents. The ledger is double-entry, append-only, and every transaction balances.
- Every money operation is idempotent. Retries can't double-charge or double-pay.
- Clients can't write money fields or call money functions. RLS and column grants stop them; only the API's service role can.
- Funding is target-or-refund. Failed campaigns refund backers in full.

## Feature flags
`layer2` (Reg CF investing) and `postBeta` (soft transfers, holder votes) are off by default. Set `VITE_FLAG_LAYER2=true` or `VITE_FLAG_POSTBETA=true`, or append `?flags=layer2,postBeta` to a URL for review.
