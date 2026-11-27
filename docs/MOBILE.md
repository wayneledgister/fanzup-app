# FanZuP mobile app (iOS and Android)

The app lives in `apps/mobile` (Expo SDK 58, React Native 0.88, Expo Router). It's a second client of the same API as the web app, and it shares its business rules with the web through `@fanzup/shared` ([CR-004](../specs/changes/CR-004-mobile-app.md), [ADR-009](adr/ADR-009-mobile-app.md), specs in [`specs/mobile/`](../specs/mobile/)).

What's in it (Phase MOB-1): Explore (live / funded), campaign page, sign up / log in / verify / forgot password, checkout (Stripe PaymentSheet, or the sandbox form locally), My backings, Account. No Layer 2, no artist or staff screens.

Added by CR-005 (MKT-1): a **Services** tab (browse vetted providers, provider page with the request form) and **My service requests** (from Services and Account). The tab is hidden unless the API reports `flags.marketplace`; provider and staff tools stay on the web.

You don't need Xcode or Android Studio. Day to day you use **Expo Go** on your phone; store builds run in the cloud on **EAS Build**.

## 1. Run it on your phone (Expo Go, local stack)
1. Install **Expo Go** from the App Store or Google Play.
2. Start the usual local stack on your computer (`pnpm db:start && pnpm db:reset`, `pnpm dev:api`, `pnpm --filter @fanzup/api worker`, and `pnpm dev:web` for the email-verification page).
3. Find your computer's LAN IP (macOS: `ipconfig getifaddr en0`). Your phone and computer must be on the same Wi-Fi.
4. `cp apps/mobile/.env.example apps/mobile/.env.local` and fill it in:
   - `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8787/api`
   - `EXPO_PUBLIC_SUPABASE_URL=http://<LAN-IP>:54321` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `supabase status`
   - `EXPO_PUBLIC_WEB_URL=http://localhost:5173` (verification emails land in the local mailbox at http://localhost:54324; open the link on your computer — that's fine, the app re-checks when you tap "I've verified")
5. `pnpm dev:mobile`, then scan the QR code with the Camera app (iOS) or Expo Go (Android).
6. Locally the API uses the **sandbox** provider: the checkout shows a labelled sandbox card form. `4242 4242 4242 4242` pays; anything else is declined.

If your Wi-Fi blocks device-to-device traffic, use `pnpm --filter @fanzup/mobile start:tunnel` and point `EXPO_PUBLIC_API_URL` at a hosted API (staging) instead.

## 2. Run it against staging
Set the four `EXPO_PUBLIC_*` values to the staging web domain (`https://<staging-domain>/api`, `https://<staging-domain>`) and the staging Supabase project's URL and anon key — the same public values the web build uses. With the `stripe-test` provider, the checkout opens Stripe's PaymentSheet; pay with `4000 0000 0000 0077`.

## 3. Checks
```bash
pnpm --filter @fanzup/mobile typecheck
pnpm --filter @fanzup/mobile test
pnpm --filter @fanzup/mobile bundle      # expo export for iOS + Android, the same as CI's "Mobile" job
pnpm lint:copy                           # also scans apps/mobile
```

## 4. What you need to do by hand (store path)
These need your accounts, so they're yours. Order matters.

| # | Step | Cost / time |
|---|---|---|
| 1 | Create an **Expo account** (expo.dev). Then `cd apps/mobile && npx eas-cli login && npx eas-cli init`. It prints a project id: set `EAS_PROJECT_ID` (or put it in `app.config.ts`) and commit. | Free |
| 2 | Confirm the **bundle id**. It's `com.fanzup.app` for both stores unless you set `FANZUP_BUNDLE_ID`. It can't change after the first upload. | — |
| 3 | Join the **Apple Developer Program** as the FanZuP entity (needs a D-U-N-S number for an organisation). Create the app in App Store Connect with the bundle id. `npx eas-cli credentials` lets EAS create the certificates and profiles. | US$99/year; enrolment can take days |
| 4 | Create a **Google Play Console** organisation account and the app. Create a service account with release rights and download its JSON key for `eas submit`. | US$25 once; identity checks take days |
| 5 | In the EAS dashboard, set **environment variables** for `preview` (staging) and `production`: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Public values only. | — |
| 6 | First internal build: `npx eas-cli build --profile preview --platform all`. Install it from the link EAS gives you. | EAS free tier has a monthly build quota |
| 7 | Internal testing: `npx eas-cli submit --profile production --platform ios` (TestFlight) and `--platform android` (Play internal track, `eas.json` sets `track: internal`). | — |
| 8 | **App icon and splash** (1024×1024 PNG, no transparency for iOS) into `apps/mobile/assets/`, referenced from `app.config.ts`. | — |

### Before a public release (blocking)
- **In-app account deletion.** Apple (guideline 5.1.1(v)) and Google require it for apps with sign-up. It depends on FR-PRV-003, which isn't built yet, so the app stays on internal test tracks until then (FR-MOB-009).
- Privacy policy URL, App Store "App Privacy" answers and Google Play "Data safety" form.
- A reviewer demo account and notes explaining test mode.
- Store description and screenshots reviewed by counsel: reward-based backing only, no investment language.
- **Payments policy:** card payments outside in-app purchase are allowed for physical goods, experiences and support paid to a third party (the artist). Digital content unlocked *inside* the app would need in-app purchase. MOB-1 unlocks nothing in the app. Confirm with counsel before submitting.

### Later (backlog)
Push notifications, Apple Pay / Google Pay in the PaymentSheet (needs an Apple Merchant ID), universal links / App Links on the production domain, artist screens, device end-to-end tests (Maestro).
