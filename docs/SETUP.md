# FanZuP backend setup: what you do by hand

Everything that can be done in code is already in the repo. These are the steps that need **your accounts, passwords or approvals**, in order. Each part ends with a check, so you know it worked before moving on.

**Time:**
- Part A (local): about 30 minutes
- Parts B–E (hosted): about 1–2 hours
- Part G (escrow partner): weeks, and it runs alongside everything else

**Layout:**
```
apps/web          React app        ┐ one Vercel project (root vercel.json):
apps/api          API + cron tick  ┘ web at /, api at /api
packages/shared   rules shared by web and API (tiers, policy, money, schemas)
supabase/         migrations, seed, config  (Supabase)
```
The reasons for one repo are in [`docs/adr/ADR-001-monorepo.md`](adr/ADR-001-monorepo.md).

---

## Part A: Run everything on your Mac

### A1. Install the tools (once)
1. Install **Docker Desktop** (docker.com) and start it. The local Supabase stack runs in Docker.
2. Install **Node 22**: `brew install node@22`, or use nvm.
3. Enable pnpm: `corepack enable`.
4. Install the **Stripe CLI**: `brew install stripe/stripe-cli/stripe`. It's only needed for step A5.

The Supabase CLI is already a dev dependency of the repo, so you don't install it separately.

### A2. Get the code and dependencies
```bash
git clone https://github.com/wayneledgister/fanzup-app && cd fanzup-app
pnpm install
```

### A3. Start the local database
```bash
pnpm db:start      # first run downloads images: ~5 min
pnpm db:reset      # applies supabase/migrations/* and supabase/seed.sql
pnpm exec supabase status
```
Keep the `status` output open; you need its URLs and keys in A4.

**✅ Check:** open **Studio** at http://127.0.0.1:54323 → Table Editor. You should see four live campaigns in `campaigns` and ten rows in `perks`.

The seed creates these test users. Every password is `FanzupDev123`.

| Email | Who |
|---|---|
| `fan@fanzup.test` | Jordan Pierce (fan) |
| `nova@fanzup.test` | Nova Reyes (artist) |
| `sol@fanzup.test` | Sol Amara (artist) |
| `velvet@fanzup.test` | Velvet Circuit (artist) |
| `lowends@fanzup.test` | The Low Ends (artist) |
| `reviewer@fanzup.test` | Compliance reviewer (staff) |

### A4. Run the API
```bash
cp apps/api/.env.example apps/api/.env
pnpm dev:api        # http://localhost:8787
```
The defaults in `.env` already point at local Supabase.

**✅ Check:** `curl localhost:8787/api/health` returns `{"ok":true,"escrow":"sandbox"}`.

If authenticated calls return 401, your local Supabase signs tokens with the legacy shared secret. Copy `JWT_SECRET` from `pnpm exec supabase status -o env` into `SUPABASE_JWT_SECRET` in `apps/api/.env`, then restart the API.

### A5. Walk the whole money flow locally (sandbox escrow, no real payments)
```bash
ANON=<"anon key" from supabase status>
TOKEN=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "content-type: application/json" \
  -d '{"email":"fan@fanzup.test","password":"FanzupDev123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

# Back Sol Amara's show: General admission, $30
curl -s localhost:8787/api/v1/backings -H "authorization: Bearer $TOKEN" -H "idempotency-key: demo-0001" \
  -H "content-type: application/json" \
  -d '{"campaignId":"dbe19d49-d0c5-54da-b4bf-0ff0c03d5e27","perkId":"3835231c-7f19-5da7-88f7-02e8a3f255b6","quantity":1}'
# → {"backingId":"…"}  then pretend the processor confirmed it:
curl -s -X POST localhost:8787/api/v1/dev/sandbox/confirm-payment/<backingId>

# Jump past the deadline: the goal isn't met, so the campaign fails and the backer is refunded in full
curl -s -X POST "localhost:8787/api/v1/dev/sandbox/tick?now=2027-03-01T00:00:00Z"
```
**✅ Check:** in Studio, look at `campaigns`, `backings` and the `ledger_balances` view:
- the campaign is `refunded`
- the backing is `refunded`
- every per-campaign ledger account is `0`

### A6. Run the tests
The tests need a Postgres server they can create and drop scratch databases on. Local Supabase works:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test
```
**✅ Check:** 26 tests pass. They cover:
- the ledger always balancing
- funded and failed flows
- idempotency
- RLS
- shared rules matching the database

---

## Part B: Create the hosted Supabase projects

### B1. Create two projects
1. Go to supabase.com → **New project**. Create **`fanzup-staging`** and **`fanzup-prod`**.
2. **Region: East US (North Virginia).** This sits next to the API host, and FanZuP LLC is a Virginia entity.
3. Generate a strong **database password** for each project and save it in your password manager. You'll need it in B3 and E2.
4. From each project's URL, `supabase.com/dashboard/project/<ref>`, note the **project ref**.

### B2. Auth settings (both projects): Dashboard → Authentication
1. **URL Configuration:**
   - Site URL = your web URL. Use the Vercel URL from Part D for now; switch to your domain later.
   - Add the same URL to **Redirect URLs**.
2. **Sign In / Providers → Email:**
   - **Confirm email:** on
   - **Secure password change:** on
   - Minimum password length **10**, requiring lowercase, uppercase and digits
3. **Multi-Factor:** enable **TOTP (App Authenticator)**. PRD 01 requires MFA.
4. **Emails → SMTP:** before real users, set up a custom SMTP sender such as Postmark or Resend. Supabase's built-in sender is rate-limited and meant for testing only.

### B3. Push the schema
```bash
pnpm exec supabase login                          # opens the browser once
pnpm exec supabase link --project-ref <staging-ref>   # asks for the DB password
pnpm exec supabase db push                        # applies supabase/migrations
```
- **Staging only:** to load the test users and campaigns, run `pnpm exec supabase db push --include-seed`.
- **Production:** never load the seed. Its users have a published password.
- Do **not** push to prod by hand. After Part E, GitHub does it with your approval.

### B4. Make yourself a reviewer
In **SQL Editor** on staging, after signing up through the app or Auth → Add user:
```sql
insert into public.staff (user_id, role)
select id, 'admin' from auth.users where email = 'wayne.ledg@gmail.com';
```

### B5. Check one Supabase-specific detail
The API switches database roles to apply RLS. Run this in **SQL Editor**:
```sql
select pg_has_role('postgres','service_role','member') as svc,
       pg_has_role('postgres','authenticated','member') as authd,
       pg_has_role('postgres','anon','member') as anon;
```
**✅ Check:** all three are `true`, which is the Supabase default. If any is false, run `grant anon, authenticated, service_role to postgres;` and send me the result.

---

## Part C: Stripe test mode (development payments only)

> **Stripe is not your escrow.** Stripe's own docs say it doesn't provide escrow services. Mechanism 05's moat is a third-party escrow / FBO partner (Part G). Stripe is wired in **test mode only**, so checkout, webhooks and refunds can be built and tested end to end. The API refuses to start the Stripe adapter with a live key.

1. Create a Stripe account and stay in **Test mode**. Don't activate live payments.
2. Copy the **Developers → API keys → Secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
3. **Local:** run `stripe listen --forward-to localhost:8787/api/v1/webhooks/stripe` and put the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`. Set `ESCROW_PROVIDER=stripe-dev`.
4. **Hosted, after Part D (Vercel):**
   - Go to Developers → **Webhooks** → Add endpoint `https://<your-vercel-domain>/api/v1/webhooks/stripe`.
   - Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`.
   - Put its signing secret in Vercel as `STRIPE_WEBHOOK_SECRET`.

---

## Part D: Host the web app and API on Vercel (one project, two services)
The root `vercel.json` deploys both apps as **Vercel Services** in one project on one domain:

| Path | Service | Source | Public? |
|---|---|---|---|
| `/api/*` | `api` | `apps/api` (Fastify, runs as one Vercel Function) | yes |
| everything else | `web` | `apps/web` (Vite static site, falls back to `index.html`) | yes |
| `/api/internal/tick` every 5 min | cron → `api` | replaces the worker loop on Vercel | only with `CRON_SECRET` |

The browser calls the API at the same-origin `/api`, so there's no CORS and no API hostname to configure.

1. **Plan check.** Vercel **Hobby** runs cron jobs at most **once a day**, and a deploy with the 5-minute schedule fails on Hobby. Settlement and refunds need it more often, so either use **Pro**, or tell me and I'll move the worker to Render (`render.yaml`, kept as the alternative).
2. Go to vercel.com → **Add New → Project** → import `wayneledgister/fanzup-app`. Leave **Root Directory** as the repo root (`./`). Vercel reads `vercel.json` and shows the two services.
3. **Environment variables** (Settings → Environment Variables; Preview = staging values, Production = prod values):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase → **Connect** → **Transaction pooler** string (port **6543**) with your password. Serverless functions should use the transaction pooler; the code turns prepared statements off for port 6543 automatically. |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `CRON_SECRET` | a random string of 16+ characters (a password generator works). Vercel sends it to the cron endpoint automatically. |
   | `STRIPE_SECRET_KEY` | your `sk_test_…` key |
   | `STRIPE_WEBHOOK_SECRET` | from step C4 |
   | `ESCROW_PROVIDER` | `stripe-dev` (or `sandbox` with no Stripe) |
   | `DB_POOL_MAX` | `3` |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | Supabase → **publishable (anon)** key. It's safe in the browser because RLS protects the data. **Never** put the secret/service key in a `VITE_` variable. |
   | `VITE_FLAG_LAYER2`, `VITE_FLAG_POSTBETA` | `false` |

4. **Deploy**, then run these checks against your Vercel URL:
   - `https://<your-app>.vercel.app/api/health` returns `{"ok":true,…}`
   - `https://<your-app>.vercel.app/campaigns/nova-live-band-tour` loads the page, not a 404
   - Settings → **Cron Jobs** lists `/api/internal/tick`
5. Put the Vercel URL into Supabase → Authentication → **Site URL** and **Redirect URLs** (B2).

**Local:** `pnpm dev:web` + `pnpm dev:api` (Vite forwards `/api` to `:8787`), or `npx vercel dev` at the repo root to run both services exactly as Vercel does.

---

## Part E: GitHub settings (repo → Settings)
1. **Environments:** create **`staging`** and **`production`**.
   - On `production`, tick **Required reviewers** and add yourself. Every prod migration then waits for your click.
   - In each environment add:
     - **secret** `SUPABASE_ACCESS_TOKEN`: create at supabase.com/dashboard/account/tokens
     - **secret** `SUPABASE_DB_PASSWORD`: that project's password
     - **variable** `SUPABASE_PROJECT_REF`: that project's ref
2. **Secrets and variables → Actions → Variables (repository):** add `DB_DEPLOY_ENABLED` = `true`. The migration-deploy workflow stays switched off until you do this. Production deploys are switched off separately: add `PROD_DEPLOY_ENABLED` = `true` only once a separate `fanzup-prod` project exists. To push the schema (and, on staging, the demo data) without a local clone, go to **Actions → Deploy database migrations → Run workflow** and tick *include_seed*.
3. **Branches → add rule for `main`:** require a pull request and the status checks **"Web · typecheck, copy rules, build"** and **"API · migrations, ledger, RLS, flow tests"**. These check names appear after the first CI run.
4. **✅ Check:** open a small PR. Both CI jobs run and turn green. After you merge a change under `supabase/migrations/`, the **Deploy database migrations** workflow runs on staging, then waits for your approval before production.

---

## Part G: Escrow partner (start now; it's the long pole)
PRD 01 §14 says partner paperwork takes 6–12 months. Escrow is the trust promise in Mechanism 05. Questions to ask:
- **North Capital (TransactAPI, has a sandbox):**
  - Will you escrow **reward-based, non-securities** campaigns, or only Reg CF and Reg A offerings?
  - Do you support target-or-refund with **milestone (tranche) releases**?
  - How do I get sandbox access?
- **Bank FBO (Column, Increase or Treasury Prime, with Modern Treasury on top):**
  - Can you open a **ring-fenced FBO account** per platform with sub-ledgering per campaign?
  - What are the underwriting timeline and the money-transmission posture?

When a partner is chosen, I add one file, `apps/api/src/escrow/<partner>.ts`, implementing the `EscrowProvider` interface. Nothing else in the codebase changes.

---

## Decision I made that you should confirm
**Processing fees on refunds.** When a campaign fails, every backer gets the **full** amount back, which is the escrow promise in Brand §7.3. Card processors don't return their fee on refunds, so **FanZuP absorbs it**. In the ledger, that cost lands in `platform_absorbed_fees`.

The alternative is refunding backers net of fees, which breaks "refunded automatically" in spirit. The other alternative, only authorizing cards and capturing at the deadline, doesn't work for campaigns longer than about a week, because standard card authorizations expire.

Tell me if you want it changed. It's one function, `record_backing_refunded`.
