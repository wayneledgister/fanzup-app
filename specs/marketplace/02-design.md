# Artist services marketplace, Phase MKT-1 (CR-005) — Design
**Implements:** `01-requirements.md` · **ADR:** [ADR-010](../../docs/adr/ADR-010-services-marketplace-money-boundary.md) · **Date:** 2026-11-27

## 1. Shape
A new module beside campaigns, in the existing apps. No new service, no new partner, no new secret.

```
apps/api/src/marketplace/        routes.ts (flag gate, public, artist, provider, staff routes) · service.ts (`provider.review` executor)
supabase/migrations/20261127000100_marketplace.sql
packages/shared/src/marketplace.ts   categories, schemas, copy, status rules (web + mobile + API)
apps/web/src/pages/services/*    Browse, Provider, MyRequests, ProviderEditor, ProviderInbox
apps/mobile/app/(tabs)/services.tsx · app/services/[slug].tsx · app/services/requests.tsx
```

## 2. Data model (migration `20261127000100_marketplace.sql`)
| Table | Key columns | Notes |
|---|---|---|
| `service_providers` | `owner_id` (unique → profiles), `slug` (unique), `display_name`, `headline`, `bio`, `city`, `remote_ok`, `categories text[]`, `links text[]`, `contact_email`, `status`, `review_note`, `submitted_at`, `reviewed_at`, `reviewed_by`, `listed_at` | `status in (draft, in_review, changes_requested, listed, suspended)`; `categories` checked against `marketplace_categories()` |
| `service_listings` | `provider_id`, `category`, `title`, `description`, `price_from_minor`, `price_unit`, `turnaround_days`, `active`, `position` | saved as a set: rows sent with an `id` update in place (open requests keep their link), rows without one are added, missing ones removed; ≤ 10 per provider (API) |
| `service_requests` | `listing_id`, `provider_id`, `requester_id`, `artist_id`, `campaign_id` (nullable), `brief`, `budget_minor`, `needed_by`, `share_email`, `requester_email` (snapshot only when `share_email`), `status`, `provider_note`, `responded_at` | `status in (sent, accepted, declined, withdrawn)`; partial unique index: one `sent` request per (artist, listing) |

- `flag.marketplace` row + `public.marketplace_enabled()` (same shape as `flag.agents`).
- RLS enabled on all three tables; `revoke all` from `anon, authenticated` (NFR-MKT-03). The API reads and writes with `asService` and checks ownership in every query's `where` clause (owner_id = verified user). There are no SQL money functions and no ledger references (NFR-MKT-01; a test checks the migration text).
- Audit: request state changes and provider submissions write `audit_events` with ids only.

## 3. API
All under `/api/v1`, all behind the flag gate in `routes.ts` (404 `marketplace_disabled` when the flag is off). Every route is also indexed in [`docs/API.md`](../../docs/API.md) (access, gate, shared contract), which CI checks against the registered routes.

| Route | Who | Does |
|---|---|---|
| `GET /services?category&q&remote&cursor` | anyone | FR-MKT-005 |
| `GET /services/providers/:slug` | anyone | FR-MKT-006 |
| `POST /services/requests` | verified artist | FR-MKT-007 |
| `GET /services/requests` | verified user | FR-MKT-010 |
| `POST /services/requests/:id/withdraw` | requester | FR-MKT-010 |
| `GET /provider` · `PUT /provider` · `PUT /provider/listings` · `POST /provider/submit` | verified user | FR-MKT-003/004 |
| `GET /provider/requests` · `POST /provider/requests/:id/respond` | provider | FR-MKT-009 |
| `GET /staff/marketplace/providers?status` · `POST /staff/marketplace/providers/:id/review` | staff (aal2) | FR-MKT-008, privileged `provider.review` |
| `POST /staff/flags/marketplace` | staff (aal2) | FR-MKT-001, privileged `flag.set` |

- Editing a `listed` provider's public fields (`display_name`, `headline`, `bio`, `categories`, listings) moves it back to `in_review` and hides it until staff list it again. Editing `contact_email`, `city`, `remote_ok`, `links` does not (*decision, reviewable:* those don't change what staff vetted for; links do change, so links **do** trigger re-review). 
- Contact reveal (FR-MKT-009) is computed in the response for the counterpart only: `providerContactEmail` on the artist's accepted requests; `requesterEmail` on the provider's accepted requests when `share_email`.
- Rate limit (FR-MKT-007): count of the user's requests created since UTC midnight, checked in the same transaction as the insert under a per-user advisory lock.
- Staff review is optimistic: the queue returns a `version` (from `updated_at`), the review must send it back, and the executor refuses with 409 `provider_changed` if the profile or its listings changed since. Slugs that are routes under `/services` (`requests`, `new`, …) are reserved in the schema and the table check.
- Suspension (FR-MKT-008): the executor updates the provider and, in the same transaction, declines its `sent` requests with the fixed note.
- `GET /v1/config.flags.marketplace` reports the flag.

## 4. Shared package (`@fanzup/shared/marketplace`)
`MARKETPLACE_CATEGORIES` (key + label), `PRICE_UNITS`, zod schemas for every request body (`ProviderProfileInput`, `ListingInput`, `ServiceRequestInput`, `RespondInput`, `ProviderReviewInput`), response types, `priceFromLabel()`, `requestStatusCopy()`, `providerStatusCopy()`, and the off-platform notice. The API parses bodies with the same schemas both clients use for inline validation, so a rule changes once.

## 5. Web
Five pages under the existing layout, composed from `@/components/brand` (BUILD_CONVENTIONS). Gated with `useFlag('marketplace')`, which for this flag is the server's `cfg.flags.marketplace` only (no client override in production builds, same rule as `layer2`). Nav entry "Services" appears only when on.

## 6. Mobile
A `services` tab (hidden via `href: null` when the flag is off), a provider screen with the request form, and "My service requests" linked from Account. Uses the shared API client and schemas.

## 7. Money boundary (MKT-2 outline, not built)
See ADR-010. In short: a booking will be a ledger subject like a backing; the artist pays through the `PaymentProvider` adapter; funds sit in a booking-held account until the artist confirms delivery (or a dispute is decided), then a two-phase outbound transfer pays the provider's connected payout account; the FanZuP fee (if any) is a separate ledger line. Which legal flow of funds is allowed (processor-led marketplace with the processor as licensed party, custodian, or referral only) is counsel's answer (MKT-Q1…Q4), and the fee is Wayne's decision.

## 8. Copy
- "Starting at $X per song" for prices; never "fee", "deposit", "charge", "escrow", "protected".
- Request confirmation and provider page carry `MKT_OFF_PLATFORM_NOTICE`: "FanZuP doesn't handle payment for services yet. You agree the price, terms and payment directly with the provider."
- `lint:copy` scans the new web pages and mobile screens (they're under the existing scanned roots).

## 9. Testing
- API (`apps/api/test/marketplace.test.ts`, real Postgres): flag off → 404 everywhere; provider lifecycle (draft → submit → staff list → visible); edit re-review; staff can't review own profile; aal1 staff refused; browse filters and no contact leak; request rules (artist needed, own provider refused, duplicate open refused, daily limit); respond once; contact reveal only after accept and only with consent; withdraw; suspension declines open requests; RLS denies `anon`/`authenticated` direct reads; the migration adds no money objects.
- Shared: schemas and copy helpers (unit), category list matches the database (API test).
- Web/mobile: typecheck, `lint:copy`, build/export in CI.

## 10. Manual steps (Wayne)
- ~~Decide the fee model and the MKT-2 payment path~~ Decided 2026-11-27: counsel first, then in-app; free in beta (CR-005 D-MKT-1/2).
- Recruit the first providers for experiment E2 (discovery).
- Counsel: add MKT-Q1…Q8 to the existing custody/MTL engagement.
- Provider Terms and a privacy-notice update before the flag is turned on for real users.

## 11. G1+G2 self-review (combined, CR-005)
| Check | Result |
|---|---|
| Every P0 FR has a route/page and a test | Yes (§3, §9) |
| Money path untouched | Yes: no ledger, provider or campaign-balance code; asserted by test (NFR-MKT-01) |
| Flag off in production | Yes: default false, privileged to change |
| Personal data minimised | Contact only after accept, email only with consent (NFR-MKT-04) |
| Store rules | Services performed outside the app aren't in-app purchases; MKT-1 has no payment at all |
| Open risks | Two-sided cold start (discovery A1/A2); counsel on MKT-2; staff review load (single operator) |

## 12. Closed beta (CR-007, ADR-012)
### 12.1 Data (migration `20261128000100_marketplace_beta.sql`)
| Object | Key columns / value | Notes |
|---|---|---|
| setting `marketplace.audience` | `"invited"` \| `"open_requests"` \| `"everyone"` | read by `public.marketplace_audience()`; written only by the `marketplace.audience` executor |
| `marketplace_invites` | `id`, `code_hash` (unique, SHA-256 hex), `email` (citext), `name`, `kind` (`provider`\|`artist`), `note`, `created_by`, `expires_at`, `redeemed_by`, `redeemed_at`, `revoked_at` | partial unique index: one open invite per email |
| `marketplace_members` | `user_id` (pk → profiles), `kind`, `invite_id`, `joined_at`, `removed_at`, `removed_by` | `removed_at` set = no access; re-inviting a removed member reactivates the row |
| `consents.kind` | adds `provider_terms` | append-only as before |

RLS on, nothing granted to `anon`/`authenticated` (NFR-MKT-03). No money objects (NFR-MKT-01; the migration test reads both marketplace migrations).

### 12.2 Access (`apps/api/src/marketplace/access.ts`)
`accessFor(sql, user | null)` → `{ audience, member, staff, canBrowse, canRequest, canProvide }`:

| Audience | canBrowse | canRequest | canProvide |
|---|---|---|---|
| `invited` | member or staff | member | member of kind `provider` |
| `open_requests` | signed in and verified | signed in (verified on the route) | member of kind `provider` |
| `everyone` | anyone | signed in | signed in |

`canRequest`/`canProvide` still need a verified email and (for requests) an artist profile, as before. Route checks: browse and provider page → `canBrowse` (an invalid or expired token counts as signed out there); `POST /services/requests` → `canRequest`; reading your own requests (`GET /services/requests`) and withdrawing one need only ownership, so someone removed from the beta can still see and close what they sent; `PUT /provider` creating a profile and `POST /provider/submit` → `canProvide` + current Provider Terms; `POST /provider/requests/:id/respond` → current Provider Terms (a removed member who still has a listed profile can answer requests already sent to them until staff suspend it). `GET /provider`, `PUT /provider` on an existing profile, `PUT /provider/listings` and the inbox need only the owner. `GET /services/access` and `POST /services/join` sit behind the flag only.

### 12.3 Invites
- Code: 18 random bytes, base64url (24 characters). The route hashes it and passes only the hash and invite id to `privileged()`, so `privileged_actions.params` never holds the code (NFR-MKT-08); the route returns the code after the action executes.
- Redemption runs in one transaction: lock the invite row by hash, check open and unexpired, compare `lower(invite.email)` with `public.marketplace_requester_email(user)`, mark redeemed, upsert the member (`provider` wins over `artist`), audit `marketplace.member.joined`.

### 12.4 Provider Terms and the launch guard
- `POLICY.legal.providerTerms = { version, approved }` and `POLICY.legal.privacyCoversMarketplace`. `POST /me/acceptances` accepts `{ kind: "provider_terms", version }` and checks it against the current version.
- `hasProviderTerms(tx, user)`: a `consents` row of kind `provider_terms` with the current version.
- `POST /staff/flags/marketplace {on: true}` in a deployed environment (`env.deployed`) refuses with 409 `legal_not_ready` unless both values are true. The check runs before `privileged()`, so a refusal leaves no failed action.

### 12.5 Staff routes
| Route | Does |
|---|---|
| `POST /staff/marketplace/audience` | `{ audience, reason }` → privileged `marketplace.audience` |
| `GET /staff/marketplace/invites` · `POST /staff/marketplace/invites` · `POST /staff/marketplace/invites/:id/revoke` | FR-MKT-022 |
| `GET /staff/marketplace/members` · `POST /staff/marketplace/members/:userId/remove` | FR-MKT-027 |
| `GET /staff/marketplace/metrics` | FR-MKT-028 |

### 12.6 Web
- `useMarketplaceAccess()` reads `/services/access` (cached per session, refetched after join and sign-in); nav entries use `canBrowse`.
- `/services/join`: signed out → sign-in link with `next` back to the join page; signed in → redeem, then go to `/provider` (provider invite) or `/services`.
- `/provider`: the Provider Terms card appears above the form until the current version is accepted; save/submit buttons stay disabled until then.
- `/admin/marketplace`: audience switch (with reason), invite form (shows the link once, with a copy button), invite and member tables, metrics tiles.

### 12.7 Mobile
The Services tab hides unless `/services/access.canBrowse` (was `config.flags.marketplace`). No new screens (CR-007: mobile deprioritised).

## Change log
- 2026-11-27: first version (CR-005, PR #27).
- 2026-11-27: SDD documentation audit: §1 names the files as built (no `gate.ts`: the gate lives in `routes.ts`; the `provider.review` executor in `service.ts`); §3 points at `docs/API.md`.
- 2026-11-27: code-review fixes (PR #27): stable listing ids, review version token, reserved slugs, unique-race errors map to 409, needed-by date allows for time zones west of UTC.
- 2026-11-27: §12 closed beta (CR-007, ADR-012): audience setting, invites, members, Provider Terms acceptance, launch guard, staff beta page.
