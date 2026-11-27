# ADR-009: Native mobile app with Expo + React Native, sharing business rules with the web

**Status:** Accepted (CR-004; Wayne, 2026-11-27, after build and merge) · **Date:** 2026-11-27 · **Decider:** Wayne · **Requirements:** FR-MOB-*, NFR-MOB-01…08

## Context
Wayne wants a React Native app on the App Store and Google Play, and the web app must stay fully supported. The web app (Vite + React DOM, 100+ routes, Playwright e2e) is the M1 deliverable and works. The M1 API already serves everything a fan needs; money is only ever moved by the API and worker. The founder's Mac has about 12 GB free and no full Xcode.

## Decision
1. **Expo (managed workflow, SDK 58) + Expo Router**, in `apps/mobile` inside the pnpm monorepo (ADR-001). Same React version as the web (19.3).
2. **Two UI layers, one rulebook.** The web keeps its DOM UI; the app has a native UI with the same brand tokens. Platform-neutral logic (API client, checkout rules, copy for money states, formatting, schemas) lives in `@fanzup/shared` and both clients import it.
3. **The API is the only path to money.** The app creates backings through `POST /v1/backings` and pays the PaymentIntent the API created, with Stripe's PaymentSheet. It never writes to Supabase tables.
4. **Builds in the cloud.** Expo Go for development, EAS Build/Submit for store binaries; no local Xcode needed.
5. **Internal test tracks only** until in-app account deletion (FR-PRV-003) exists.

## Alternatives
- **React Native Web replacing the Vite app:** one UI codebase, but a rewrite of a working, tested web app. Rejected for now; can be revisited when the web UI is next redesigned.
- **WebView / Capacitor wrapper:** fastest, but not React Native and at risk under Apple guideline 4.2.
- **Bare React Native CLI:** full native control but needs Xcode/Android Studio locally. Expo can eject (prebuild) later if a native module needs it.

## Consequences
- A UI change is made twice (web and native); a rule change is made once.
- `@fanzup/shared` must stay free of DOM and Node-only APIs (its tsconfig has no DOM lib in practice; the API client takes `fetch` by injection).
- Store accounts, signing and review become Wayne's recurring operational work (design §9).
- Expo SDK upgrades roughly twice a year; Expo Go only runs the latest SDK or two, so the app must keep up.
