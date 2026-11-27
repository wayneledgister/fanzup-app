# RAID log · FanZuP (risks, assumptions, issues, dependencies)
**Owner:** Wayne · **Status:** active · **Date:** 2026-11-27 · **Scope:** web closed beta on test money (M2) and the path to live money (M3) · **Review:** at every gate (G5, G6) and monthly until GA

Scores: **L**ikelihood and **I**mpact 1–5, score = L × I. ≥ 15 is red (must have an owner and a dated mitigation before G5), 8–14 amber, ≤ 7 green. Ids are stable; close a row with the date and how, never delete it. Engineering findings link to `specs/05-readiness.md` item ids; failure modes link to `specs/fmea.md`.

## Risks
| ID | Risk | L | I | Score | Mitigation | Owner | Due / trigger | Status |
|---|---|---|---|---|---|---|---|---|
| R-01 | **No production environment and no backups.** Only `fanzup-staging` exists, on a plan with no backups, and it was **paused** on 2026-11-27. A bad migration or provider incident could lose every backing and ledger row with no restore. | 4 | 5 | **20** | Create `fanzup-prod` (Pro + PITR, East US); move staging to a plan that doesn't pause or accept re-restoring it; separate Vercel Production env vars and a production Render worker; run one PITR restore drill (NFR-OPS-01/02) | Wayne | before M2 beta invites | Open |
| R-02 | **Hosted app never exercised end to end.** Exit test 8 (one Stripe test-mode run on the hosted app) hasn't been run; CI and local runs use the sandbox provider. Sandbox-vs-Stripe differences (event order, fund availability, fees) surface in front of beta users. | 4 | 4 | **16** | Run SETUP Part F on staging; record ids and recon result in the worklog; add an optional Stripe test-mode CI job once keys exist (design §15.1) | Wayne | before M2 beta | Open |
| R-03 | **Nobody is told when it breaks.** No error tracker, uptime monitor or pager; `alert`-level log lines go only to Vercel/Render logs. A dead-lettered refund or a stopped worker is found only by looking (E1 F13). | 4 | 4 | **16** | Error tracker on API, worker and web (NFR-OPS-04); external check of `/api/health` every 5 min that pages when `worker.ageSeconds` > 600 (NFR-OPS-06); log drain alert on `"level":"alert"` | Wayne | before M2 beta | Open |
| R-04 | **Custody posture not approved.** Counsel hasn't opined on custody / money transmission; Stripe says it doesn't provide escrow. Live money can't start, and copy that says "escrow" may be misleading in some states. | 5 | 5 | **25** | Keep FR-PAY-008 fail-closed (test keys only, enforced in `env.ts`); operating agreement → counsel opinion → custodian or Stripe approval (critical path); reword remaining "escrow" copy (G2 C19) | Wayne + counsel | M3 gate (est. 2027-08) | Open (accepted for M2: test money only) |
| R-05 | **User-facing legal documents not approved.** Terms, privacy notice, backer pledge terms, artist agreement are first drafts (PR #28) awaiting counsel. Beta users would accept placeholders. | 4 | 4 | **16** | Counsel review of the drafts; version them in the sign-up acceptance flow (FR-PRV-001) | Wayne + counsel | before M2 beta invites | Open |
| R-06 | **Abuse with no rate limits.** No per-user or per-IP write limits (NFR-SEC-13, P0a; design G-3). Card testing, sign-up spam or request floods are limited only by the unconfirmed-checkout cap and Supabase Auth's own limits. | 3 | 4 | 12 | Shared rate limiter on write routes using `POLICY.rateLimits`; bot challenge on sign-up at P0b | Engineering | M2 | Open |
| R-07 | **Single operator, no backup.** Wayne is the only staff member and the only person who can deploy, roll back or verify milestones. Illness or travel stalls payouts and incident response. | 3 | 4 | 12 | Name a backup with read access to dashboards and a written notice script; second staff member at P0b; weekly review log to an outside reader (backlog N17) | Wayne | M2 | Open (accepted for test money) |
| R-08 | **No browser security headers.** No CSP, frame-ancestors, nosniff, referrer or permissions policy on the web (NFR-SEC-03, P0a). An XSS or clickjacking bug has no second line of defence. | 3 | 4 | 12 | `headers` block in `vercel.json` for the `web` service; CSP in report-only first, then enforced, allowing Stripe and Supabase origins | Engineering | M2 | Open |
| R-09 | **Known vulnerable dependencies.** `pnpm audit --prod` on 2026-11-27: 7 high (6 in `react-router` 7.13.0, pinned exactly so Dependabot range bumps skip it; 1 in `zod` for oversized collections, mitigated by the API's 64 KB body limit), 11 moderate, 5 low. Most react-router highs are in RSC/framework modes the SPA doesn't use. | 3 | 3 | 9 | Bump `react-router` to ≥ 7.18.2 and `zod` to a patched line; add `pnpm audit --audit-level high` to CI (NFR-SEC-09) | Engineering | M2 | Open |
| R-10 | **Database runtimes use the owner role.** API and worker connect as `postgres` through the pooler (only the agent worker has its own role). A leaked `DATABASE_URL` is full control (NFR-SEC-05). | 2 | 5 | 10 | Least-privilege login roles for API and worker; rotate every 90 days; keep the migration role separate | Engineering | before M3 | Open |
| R-11 | **No change control on `main`.** No branch protection; E2E isn't a required check; one maintainer merges. A red or unreviewed change can reach production (NFR-OPS-07). | 3 | 3 | 9 | Protect `main`: PR required, Web + API (+ E2E once stable) required checks; keep the recorded agent review per PR | Wayne | M2 | Open |
| R-12 | **Artist screens show sample data.** `/creator/*` and the landing hero use `@/lib/mock` with fixed 2026 dates ("Ended", negative days left). Beta artists can't manage a real campaign in the web app (FR-PLT-002). | 5 | 3 | **15** | Live artist screens (M2 item 1; separate thread) | Engineering | M2 | In progress |
| R-13 | **Disputes aren't modelled.** A chargeback debits the Stripe balance with no ledger posting; recon flags it, but nothing holds tranches or allocates the loss (NFR-COMP-04, E1 F3). Reward crowdfunding has high "not received" dispute rates. | 2 | 5 | 10 | Dispute ingestion + ledger accounts + tranche hold (P0b); in test money, any dispute is a SEV1 manual investigation | Engineering + counsel | before M3 | Open |
| R-14 | **No account deletion or data export.** Settings promises deletion; FKs make deleting a backer fail; no DSAR path (FR-PRV-003, G-3). Also blocks the store release of the mobile app. | 3 | 3 | 9 | Pseudonymising deletion job + export; audit PII sidecar (backlog N7) | Engineering | before public beta | Open |
| R-15 | **No degrade switches.** No "pledges paused" or read-only switch (NFR-OPS-12, P0b). In an incident the only way to stop checkout is a rollback or forcing the 503 `misconfigured` state. | 2 | 4 | 8 | `flag.checkout` / `flag.payouts` in `platform_settings`, honoured by the API and worker, switchable through `POST /staff/flags/:flag` | Engineering | M2 | Open |
| R-16 | **Built-in Supabase email sender.** Rate-limited and meant for testing; confirmation and reset emails may not arrive for a beta cohort. | 4 | 3 | 12 | Custom SMTP (Postmark or Resend), SPF/DKIM on the sending domain (SETUP B2.4) | Wayne | before M2 beta invites | Open |
| R-17 | **Vendor agreements not recorded.** No DPAs on file for Supabase, Vercel, Render, Stripe, the email sender or Anthropic; the agent layer must not see real user data before AGT-Q1 (retention + DPA). | 3 | 3 | 9 | Collect and file the DPAs; keep `flag.agents` off until AGT-Q1 | Wayne | before M2 beta | Open |
| R-18 | **Platform float runs dry.** FanZuP absorbs the card fee on every refund (E1 card C default). Without a float in the Stripe balance, artist payouts wait for funds. | 3 | 2 | 6 | Float top-up (SETUP C7); `waiting_funds` break never pauses payouts but is visible in recon | Wayne | ongoing | Open |
| R-19 | **Free-plan pausing hides outages.** A paused Supabase project makes the whole hosted app fail with `database_unavailable` until someone restores it. | 4 | 3 | 12 | Folded into R-01: no hosted environment a user can reach runs on a pausing plan | Wayne | with R-01 | Open |

## Assumptions
| ID | Assumption | If wrong | Check by |
|---|---|---|---|
| A-01 | Beta volume stays within design §10 headroom: ≤ 20 campaigns, ≤ 5,000 backings; a 5,000-backer failure refunds in ≈ 25 min | Refund SLA (NFR-PERF-03, 1 h) missed; raise outbox batch or tick rate | Load test before public beta (readiness C-6) |
| A-02 | The sandbox provider behaves like Stripe test mode closely enough that green CI predicts a clean hosted run | Hosted-only bugs | Exit test 8 (R-02) |
| A-03 | One worker instance is enough; a second is safe (SKIP LOCKED + leases) | Settlement lag | Worker tick duration in logs |
| A-04 | Vercel's edge is the only proxy hop (`TRUSTED_PROXY_HOPS = 1`) | Recorded client IPs on consents are wrong | Re-check if a CDN is put in front |
| A-05 | Test-money beta users accept that no real money moves and that FanZuP can reset data | Trust damage | Beta invite copy + terms |
| A-06 | Stripe payouts stay on a **manual** schedule during test mode | Every automatic payout opens a payout-pausing recon break | SETUP C8; recon |

## Issues (happening now)
| ID | Issue | Impact | Action | Owner | Status |
|---|---|---|---|---|---|
| I-01 | Staging Supabase project is paused (seen 2026-11-27 through the Supabase connector: status `INACTIVE`) | Hosted app answers `database_unavailable` | Restore it from the dashboard before any hosted test; decide on R-01 | Wayne | Open |
| I-02 | 30 P0a requirements are "spec only" in `specs/traceability.md` | G5 can't pass with P0a rows untraced | Triage at M2 planning (DOC audit condition 1) | Wayne + engineering | Open |
| I-03 | Gate sign-offs pending: M1 G2/G3, AGT G1+G2, CR-004/CR-005 self-reviews | The record says the system runs on unsigned designs | Wayne to sign or reject | Wayne | Open |
| I-04 | Operator tooling gaps: no CLI command for op/event replay or flags; no staff route to resolve a core recon break | Incident steps need hand-made API calls or SQL | Readiness D-2a/D-2b | Engineering | Open |

## Dependencies
| ID | Dependency | Needed for | Owner | Status |
|---|---|---|---|---|
| D-01 | Operating agreement signed (FanZuP LLC members) | Counsel engagement on custody | Wayne + Carl + attorney | With the attorney |
| D-02 | Counsel opinion on custody / money transmission; Stripe crowdfunding approval or a custodian contract | Live money (M3), FR-PAY-010 | Counsel | Not started |
| D-03 | Counsel review of the 10 user-policy drafts (PR #28) | Beta invites, marketplace (Provider Terms) | Counsel | Pending |
| D-04 | Supabase Pro + PITR for production | R-01 | Wayne (billing) | Not started |
| D-05 | Error tracker, uptime monitor and email sender accounts | R-03, R-16 | Wayne | Not started |
| D-06 | First ~20 marketplace providers recruited | Marketplace beta (flag on) | Wayne | Not started |

## Change log
- 2026-11-27: first version (DOC audit condition 2; launch-gate docs PR).
