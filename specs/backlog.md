# Backlog: FanZuP app

| Item | Origin | Value hypothesis | Size | Added |
|---|---|---|---|---|
| Disputes & refunds full admin queues | CONSOLIDATION (summaries only on /admin) | Fulfillment failure is a named Mechanism 05 risk; ops needs real queues | M | 2026-10-03 |
| Promote shared kit (Modal, Toggle, SegmentedTabs, CopyCode, FileDrop) into `components/brand` | Build agents' reports | Removes 3 near-duplicate implementations across fan, creator and campaign | S | 2026-10-03 |
| Wire admin SLA display to `POLICY.adminSlaBusinessDays` | D1 pass 2 | One source for SLA targets | S | 2026-10-03 |
| Wire the web app to the API (campaign list/detail, back flow, Supabase Auth sign-in) | Backend setup 2026-10-03 | Turns the prototype into a working Fund My Show | M | 2026-10-03 |
| Port the 93-route Playwright sweep into CI | Backend setup 2026-10-03 | Catches visual/overflow regressions on every PR | S | 2026-10-03 |
| Escrow partner adapter (`apps/api/src/escrow/<partner>.ts`) | SETUP.md Part G | Production custody; replaces Stripe dev adapter | M | 2026-10-03 |
| Layer 2 for real: W-9/TIN tokens, intermediary + escrow agent integration (replace mock), transfer agent, reconfirmation on material change, state notice filings | PRD 01a, council D1; CR-002 built the schema and a demo on mock rails | Needed before `layer2` can go on anywhere real | XL | 2026-10-03 |
| Perk fulfillment + disputes API | Mechanism 05 §5 | Fulfillment failure is a named risk | M | 2026-10-03 |
| North Capital TransactAPI adapter behind `RegCfProvider` | CR-002 / ADR-007 | Swaps the mock for a real sandbox once keys arrive (L2-Q4) | M | 2026-10-03 |
| Staff UI to cancel scheduled privileged actions and view the weekly review | CR-002 demo | Single-operator delay is visible but only cancellable via API | S | 2026-10-03 |
