# FanZuP agent layer — Integration strategy
**Change:** [CR-003](../changes/CR-003-agent-layer.md) · **Date:** 2026-11-26 · **Owner:** Wayne · **Tier:** Enterprise (inherits v2; the agent layer sits next to custodied money)
**Source:** the consultant report "FanZuP Agent Strategy" (2026-11-26), v2 brief and requirements, councils D1/E1/G1, M1 and L2 status, this repository at `0bb1182`.

## 1. The rule every phase inherits
**Agents propose, people decide, the ledger executes.**
1. No agent holds a credential that can write money tables, call money functions or call a provider's write API.
2. An agent's only writes are its own task, run and proposal rows. Every action a proposal suggests is carried out, if at all, by a person through the existing staff API, with its step-up, single-operator delay and limits.
3. An agent never counts as a reviewer, verifier or approver for FR-ID-003 purposes.
4. If the agent layer is off or broken, every queue and SLA works exactly as it does today.

## 2. How agents plug into what already exists
| Existing piece | How the agent layer uses it |
|---|---|
| Workflow functions and audit (`submit_campaign`, `audit_events.actor_kind`) | A trigger on `campaigns` enqueues an agent task when a campaign enters `in_review`. Agent writes are audited with actor kind `system:agent:<name>`. |
| Correlation ids (ADR-005) | Each task carries the correlation id of the change that created it; runs and proposals inherit it, so `/staff/trace/:cid` shows them. |
| DB-backed jobs with bounded attempts and dead letters (NFR-OPS-05) | `agent_tasks` follows the same rules: per-type claim with `skip locked`, attempts capped, dead state, staff-visible. |
| Server-enforced flags (FR-PLT-001) and `flag.set` | New flag `agents`, off by default, set only through the audited staff action. |
| Column allowlists (NFR-SEC-01) and least-privilege roles (NFR-SEC-05) | New database role `fanzup_agent` that can read only `agent_v_*` views and write only agent tables. Enforced by Postgres, not by convention. |
| Staff console queues (FR-ADM-001) | Proposals attach to the queue item they concern (`subject_kind`, `subject_id`). Staff record a verdict (agree, partial, disagree) which feeds the agreement metric. |
| Copy rules (`lint:copy`, Brand §7.4, NFR-COMP-23) | The same banned-language list runs deterministically over campaign text and over anything an agent drafts. |
| Separate worker process (ADR-002) | The agent worker is its own process, so model latency or a model outage can never delay settlement, refunds or payouts. |

## 3. Runtime choice
Phase 0 agents are **code-driven workflows**: deterministic gathering and checks, then one model call with a strict JSON schema and **no tools**. That is the simplest tier that meets the need, keeps untrusted campaign text away from anything that can act, and keeps data on FanZuP's own infrastructure. Later agents that genuinely need to explore (evidence analysis, break investigation) can add a tool loop on the same runtime with read-only tools. Anthropic's hosted Managed Agents was considered and not chosen for now: it is not zero-data-retention eligible, and the custody and privacy posture (NFR-COMP-21, NFR-SEC-08) favours keeping personal and money data in-house.

- Model: Claude Opus 5.5 (`claude-opus-5-5`) through the Messages API, structured outputs, server-side refusal fallback on. Configurable per agent.
- Model provider is a boundary like ADR-003: `none` (deterministic only), `fake` (tests, refused when deployed), `anthropic`.
- With provider `none` or after the model fails its attempts, an agent still writes its deterministic findings, marked as such. The agent degrades to a checklist, never to nothing.

## 4. Phasing
| Phase | Milestone | Agents | Exit criteria |
|---|---|---|---|
| **0 (this change)** | now → M2 | Foundation; **A8 Ops Steward** (weekly single-operator review pack); **A1 Campaign Review Copilot** (review packet on submission) | Migration, role, flag, worker, staff endpoints, tests green; flag on in staging with a model key; ≥ 20 verdicts recorded |
| 1 | M2 closed beta | A2 Milestone Evidence Analyst; A3 Reconciliation Break Investigator on Stripe test; A6 Artist Coach (drafts only) | Agreement ≥ 95% on 50 consecutive A1 packets before any A1 autonomy is discussed |
| 2 | M3 live money | A4 Support and Dispute; A5 Fulfillment Watchdog; A7 Risk Sentinel | Counsel memo covers the agent role; model vendor DPA signed; threat model updated |
| 3 | M4 GA | Narrow autonomy (ledger-derived status replies, pre-submit feedback) | Each autonomy grant is a policy value Wayne accepts, with its measured agreement |

Layer 2 stays out of scope for agents until the L2 counsel items are closed.

## 5. Shadow mode and earning autonomy
Every agent starts in shadow mode: it prepares, staff decide and record a verdict. The agreement rate per agent is visible at `/staff/agents/metrics`. Autonomy for a specific, narrow action is a later change request that cites the measured rate. Phase 0 grants none.

## 6. Data and vendor posture
- Agents read through views that exclude email, addresses, payout references, identity references and verification evidence. Phase 0 views carry no personal data beyond display names and handles.
- Model inputs and outputs are stored in `agent_runs` as a SHA-256 digest of the input and the parsed output; prompts are versioned in code.
- Before real user data reaches the model vendor: a DPA (NFR-COMP-21), the vendor listed in the Privacy Notice, and the retention setting chosen.

## 7. What we will not build
A fan-facing chatbot first; agents that move money or post to the ledger; AI-decided approvals, suspensions or sanctions clearances; generated social proof or urgency; recommendations ranked by money; anything that promotes or explains a Layer 2 offering.

## 8. Open questions
| # | Question | Who |
|---|---|---|
| AGT-Q1 | Model vendor terms: retention setting, DPA | Wayne |
| AGT-Q2 | Does agent-prepared review or verification affect the custody posture or "escrow" wording? | Counsel (with E1-B) |
| AGT-Q3 | Automated-decision rules in state privacy laws for the future risk agent (A7) | Counsel |
| AGT-Q4 | Agreement target before autonomy (proposed: 95% on 50 consecutive items) | Wayne |
