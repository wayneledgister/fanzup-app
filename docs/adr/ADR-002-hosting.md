# ADR-002: Vercel for web + API, Render for the worker

**Status:** Accepted · **Date:** 2026-10-03 · **Decider:** Wayne

## Decision
| Piece | Host | Why |
|---|---|---|
| `web` (apps/web) at `/` | Vercel Services | Static site with preview deploys on every PR |
| `api` (apps/api) at `/api` | Vercel Services, same domain | No CORS, one domain, request/response work fits serverless functions |
| Worker (apps/api `worker.ts`) | Render background worker (~$7/month) | Settlement and refunds must run every few minutes. Vercel Hobby cron runs at most once a day; Render runs an always-on loop every 30 seconds. |

- **Service names:** `api` and `web`.
- **Public routing:** both services are public. `/api/*` goes to `api`; everything else goes to `web`.
- **Bindings:** none. The browser calls `/api` publicly, and no server-side code calls another service.
- **DB connections:**
  - Vercel functions use the Supabase **transaction pooler** (6543); prepared statements are turned off automatically.
  - The Render worker uses the **session pooler** (5432).

## Consequences
- `render.yaml` defines only the worker.
- `/api/internal/tick` stays in the API as a fallback trigger. It's hidden unless `CRON_SECRET` is set, so a move to Vercel Pro cron later is a one-line `crons` addition, after which the Render worker can be retired.
- Revisit if Vercel Queues/Workflow or Pro cron becomes the cheaper path, or when the escrow partner pushes events via webhooks (less polling).
