# CR-007: Marketplace closed beta (invites, cohort access, Provider Terms acceptance, beta metrics)
**Status:** Accepted (v-now, Phase MKT-1b; web first, flag still off) · **Source:** Wayne (founder), 2026-11-27 · **Date:** 2026-11-27

## Request
Wayne's words, answering "what's next" (item 4 was "Marketplace beta: built but switched off, waiting on the Provider Terms and privacy update from your attorney and your first 20 or so providers"):

> "do 1,3,4 we will deprioritize mobile for now. Let's get web feature and production ready."

Read as: build what the web app needs to run the marketplace closed beta with Wayne's first ~20 providers, without adding payments or fees (CR-005 D-MKT-1/2 stand).

## Classification
**Scope change** to CR-005 MKT-1. FR-MKT-001's "on for everyone" switch becomes "on for a cohort first"; FR-MKT-003/009 gain a Provider Terms precondition. No money path is touched.

## Impact
### Requirements
- **Added:** FR-MKT-021…029 and NFR-MKT-08/09 in `specs/marketplace/01-requirements.md` §5 (beta audience, invites, redemption, access check, versioned Provider Terms acceptance, launch guard, member removal, beta metrics, web screens).
- **Modified:** FR-MKT-001 (flag on means "open to the audience the audience setting allows"); FR-MKT-003 (creating a provider profile needs provider access and the current Provider Terms); FR-MKT-009 (responding needs the current Provider Terms); FR-MKT-012 (the mobile Services tab follows the per-user access check). FR-PLT-001 (flags per cohort and per user) is now met for the marketplace.
- **Retired:** none.

### Design
- `specs/marketplace/02-design.md` §12; [ADR-012](../../docs/adr/ADR-012-marketplace-beta-access-and-terms.md) (cohort access by invite, Provider Terms versions in code, launch guard).
- Migration `20261128000100_marketplace_beta.sql`: `marketplace_invites`, `marketplace_members`, the `marketplace.audience` setting, `provider_terms` consent kind. Still no money objects (NFR-MKT-01 test covers both migrations).
- New privileged actions: `marketplace.audience`, `marketplace.invite`, `marketplace.invite_revoke`, `marketplace.member_remove` (aal2, typed reason, audited; not money actions).
- New routes: `GET /services/access`, `POST /services/join`, staff invites/members/audience/metrics (`docs/API.md`).

### Plan
`specs/marketplace/03-tasks.md` MKT-T-017…025. Size **M**, one PR.

### Ripple
- Existing marketplace tests and the E2E journey change: providers now accept the Provider Terms, and the journey runs through an invite.
- Mobile: only the Services tab gate changes (it reads `/services/access`); invite redemption and terms acceptance are web-only for now (Wayne deprioritised mobile, 2026-11-27).
- Legal: the Provider Terms and privacy-notice drafts (PR #28) stay unpublished. The launch guard (FR-MKT-026) makes counsel's approval a code change that CI and review see: `POLICY.legal.providerTerms.approved` and `POLICY.legal.privacyCoversMarketplace`.
- Runbook: `specs/runbooks/marketplace-beta.md` (new) for inviting providers, vetting and opening up.

## What this displaces
Time on live artist screens (M2, FR-PLT-002) and the launch-gate docs, which run in parallel threads. No money-path work is displaced.

## Options considered
| Option | Cost / consequence |
|---|---|
| **Invite-based cohort + versioned Provider Terms + launch guard** (recommended) | One PR; Wayne controls exactly who's in; counsel approval becomes a visible switch |
| Turn the flag on for everyone once the docs arrive | No build, but anyone could list or request on day one with one staff reviewer |
| Staff-created provider accounts (no self-serve) | Fewer screens, but staff would handle providers' credentials and contact data |

## Decision
**Accepted (v-now): Wayne, 2026-11-27**, direct request (quoted above).

**D-MKT-3 Beta audience (Wayne, decision card, 2026-11-27): "Invited people only."** Providers and artists each need a personal invite; the default audience is `invited`. `open_requests` (invited providers, any signed-in artist) and `everyone` stay available as one audited switch for later.
