# Changelog
All notable changes to FanZuP, newest first. One entry per merged pull request (dependency bumps grouped). Each entry names the change request (CR) or milestone it implements, so the "why" is one click away in [`specs/changes/000-index.md`](specs/changes/000-index.md). Nothing here is released to the public yet: production runs test-mode money only (FR-PAY-008).

Add your entry in the PR that makes the change, under **Unreleased**.

## Unreleased
- **Marketplace closed beta (CR-007, ADR-012).** Invite-only cohort for the services marketplace (audience `invited` by default; `open_requests` and `everyone` behind the privileged `marketplace.audience`), single-use invites bound to the invitee's email (code shown once, stored as SHA-256), versioned Provider Terms acceptance (`provider_terms` consents) required to create, submit and answer, a launch guard that keeps `flag.marketplace` off in deployed environments until counsel's approval is recorded in `POLICY.legal`, staff page `/admin/marketplace` (audience, invites, members, beta metrics), join page `/services/join`. 9 routes (`docs/API.md`); migration `20261128000100_marketplace_beta.sql`; runbook `specs/runbooks/marketplace-beta.md`. Mobile only follows the access check. Still no money.
- **Docs: launch-gate runbooks, risk log, FMEA, architecture diagrams and readiness review** (DOC audit condition 2; sdd-ready-launch, 2026-11-27). `specs/runbooks/` (deploy and rollback for Vercel web/API, the Render worker and Supabase; incidents with a severity matrix, the NFR-OPS-09 top five failure modes and a postmortem template), `specs/risks.md` (RAID log), `specs/fmea.md` (checkout, settlement, refund and payout), `specs/diagrams/` (C4 context, containers, deployment, money-flow sequences), `specs/05-readiness.md` (Enterprise checklist against `main`: **fix first**, blockers B1–B8). No code change.
- **Docs: specs and wire contracts brought up to date with `main`** (SDD audit, 2026-11-27). Added `docs/API.md` (every API route, with a CI test that fails on drift), the generated requirements traceability matrix `specs/traceability.md` (CI fails when stale), the ADR index and decision log `docs/adr/README.md`, this changelog, and a current `specs/session-state.md`. M1 design §4.2 gains the routes it was missing. No behaviour change; `buildApp` takes an optional `onRoute` callback for the route inventory.
- **#27 Services marketplace, Phase MKT-1 (CR-005, ADR-010).** Vetted third-party providers, listings, service requests, provider accept/decline and staff vetting (`provider.review`) on web and mobile, behind `flag.marketplace` (off). Moves no money: artist and provider pay off-platform until counsel picks the MKT-2 flow of funds. 13 routes under `/v1/services`, `/v1/provider`, `/v1/staff/marketplace` (`docs/API.md`); migration `20261127000100_marketplace.sql`; `@fanzup/shared/marketplace`. End-to-end journey `e2e/marketplace.spec.ts` (provider lists, staff vets, artist requests, provider accepts) runs in the CI E2E job.
- *Open:* user-policy first drafts for counsel — draft PR #28.

## 2026-11-27
- **#26 fix(deploy): keep the API on TypeScript 5.9 so Vercel can build it.** Vercel compiles `apps/api` with the TypeScript JS API, which TypeScript 7 (from #16) doesn't ship. `apps/api` pins `typescript ~5.9.3`; CI checks the API's TypeScript has `transpileModule`; Dependabot ignores TypeScript major bumps. Decision log DL-001.
- **#25 Mobile app (iOS + Android) with Expo + React Native (CR-004, ADR-009).** `apps/mobile` (Expo SDK 58, RN 0.88, React 19.3): Explore, campaign, sign up / log in, checkout, Backed, Account. Shared rules move to `@fanzup/shared` (`api-client`, `checkout-flow`, `backing-copy`, `format`, `auth-rules`); the web re-exports them unchanged. No API change. CI job "Mobile". Store release waits on in-app account deletion (FR-PRV-003).

## 2026-11-26
- **#24 Agent layer Phase 0 (CR-003, ADR-008).** Advisory Campaign Review Copilot and Ops Steward in their own worker, as the read-only role `fanzup_agent`, behind `flag.agents` (off). Staff routes: `GET /staff/agents/proposals`, `POST /staff/agents/proposals/:id/verdict`, `GET /staff/agents/metrics`, `POST /staff/flags/agents`; queue type `agent_dead_letters`.
- **Dependencies:** TypeScript 7.0.2 (#16, see #26), React and React DOM 19.3.0 (#15 + #17), lucide-react 1.52 (#18), `actions/upload-artifact` v7 (#20), 38 minor/patch bumps (#23).

## 2026-10-12 — Layer 2 demo on mock rails (CR-002, ADR-007)
- **#13** Web + e2e: Pools, investing, portfolio, creator and staff screens on real data; Playwright Layer 2 journeys.
- **#12** API: Pools, investing, escrow, royalties, Waterfall, staff actions, signed webhooks, demo seed.
- **#11** Database + mock rails: Layer 2 schema and money functions, `apps/mock-escrow`, Reg CF provider interface.
- **#10** Spec: CR-002 requirements, design, ADR-007, council record.

## 2026-10-11 — M1 walking skeleton
- **#9** Web wired to the API and Supabase Auth; Playwright golden journey in CI; `pnpm m1:operator`.
- **#8** Identity, single-operator staff API, artist API, notifications, funnel events.
- **#7** Money path: provider event inbox, checkout holds, two-phase outbound, reconciliation, correlation ids (ADR-003, ADR-005).
- **#6** M1 spec: G1 decisions, M1 scope, G2 design (approved with conditions), plan.

## 2026-10-03 — Foundation
- **#5** Deploy web + API as one Vercel project (Services) (ADR-002).
- **#1–#4** CI action bumps (`pnpm/action-setup`, `setup-node`, `checkout`, `supabase/setup-cli`).
