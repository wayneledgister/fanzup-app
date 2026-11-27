# FanZuP API reference (wire contract)
**Owner:** Wayne (product) · engineering · **Status:** active · **Date:** 2026-11-27 · **Touches:** FR-PLT-001, NFR-OPS-04, ADR-003, ADR-005, ADR-007, ADR-008, ADR-009, ADR-010

Every HTTP route the API registers, in one table. **This file is checked in CI**: `apps/api/test/api-contract.test.ts` builds the app twice — locally with every optional module on (sandbox payments, mock Reg CF, cron secret) and as a deployed staging API (Stripe test provider) — and fails if a route exists that isn't listed here, or a listed route no longer exists. When you add, rename or remove a route, update this table, the owning design doc's API section and, if a client calls it, `packages/shared/src/api-client.ts` in the same PR. `pnpm --filter @fanzup/api api:routes` prints the live list.

The detailed request, response and error shapes stay in the design docs (the **Spec** column); this file is the index and the drift guard. Request bodies are parsed with the zod schemas in `@fanzup/shared` where one exists (**Contract** column), so web, mobile and API validate with the same rule; the remaining bodies are parsed by route-local zod schemas in `apps/api/src`.

## Conventions (all routes)
- **Base path:** `/api` (Vercel routes `/api/*` to the API and doesn't strip the prefix). Versioned routes live under `/api/v1`.
- **Errors:** `{ error: <code>, message, correlationId }` (`ApiErrorBody` in `@fanzup/shared/schemas`). `400 invalid_request` for schema failures; `409` for business-rule refusals (named code, or `rule_violation`); `500 internal` never carries internals.
- **Correlation id:** every response carries `x-correlation-id`; a valid inbound `x-correlation-id` is kept (ADR-005).
- **Idempotency:** money-creating POSTs (`/v1/backings`, `/v1/pools/:id/investments`) require `Idempotency-Key`; the same key always gets the same outcome, including the same error.
- **Access levels** (M1 design §4.1): *public*; *user* = valid Supabase token; *verified* = user with a confirmed email (checked in the database); *owner* = owns the artist/campaign/Pool in the path; *staff (aal2)* = row in `staff` + second factor, otherwise `403 second_factor_required`; *signed* = provider signature, no user.
- **Gates:** `marketplace` = 404 `marketplace_disabled` unless `flag.marketplace` is on (CR-005). `layer2` = 404 `layer2_disabled` unless `REGCF_PROVIDER=mock` **and** `flag.layer2` is on; *mock Reg CF (completion)* = needs the mock provider only, so money in flight finishes with the flag off (L2 design §2). Dev routes are never registered in a deployed environment.
- **Privileged action:** recorded through `privileged()` with a typed reason, reviewer ≠ owner, audited; single-operator delays and daily limits apply to money actions (M1 design §3.6).

## Routes
<!-- routes:start (generated rows are checked by apps/api/test/api-contract.test.ts; keep one row per method + path) -->
| Method | Path | Access | Gate | Contract (`@fanzup/shared`) | Notes | Spec |
|---|---|---|---|---|---|---|
| GET | `/` | public | — |  | API banner (not the website) | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/health` | public | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/internal/tick` | cron (`Bearer CRON_SECRET`) | 404 unless `CRON_SECRET` set |  |  | [ADR-002](adr/ADR-002-hosting.md) |
| GET | `/api/v1/artist` | verified (own profile) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/artist` | verified (own profile) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/artist/campaigns` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| DELETE | `/api/v1/artist/campaigns/:id` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/artist/campaigns/:id` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| PATCH | `/api/v1/artist/campaigns/:id` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| PUT | `/api/v1/artist/campaigns/:id/perks` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/artist/campaigns/:id/publish` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/artist/campaigns/:id/submit` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| PUT | `/api/v1/artist/campaigns/:id/tranches` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/artist/payout-account` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/artist/tranches/:id/evidence` | verified + owner | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/backings` | verified | — | `BackCampaignRequest` → `BackCampaignResponse` | Idempotency-Key | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/backings/:id` | user (own) | — | `BackingStatus` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/campaigns` | public | — | `CampaignList` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/campaigns/:slug` | public | — | `CampaignDetail` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/config` | public | — | `PublicConfig` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/creator/pool-tranches/:id/evidence` | verified + owner | `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/creator/pools` | verified + owner | `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/creator/pools` | verified + owner | `layer2` | `PoolDraftRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/creator/pools/:id` | verified + owner | `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| PATCH | `/api/v1/creator/pools/:id` | verified + owner | `layer2` | `PoolDraftRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/creator/pools/:id/launch` | verified + owner | `layer2` | `PoolLaunchRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/creator/pools/:id/periods` | verified + owner | `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/creator/pools/:id/statements` | verified + owner | `layer2` | `StatementRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/creator/pools/:id/submit` | verified + owner | `layer2` | `PoolSubmitRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/dev/l2/advance` | none (dev only) | mock Reg CF, not deployed; `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/dev/l2/delays` | none (dev only) | mock Reg CF, not deployed; `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/dev/sandbox/pay/:backingId` | none (dev only) | sandbox provider, not deployed |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/dev/sandbox/tick` | none (dev only) | sandbox provider, not deployed |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/dev/sandbox/topup` | none (dev only) | sandbox provider, not deployed |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/events` | public | — | `FunnelEventRequest` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/investments` | user (own) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/investments/:id` | user (own) | mock Reg CF (completion) | `InvestmentView` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/investments/:id/cancel` | user (own) | mock Reg CF (completion) | `{ result, investment: InvestmentView }` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/investor/certification` | verified | `layer2` | `CertificationRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/investor/kyc` | verified | `layer2` | `KycStartRequest` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/investor/me` | user | `layer2` | `InvestorMeView` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/me` | user | — | `Me` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/me/acceptances` | user | — | `AcceptanceRequest` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/me/backings` | user | — | `{ backings: MyBacking[] }` |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/pools` | public | `layer2` | `PoolCardView[]` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/pools/:id/investments` | verified | `layer2` | `InvestRequest` → `InvestResponse` | Idempotency-Key | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/pools/:slug` | public | `layer2` | `PoolDetailView` |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/pools/:slug/form-c` | public | `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/portfolio` | user | `layer2` |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/provider` | verified (own profile) | `marketplace` | `{ provider: MyProvider \| null }` |  | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| PUT | `/api/v1/provider` | verified (own profile) | `marketplace` | `ProviderProfileInput` → `{ provider: MyProvider }` | editing vetted fields of a `listed` provider sends it back to review | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| PUT | `/api/v1/provider/listings` | verified (own profile) | `marketplace` | `ListingInput[]` → `{ provider: MyProvider }` | ≤ 10 listings; rows with an `id` update in place | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| GET | `/api/v1/provider/requests` | verified (provider) | `marketplace` | `{ items: ServiceRequestView[] }` | requester email only after accept and with consent | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/provider/requests/:id/respond` | verified (provider) | `marketplace` | `RespondInput` → `ServiceRequestView` | once per request | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/provider/submit` | verified (own profile) | `marketplace` | `{ provider: MyProvider }` | to staff review | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| GET | `/api/v1/services` | public | `marketplace` | `ServiceList` | no money in MKT-1 (ADR-010) | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| GET | `/api/v1/services/providers/:slug` | public | `marketplace` | `ProviderPage` | listed providers only | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| GET | `/api/v1/services/requests` | verified | `marketplace` | `{ items: ServiceRequestView[] }` |  | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/services/requests` | verified (artist) | `marketplace` | `ServiceRequestInput` → `ServiceRequestView` | daily limit; one open request per listing | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/services/requests/:id/withdraw` | verified (requester) | `marketplace` | `ServiceRequestView` |  | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/staff/actions/:id/cancel` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/staff/agents/metrics` | staff (aal2) | — |  |  | [AGT §5](../specs/agents/02-design.md#5-staff-api-appsapisrcroutesstaffts-additions) |
| GET | `/api/v1/staff/agents/proposals` | staff (aal2) | — |  |  | [AGT §5](../specs/agents/02-design.md#5-staff-api-appsapisrcroutesstaffts-additions) |
| POST | `/api/v1/staff/agents/proposals/:id/verdict` | staff (aal2) | — |  | privileged action | [AGT §5](../specs/agents/02-design.md#5-staff-api-appsapisrcroutesstaffts-additions) |
| POST | `/api/v1/staff/backings/:id/refund` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/campaigns/:id/review` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/flags/:flag` | staff (aal2) | — |  | privileged `flag.set`; `:flag` ∈ `layer2`, `agents`, `marketplace` | [M1 §4.2](../specs/02-design.md#42-endpoints), [AGT §5](../specs/agents/02-design.md#5-staff-api-appsapisrcroutesstaffts-additions) |
| GET | `/api/v1/staff/l2/investors` | staff (aal2) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/investors/:userId/kyc` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pool-breaks/:id/resolve` | staff (aal2) | mock Reg CF (completion) |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pool-ops/:id/replay` | staff (aal2) | mock Reg CF (completion) |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pool-tranches/:id/verify` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/staff/l2/pools` | staff (aal2) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/collection-state` | staff (aal2) | mock Reg CF (completion) |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/collection/execute` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/deposits` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/distributions/commit` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/distributions/dry-run` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/staff/l2/pools/:id/form-c` | staff (aal2) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/staff/l2/pools/:id/money` | staff (aal2) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/recon` | staff (aal2) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/staff/l2/pools/:id/review` | staff (aal2) | `layer2` |  | privileged action | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/staff/l2/queue` | staff (aal2) | mock Reg CF (completion) |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| GET | `/api/v1/staff/marketplace/providers` | staff (aal2) | `marketplace` | `?status=` |  | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/staff/marketplace/providers/:id/review` | staff (aal2) | `marketplace` | `ProviderReviewInput` | privileged `provider.review`; reviewer ≠ owner | [MKT §3](../specs/marketplace/02-design.md#3-api) |
| POST | `/api/v1/staff/outbound-ops/:id/replay` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/provider-events/:id/replay` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/staff/queue` | staff (aal2) | — | `StaffQueueType` (query) |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/staff/recon/latest` | staff (aal2) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/recon/override` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/recon/run` | staff (aal2) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/staff/trace/:cid` | staff (aal2) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/tranches/:id/verify` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| GET | `/api/v1/staff/weekly-review` | staff (aal2) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/staff/weekly-review/signoff` | staff (aal2) | — |  | privileged action | [M1 §4.2](../specs/02-design.md#42-endpoints) |
| POST | `/api/v1/webhooks/regcf` | signed (mock escrow) | 404 without Reg CF provider |  |  | [L2 §9](../specs/l2/02-design.md#9-api-surface-behind-the-layer2-gate-except-where-noted) |
| POST | `/api/v1/webhooks/stripe` | signed (Stripe) | — |  |  | [M1 §4.2](../specs/02-design.md#42-endpoints) |
<!-- routes:end -->

## Clients
- **Web** (`apps/web/src/lib/api.ts`) and **mobile** (`apps/mobile`) call the API only through `createApiClient` in `packages/shared/src/api-client.ts` (ADR-009). A route a client needs gets a typed method there, not an ad-hoc `fetch`.
- **Staff and Layer 2 screens** on the web still call some routes directly through `request` (the shared client's generic call, `apps/web/src/lib/api.ts`); those paths must also appear above.

## Change log
- 2026-11-27: CR-005 (PR #27): 13 services-marketplace routes behind `flag.marketplace`; `marketplace` added to `POST /staff/flags/:flag`.
- 2026-11-27: Created from the registered routes (84) during the SDD documentation audit; added the CI drift test.
