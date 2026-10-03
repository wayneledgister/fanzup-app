# Worklog · M1 walking skeleton
Labels: ✅ built and verified here (how) · 🟡 partial (what remains) · ⏳ not started · ⛔ blocked (on what)

## 2026-10-03
- Spec: G1 decisions recorded; M1 scope moved into requirements; design + ADR-003..006; G2 pass 1 (REVISE, doc fixes) → pass 2 APPROVE WITH CONDITIONS; plan written.

## Evidence
| Suite | How run | Last result | Date |
|---|---|---|---|
| shared + API (baseline before M1) | `pnpm test`, local Postgres 16 | 29/29 green | 2026-10-03 |
| shared (PR-B) | `pnpm --filter @fanzup/shared test` | 7/7 green | 2026-10-03 |
| API (PR-B) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 61/61 green | 2026-10-03 |
| CI PR-A #6, PR-B #7 | GitHub Actions (Postgres 17) | web ✅ api ✅ | 2026-10-03 |
| API (PR-C) | `pnpm --filter @fanzup/api test`, local Postgres 16 | 81/81 green | 2026-10-03 |

## Not run here
- Anything needing Docker (Supabase CLI stack, e2e) — runs only in CI.

## 2026-10-03 · PR-B money path
- T-001 ✅ policy keys (Appendix A) — shared tests 7/7, run here
- T-002 ✅ migrations 0100–0300 apply on a fresh DB after the existing three — every API suite runs them, run here
- T-003 ✅ request context + correlation ids — `money-flow` "correlation ids", `checkout` NFR-OPS-04 tests, run here
- T-004 ✅ provider adapter (sandbox + Stripe test), fail-closed env — `money-flow` env tests + Stripe adapter contract tests, run here. Stripe adapter against the real Stripe API: **not run** (no keys; exit test 8)
- T-005 ✅ webhook inbox — duplicate/unmatched/dead-letter tests + Stripe signature/livemode/foreign-account route test, run here
- T-006 ✅ checkout holds + claim-first idempotency — last-unit race (6 fans), 5× same key, provider-failure resume, hold expiry, open-checkout cap, run here
- T-007 ✅ capture / late capture / refunds via two-phase ops — late capture after deadline, amount mismatch + break, "provider acted then timed out" lookup, dead letter at 8, staff refund, run here
- T-008 ✅ settlement → refunds and tranche releases — funded (both tranches) and failed (3 backers) journeys, wait_funds/permanent classes, one failing campaign isolated, run here
- T-009 ✅ reconciliation — zero diff after both journeys; stray provider movement → breaks + payout pause; override; business days, run here
- T-010 ✅ worker tick + heartbeat + `/api/health` age, run here
- Deviation D-001: design §3 split migrations as 0300 money / 0400 staff+recon; built recon tables and tranche evidence in 0300 (they belong to the money path in PR-B) and identity/staff in 0400. Spec impact: design §3 table updated.
- Deviation D-002: `payment.failed` events don't mark the backing failed (Stripe lets the fan retry the same payment; the hold expiry cleans up). Design §5 didn't specify; no requirement impact.
- Deviation D-003: the sandbox's "available balance" for transfers is platform-wide, like Stripe's. No requirement impact.

## 2026-10-03 · PR-C identity, staff, artist
- CI on PR-A (#6) and PR-B (#7): ✅ both jobs green (GitHub Actions, Postgres 17)
- T-011 ✅ identity: attestation trigger, consents, verified-email gate, `/me`, re-acceptance with IP/UA — `identity-staff` tests, run here
- T-012 ✅ staff `aal2`, privileged actions, single-operator delay/limits/cancel, weekly review + sign-off — run here
- T-013 ✅ staff endpoints: review, verify, refund, replay (event/op), recon run/latest/override, queue, trace — run here
- T-014 ✅ artist API: profile, payout onboarding (sandbox), draft CRUD, perks, tranches, submit, publish, evidence; cross-artist isolation — run here. Stripe Connect onboarding against Stripe: **not run** (no keys)
- T-015 ✅ notifications: 6 templates (5 M1 messages + "refund started" for auto/staff refunds), versioned, log transport, test-mode footer; `lint:copy` now scans API templates — run here
- T-016 ✅ funnel events: account_created (trigger), checkout_started + backing_confirmed (backing trigger), perk_selected (`POST /events`, bounded) — run here
- T-017 ✅ column allowlists (artists, profiles) + no client access to any new internal table + clients can't call workflow functions — `rls` tests, run here
- Deviation D-004: FR-ID-004 (M1) — the artist's identity status becomes `verified` when the provider reports the payout account ready (Stripe Connect performs KYC in its hosted onboarding; the sandbox connects at once). Design §4.2 implied it; now explicit. Spec impact: none (FR-ID-004 already says identity and payout setup run through the provider's hosted flow).
- Deviation D-005: `checkout_started` is recorded server-side when the backing hold is created; the web app only sends `perk_selected` (Pragmatist G2 nit). Spec impact: none.

## 2026-10-03 · PR-D web + e2e
- CI on PR-C (#8): see PR checks.
- T-018 ✅ M1 contracts as zod schemas in `packages/shared/src/schemas.ts`, used by the API (requests) and the web client (types) — typecheck, run here
- T-019 ✅ Supabase Auth in the web app: sign-up (name, email, password, 18+, terms), verify-email (link → back to `next`; resend; cross-device "continue"), log in (+ TOTP step for staff), reset password, session context, guards — run here in the local e2e harness against GoTrue built from source
- T-020 ✅ Explore and campaign page on the API (live/funded tabs, type filter, paging; artist's own story/risks/milestones only; local-time deadline; test-mode notice; refund-promise copy without "escrow") — run here (e2e + screenshots at Pixel 7 width)
- T-021 ✅ checkout route (hold countdown, quantity, total, charge timing, re-acceptance, Stripe Payment Element / sandbox card form, failure categories, confirmation) and My backings on the API — run here (e2e)
- T-022 ✅ Playwright golden journey — **passes locally** 3× from a fresh database (GoTrue + mail sink + gateway harness mirroring the Supabase CLI stack)
- T-023 🟡 CI `e2e` job (Supabase CLI local stack) written; first CI result pending on PR-D
- Bug found by e2e and fixed: `Intl.DateTimeFormat` rejects `dateStyle` + `timeZoneName` → campaign page crashed; new `formatInstant()`.
- Bug found by screenshots and fixed: My backings refund line overflowed at phone width.
- Deviation D-006 (operational finding): FanZuP absorbs the processing fee on refunds (E1-C default), so the processor balance runs short of what artists are owed unless FanZuP keeps a float there; the sandbox now models a platform float, and design §12.1 tells Wayne to keep one on Stripe. Spec impact: none (setup step added).
- Deviation D-007: added `GET /artist/campaigns/:id` (milestone ids are needed to submit evidence). Design §4.2 updated.
- Deviation D-008: `/checkout/:slug` lives in the public shell (a signed-out fan arriving from a link sees the same chrome as the campaign page); guarded inside the page. Design §11 updated.
- Not run here: `supabase start` itself (no Docker) — runs only in CI.
