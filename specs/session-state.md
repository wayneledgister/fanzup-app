# Session state · FanZuP · 2026-11-27
**Active:** sdd-document / sdd-continuity · documentation audit of `main` after PRs #24–#26, plus PR #27's contracts and docs
**Last completed (merged on `main`):** M1 walking skeleton (PRs #6–#9); Layer 2 demo on mock rails (CR-002, PRs #10–#13); agent layer Phase 0 (CR-003, PR #24); mobile app MOB-1 (CR-004, PR #25); API pinned to TypeScript 5.9 for Vercel (PR #26, decision log DL-001); dependency bumps (#15–#23). See `CHANGELOG.md`.
**In flight:**
- Draft PR #27, services marketplace MKT-1 (CR-005, ADR-010) — built and tested in the sandbox; docs completed by the audit (README, SETUP, worklog, FR-PLT-001 flag list, design §1). After the docs PR merges, PR #27 must add its 9+ routes to `docs/API.md` and regenerate `specs/traceability.md` (CI tells it to).
- Draft PR #28, user-policy first drafts for counsel (`docs/legal/`); Word copies in the project files.
- Docs PR from this audit (`docs/sdd-sync-2026-11-27`): `docs/API.md` + drift test, `specs/traceability.md` + CI check, `docs/adr/README.md`, `CHANGELOG.md`, this file.
- Wayne's local branch `docs/local-testing-runbook` (not pushed; the project file `LOCAL-TESTING.md` is its copy).
**Pending decisions (Wayne):** D-001 (late-capture deadline judged at processing time, `04-worklog.md`); G2 sign-off for M1 (with the post-gate delta) and G3; AGT G1+G2 sign-off and AGT-Q1 (vendor terms); CR-004 and CR-005 G1+G2 self-reviews; E1-A/B/C defaults hold (no live money, Stripe test only, FanZuP absorbs refund fees).
**Manual steps (Wayne):** Stripe test keys + webhook + Connect + platform float; hosted Supabase Auth redirect and staff TOTP; exit test 8 (`docs/SETUP.md` Part F); Render agent worker (`AGENT_DATABASE_URL`); Expo account, bundle id, Apple/Google developer accounts, EAS env, first preview build (`docs/MOBILE.md`); provider recruitment and counsel questions MKT-Q1…Q8 (CR-005).
**Open questions:** the 79 requirements marked "spec only" in `specs/traceability.md` are mostly P0b/P1/P2 (M2+); the P0a ones in that list need a triage pass at M2 planning (see the audit gate record).
**Do NOT redo:** E1, G1, G2 passes, L2-G1G2, AGT-G1G2, every PR review round recorded in `04-worklog.md` and `specs/gates/`; the 2026-11-27 documentation audit (`specs/gates/DOC-2026-11-27-audit.md`).
**Resume by:** read this file, `CHANGELOG.md` and `specs/gates/DOC-2026-11-27-audit.md`; then merge order #27 → rebase onto the docs PR, add its rows to `docs/API.md`, `pnpm trace`.
