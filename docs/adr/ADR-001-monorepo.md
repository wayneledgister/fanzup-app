# ADR-001: One monorepo (pnpm workspaces), not multiple repos

**Status:** Accepted · **Date:** 2026-10-03 · **Decider:** Wayne

## Context
FanZuP is adding a backend: a Supabase Postgres database plus a TypeScript API, next to the existing React web app. The team is one founder-engineer for now, likely a small team through Beta (PRD 01 §14: Beta = Layer 1 plus one real raise, Aug 2027).

The web app and the API share rules that **must not drift**:
- creator tier gates and caps (PRD 01 §6.3)
- policy defaults (council D1, Card B)
- money in integer cents
- campaign states and escrow rules (Mechanism 05)
- the regulated-copy rules (Brand §7.4)

A mismatch here isn't a cosmetic bug. It would mean the UI shows one Reg CF cap while the API enforces another.

## Options

| | Monorepo (pnpm workspaces) | Multiple repos (web / api / db) |
|---|---|---|
| Shared rules (tiers, policy, money types, request schemas) | One `packages/shared`, imported by both sides. They can't drift. | Has to be published as a versioned npm package, so every rule change needs three PRs and a version bump. |
| A change that spans DB, API and UI (most features) | One PR, reviewed and rolled back as a unit | Three coordinated PRs; easy to merge one without the others |
| CI | One workflow, path-filtered per app | Three pipelines; cross-repo contract tests needed |
| Access control / team boundaries | Coarser; CODEOWNERS can still require review per folder | Hard boundaries per repo |
| Independent deploys | Still independent: each app deploys on its own path filter | Natural |
| Scale ceiling | Fine well past Beta; Turborepo can be added if builds get slow | Better for many teams |
| Tooling in this environment | Uses the one repo already connected | New repos would have to be created by hand |

## Decision
**One monorepo using pnpm workspaces.**
```
apps/web          React app (the existing prototype)
apps/api          Fastify + TypeScript API (the money path)
packages/shared   tiers, policy, money, campaign state machine, zod schemas
supabase/         migrations, seed, config (Supabase CLI layout)
```

## Consequences
- The PRD 01 §14 "two cadences" guardrail is kept with **path-filtered CI and separate release gates**, not separate repos:
  - `apps/web` deploys freely.
  - `apps/api` and `supabase/migrations` need passing ledger tests and a protected-environment approval.
- Revisit if any of these happen:
  - more than ~3 teams
  - an outside party (e.g. the broker-dealer) needs repo access to only part of the code
  - CI time goes above ~10 minutes

  In any of those cases, split out `apps/api` first. `packages/shared` would then become a published package.
