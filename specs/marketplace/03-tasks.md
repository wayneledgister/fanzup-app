# Artist services marketplace, Phase MKT-1 (CR-005) — Plan & tasks
**Implements:** `01-requirements.md` · **Design:** `02-design.md` · **Date:** 2026-11-27
**Shape:** one PR (`feat/services-marketplace`): spec, migration, API, shared rules, web and mobile, reviewed together.

| ID | Task | Implements | Status |
|---|---|---|---|
| MKT-T-001 | Discovery, CR-005, requirements, design, ADR-010, this plan | CR-005 | ✅ |
| MKT-T-002 | Migration: flag, categories, providers, listings, requests; RLS on, no client grants; consented-email function | FR-MKT-001…004/007, NFR-MKT-01/03 | ✅ |
| MKT-T-003 | `@fanzup/shared/marketplace`: categories, schemas, response types, copy; policy limits; API client methods (+ tests) | FR-MKT-002…009, NFR-MKT-05 | ✅ |
| MKT-T-004 | API: public browse + provider page, artist requests, provider profile/listings/submit/inbox/respond | FR-MKT-003…007/009/010 | ✅ |
| MKT-T-005 | Staff vetting: `provider.review` privileged action (no self-review), queue, suspension declines open requests; `marketplace` staff flag; `config.flags.marketplace` | FR-MKT-001/008, NFR-MKT-07 | ✅ |
| MKT-T-006 | API tests (21): flag, lifecycle, re-review, browse filters, request rules, contact reveal, daily limit, suspension, RLS, no-money migration | §9 | ✅ |
| MKT-T-007 | Web: `/services`, `/services/:slug` + request form, `/services/requests`, `/provider`, `/provider/requests`, `/admin/providers`; nav entries behind the server flag | FR-MKT-011 | ✅ |
| MKT-T-008 | Mobile: Services tab (hidden unless flag), provider screen + request form, My service requests (from Services and Account) | FR-MKT-012 | ✅ |
| MKT-T-015 | Docs in step (SDD audit): `docs/API.md` rows, README section and flag list, `docs/SETUP.md` A7, `docs/MOBILE.md`, FR-PLT-001 flag list, worklog, changelog, traceability regenerated | CR-005 | ✅ |
| MKT-T-016 | Playwright journey `e2e/marketplace.spec.ts` in the CI E2E job: flag off → 404; staff turns `flag.marketplace` on (audited `flag.set`); provider creates profile + service and submits; staff lists at aal2; artist searches, opens the provider page and sends a request; provider accepts with a note; artist sees the answer and the provider's contact email; flag restored | FR-MKT-001…008/010/011 | ✅ |
| MKT-T-009 | *(Wayne)* Recruit ~20 providers across 4+ categories; 5 short interviews (discovery E2) | discovery E2 | ⏳ Wayne |
| MKT-T-010 | *(Wayne)* Add MKT-Q1…Q8 to the custody/MTL counsel engagement | D-MKT-1 | ⏳ Wayne |
| MKT-T-011 | Provider Terms and privacy-notice update before the flag goes on for real users | CR-005 ripple | Backlog (counsel) |
| MKT-T-012 | Turn `flag.marketplace` on for the M2 closed beta and measure E1 | discovery E1 | Backlog (M2) |
| MKT-T-013 | MKT-2 quotes + paid bookings on the ledger, after counsel picks the flow of funds | FR-MKT-013…016, ADR-010 | Backlog (counsel-gated) |
| MKT-T-014 | MKT-3 reviews, campaign-tranche link and provider credits, message threads, mobile provider tools | FR-MKT-017…020 | Backlog |

## Verification (2026-11-27, in the agent sandbox)
- `pnpm -r typecheck` clean (shared, web, api, mock-escrow, mobile).
- API 380/380 against Postgres 16 (21 new in `marketplace.test.ts`; `agents` and `l2-platform` expectations updated for the new function grant and config flag).
- shared 97/97 (6 new), web 13/13 (1 new), mobile 9/9.
- `pnpm lint:copy` clean. Web production build clean. `expo export` for iOS and Android clean (EXPO_OFFLINE=1).
- Not done here: screenshots of the new web pages against a live API and a phone run of the Services tab.
