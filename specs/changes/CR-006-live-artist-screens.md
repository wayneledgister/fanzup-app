# CR-006: Live artist screens and home page (M2 slice)
**Status:** Accepted (v-now, web only) · **Source:** Wayne (founder), 2026-11-27 · **Date:** 2026-11-27

## Request
Wayne's words (the authority for this change, recorded verbatim), answering the proposed next steps ("1. Live artist screens (M2). The artist dashboard and the home page's featured campaign still run on sample data with stale dates."):

> "do 1,3,4 we will deprioritize mobile for now. Let's get web feature and production ready."

## Existing specs
- FR-PLT-002 (P0a): "Mock data is never served in production." Not met: `/`, `/creator`, `/creator/campaigns` and `/creator/campaigns/:id` render `@/lib/mock` / `components/creator/data.ts`, fixed to 2026-10, so they now show "Ended" and negative days left.
- FR-CMP-001/002: the artist API exists since M1 (M1 design §4.2), and M1 design §11 says "every other route keeps its mock data until M2"; this CR is that M2 step for the artist home and campaign screens.
- FR-ID-005: creator screens need the right session.
- FR-CMP-008: discovery is ordered ending soonest, never by money; the home page's featured campaign follows the same rule.

## Classification
**Clarification + scope at M2 as planned.** No requirement changes meaning. One requirement is added (FR-CMP-009) to state what the artist home must show, so the screens have acceptance criteria. No new route, table, migration or flag. Two existing owner routes get typed, slightly richer responses (additive fields only).

## Impact
### Requirements
- **Added:** FR-CMP-009 "The artist home shows the artist's real campaigns" (`specs/01-requirements.md`).
- **Modified:** none. FR-PLT-002 is partly met by this CR (four routes stop serving mock data); the route tagging and pruning of the other creator screens stays open.
- **Retired:** none.

### Design
- M1 design §4.2: `GET /artist` and `GET /artist/campaigns/:id` gain the fields listed in ADR-011 and named contracts `MyArtist` / `MyCampaign` in `@fanzup/shared/schemas`; `api-client` gains `myArtist()` and `myCampaign(id)`.
- M1 design §11: rows for `/`, `/creator`, `/creator/campaigns`, `/creator/campaigns/:id`.
- ADR-011 (new): artist screens read only owner API data; sections with no backend are left out, not faked.
- `docs/API.md`: Contract column for the two routes. Route list unchanged, so the drift test is unaffected.
- No OpenAPI document exists; `docs/API.md` is the wire-contract index (decision log DL-002).

### Plan
Tasks M2-T-001…M2-T-004 in `specs/03-tasks.md`. Size **S/M**, one PR.

### Ripple
- **Mobile:** none (Wayne deprioritised mobile on 2026-11-27). The new client calls live in `@fanzup/shared`, so the app can use them later.
- **Screens taken off the artist home** until they have a backend: subscribers, monthly listeners, monthly revenue chart, recent activity, upcoming events, tier progress, backer list, fulfillment tracker and the update composer (FR-COM-001 is P0b). Their own pages (`/creator/revenue`, `/creator/events`, …) still show sample data and stay on the FR-PLT-002 list.
- **E2E:** the golden journey doesn't open these pages. A new API test covers the contracts.
- **Gates:** small enough for a self-review recorded in the PR; no council.

## What this displaces
Nothing on the critical path (engineering isn't the constraint; production-readiness review 2026-11-26). It's the most visible demo gap.

## Options considered
| Option | Cost / consequence |
|---|---|
| **Wire the four screens to the existing owner routes, extend those routes' responses, hide sections without a backend** (recommended) | One PR, no migration, honest screens (FR-PLT-002) |
| Keep the sample data but move its dates relative to today | Cheapest; still fake numbers in front of artists, still breaks FR-PLT-002 |
| Build backends for every dashboard widget (activity feed, revenue, events, tier progress) first | Weeks of P0b/P1 work; delays the honest screens for widgets nobody uses in the closed beta |
| New `/artist/dashboard` aggregate route | One more route and contract to keep in step; the existing two routes already carry the data |

## Decision
**Accepted (v-now): Wayne, 2026-11-27**, direct request (quoted above). Web only.
