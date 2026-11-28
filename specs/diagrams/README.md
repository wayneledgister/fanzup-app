# Architecture diagrams · FanZuP
**Owner:** engineering · **Status:** active · **Date:** 2026-11-27 · **As built on:** `main` after PR #27 · **Sources:** `specs/02-design.md` §1, §5–§9, ADR-001…010, `vercel.json`, `render.yaml`, `supabase/config.toml`

C4-style views (context → containers → deployment), then the three money flows the FMEA analyses. Diagrams are Mermaid, so GitHub renders them and they're diffable. They show what runs today; planned pieces are drawn dashed and labelled *planned*. When a PR changes a box or an arrow here, it updates this file (`sdd-document`).

## 1. System context (C4 level 1)
Who uses FanZuP and which outside systems it depends on.

```mermaid
flowchart LR
  fan(["Fan / backer<br/>web or phone"])
  artist(["Artist<br/>runs campaigns"])
  provider(["Service provider<br/>marketplace, flag off"])
  staff(["Staff operator<br/>Wayne, single-operator mode"])

  fz["FanZuP platform<br/>reward campaigns, money held until the goal is met,<br/>milestone releases, refunds"]

  stripe[["Stripe (TEST mode only)<br/>PaymentIntents, Refunds,<br/>Connect transfers, webhooks"]]
  supaauth[["Supabase Auth<br/>email + password, TOTP"]]
  mail[["Email sender<br/>Supabase built-in today,<br/>custom SMTP planned"]]
  llm[["Anthropic API<br/>advisory agents, flag off"]]
  custodian[["Escrow / custody partner<br/>planned, not chosen (FR-PAY-010)"]]

  fan -->|back campaigns, see refunds| fz
  artist -->|create, publish, submit evidence, get paid| fz
  provider -->|list services, answer requests| fz
  staff -->|review, verify, refund, reconcile| fz

  fz -->|charge, refund, transfer| stripe
  stripe -->|signed webhooks| fz
  fz -->|verify tokens via JWKS| supaauth
  fan & artist & staff -->|sign in| supaauth
  supaauth --> mail
  fz -.->|review packets| llm
  fz -.->|planned: replaces Stripe for custody| custodian
```

**Trust boundaries** (design §9): browser ↔ API (untrusted input, bearer tokens); API ↔ Postgres (money functions as `service_role` only); Stripe → webhook (signature on the raw body, livemode rejected); API/worker → Stripe (test key only); staff ↔ API (second factor, `aal2`).

## 2. Containers (C4 level 2)
What runs, what it owns, how the pieces talk.

```mermaid
flowchart TB
  subgraph clients["Clients"]
    web["Web app · apps/web<br/>React 19 + Vite SPA<br/>@fanzup/shared rules"]
    mobile["Mobile app · apps/mobile<br/>Expo / React Native<br/>(deprioritised)"]
  end

  subgraph vercel["Vercel project (one domain)"]
    webhost["service web<br/>static files at /"]
    api["service api · apps/api<br/>Fastify in one Vercel Function at /api<br/>auth, validation, sequencing, never computes a ledger amount"]
  end

  subgraph render["Render"]
    worker["fanzup-worker · apps/api/src/worker.ts<br/>loop every 30 s: heartbeat, expire holds,<br/>process events, settle, drain outbox, run ops, recon"]
    agentw["agent worker · agent-worker.ts<br/>optional, role fanzup_agent, flag off"]
  end

  subgraph supabase["Supabase (East US)"]
    auth["Auth (GoTrue)"]
    db[("Postgres 17<br/>ledger (double-entry, append-only) · audit<br/>backings · campaigns · tranches · outbox<br/>provider_events · outbound_ops · recon_*<br/>privileged_actions · platform_settings (flags)<br/>RLS + column grants, money rules in SQL")]
  end

  stripe[["Stripe test mode"]]
  llm[["Anthropic API"]]

  web -->|HTTPS same-origin /api/v1/*<br/>Bearer access token| api
  mobile -->|HTTPS /api/v1/*| api
  web & mobile -->|sign-up / sign-in| auth
  webhost -. serves .-> web
  api -->|transaction pooler :6543<br/>asUser = RLS, asService = money fns| db
  api -->|JWKS| auth
  api -->|create PaymentIntent, onboarding links| stripe
  stripe -->|POST /api/v1/webhooks/stripe| api
  worker -->|session pooler :5432| db
  worker -->|refunds, transfers, cancels, balance txns| stripe
  agentw -->|read views, write agent tables only| db
  agentw -.-> llm
```

**Who owns what** (design §1): the database owns every money rule and state transition; the API authenticates, authorises, validates and sequences provider calls; the worker owns everything time-based or retried; the provider adapter (`apps/api/src/provider/`) is the only code that talks to Stripe. The web and mobile apps are clients of the API for every money path and of Supabase Auth for identity only. Layer 2 (Reg CF) and its mock escrow service (`apps/mock-escrow`) exist only in local and CI; a deployed API refuses `REGCF_PROVIDER=mock`.

## 3. Deployment and release (today vs target)
```mermaid
flowchart LR
  dev["PR branch"] -->|push| gh["GitHub<br/>CI: Web, API, Mobile, E2E"]
  gh -->|preview per PR| vprev["Vercel preview<br/>(Preview env vars)"]
  gh -->|squash-merge to main| main(("main"))
  main -->|Git integration| vprod["Vercel production<br/>web + api, atomic swap"]
  main -->|after CI passes| rw["Render fanzup-worker<br/>DEPLOY_ENV=staging"]
  main -->|GitHub integration| sstg[("Supabase fanzup-staging<br/>paused · no backups")]
  gh -.->|manual fallback db-deploy.yml| sstg
  vprod --> sstg
  rw --> sstg
  vprev --> sstg

  sprod[("planned: fanzup-prod<br/>Pro + PITR")]:::planned
  rwp["planned: production worker<br/>DEPLOY_ENV=production"]:::planned
  main -.->|planned: db-deploy production job,<br/>required reviewer| sprod
  vprod -.->|planned: Production env vars| sprod
  rwp -.-> sprod
  classDef planned stroke-dasharray: 5 5
```
Today every hosted piece points at the one staging database. NFR-OPS-01 needs the dashed production column before real users (readiness blocker B1). Deploy and rollback steps: `specs/runbooks/deploy-and-rollback.md`.

## 4. Backing (checkout) — claim-first, retry-safe (FR-PAY-001, FR-PAY-006)
```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant D as Postgres
  participant S as Stripe
  B->>A: POST /v1/backings (Idempotency-Key, perk, qty)
  A->>D: claim key + create pending backing + hold perk stock (one txn)
  A->>S: create PaymentIntent (idempotent, metadata = backing id, correlation id)
  S-->>A: client_secret
  A-->>B: backingId + client_secret
  B->>S: confirm card (3-D Secure if asked)
  S-->>A: webhook payment_intent.succeeded (signed)
  A->>D: store provider_event (unique event id), ack 200
  A->>D: process the event right after the ack (the worker's next tick is the backstop, safe to race)
  D->>D: backing held, ledger posting (escrow_cash ↔ backer_liability)
  Note over D: capture after deadline or after the hold expired → auto refund (FR-PAY-003)
```

## 5. Settlement and refunds — failed campaign (FR-PAY-003, FR-PAY-004)
```mermaid
sequenceDiagram
  autonumber
  participant W as Worker
  participant D as Postgres
  participant S as Stripe
  W->>D: settle due campaigns (one txn per campaign)
  D->>D: goal missed → campaign failed, outbox backing.refund × N
  W->>D: drain outbox (≤ 100 per tick) → outbound_op initiated (unique per subject)
  W->>S: create Refund (idempotency key = op key + generation)
  S-->>W: refund id
  W->>D: op sent
  S-->>D: webhook refund.updated (via API inbox)
  D->>D: event processed (API after ack, or worker) → op confirmed, backing refunded, ledger posting, FanZuP absorbs the fee (platform_funding)
  Note over W,S: no DB lock is held across the Stripe call, retries back off, dead-letter after 8 attempts
```

## 6. Milestone release — funded campaign (FR-PAY-005)
```mermaid
sequenceDiagram
  autonumber
  participant Ar as Artist
  participant St as Staff (aal2)
  participant A as API
  participant D as Postgres
  participant W as Worker
  participant S as Stripe Connect
  Note over D: funded at deadline → outbox tranche.release for tranche 1
  Ar->>A: submit evidence for tranche n
  St->>A: POST /staff/tranches/:id/verify (reason, second factor)
  A->>D: privileged action (delayed above the threshold), reviewer ≠ owner in SQL
  D->>D: outbox tranche.release
  W->>D: payouts paused by an open payout-pausing recon break? → wait
  W->>S: create Transfer to the artist's Connect account
  S-->>D: transfer.created (via inbox) → op confirmed, ledger release posting
  Note over W,D: daily recon compares the ledger with every Stripe balance transaction
```

## Change log
- 2026-11-27: first version (DOC audit condition 2; this PR).
