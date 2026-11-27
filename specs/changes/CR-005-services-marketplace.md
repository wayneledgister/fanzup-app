# CR-005: Artist services marketplace (third-party providers)
**Status:** Accepted (v-now, Phase MKT-1: directory + requests, no money; ships with `flag.marketplace` off) · **Source:** Wayne (founder), 2026-11-27 · **Date:** 2026-11-27

## Request
Wayne's words (the authority for this change, recorded verbatim):

> "now what about the 3rd party marketplace for artists who need various services and providers? That is a key feature and needs integration. If not already built please begin it using the sdd skills and any other skills available to you. first check for existing specs"

## Existing specs
None found (see `specs/marketplace/discovery.md` "Existing specs").

## Classification
**New scope.** No existing requirement changes meaning. Adds a new role (service provider), three tables, one flag, one staff action and pages on web and mobile.

## Impact
### Requirements
- **Added:** `specs/marketplace/01-requirements.md` (FR-MKT-001…020, NFR-MKT-01…07), discovery `specs/marketplace/discovery.md`.
- **Modified:** FR-PLT-001 gains the `marketplace` flag. The privacy notice (FR-PRV) must list service requests and provider contact data before the flag is on for real users.
- **Retired:** none.

### Design
- `specs/marketplace/02-design.md`, ADR-010 (no money in MKT-1; one money boundary for MKT-2).
- Migration `20261127000100_marketplace.sql`; API module `apps/api/src/marketplace`; `@fanzup/shared/marketplace`; web pages under `/services` and `/provider`; mobile Services tab.
- ADRs contradicted: none. ADR-003 is the template for MKT-2's money path.

### Plan
`specs/marketplace/03-tasks.md` (MKT-T-001…). Size **M** for MKT-1, one PR.

### Ripple
- **Gates:** combined G1+G2 self-review in `02-design.md` §11.
- **Partners and counsel:** MKT-Q1…Q8 join the existing counsel engagement; no new vendor in MKT-1.
- **Store policy:** no payment in MKT-1, so no in-app purchase question. Revisit at MKT-2.
- **Manual steps (Wayne):** fee model, MKT-2 payment path, provider recruitment (E2), Provider Terms.

## What this displaces
Time on M1 close and M2 prep. The production-readiness review recommended freezing new money-adjacent builds until M2; MKT-1 has no money path, so it fits that rule. MKT-2 does not start until counsel answers.

## Options considered
| Option | Cost / consequence |
|---|---|
| **MKT-1 directory + requests, no money, flag off** (recommended) | One build session; tests demand and supply cheaply; no legal exposure from money movement |
| Full marketplace with paid bookings now | Revenue sooner, but needs a money-transmission answer and payout/tax/sanctions perimeter that doesn't exist yet; on the critical path |
| Partner with an existing marketplace (link out) | Cheapest; no integration with campaigns, which is the point Wayne made |
| Spec only | Contradicts "please begin it" |

## Decision
**Accepted (v-now, MKT-1): Wayne, 2026-11-27**, direct request (quoted above).

Decisions (Wayne, decision cards, 2026-11-27):
- **D-MKT-1 Payment path: "Ask counsel first, then in-app."** MKT-1 stays off-platform. MKT-Q1…Q8 join the existing custody/MTL counsel engagement; paid bookings (MKT-2) are built on the ledger and `PaymentProvider` only after counsel picks the flow of funds (ADR-010).
- **D-MKT-2 Fee model: "Free in beta, decide later."** No marketplace fee anywhere in the beta; the model is set after the beta shows request and acceptance rates (discovery E1).
