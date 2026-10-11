# ADR-006: End-to-end tests on the Supabase CLI stack in CI, sandbox provider, Mailpit

**Status:** Proposed (G2, M1) · **Date:** 2026-10-03 · **Decider:** Wayne · **Requirements:** NFR-QA-02, M1 exit tests 5–7

## Context
M1 needs a browser test of the golden journey with **real Supabase Auth** (sign-up, confirmation email, sign-in) in CI. Stripe test keys aren't available to CI (no secrets in the repo), and Stripe test mode can't be time-travelled to a campaign deadline.

## Decision
- A separate `e2e` GitHub Actions job runs `supabase start` (database, auth, API gateway, Mailpit only), which applies the migrations and `seed.sql`; builds the API and web; runs the API, the worker (1 s interval) and `vite preview` (proxying `/api`); then Playwright (Chromium).
- The fan's journey runs in the browser: sign up → open the confirmation link from Mailpit → land on checkout with the same perk → pay with the sandbox card form → confirmation → My backings.
- Artist, staff and time steps run through the API in the same test: the artist creates and submits two small campaigns; the staff user (seeded **locally/CI only**) enrols TOTP and acts with an `aal2` session; the sandbox `tick?now=` moves time past the deadline; recon must report zero difference.
- A Stripe test-mode variant is a manual/optional job that runs only when Stripe test secrets exist.

## Consequences
- Real auth emails and MFA are exercised on every PR; the job takes ~5 minutes and runs beside the fast jobs.
- The dev routes it relies on exist only with the sandbox provider in a non-deployed environment (design §9).
- Stripe-specific behaviour is covered by adapter unit tests and the manual run, not by this job.
