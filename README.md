# FanZuP

Direct-to-fan funding for independent artists. *Fund the culture. Own the future.*

| Path | What | Hosted on |
|---|---|---|
| `apps/web` | React app (Brand v2.0, 93 routes) | Vercel service `web` at `/` |
| `apps/api` | Fastify API: backings, escrow orchestration, settlement, refunds, milestone releases | Vercel service `api` at `/api`; worker on Render ([ADR-002](docs/adr/ADR-002-hosting.md)) |
| `apps/mock-escrow` | Mock Reg CF escrow/offering provider (TransactAPI-shaped) for the Layer 2 demo — local and CI only ([ADR-007](docs/adr/ADR-007-regcf-provider-and-mock-escrow.md)) | never deployed |
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
pnpm e2e                         # golden + Layer 2 journeys; needs the local stack + mock escrow (see .github/workflows/ci.yml job e2e)
```

## Money-path rules (enforced in the database, tested in CI)
- FanZuP never holds cash. A third-party escrow partner does; the ledger mirrors it (Mechanism 05).
- Amounts are integer cents. The ledger is double-entry, append-only, and every transaction balances.
- Every money operation is idempotent. Retries can't double-charge or double-pay.
- Clients can't write money fields or call money functions. RLS and column grants stop them; only the API's service role can.
- Funding is target-or-refund. Failed campaigns refund backers in full.

## Feature flags
`layer2` (Reg CF investing) and `postBeta` (soft transfers, holder votes) are off by default. Set `VITE_FLAG_LAYER2=true` or `VITE_FLAG_POSTBETA=true`, or append `?flags=layer2,postBeta` to a URL for review of mock-only screens.

**`layer2` is enforced on the server** (CR-002, FR-PLT-001 slice): every Layer 2 API route answers 404 `layer2_disabled` unless the API runs with `REGCF_PROVIDER=mock` **and** the database flag `flag.layer2` is on. `REGCF_PROVIDER=mock` is refused in any deployed environment, so Layer 2 can't be on in production. Staff change the DB flag with `POST /api/v1/staff/flags/layer2` (audited); the local seed turns it on.

## Layer 2 demo: album royalty Pool on mock rails (CR-002)
A creator offers fans a share of an album's royalties for **Units** (Reg CF revenue-share Pool): Form C review, mock KYC/AML, Reg CF limits, escrow with target-or-refund, milestone releases, royalty statements reconciled to cash, and a deterministic Waterfall. **Demo only — not an offer of securities. Mock escrow and data.** Specs: [`specs/l2/`](specs/l2/), [CR-002](specs/changes/CR-002-l2-album-royalty-pool.md).

```bash
# once: apps/api/.env needs REGCF_PROVIDER=mock (see apps/api/.env.example); the web needs VITE_SUPABASE_URL/ANON_KEY
pnpm db:start && pnpm db:reset        # migrations + seed.sql + seed_layer2.sql (local only)
pnpm dev                              # web :5173, API :8787, mock escrow :8790 (loads fixtures matching the seed)
pnpm dev:worker                       # settlement, provider operations, royalty reconciliation (or use the demo clock)
pnpm demo:reset                       # start over: reset the DB and the mock escrow together
```
Seeded logins (local only; password in the header of `supabase/seed.sql`):
| Who | Email | State |
|---|---|---|
| Creator, Rising | `nova@fanzup.test` | *Night Bloom* live and filling; *Demo Tape EP* ended at the cap |
| Creator, Rising | `sol@fanzup.test` | *Sol Sessions Vol. 1* funded, two quarters distributed |
| Creator, Starter | `lowends@fanzup.test` | can't create Pools (tier rule) |
| Fan, verified | `fan@fanzup.test` (Jordan) | $7,500 limit, $2,000 used; holdings in Sol Sessions and a refunded Pool |
| Fan, verified | `ava@fanzup.test` | $3,000 limit, $2,000 used |
| Fan, accredited | `ben@fanzup.test` | no limit; at the cap in Demo Tape EP |
| Fan, KYC rejected / manual review / not started | `cleo@` / `dev@` / `eli@fanzup.test` | |
| Staff | `reviewer@fanzup.test` (M1 seed) | needs a TOTP code: the staff screens walk you through enrolling an authenticator |

Walkthrough: `/creator/pools/new` (as Nova) → `/admin/pools` (as the reviewer: approve the Form C, execute the collection agreement) → creator launches → `/pools` → invest as Eli (mock KYC: last name `KYCFAIL` is rejected, `AMLHOLD` goes to manual review; a whole-dollar amount ending in 13 is returned by the bank) → on `/admin/pools/:id`, **Demo clock → Run past the offering deadline** → creator adds a royalty statement → staff send matching cash, reconcile, dry-run and commit a distribution → `/portfolio`.
