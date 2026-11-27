# Mobile app, Phase MOB-1 (CR-004) — Design
**Implements:** `01-requirements.md` · **ADR:** [ADR-009](../../docs/adr/ADR-009-mobile-app.md) · **Date:** 2026-11-27

## 1. Shape
```
apps/web     (Vite + React DOM)  ─┐
                                  ├─ @fanzup/shared  (schemas, API client, checkout rules, copy, formatting)
apps/mobile  (Expo + React Native)┘        │
                                           ▼
                                apps/api  (Fastify, unchanged)  →  Postgres / Stripe / Supabase Auth
```
- `apps/mobile` is an Expo SDK 58 app (React Native 0.88, React 19.3 — the same React as the web), using Expo Router for file-based navigation.
- Both clients talk to the same API with the same bearer token from Supabase Auth. The app adds no endpoint.

## 2. Shared code (NFR-MOB-04)
Moved out of the web app into `packages/shared/src`, platform-neutral (no DOM, no React):

| Module | Contents | Was |
|---|---|---|
| `api-client.ts` | `ApiError`, `createApiClient({ baseUrl, getAccessToken, fetch? })` → `config, campaigns, campaign, me, accept, back, backing, myBackings, event, sandboxPay` | `apps/web/src/lib/api.ts` |
| `checkout-flow.ts` | `Failure`, `categorize`, `deadReason`, `PAID_STATUSES`, `EXPIRED`, `UNCONFIRMED`, `holdAnnouncement`, `holdSecondsLeft`, `acceptanceDocuments`, `waitForCapture` (poll loop with injected sleep), `PHYSICAL_PERK_NOTE` | `apps/web/src/pages/fan/Checkout.tsx` |
| `backing-copy.ts` | money-state labels/tones/help, campaign-status labels | `apps/web/src/pages/fan/BackedAndPerks.tsx` |
| `format.ts` | `formatMoney`, `formatUsd`, `formatNumber`, `formatPercent`, `parseDate`, `formatDate`, `daysUntil`, `formatInstant`, `timeLeft` | `apps/web/src/lib/format.ts` |

The web files keep their export names (they re-export from shared), so no other web import changes. `checkout-key.ts`, `policy.ts`, `schemas.ts`, `copy-rules.ts` were already shared.

## 3. App structure
```
apps/mobile/
  app.config.ts          name, scheme "fanzup", bundle ids, env → extra
  eas.json               development / preview / production profiles
  app/                   Expo Router routes
    _layout.tsx          providers (Session, Config, Stripe), stack
    (tabs)/_layout.tsx   tabs: Explore, Backed, Account
    (tabs)/index.tsx     FR-MOB-001
    (tabs)/backed.tsx    FR-MOB-005
    (tabs)/account.tsx   FR-MOB-007
    campaigns/[slug].tsx FR-MOB-002
    checkout/[slug].tsx  FR-MOB-004 (?perk=)
    auth/login.tsx, auth/signup.tsx, auth/verify.tsx, auth/forgot.tsx   FR-MOB-003
  src/lib/               env, api (shared client instance), supabase, secure-storage, session, config, checkout-keys, stripe
  src/components/        UI kit mirroring the web brand kit (Button, Card, Callout, Badge, ProgressBar, Field, TextField, Checkbox, Screen, EscrowNotice, TestModeNotice, ArtistArt, CampaignCard)
  src/theme.ts           brand tokens copied from the web CSS (NFR-MOB-06)
  test/                  vitest for pure modules (secure-storage chunking, route helpers)
```

## 4. Auth (FR-MOB-003)
- `@supabase/supabase-js` with `storage` = a chunked `expo-secure-store` adapter (SecureStore warns above 2 KB per item; the session JSON is larger). `autoRefreshToken` on, refreshed on app foreground via `AppState` (Supabase's documented React Native pattern); `detectSessionInUrl: false`.
- Sign-up sends the same `options.data` as the web (`display_name`, `adult_attested`, `terms_version`, `privacy_version`, `anon_id`), with `emailRedirectTo` = `<WEB_URL>/verify-email?next=/explore`. The fan verifies in the browser; the app's verify screen calls `refreshSession()` / re-login and checks `email_confirmed_at`.
- Return-to-checkout (FR-BCK-002): the auth screens take a `next` param limited to in-app paths (`/checkout/…`, `/campaigns/…`, tabs) by `safeAppNext()`.

## 5. Checkout (FR-MOB-004)
Same state machine as the web: `review → pay → processing → done`.
1. `start()`: accept pending documents (`acceptanceDocuments(me)`), `POST /backings` with `keys.get(checkoutKeyName(slug, perk, qty))`, then `GET /backings/:id`; paid → done, `deadReason` → dead, else pay.
2. **stripe-test:** `initPaymentSheet({ paymentIntentClientSecret, merchantDisplayName: "FanZuP", returnURL: "fanzup://stripe-redirect", appearance })` → `presentPaymentSheet()`. `Canceled` returns to the pay step with no failure; other errors go through `categorize(err, "pay")`. The `StripeProvider` gets the publishable key from `GET /v1/config` at runtime.
3. **sandbox:** labelled sandbox form → `POST /v1/dev/sandbox/pay/:id` (local/CI API only).
4. `waitForCapture` polls `GET /backings/:id` (40 × 1 s) — shared with the web.
Keys are kept in an in-memory `checkoutKeys(null)` instance for the app's process life (NFR-MOB-02).

## 6. Configuration
`app.config.ts` reads, at build time:
| Var | Meaning |
|---|---|
| `EXPO_PUBLIC_API_URL` | API base, e.g. `https://<web-domain>/api` (the web's `/api` route) or `http://<LAN-IP>:8787/api` for local |
| `EXPO_PUBLIC_WEB_URL` | web origin for legal pages and the email-verification redirect |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the same public values as the web's `VITE_SUPABASE_*` |
Per-profile values live in `eas.json` (`preview` → staging) or EAS environment variables. The hosted Supabase Auth redirect allow-list must include `<WEB_URL>/**` (already required for the web).

## 7. Testing
- `packages/shared/test`: new tests for `api-client` (headers, idempotency key, error mapping, network error), `checkout-flow` (categorize table, deadReason, holdAnnouncement, waitForCapture), `format.timeLeft`.
- `apps/mobile/test`: secure-storage chunking, `safeAppNext`.
- CI `mobile` job: `typecheck`, `test`, `expo export --platform ios --platform android` (proves Metro resolves the monorepo and both bundles build).
- Manual: Expo Go on a phone against a local API (`docs/MOBILE.md`), then an EAS `preview` build against staging.
- Not in MOB-1: Detox/Maestro device e2e (backlog; the web Playwright journey keeps covering the API path).

## 8. Copy and brand
`lint:copy` scans `apps/mobile/app` and `apps/mobile/src`. Same Layer 1 vocabulary; escrow promise via `<EscrowNotice />`; test-mode notice text matches the web's.

## 9. Manual steps for Wayne (store path)
1. **Expo account** (free) → `npx eas-cli login` → `cd apps/mobile && npx eas-cli init` (writes `extra.eas.projectId`; commit it).
2. **Bundle ids:** confirm `com.fanzup.app` (iOS bundle id and Android package) or pick another; it can't change after the first store upload.
3. **Apple Developer Program** (US$99/yr, enrol as the FanZuP entity — needs a D-U-N-S number for an organisation) → App Store Connect app record → `eas credentials` lets EAS create certificates and profiles.
4. **Google Play Console** (US$25 one-off, organisation account, identity verification) → create the app → a service-account JSON for `eas submit`.
5. **EAS env:** set `EXPO_PUBLIC_*` for `preview` (staging) and `production` in the EAS dashboard.
6. **Stripe:** nothing new for card payments; Apple Pay / Google Pay later need an Apple Merchant ID and Stripe domain setup (backlog).
7. **Before public release (blocking):** in-app account deletion (FR-PRV-003 / FR-MOB-009); privacy policy URL and the App Privacy / Data safety forms; reviewer demo account; app icon and screenshots; counsel review of the store description (reward-based crowdfunding copy, no investment language).
8. **Payments policy note:** perks are mostly physical goods, experiences and artist-delivered digital items, and backing is a contribution to a third party (the artist). Apple and Google allow non-IAP payment for physical goods and person-to-person support; digital perks consumed inside the app would need IAP. FanZuP delivers no digital content inside the app in MOB-1. Confirm with counsel before submission.

## 10. G1+G2 self-review (combined, CR-004)
| Check | Result |
|---|---|
| Every FR-MOB has acceptance criteria and a parity FR where one exists | ✅ |
| Money path unchanged; no new endpoint; no secret in the bundle | ✅ NFR-MOB-01/02 |
| Rules shared, not copied (checkout categories, dead/paid statuses, copy) | ✅ §2 |
| Layer 2 unreachable on mobile | ✅ NFR-MOB-03, no routes exist |
| Store blockers named before anyone submits | ✅ §9 item 7, FR-MOB-009 |
| Web regressions guarded | ✅ CI web job + e2e unchanged; web re-exports keep import paths |
| Open risks | Expo Go must support SDK 58 on the tester's phone (it tracks the latest SDK); PaymentSheet redirect-based methods need the `fanzup` scheme (set); session refresh on resume (AppState hook) |
