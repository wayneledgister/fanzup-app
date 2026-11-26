# Agent layer, Phase 0 (CR-003) — Requirements
**Tier:** Enterprise (inherits v2) · **Status:** G1+G2 combined pass (`../gates/AGT-G1G2.md`) · **Date:** 2026-11-26
**Authority:** [CR-003](../changes/CR-003-agent-layer.md). **Strategy:** `00-strategy.md`.
**Priorities:** P0 = in Phase 0. P1 = Phase 1 (backlog).

## 1. Foundation (FR-AGT-F)

### FR-AGT-F-001: Agents can't touch money
**Story:** As Wayne, I want it to be impossible for an agent to move money or change a money record, so that adding AI can't weaken the target-or-refund promise.
**Acceptance criteria:**
- Given the agent database role, when it tries to read or write any ledger, backing, outbound-op, provider-event, privileged-action, profile or platform-settings table, or call any money or workflow function, then Postgres refuses.
- Given the agent database role, then it can read only the `agent_v_*` views and read/write only `agent_tasks`, `agent_runs` and `agent_proposals` (and only the columns its job needs).
- A test proves both, and fails if a later migration grants the role more.
**Priority:** P0

### FR-AGT-F-002: Agents are off unless staff turn them on
**Story:** As Wayne, I want one switch for the whole agent layer, so that I can stop it instantly.
**Acceptance criteria:**
- Given `flag.agents` is off (the default), then the agent worker claims no task and calls no model; tasks still accumulate so nothing is lost.
- Given a staff member with a second factor, when they set the flag through `POST /staff/flags/agents` with a reason, then it changes through the audited `flag.set` action.
- `GET /v1/config` doesn't expose the flag (staff-only concern).
**Priority:** P0

### FR-AGT-F-003: Work queue with bounded attempts
**Story:** As the operator, I want agent work to behave like every other job, so that a failing agent never blocks anything and never retries forever.
**Acceptance criteria:**
- Each task has an agent name, subject, dedupe key (unique), status, attempts and next-attempt time.
- Two workers never run the same task (claim with skip-locked).
- A task that fails is retried with backoff up to `POLICY.agents.maxAttempts`; then it is `dead`, and visible in the staff queue as `agent_dead_letters`.
- A task that runs longer than `POLICY.agents.leaseMinutes` without finishing can be claimed again.
**Priority:** P0

### FR-AGT-F-004: Every run is accounted for
**Story:** As an auditor, I want to see what each agent ran, on what, with which model and prompt, so that agent output can be examined later.
**Acceptance criteria:**
- Each attempt writes one `agent_runs` row: task, agent, model, prompt version, input digest (SHA-256 of the exact model input), status, token usage, error code, timings, correlation id.
- Agent writes carry actor kind `system:agent:<agent name>` in their audit events.
- Runs and proposals are append-only for the agent role (it can't update or delete them).
**Priority:** P0

### FR-AGT-F-005: Proposals are advisory and get a verdict
**Story:** As a staff reviewer, I want each agent's output attached to the item I'm working, and to record whether I agreed, so that we can measure whether the agent helps.
**Acceptance criteria:**
- A proposal has agent, subject kind and id, kind, body (validated JSON), source (`model` or `deterministic`), and the run that produced it.
- A newer proposal for the same agent and subject marks the earlier one `superseded`.
- `GET /staff/agents/proposals` lists proposals by subject, agent or status. `POST /staff/agents/proposals/:id/verdict` records `agree`, `partial` or `disagree` with a note, through `privileged()` (typed reason, audit). A proposal gets one verdict.
- Recording a verdict changes nothing else: it doesn't approve, reject or edit any campaign or action.
- `GET /staff/agents/metrics` returns, per agent, counts by verdict and the agreement rate (`agree` / all verdicts).
**Priority:** P0

### FR-AGT-F-006: Model boundary that fails closed
**Story:** As Wayne, I want the model to be swappable and the worker to refuse unsafe configuration, so that a test double never runs on hosted infrastructure.
**Acceptance criteria:**
- `AGENT_MODEL_PROVIDER` is `none` (default), `fake` or `anthropic`. `fake` is refused in a deployed environment. `anthropic` requires `ANTHROPIC_API_KEY`.
- With provider `none`, agents write deterministic-only proposals.
- The model input marks all user-written text as untrusted data; the model has no tools; its output must parse against the agent's schema, or the attempt fails.
- After the model fails `POLICY.agents.maxAttempts` times, the agent writes a deterministic-only proposal with `model_unavailable: true` and the task completes (the deterministic checklist is never lost).
**Priority:** P0

## 2. A1 Campaign Review Copilot (FR-AGT-A1)

### FR-AGT-A1-001: A review packet for every submission
**Story:** As the reviewer, I want a packet ready when a campaign enters review, so that I spend my time judging, not hunting.
**Acceptance criteria:**
- Given a campaign moves to `in_review`, then exactly one `campaign_review` task is enqueued for that submission (a resubmission after revisions gets a new one).
- The packet contains deterministic findings (FR-AGT-A1-002), the model's assessment when available (summary, findings with severity and the quoted text they rest on, questions for the artist, a drafted "revisions requested" note), and the campaign version it was built from (`updated_at`).
- The packet never approves or requests revisions by itself; the existing review action is unchanged.
**Priority:** P0

### FR-AGT-A1-002: Deterministic checks the model can't skip
**Acceptance criteria:** the packet lists, with the field and quoted text:
- Banned language from the shared copy rules (same list as `lint:copy`; a sync test keeps them equal).
- Layer 1 investment language in a reward campaign: invest, returns, profit, equity, shares, ownership, dividend.
- Urgency or scarcity claims that need a human check (NFR-COMP-23): "only N left", "last chance", "hurry", "selling fast", "act now", "limited time".
- The word "escrow" (only counsel-approved wording may use it, FR-PAY-008).
- Goal above 80% of the tier cap recorded at submission (headroom note), and backers needed at the median perk price.
- Physical perks (address collection and NFR-SEC-08 apply) and any perk whose `fulfill_by` is missing or falls before the campaign could end.
- Milestone tranches: a later tranche with no evidence requirement, a target date in the past or before the campaign could end, or dates out of order.
**Priority:** P0

## 3. A8 Ops Steward (FR-AGT-A8)

### FR-AGT-A8-001: Weekly single-operator review pack
**Story:** As Wayne, running single-operator mode, I want the weekly review (FR-ID-007, G1-A) prepared for me, so that the sign-off is fast and nothing slips through.
**Acceptance criteria:**
- Once the last week (Monday–Sunday, UTC) has ended, exactly one `ops_weekly` task exists for it.
- The pack lists that week's privileged actions grouped by action and status; delayed, cancelled and failed actions; refund totals per day against the single-operator daily limit; verification counts per day against their limit; and whether the week is signed off.
- It adds a current queue snapshot: campaigns in review and the oldest age, evidence waiting, dead-lettered money ops, open reconciliation breaks, and dead agent tasks.
- With a model, it adds a short brief and up to five items needing attention, each pointing at a row in the pack. The sign-off stays a separate staff action.
**Priority:** P0

## Non-functional requirements
| ID | Requirement | Priority |
|---|---|---|
| NFR-AGT-01 | The agent worker is a separate process from the money worker; `runWorkerTick` doesn't change. | P0 |
| NFR-AGT-02 | No personal data beyond display names and handles enters a Phase 0 model input. A test asserts the views' column lists. | P0 |
| NFR-AGT-03 | Model calls time out (`POLICY.agents.modelTimeoutMs`) and never hold a database transaction open. | P0 |
| NFR-AGT-04 | Logs follow NFR-SEC-12 redaction; model output and prompts are not logged. | P0 |
| NFR-AGT-05 | Generated text shown to staff is rendered as text, never markup (NFR-SEC-14). Phase 0 has no web UI; the API returns JSON. | P0 |
| NFR-AGT-06 | The agent worker writes a heartbeat (`worker_heartbeats`, worker `agents`). | P0 |

## Out of scope (Phase 0)
Agents A2–A7 (backlog, origin CR-003); any web UI for proposals (the staff console has no UI yet, G2 condition 9); any autonomy; Layer 2.

## Change log
- 2026-11-26: created (CR-003).
