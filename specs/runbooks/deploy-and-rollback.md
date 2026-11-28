# Runbook: deploy and rollback · FanZuP web, API, worker, database
**Owner:** Wayne · **Status:** active · **Date:** 2026-11-27 · **Requirements:** NFR-OPS-01, NFR-OPS-07, NFR-OPS-12, NFR-SEC-04, NFR-SEC-07 · **Decisions:** ADR-002 (hosting), DL-001 (API TypeScript pin)

This is how a change reaches users and how to take it back. One-time account setup is in `docs/SETUP.md`; this file assumes it's done.

## 1. What a merge to `main` does
One merge starts three deploys at about the same time. Nothing orders them.

```
merge PR to main
 ├─ Vercel (Git integration)      builds web + api from vercel.json → one production deployment, swapped in atomically
 ├─ Render (Auto-Deploy "After CI checks pass")   waits for CI on main, rebuilds fanzup-worker, restarts it
 └─ Supabase GitHub integration   applies new files in supabase/migrations/ to the linked project ("Deploy to production")
```

Consequences you have to design for:
- **Old code meets the new schema.** For a minute or more, the previous API and worker run against a database that already has the new migration. After a code rollback, they run against it indefinitely. So **every migration must work with the code before it** (expand → deploy → contract, NFR-OPS-07): add columns nullable or with defaults, add new functions beside old ones, and drop or rename only in a later PR once nothing calls the old shape.
- **Web and API ship together.** They are one Vercel deployment, so there's no version skew between the browser bundle and `/api` (except users with an old tab open — keep API changes backwards-compatible for one release).
- **The worker can lag.** Render deploys only after CI passes on `main`; until then the old worker runs against the new schema. Same rule as above.
- **Migrations are forward-only.** Supabase has no down-migrations. "Rolling back" the schema means a new forward migration that undoes the change, or a point-in-time restore (§5.4), which loses data written since.

## 2. Before you merge (pre-deploy checklist)
Run through this on the PR. Each line is quick; skipping one is how a bad deploy happens.

| # | Check | How |
|---|---|---|
| 1 | CI is green on the PR: Web, API, Mobile and E2E jobs | PR → Checks. E2E isn't a required check yet (readiness C-4), so look at it yourself |
| 2 | The Vercel preview works | PR → Vercel bot comment → open the preview; `…/api/health` returns `ok:true` (or the intended 503 `misconfigured` if preview env vars aren't set) |
| 3 | Migrations are expand-only, or the contract step's callers are already gone | Read every new file in `supabase/migrations/`. Any `drop`, `rename`, `alter … type`, `not null` without default, or changed function signature → stop and split the PR |
| 4 | Ledger or audit tables touched? | Any migration that touches `ledger_*`, `audit_*`, money functions or RLS on them needs a second review pass (NFR-OPS-07; the single-maintainer rule proposed in the backlog is a recorded agent review plus a delay before merge) |
| 5 | New env var? | Added to `apps/api/src/env.ts`, `apps/api/.env.example`, `docs/SETUP.md` D1/D2, `render.yaml` (if the worker needs it) and **set in Vercel/Render before merging**. A deployed API with missing config serves 503 `misconfigured` (by design, NFR-SEC-04) |
| 6 | New route? | Row in `docs/API.md` (the drift test fails otherwise) |
| 7 | Risky path behind a flag? | New user-facing money or marketplace behaviour ships with its flag off (`flag.*` in `platform_settings`); turn it on after the deploy is verified |
| 8 | Docs in step | `CHANGELOG.md` entry, `pnpm trace` run, worklog entry |
| 9 | Not a Friday-night money change | Settlement and refunds run every 30 s. Merge money-path changes when you can watch for an hour |

## 3. Deploy (normal path)
1. Squash-merge the PR on GitHub.
2. **Vercel:** Deployments → the new production deployment → wait for **Ready** (about 1–3 min). If the build fails, nothing changed for users: the previous deployment keeps serving. Fix forward.
3. **Supabase** (only if the PR has migrations): Database → Migrations → the new version is listed. If the integration is off, run **Actions → Deploy database migrations → Run workflow** (staging job first; production waits for your approval when `PROD_DEPLOY_ENABLED` is set).
4. **Render:** fanzup-worker → Events → the deploy for the merge commit → **Live**. Logs show `{"msg":"worker.start",…}`.
5. Run the **verification probes** (§4). If any fails, go to §5.
6. Note the deploy in the PR (merge commit, time, probe results) if it touched money paths.

### Changing only an environment variable
Vercel and Render apply env var changes **only on the next deploy**. Vercel: Deployments → latest production → ⋯ → **Redeploy** (keep "Use existing build cache"). Render: Manual Deploy → **Deploy latest commit** (or it restarts on save). Then run §4.

## 4. Verification probes (run after every production deploy)
Replace `$SITE` with the production URL. Each takes seconds.

| # | Probe | Expect | If not |
|---|---|---|---|
| P1 | `curl -s $SITE/api/health` | `{"ok":true,"provider":"stripe-test","testMode":true,"worker":{"ageSeconds":<60…}}` | 503 `misconfigured` → env var missing (body names it), fix and redeploy. 503 `database_unavailable` → incidents §DB. `provider` not `stripe-test` → stop, roll back |
| P2 | `curl -s $SITE/api/v1/config` | `provider`, `stripePublishableKey` starting `pk_test_`, `flags` as you expect (all `false` unless you turned one on) | A flag on you didn't intend → turn it off (§5.1) |
| P3 | Open `$SITE/` and `$SITE/explore` in a private window | pages render, no console errors, deep link isn't a 404 | roll back the deployment (§5.2) |
| P4 | Sign in as your own fan test account | sign-in works; "Backed" loads | Supabase Auth settings or `VITE_SUPABASE_*` wrong → incidents §Auth |
| P5 | Worker age 1–2 min after Render says Live | `worker.ageSeconds` < 60 in `/api/health` | incidents §1 (worker down) |
| P6 | After a money-path change only: `pnpm m1:operator … staff queue dead_letters` and `staff recon run` | empty dead letters; recon total diff 0 (float reported separately) | incidents §4 (recon break) |
| P7 | Vercel → Logs, last 15 min, filter `api.error` | nothing new | read the correlation id, `staff trace` it, decide roll back vs fix forward |

## 5. Rollback
### When to roll back (decide before, not during)
Roll back **without debating it** when any of these is true within an hour of a deploy:
- P1, P3 or P4 fails and the cause isn't a one-line env var fix.
- `api.error` lines or 5xx responses on `/api/v1/backings` above 2% over 5 minutes (NFR-OPS-11 checkout 5xx threshold).
- Any money symptom: a recon break, a dead-lettered refund or payout, or a ledger invariant error appears after the deploy.
- The worker crash-loops (Render shows repeated restarts, no `worker.tick`).

**Who pulls it:** Wayne (the only operator). If you can't be reached, nobody else can roll back yet (risk R-07). For anything touching money, prefer turning the feature off (§5.1) or rolling back code (§5.2/5.3) over a database restore (§5.4).

### 5.1 Turn the feature off (fastest, no deploy)
Flags are server-side and audited. From a staff session with a second factor:
```
POST $SITE/api/v1/staff/flags/<flag>   {"on": false, "reason": "<why, 10+ chars>"}
```
`<flag>` ∈ `layer2`, `agents`, `marketplace` (`docs/API.md`). The web and mobile apps read `GET /api/v1/config` and hide the feature. Takes effect immediately; no data is lost.
There is **no flag to pause checkout or payouts** yet (NFR-OPS-12 degrade modes, P0b; readiness gap R-3a). Payouts do pause automatically on a payout-pausing recon break (design §7).

### 5.2 Roll back the web and API (Vercel)
1. Vercel → Project → **Deployments** → the last good production deployment → ⋯ → **Instant Rollback** (CLI: `vercel rollback <deployment-url>`). It swaps the domain back in seconds with no rebuild; the web and API go back together.
2. While rolled back, Vercel stops auto-assigning new production deployments to the domain. When the fix is merged, **promote** the new deployment (⋯ → Promote) or the domain stays on the old one.
3. Run P1–P4.
4. Plan limits: on the Hobby plan, Instant Rollback may only go back to the immediately previous production deployment; to go further back, redeploy that commit (Deployments → ⋯ → Redeploy) or `git revert` and merge.

### 5.3 Roll back the worker (Render)
1. Render → fanzup-worker → **Events** → the last good deploy → **Rollback** (or Manual Deploy → Deploy a specific commit).
2. **Turn Auto-Deploy off** while rolled back, or the next merge redeploys the bad code. Turn it back on after the fix is merged.
3. Check P5. The worker is idempotent and resumes where it left off (leases + `SKIP LOCKED`); a restart loses nothing.
4. If the change was in `apps/api`, roll back **both** Vercel (§5.2) and Render: they're the same code.

### 5.4 Roll back the database
Pick the least destructive option that works:
1. **Fix forward (default).** Write a new migration that reverses or repairs the change, merge it through the normal path. Use this for any schema mistake that hasn't corrupted data.
2. **Code rollback only.** If the migration was expand-only (§1), the old code runs fine on the new schema: roll back code (§5.2/5.3) and leave the schema.
3. **Point-in-time restore (last resort; data loss).** Supabase → Database → Backups → **Point in time** → a time just before the bad migration. Everything written after that time is lost, including backings, provider events and ledger postings. Before you do it:
   - Turn the worker off (Render → Suspend) so nothing settles during the restore.
   - Note the restore time; afterwards, every Stripe event and money movement after it must be replayed or reconciled: run `staff recon run` and work every break (incidents §4) before resuming the worker.
   - Needs the Pro plan with the PITR add-on (NFR-OPS-01/02). **The staging project appears to be on the Free plan (only Free projects pause), which has no restorable backups, and it is currently paused**, and `fanzup-prod` doesn't exist yet (readiness R-2, risk R-01). Until that's fixed, option 3 isn't available.
4. **Never** run `supabase db reset --linked` on a hosted project: it drops the data and loads the seed (published passwords, a staff account; NFR-SEC-07, SETUP B3a).

### 5.5 After any rollback
- Post in the PR what happened, the time, and which option you used.
- If users saw errors or money was affected, open a postmortem (`incidents.md` §Postmortem). Money affected = SEV1 by definition.
- Revert or fix on a branch; the fix goes through the normal checklist (§2), including a test that would have caught it.

## 6. Staging and production
Today there is **one** hosted environment: Supabase `fanzup-staging` (paused), the Vercel project's production deployment, and one Render worker with `DEPLOY_ENV=staging`. NFR-OPS-01 requires production to have its own database project with PITR, its own web/API environment and its own worker before real users. Target layout (readiness blocker B1):

| | Staging | Production |
|---|---|---|
| Supabase | `fanzup-staging` | `fanzup-prod`, Pro + PITR, East US |
| Vercel | Preview deployments (env scope **Preview** → staging DB) | Production deployment (env scope **Production** → prod DB) |
| Render | `fanzup-worker-staging`, `DEPLOY_ENV=staging` | `fanzup-worker`, `DEPLOY_ENV=production` |
| Stripe | test mode, staging webhook endpoint | test mode until custody is approved (FR-PAY-008), its own webhook endpoint and secret |
| Migrations | integration on `main` | `db-deploy.yml` production job with required reviewer, `PROD_DEPLOY_ENABLED=true` |
| Seed | never | never |

When prod exists, migrations go to staging first, P1–P7 run there, then production.

## 7. Rehearsal
A runbook that hasn't been run is a guess. Before the closed beta (G5): on staging, deploy a harmless change, Instant-Rollback it, roll the worker back, and restore the database to a point in time once; time each step and write the times here. Record the drill in `specs/04-worklog.md` (readiness R-1, R-11).

| Drill | Date | Time taken | Notes |
|---|---|---|---|
| Vercel Instant Rollback | — | — | not run yet |
| Render rollback | — | — | not run yet |
| PITR restore + recon on the restored copy (NFR-OPS-02) | — | — | needs Pro + PITR |
