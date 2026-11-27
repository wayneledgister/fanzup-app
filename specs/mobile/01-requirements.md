# Mobile app, Phase MOB-1 (CR-004) — Requirements
**Tier:** Enterprise (inherits v2) · **Status:** G1+G2 combined self-review (`02-design.md` §10) · **Date:** 2026-11-27
**Authority:** [CR-004](../changes/CR-004-mobile-app.md).
**Priorities:** P0 = in MOB-1. P1 = later mobile phase (backlog).

The mobile app is a second client of the same API as the web app. Every requirement below that names an M1 FR means "the mobile client meets that FR's M1 line in `../01-requirements.md`, through the same API". Nothing here relaxes an M1 or P0a requirement for the web app.

## 1. Fan flows (FR-MOB)

### FR-MOB-001: Discover campaigns
**Story:** As a fan on my phone, I want to browse live and funded campaigns, so that I can find one to back.
**Acceptance criteria:**
- Given the app is open, then the Explore tab lists campaigns from `GET /v1/campaigns` with tabs Live / Funded, in the API's order (never re-ordered by money; FR-CMP-008).
- Each card shows title, artist, raised and goal in USD, backers and time left.
- Given more pages exist (`nextCursor`), when the fan scrolls to the end, then the next page loads.
- Given the API is unreachable, then the screen says so and offers Retry; pull-to-refresh reloads.
**Priority:** P0 · **Parity:** FR-CMP-008

### FR-MOB-002: Campaign page
**Story:** As a fan, I want to see a campaign's story, perks and milestones, so that I can decide to back it.
**Acceptance criteria:**
- Renders only the artist's own fields from `GET /v1/campaigns/:slug`; empty sections are hidden (FR-CMP-003).
- Shows funding progress, deadline in the fan's time zone ("hours and minutes left" under 24 hours; FR-BCK-004), milestone tranches with dates, and the escrow promise.
- Each perk shows price, delivery date and remaining stock; sold-out perks can't be picked; a closed campaign has no Back button.
- Opening `fanzup://campaigns/<slug>` opens this screen.
**Priority:** P0 · **Parity:** FR-CMP-003, FR-BCK-004

### FR-MOB-003: Account: sign up, log in, sign out, reset password
**Story:** As a fan, I want a real FanZuP account on my phone, the same one I use on the web.
**Acceptance criteria:**
- Sign up with name, email, password, 18+ attestation and acceptance of the current Terms/Privacy versions from `GET /v1/config.legal` (FR-ID-006 bullet 1, FR-PRV-001). The server rejects sign-up without them, as on the web.
- After sign-up the app says a verification link was emailed; the link opens the web app, which confirms the email. Back in the app, "I've verified" refreshes the session and continues to where the fan was going (FR-BCK-002).
- Log in with email + password; log out; "Forgot password" sends the reset email (the reset itself happens on the web, FR-ID-001 M1 line).
- The session is stored in the device's secure storage (Keychain / Keystore), never in plain storage (NFR-MOB-02).
**Priority:** P0 · **Parity:** FR-ID-001, FR-ID-006, FR-PRV-001, FR-BCK-002

### FR-MOB-004: Back a campaign (checkout)
**Story:** As a fan, I want to back a campaign in the app with my card, with the same protections as on the web.
**Acceptance criteria:**
- Given a signed-out fan taps Back, then they're asked to sign up or log in, and come back to the same campaign and perk (FR-BCK-002).
- One screen shows perk, delivery date, quantity (1–10, capped at stock), total in USD, when the card is charged, and the refund promise (FR-BCK-001).
- Re-acceptance of new Terms/Privacy is asked before backing when `GET /v1/me.needsAcceptance` is non-empty (FR-PRV-001).
- The backing is created with `POST /v1/backings` and an Idempotency-Key that follows the shared rule (`@fanzup/shared/checkout-key`): a retry resumes the same backing; any stored 4xx or a dead backing mints a new key (FR-PAY-006).
- The perk-hold countdown shows; at zero the fan is told nothing was charged and can start again (FR-PAY-001).
- Card details are taken by Stripe's PaymentSheet (stripe-test provider) and never pass through FanZuP code. With the sandbox provider (local/CI), a clearly labelled sandbox form stands in.
- After the card step the app polls `GET /v1/backings/:id` until the backing is paid or dead, exactly as the web does; it never decides on its own that a payment succeeded.
- Failure messages use the same categories and wording as the web (`@fanzup/shared/checkout-flow`), including "you won't be charged twice" for unconfirmed payments.
- The confirmation states amount, deadline, what happens if the goal is or isn't reached, and offers Share and My backings.
**Priority:** P0 · **Parity:** FR-BCK-001, FR-BCK-002, FR-PAY-001, FR-PAY-006, FR-PRV-001

### FR-MOB-005: My backings
**Story:** As a fan, I want to see every backing, where the money is, and what happens next.
**Acceptance criteria:**
- Lists `GET /v1/me/backings` with campaign status, money state (same labels as the web, `@fanzup/shared/backing-copy`), perk status, next event, and refund amount/date/reference when refunded (FR-BCK-005, FR-PAY-009 fan view).
- Empty, loading and error states; pull-to-refresh.
**Priority:** P0 · **Parity:** FR-BCK-005, FR-PAY-009

### FR-MOB-006: Test-money notice
**Story:** As a fan, I must know that this beta uses test money.
**Acceptance criteria:**
- Whenever `GET /v1/config.testMode` is true, Explore, campaign, checkout, confirmation and My backings show the test-mode notice (FR-PLT-006).
**Priority:** P0 · **Parity:** FR-PLT-006

### FR-MOB-007: Account tab
**Story:** As a fan, I want to see who I'm signed in as, reach help and legal pages, and sign out.
**Acceptance criteria:**
- Shows name and email when signed in; Log in / Sign up when not.
- Links to Terms, Privacy, Fees, How money moves (Trust) and Support open the web pages in an in-app browser.
- Shows the app version and environment (API host) for support.
**Priority:** P0

### FR-MOB-008: Same account, same data on web and phone
**Story:** As a fan, I want what I do on my phone to show on the web and the other way round.
**Acceptance criteria:**
- The app uses the same Supabase project and API as the web build it's paired with (configured per EAS profile), so a backing made on one client appears in My backings on the other.
**Priority:** P0

### FR-MOB-009: Account deletion before public store release
**Story:** As Apple and Google require, a fan who signs up in the app must be able to start deleting their account from the app.
**Acceptance criteria:**
- Until FR-PRV-003 is built (P0b), the app is distributed only on internal test tracks (TestFlight internal testers, Google Play internal testing). The store-submission checklist (`02-design.md` §9) blocks public submission on it.
- When FR-PRV-003 ships, the Account tab gains "Delete my account" that uses it.
**Priority:** P0 (the gate); the in-app action is P0b with FR-PRV-003

## 2. Non-functional (NFR-MOB)

### NFR-MOB-01: The API is the only path to money
The app holds no money logic and no provider secret. It never writes to Supabase tables directly (NFR-SEC-02); it reads its session from Supabase Auth and does everything else through the API. The only payment code on the device is Stripe's SDK presenting a PaymentIntent the API created.

### NFR-MOB-02: Secrets and storage
- The bundle contains only public values: API base URL, Supabase URL and anon key, Stripe publishable key comes from `GET /v1/config` at runtime.
- The auth session is kept in `expo-secure-store` (chunked to fit its per-item limit). Checkout Idempotency-Keys are kept in memory for the life of the app process (the web keeps them for the tab session).

### NFR-MOB-03: No Layer 2 in the mobile app
No securities surface (Pools, investing, holdings, Form C) is built or reachable in MOB-1, whatever the server flags say. Copy rules for Layer 1 apply to every mobile screen, enforced by `pnpm lint:copy`.

### NFR-MOB-04: One set of business rules
Rules both clients need live in `@fanzup/shared` with unit tests there: API client and error type, checkout failure categories, dead-backing and paid-status rules, hold announcements, money-state copy, formatting. A rule change is made once.

### NFR-MOB-05: Accessibility
Touch targets ≥ 44 pt; every control has an accessibility label and role; money and time values are readable by VoiceOver/TalkBack; the hold countdown announces only at 5 minutes, 1 minute and expiry (shared `holdAnnouncement`).

### NFR-MOB-06: Brand
Same tokens as the web (`apps/web/src/styles/index.css`): dark canvas, gold for the one primary action per screen, never white text on gold, numbers in the mono face. Mobile-first 16 pt gutters.

### NFR-MOB-07: Buildable without a Mac toolchain
The app runs in Expo Go for day-to-day testing and builds store binaries on EAS Build (cloud). No local Xcode or Android Studio is required. CI proves the JS bundles for iOS and Android on every PR.

### NFR-MOB-08: Web stays fully supported
The shared-code move changes no web behaviour: web typecheck, unit tests, copy rules, build and the e2e golden journey stay green.

## 3. Out of scope for MOB-1 (backlog)
Push notifications (needs FR-NTF provider + device tokens API), artist/creator flows, staff console, Apple Pay / Google Pay in PaymentSheet (needs merchant ids), universal links / App Links (needs a production domain), Layer 2, offline cache, in-app account deletion (with FR-PRV-003).

## Change notes
- 2026-11-27: created for CR-004.
