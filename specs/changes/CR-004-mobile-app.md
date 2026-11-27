# CR-004: Native mobile app (iOS and Android) beside the web app
**Status:** Accepted (v-now, Phase MOB-1: fan core on test money) · **Source:** Wayne (founder), 2026-11-27 · **Date:** 2026-11-27

## Request
Wayne's words (the authority for this change, recorded verbatim):

> "need to build the react native app version. both we and native support are important"

"we" is read as "web" (typo, confirmed by the coordinator's brief): the web app stays fully supported, and a React Native app is added that can ship to the App Store and Google Play. Both are first-class clients.

## Classification
**New scope.** No existing requirement changes meaning. The mobile app is a second client of the existing API: it adds no endpoint, no migration and no money logic. Business rules the web app already had inside its pages (checkout failure categories, backing status rules, display copy for money states, formatting) move into `@fanzup/shared` so both clients run the same code — a refactor of the web app with no behaviour change.

## Impact
### Requirements
- **Added:** `specs/mobile/01-requirements.md` (FR-MOB-*, NFR-MOB-*).
- **Modified:** none. FR-BCK-001's "Stripe Payment Element" becomes "Stripe's hosted card UI (Payment Element on web, PaymentSheet on mobile)" for the mobile client only; the server contract is unchanged.
- **Retired:** none.

### Design
- New design `specs/mobile/02-design.md` and ADR-009 (Expo + React Native client in the monorepo, sharing `@fanzup/shared`; the API is the only path to money).
- New workspace `apps/mobile` (`@fanzup/mobile`).
- `@fanzup/shared` gains `api-client.ts`, `checkout-flow.ts`, `backing-copy.ts`, `format.ts`. The web app's `lib/api.ts`, `lib/format.ts`, `pages/fan/Checkout.tsx` and `pages/fan/BackedAndPerks.tsx` import them instead of holding their own copies.
- API: none. Native clients send no `Origin`, so CORS doesn't apply; they authenticate with the same Supabase bearer token.
- ADRs contradicted: none. ADR-001 (monorepo) gains a fourth app.

### Plan
- `specs/mobile/03-tasks.md` (MOB-T-001…). Size **M** for Phase MOB-1. One PR: the shared refactor and the app are reviewed together because the refactor exists to serve the app.

### Ripple
- **Gates:** M1 G1/G2 untouched. This change gets a combined G1+G2 self-review recorded in `specs/mobile/02-design.md` §10.
- **CI:** a new `mobile` job (typecheck, unit tests, `expo export` bundle for iOS and Android). The `web` job is unchanged and must stay green.
- **Copy rules:** `pnpm lint:copy` extends to `apps/mobile/src` and `apps/mobile/app`.
- **Store policy:** Apple guideline 5.1.1(v) requires in-app account deletion for apps with sign-up. FR-PRV-003 is P0b today, so the app ships to **internal testing only** (TestFlight internal, Play internal track) until FR-PRV-003 exists. See FR-MOB-009.
- **Partners and counsel:** none new. Layer 2 (securities) never appears in the mobile app in this phase (NFR-MOB-03).
- **Manual steps (Wayne):** Apple Developer Program and Google Play Console accounts, Expo account + EAS project, bundle ids, store listings. Listed in `specs/mobile/02-design.md` §9.

## What this displaces
Time on M1 close / M2 prep. Mitigation: the mobile app reuses M1's API unchanged, so nothing on the money path is reopened; and the shared-code move means future checkout fixes land once for both clients.

## Options considered
| Option | Cost / consequence |
|---|---|
| **Expo + React Native app in `apps/mobile`, sharing `@fanzup/shared`; fan core first** (recommended) | About one build session for MOB-1. Testable on a phone with Expo Go and EAS without Xcode. Two UI codebases (web DOM, native), one set of rules. |
| React Native Web replacing the Vite web app | One UI codebase, but rewrites 100+ working web routes and their e2e; risks the web app Wayne said must stay fully supported. |
| Capacitor / WebView wrapper of the web app | Fastest, but Apple often rejects thin wrappers (guideline 4.2), and it isn't React Native. |
| Spec only | Cheapest; contradicts "need to build". |

## Recommendation
Accept MOB-1 (fan core: explore, campaign, account, checkout, My backings) into v-now. Push notifications, artist/creator flows, Apple Pay/Google Pay, universal links and Layer 2 go to the backlog.

## Decision
**Accepted (v-now, MOB-1): Wayne, 2026-11-27** — direct request (quoted above). Ships to internal testing tracks only until FR-PRV-003 (account deletion) is built.
