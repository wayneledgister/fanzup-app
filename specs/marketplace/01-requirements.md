# Artist services marketplace, Phase MKT-1 (CR-005) — Requirements
**Tier:** Enterprise (inherits v2) · **Status:** G1+G2 combined self-review (`02-design.md` §11) · **Date:** 2026-11-27
**Authority:** [CR-005](../changes/CR-005-services-marketplace.md) · **Discovery:** [`discovery.md`](discovery.md)
**Priorities:** P0 = in MKT-1. P1 = MKT-2 (paid bookings, counsel-gated). P2 = MKT-3 (reviews, campaign integration, messaging).

MKT-1 moves **no money**. Prices on listings are "starting at" guides for the conversation; the artist and provider agree terms and pay each other outside FanZuP until MKT-2 exists. Web and native mobile are both first-class (CR-004): every P0 artist-facing requirement below is met on both, through the same API.

## 1. Roles
- **Artist (buyer):** a signed-in, email-verified user who owns an artist profile (FR-CMP-001).
- **Provider (seller):** a signed-in, email-verified user who creates a provider profile. A person can be both an artist and a provider. One provider profile per user in MKT-1.
- **Staff:** reviews providers before they're listed (FR-ID-002 staff rules: aal2, typed reason, audit).
- **Visitor:** anyone, signed in or not, while the flag is on.

## 2. Functional requirements (FR-MKT)

### FR-MKT-001: Flag
**Story:** As the operator, I want the whole marketplace dark until I turn it on.
- `flag.marketplace` in `platform_settings`, default **false**; changed only by the staff flag route (privileged, audited; FR-PLT-001).
- Off: every marketplace route answers 404 `marketplace_disabled`, `GET /v1/config.flags.marketplace` is false, and neither the web nor the mobile app shows a marketplace entry point.
**Priority:** P0

### FR-MKT-002: Categories
- A fixed list shared by API, web and mobile (`@fanzup/shared/marketplace`): `production` Production & beats, `mixing_mastering` Mixing & mastering, `session_musicians` Session musicians & vocals, `songwriting` Songwriting, `video` Music video & film, `photography` Photography, `design` Artwork & design, `marketing_pr` Marketing & PR, `live_support` Tour & live support, `other` Other.
- Paid playlist or streaming placement is not a category (see §4).
- The database checks the same list (a test keeps them in sync).
**Priority:** P0

### FR-MKT-003: Provider profile
**Story:** As a provider, I want a profile that shows who I am and what I do, so artists can find me.
- Fields: slug (unique), display name, headline (≤ 120), bio (≤ 2000), city, works remotely (yes/no), categories (1–5 from FR-MKT-002), up to 5 portfolio links (https only), contact email (shown only per FR-MKT-007).
- States: `draft` → `in_review` (submitted) → `listed` | `changes_requested`; `listed` → `suspended` (staff) or back to `in_review` when the provider edits a listed profile's public fields. Only `listed` profiles are visible to anyone but the owner and staff.
- The provider sees their status and any staff note.
**Priority:** P0

### FR-MKT-004: Listings
**Story:** As a provider, I want to list specific services with a starting price and turnaround.
- 1–10 listings per provider: category (one of the provider's), title (3–90), description (≤ 2000), starting price in USD cents (optional, ≥ 0, ≤ $100,000) with unit (per project / per song / per hour / per day), typical turnaround in days (optional, 1–365), active yes/no.
- Listings are replaced wholesale (like perks). A provider needs at least one active listing to submit for review.
- Prices are labelled "Starting at" and never as a fee, deposit or charge.
**Priority:** P0

### FR-MKT-005: Browse and search
**Story:** As an artist, I want to find providers by what I need.
- `GET /v1/services` lists listed providers' active listings; filters: category, text (title, headline, provider name), remote-only; paged by cursor (20 per page).
- Order: most recently listed first. **Never** ranked by price paid, money raised, or any paid placement in MKT-1.
- Each result shows provider name, headline, city or "Remote", listing title, category, starting price and turnaround.
- Signed-out visitors can browse; requesting needs sign-in.
**Priority:** P0

### FR-MKT-006: Provider page
- `GET /v1/services/providers/:slug` shows a listed provider's profile, active listings and portfolio links (opened in the system browser, never embedded).
- Unknown, unlisted or suspended slugs answer 404.
**Priority:** P0

### FR-MKT-007: Send a service request
**Story:** As an artist, I want to tell a provider what I need and when, so they can say yes or no.
- Needs a verified user with an artist profile (`no_artist` otherwise, with a link to create one).
- Fields: listing, brief (20–4000), budget in USD cents (optional, display only), needed-by date (optional, future), one of the artist's own campaigns (optional; integration hook for MKT-3), and an explicit choice to share the requester's account email with the provider **if they accept**.
- A provider can't receive a request from their own account. One open request per artist per listing. At most `POLICY.marketplace.requestsPerDay` (10) new requests per user per UTC day.
- The confirmation says plainly that FanZuP doesn't take payment for services yet and that terms and payment are agreed directly with the provider (`MKT_OFF_PLATFORM_NOTICE`).
**Priority:** P0

### FR-MKT-008: Staff vetting
**Story:** As staff, I want to approve providers before artists see them, so the directory stays trustworthy.
- `GET /v1/staff/marketplace/providers?status=in_review` lists the queue with listings.
- `POST /v1/staff/marketplace/providers/:id/review` with decision `listed` | `changes_requested` | `suspended`, a note (required unless listing), and a typed reason: a privileged action `provider.review` (aal2, audited). Staff can't review their own provider profile.
- Suspending a provider hides it at once; open requests to it are closed as `declined` with the note "This provider is no longer listed."
**Priority:** P0

### FR-MKT-009: Provider inbox and response
**Story:** As a provider, I want to see requests and accept or decline them.
- `GET /v1/provider/requests` lists requests to the provider, newest first, with the brief, budget, needed-by date, artist name and linked campaign title.
- Accept or decline with an optional note (≤ 1000). Only `sent` requests can be answered; answering twice is refused.
- On accept, each side sees the other's contact: the provider's contact email to the artist, and the artist's account email to the provider only if the artist chose to share it (FR-MKT-007). On decline, nothing is shared.
**Priority:** P0

### FR-MKT-010: My requests (artist)
- `GET /v1/services/requests` lists the artist's requests with status, provider, listing, response note, and the provider contact once accepted.
- The artist can withdraw a `sent` request.
**Priority:** P0

### FR-MKT-011: Web
- Routes: `/services` (browse), `/services/:slug` (provider page with request form), `/services/requests` (artist's requests), `/provider` (provider profile + listings editor, status), `/provider/requests` (inbox).
- Entry points (only when the flag is on): "Services" in the main nav and on the artist dashboard.
**Priority:** P0

### FR-MKT-012: Mobile
- A "Services" tab (browse + search + category chips), provider screen with request form, and "My requests" under Account. Provider editing and the inbox stay web-only in MKT-1 (P2 on mobile).
- The tab is hidden unless `GET /v1/config.flags.marketplace` is true.
**Priority:** P0

### FR-MKT-013 … 020 (later phases)
| ID | What | Priority |
|---|---|---|
| FR-MKT-013 | Quotes: provider sends a fixed quote with deliverables and dates against a request | P1 |
| FR-MKT-014 | Paid bookings through the API, ledger and payment adapter; hold until delivery if counsel allows (ADR-010) | P1 (needs MKT-Q1…Q4) |
| FR-MKT-015 | Provider payout onboarding, tax info and sanctions screening before any payout | P1 |
| FR-MKT-016 | Disputes and refunds on bookings | P1 |
| FR-MKT-017 | Reviews and ratings after a completed booking only, FTC 16 CFR 465 compliant | P2 |
| FR-MKT-018 | Link a booking to a campaign tranche as milestone evidence; provider credits on the campaign page | P2 |
| FR-MKT-019 | In-app message threads and notifications (email + push) | P2 |
| FR-MKT-020 | Provider editing and inbox on mobile | P2 |

## 3. Non-functional requirements (NFR-MKT)
| ID | Requirement | Priority |
|---|---|---|
| NFR-MKT-01 | **No money in MKT-1.** No marketplace code calls the payment provider, writes the ledger, or reads campaign balances. A test asserts the marketplace migration adds no ledger account kind and no money function. | P0 |
| NFR-MKT-02 | When money comes (MKT-2), it goes only through the API, the ledger and the `PaymentProvider` adapter (ADR-003, ADR-010); clients never compute or move money. | P1 |
| NFR-MKT-03 | Marketplace tables have RLS on with no `anon`/`authenticated` grants; all access goes through the API, which checks ownership. | P0 |
| NFR-MKT-04 | Contact details are never in list or page responses; only the accepted counterpart sees them (FR-MKT-009). Requests and contact emails are personal data (privacy notice update, FR-PRV). | P0 |
| NFR-MKT-05 | Copy rules apply (`pnpm lint:copy` covers the new pages and the mobile app): no investment words, no invented fees, no "escrow" or "protected payment" for services. | P0 |
| NFR-MKT-06 | Accessibility and layout as the rest of the app (WCAG 2.2 AA, 390 px, 44 px targets). | P0 |
| NFR-MKT-07 | Every staff decision is a privileged action with an audit event; every request state change writes an audit event with ids only (NFR-COMP-11). | P0 |

## 4. Out of scope and why
- **Paid playlist placement / streaming promotion:** pay-for-placement breaks most DSP terms; excluded as a category.
- **Payments, deposits, holds, fees:** MKT-2, after counsel (discovery MKT-Q1…Q4) and Wayne's fee decision.
- **Fans hiring providers:** not in MKT-1.
