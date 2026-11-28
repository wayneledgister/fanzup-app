# ADR-011: Artist screens read only owner API data; sections without a backend are left out

**Status:** Accepted (CR-006) · **Date:** 2026-11-27 · **Decider:** Wayne · **Requirements:** FR-CMP-009, FR-PLT-002, FR-ID-005

## Context
The artist home (`/creator`), the campaign list and the campaign management page were built from the design mockups with page-local sample data (`components/creator/data.ts`, fixed to October 2026). The M1 API already has owner routes (`GET /artist`, `GET /artist/campaigns/:id`) that return the artist's campaigns, but their responses had no shared contract and lacked fields the screens need (type, backers, perks with units claimed). The home page's featured campaign read the same sample data. FR-PLT-002 forbids mock data in production.

## Decision
1. **Owner routes are the read model.** The artist screens read `GET /api/v1/artist` (profile, payout-account status, every campaign) and `GET /api/v1/artist/campaigns/:id` (one campaign with perks and milestones). No aggregate dashboard route.
2. **Named contracts in `@fanzup/shared/schemas`:** `MyArtist`, `MyCampaignSummary`, `MyCampaign`, `MyPerk`, `MyTranche`; `api-client` gets `myArtist()` and `myCampaign(id)`. The new fields are additive: `tier`, and on each campaign `type`, `blurb`, `backers`, `milestoneRelease`, `startsAt`, `createdAt`, `updatedAt`; the detail adds `perks` (with `claimed` and `limit`) and `tranches.targetDate`. Amounts stay integer cents; clients don't compute money beyond display (goal − raised for "still needed").
3. **Nothing is faked.** A widget with no backend (subscribers, listeners, revenue trend, activity feed, events, tier progress, backer list, fulfillment, updates) is left off these screens until its requirement is built, rather than shown with sample numbers. Next steps on the dashboard are derived from real state (profile, payout account, campaign status).
4. **The home page's featured campaign** is the first result of the public `GET /campaigns?tab=live` (ending soonest, FR-CMP-008), never chosen by money raised. No live campaign → no featured card, a call to action instead.
5. **Creator routes wired to the API sit behind `RequireAccount`** (FR-ID-005); the API enforces the same rule (`verified` + owner).

## Alternatives
- *Relative-dated sample data*: still mock data in production (FR-PLT-002).
- *A `GET /artist/dashboard` aggregate*: one more route and contract for data the two routes already return; reconsider if the home page needs data from more than these two.
- *Build every widget's backend first*: P0b/P1 scope; delays honest screens.

## Consequences
- The artist home is shorter than the mockup until the P0b/P1 features land; each one adds its section back with its own route.
- Web and (later) mobile share the same typed calls.
- The other creator pages (`/creator/revenue`, `/events`, `/content`, `/streaming`, `/payouts`, `/tax`) still show sample data; they stay on the FR-PLT-002 route-tagging list.

## Revisit when
The home page needs data from a third source (activity, revenue), or the two owner responses grow past what a list view should carry (then add paging or an aggregate route through a new ADR).
