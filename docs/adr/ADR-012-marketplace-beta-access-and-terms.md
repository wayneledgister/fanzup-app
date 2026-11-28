# ADR-012: Marketplace closed beta — cohort access by invite, Provider Terms versions in code, launch guard

**Status:** Accepted (CR-007) · **Date:** 2026-11-27 · **Decider:** Wayne · **Requirements:** FR-MKT-021…029, NFR-MKT-08/09, FR-PLT-001, FR-PRV-001

## Context
MKT-1 (CR-005) has one switch, `flag.marketplace`, which opens everything to everyone. The beta needs a small, named group (Wayne's first ~20 providers and some artists), one staff reviewer, and proof that every provider accepted the Provider Terms. The terms and the privacy-notice update are drafts with counsel (PR #28); nothing may be published before counsel approves (FR-PRV-001). There's no email provider yet.

## Decision
1. **Audience setting beside the flag.** `marketplace.audience` = `invited` (default) | `open_requests` | `everyone`, changed by the privileged action `marketplace.audience`. The flag stays the master switch; the audience decides who's inside. One function in the API (`accessFor`) computes `canBrowse`/`canRequest`/`canProvide`, and every route calls it (NFR-MKT-09).
2. **Membership by single-use invite bound to an email.** Staff create an invite (privileged `marketplace.invite`); the API answers the code once and stores only its SHA-256. Redemption needs a verified account whose email matches. Staff send the link themselves.
3. **Provider Terms versions live in code** (`POLICY.legal.providerTerms`), like the existing Terms and Privacy versions (`POLICY.legal`, design §3.7). Acceptance reuses the append-only `consents` table with a new kind, `provider_terms`, through `POST /me/acceptances`. Changing the version is a reviewed PR; providers re-accept before their next create, submit or respond.
4. **Launch guard.** A deployed environment refuses turning `flag.marketplace` on unless the code says the Provider Terms are approved and the privacy notice covers the marketplace. Counsel's sign-off becomes a one-line, reviewed code change instead of an operator's memory.

## Alternatives
- **Allowlist of emails in a setting:** simpler, but no expiry, no audit per person, and an email list in a settings row.
- **Legal documents stored and versioned in the database, published by staff:** lets staff change terms without a deploy, but that's the opposite of what we want before counsel approves; revisit when legal text changes often.
- **Per-user feature-flag service (LaunchDarkly and similar):** a new vendor and data processor for one cohort; not worth it at this size.

## Consequences
- Wayne controls exactly who's in, and can widen the beta with one audited switch.
- Counsel's approval ships as a PR touching `packages/shared/src/policy.ts`; CI and review see it.
- Invites are copied by hand until an email provider exists (FR-NTF).
- A removed member keeps their data; suspension of a listed provider stays a separate staff decision.

## Revisit when
An email provider exists (send invites from FanZuP), the marketplace leaves beta (`everyone` becomes the default and invites become optional), or legal text needs to change without a deploy.
