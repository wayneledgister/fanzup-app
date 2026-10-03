# ADR-004: Full account before checkout on Supabase Auth; staff second factor via `aal2`

**Status:** Proposed (G2, M1) · **Date:** 2026-10-03 · **Decider:** Wayne · **Requirements:** FR-ID-001/002/003/006/007, FR-BCK-002, FR-PRV-001

## Context
Wayne chose card G1-B option 3: fans create and verify an account before their first backing. Staff actions need a second factor taken from the verified session (FR-ID-003), and the operator is alone (FR-ID-007).

## Decision
- **Fans and artists:** Supabase Auth email + password with email confirmation. The browser signs up directly with Supabase (supabase-js) and passes `next` (a same-origin path holding campaign + perk) through the confirmation link's redirect.
- **Verified email is checked by the API** from `auth.users.email_confirmed_at` on every checkout write, never from client state.
- **18+ and terms are enforced in the database:** the new-user trigger refuses a user without `adult_attested = true` and the current terms version, and records `consents` rows. Re-acceptance goes through `POST /me/acceptances`, which records IP and user agent.
- **Staff:** Supabase TOTP MFA; every staff endpoint requires the token's `aal` claim to be `aal2`; actor id and `aal` come from the verified token into the request context and audit rows.

## Consequences
- No auth server of our own; the API stays stateless.
- Sign-up acceptances carry no IP/UA at M1 (design gap G-1); fixed at M2 with an auth hook or API-proxied sign-up.
- Hosted Supabase needs MFA enabled and redirect URLs set (design §12).
- Conversion cost of a full account is accepted by the founder; measured from M1 via funnel events, judged at M3.
