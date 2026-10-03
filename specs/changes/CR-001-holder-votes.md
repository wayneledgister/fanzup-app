# CR-001: Holder communications & votes
**Status:** Accepted (v-now, spec-first; ships behind `postBeta`) · **Source:** Wayne, council D1 Card A · **Date:** 2026-10-03

## Request
"Keep building." In other words: don't freeze the investor holder-votes page. Give it a proper spec so it can be built for real.

## Classification
**New scope.** It's additive: no existing FR, design or plan item changes. Today it is a prototype page (`src/pages/invest/HolderVotes.tsx`) behind the `postBeta` flag, and no PRD covers it.

## What the docs allow (constraints, not choices)
- **Mechanism 03 (i):**
  - Each artist's Reg CF raise can use a per-artist crowdfunding vehicle (an SPV).
  - Its operating agreement *passes through economic and voting rights one-to-one* to the fan members.
  - It is administered by the **SPV manager**, which is the artist's entity.
  - It is the only structure in the docs that gives fans votes.
  - It holds **one issuer only**, so there is no platform-wide or multi-artist governance.
- **Gating:**
  - Mechanism 03 is gated behind the reward-vs-profit-share A/B test.
  - Its §12(g) relief is *disputed pending counsel*.
  - Everything here therefore depends on `layer2` going live and on counsel approving the SPV structure.
- **Mechanism 04:** a registered transfer agent keeps the holder register. The vote record date and eligibility must come from it.
- **Brand §7.4 / PRD 01 §11:** nothing may imply returns, liquidity or platform control. FanZuP is a **delivery channel, not the decision-maker**. This is council D1's Compliance finding.

## Impact

### Requirements: proposed new FRs (draft for PRD 04 *Holder Communications & Votes*)
| ID | Requirement |
|---|---|
| FR-HV-001 | Each SPV-structured Pool has a **holder communications feed** from the SPV manager: material-change notices, annual Form C-AR reports, distribution statements and meeting notices. Holders get the items in-app and by email. |
| FR-HV-002 | A **holder vote** can be opened only for a Pool whose Form C and SPV operating agreement grant pass-through voting rights. The SPV manager creates it; FanZuP never initiates one. |
| FR-HV-003 | Every vote attaches the **official notice document** and shows the question, options (For / Against / Abstain), opening time, deadline, record date, and the quorum and approval threshold *as stated in the operating agreement*. FanZuP displays these values; it doesn't set them. |
| FR-HV-004 | **One vote per Unit held at the record date**, taken from the transfer-agent register snapshot. Transfers after the record date don't move votes. |
| FR-HV-005 | A holder can change their ballot until the deadline. After the deadline, ballots are locked. |
| FR-HV-006 | Results show tallies by Units and whether quorum and the threshold were met. The SPV manager or transfer agent certifies them before they're published. Every ballot event is written to the immutable audit log and kept for 6+ years (PRD 01 §10). |
| FR-HV-007 | Pools that aren't SPV-structured show no voting UI. Their communications feed says "Units in this Pool don't carry voting rights. See the Form C." |
| FR-HV-008 | **Out of scope by rule:** platform-wide governance, treasury, delegation or proxies (until counsel says otherwise), voting weighted by tier or amount invested, on-chain anything, and forecasting. |
| FR-HV-009 | E-delivery: before the first electronic notice, the holder gives E-SIGN consent and can choose to get paper copies. |

### Design
- **New:**
  - `HolderNotice` and `Vote` / `Ballot` / `VoteResult` entities.
  - A record-date snapshot pulled from the transfer agent.
  - Hooks into the notification service and the audit ledger.
- **Changes to the existing prototype:** `HolderVotes.tsx` gets reworked to FR-HV-001 to 009. The current page already avoids on-chain, delegation and tiers, but it invents an SPV entity name and has no record date, quorum or certification step.
- **ADRs:** none contradicted.

### Plan (size M; tasks start only after PRD 04 is approved)
- **T-HV-01:** draft PRD 04 from the FRs above, with acceptance criteria.
- **T-HV-02:** take three questions to counsel. Do SPV member votes need proxy-style solicitation rules? What's the e-delivery consent standard? Is the §12(g) relief available?
- **T-HV-03:** rework `HolderVotes.tsx`:
  - a per-Pool feed
  - a vote detail page with the record date, quorum and notice document
  - ballot change before the deadline
  - a certified results state
  - the no-voting-rights state
- **T-HV-04:** add a Pool → "Holder updates" entry point on Holding Detail. It stays behind `postBeta`.
- **T-HV-05:** demo data for one SPV Pool and one non-SPV Pool. The SPV manager is shown as "<Artist> CF LLC (manager: <artist entity>)", following Mechanism 03's naming pattern, and is labelled sample data.

### Ripple
- No gate needs re-review: council D1 pass 2 stands.
- `docs/CONSOLIDATION.md` open question 1 is now **decided**. Its governance row is updated to point here.
- A Mechanism 03 counsel answer could reshape FR-HV-002 and FR-HV-004.

## What this displaces
Everything here is post-Beta and securities-path work. Each day on it is a day not spent on the **Fund My Show** reward core (Mechanism 05, "ship in weeks"). The council's dissent is on record in D1: four seats preferred Freeze. Recommended mitigation: do T-HV-01 and T-HV-02 now, because they're cheap and counsel answers take time. Schedule T-HV-03 to T-HV-05 after the first reward campaign ships.

## Options considered
| Option | Cost / consequence |
|---|---|
| Do now, in full | About 3–4 days of build on top of a structure counsel hasn't approved. Displaces Fund My Show. |
| **Do now, spec-first; build after the first reward campaign ships** (recommended) | About half a day of spec plus a counsel request now. The build waits for both. |
| Next version | Cheapest. Contradicts "Keep building". |
| Reject | Contradicts your decision. |

## Recommendation
**Accept in v-now, spec-first.** Write PRD 04 (T-HV-01) and send the counsel questions (T-HV-02) now. Start code tasks only after PRD 04 is approved and Fund My Show has shipped.

## Decision
**Accepted (v-now): Wayne, 2026-10-03** (council D1 Card A, "Keep building"). Sequencing per the recommendation: spec first, build after PRD 04 is approved. This sequencing can be overridden with "just build it".
