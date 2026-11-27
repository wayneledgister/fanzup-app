# Mobile app, Phase MOB-1 (CR-004) — Plan & tasks
**Implements:** `01-requirements.md` · **Design:** `02-design.md` · **Date:** 2026-11-27
**Shape:** one PR (`feat/mobile-app`): the shared-code move and the app, reviewed together.

| ID | Task | Implements | Status |
|---|---|---|---|
| MOB-T-001 | CR-004, requirements, design, ADR-009, this plan | CR-004 | ✅ |
| MOB-T-002 | Shared `api-client.ts` (+ tests); web `lib/api.ts` becomes a wrapper, same exports | NFR-MOB-04 | ✅ |
| MOB-T-003 | Shared `checkout-flow.ts` (categorize, deadReason, paid statuses, hold announcements, capture poll; + tests); web checkout imports it | NFR-MOB-04, FR-MOB-004 | ✅ |
| MOB-T-004 | Shared `backing-copy.ts` (money-state and campaign-status copy, refund promise, test-mode notice, FAQ, tranche labels, perk stock; + tests) and `format.ts`; web pages import them | NFR-MOB-04, FR-MOB-005/006 | ✅ |
| MOB-T-005 | Shared `auth-rules.ts` (email/password rules, sign-up errors and metadata); web sign-up imports it | FR-MOB-003 | ✅ |
| MOB-T-006 | `apps/mobile` scaffold: Expo SDK 58, Expo Router, `app.config.ts`, `eas.json`, brand theme and UI kit | NFR-MOB-06/07 | ✅ |
| MOB-T-007 | Supabase Auth with chunked SecureStore session (+ tests), session provider, foreground token refresh | FR-MOB-003, NFR-MOB-02 | ✅ |
| MOB-T-008 | Explore tab (tabs, paging, pull-to-refresh, error/empty states) | FR-MOB-001 | ✅ |
| MOB-T-009 | Campaign page (perks, milestones, countdown, FAQ, share, deep link) | FR-MOB-002 | ✅ |
| MOB-T-010 | Auth screens: sign up, log in, verify, forgot; `safeAppNext` (+ tests) | FR-MOB-003, FR-BCK-002 | ✅ |
| MOB-T-011 | Checkout: review → pay (PaymentSheet / sandbox) → processing → confirmation, shared key lifecycle | FR-MOB-004 | ✅ |
| MOB-T-012 | Backed tab and Account tab | FR-MOB-005, FR-MOB-007 | ✅ |
| MOB-T-013 | `lint:copy` scans `apps/mobile` (Layer 1 only) and the shared copy | NFR-MOB-03 | ✅ |
| MOB-T-014 | CI `mobile` job: typecheck, tests, `expo export` iOS + Android | NFR-MOB-07 | ✅ |
| MOB-T-015 | `docs/MOBILE.md`: Expo Go, staging, store steps for Wayne | design §9 | ✅ |
| MOB-T-016 | *(Wayne)* Expo account + `eas init`; bundle id; Apple and Google developer accounts; EAS env | design §9 | ⏳ Wayne |
| MOB-T-017 | *(Wayne)* First `preview` build on a phone against staging; one sandbox and one stripe-test backing that shows on the web's My backings (FR-MOB-008) | FR-MOB-004/008 | ⏳ Wayne |
| MOB-T-018 | In-app account deletion, once FR-PRV-003 exists | FR-MOB-009 | Backlog (P0b) |

## Verification (2026-11-27, in the agent sandbox)
- `pnpm -r typecheck` clean (shared, web, api, mock-escrow, mobile).
- shared 88/88 (22 new), web 12/12, mobile 9/9.
- `pnpm lint:copy` clean, including the new mobile and shared-copy scans (checked to fail on a planted "invest"/"returns"/"escrow" line).
- Web production build clean.
- `expo export --platform ios --platform android` builds both Hermes bundles.
- Not run here: API tests and the Playwright e2e (need Postgres / Docker; CI runs them). No device run: the sandbox has no phone or simulator.
