/**
 * Layer 2 API client (CR-002), matching `apps/api/src/l2/routes.ts` on `main` (PRs #11–#12 as reviewed).
 * Entry routes come back 404 `layer2_disabled` when the server flag is off — the server is the gate (FR-PLT-001);
 * pages show the "isn't open yet" state when they do. Completion routes (an investor's own investment + cancel, staff
 * money views, recon, replay, break resolve, collection state) answer with the flag off (design §2, L2-T-038).
 */
import type {
  CertificationRequest, InvestmentView, InvestorMeView, InvestResponse, KycStartRequest, PoolCardView, PoolDetailView, PoolDraftRequest, PoolLaunchRequest, StatementRequest,
} from "@fanzup/shared/l2schemas";
import { ApiError, request } from "./api";

export type { InvestmentView, InvestorMeView, PoolCardView, PoolDetailView, PoolDraftRequest };

export const isL2Disabled = (e: unknown) => e instanceof ApiError && e.code === "layer2_disabled";
export const isSecondFactor = (e: unknown) => e instanceof ApiError && (e.code === "second_factor_required" || e.code === "not_staff");

export interface FormCDoc { poolId: string; slug: string; title: string; version: number; sha256: string; createdAt: string; body: Record<string, unknown> }
export interface CreatorPoolView extends PoolCardView {
  story: string | null; risks: string | null; tracklist: string[]; useOfFunds: { label: string; amountMinor: number }[]; creatorBps: number; platformBps: number;
  minUnits: number; durationDays: number; collectionMechanism: string; collectionState: string; genre: string | null; closedAt: string | null; maturesAt: string | null;
  collection: { mechanism: string; badge: string; status: string; details: Record<string, string>; executed_at: string | null } | null;
  reviews: { decision: string; notes: string | null; created_at: string }[];
  tranches: { id: string; seq: number; pct: number; milestone: string | null; evidenceRequired: string | null; targetDate: string | null; status: string; releasedMinor: number | null }[];
  statements: { id: string; periodLabel: string; coveredMinor: number; collectedMinor: number; status: string; verification: string; createdAt: string }[];
  money: { escrowMinor: number; issuerPayableMinor: number; releasedMinor: number; unallocatedMinor: number; creatorRoyaltiesPaidMinor: number };
}
/** Expected royalty periods (design §6): a statement must name exactly one window (`period_not_expected` otherwise). */
export interface PeriodWindow { seq: number; periodStart: string; periodEnd: string; dueAt: string }
export interface StaffQueueItem { type: string; id: string; poolId: string | null; summary: string; createdAt: string }
/** M1 staff queue rows (GET /staff/queue); Layer 2 adds `pool_dead_letters` and `pool_breaks` (L2-T-046, L2-T-056). */
export interface M1QueueItem { type: string; id: string; subjectId: string | null; summary: string; ageSeconds: number; correlationId: string | null }
export interface ActionResult { id: string; status: "executed" | "scheduled"; executeAfter: string | null; correlationId: string | null }
export interface StaffAction { action: ActionResult }
/** Commit answer: a privileged action, or (same label + hash already committed) the earlier run, replayed. */
export interface CommitResult { action: ActionResult | null; runId?: string; replayed?: boolean }
export interface DryRun {
  poolId: string; label: string; poolStatus: string; hash: string; fanPoolMinor: number; allCapped: boolean;
  input: { collectedMinor: number; fansBps: number; creatorBps: number; platformBps: number; holdings: { investmentId: string; units: number; capRemainingMinor: number }[] };
  allocation: { runTotalMinor: number; payouts: { investmentId: string; amountMinor: number }[]; creatorMinor: number; platformMinor: number; capOverflowMinor: number };
}
export interface StaffMoney {
  pool: PoolCardView & { collectionState: string; collectionMechanism: string; offeringRef: string | null; collectionRef: string | null; closedAt: string | null; maturesAt: string | null; fansBps: number; creatorBps: number; platformBps: number; formCSha256: string | null; collection: { mechanism: string; badge: string; status: string; details: Record<string, string>; executed_at: string | null } | null };
  /** Pool ledger balances as stored (signed: credit-normal accounts are negative). */
  ledger: Record<string, number>;
  investments: { id: string; investor: string; units: number; amountMinor: number; status: string; distributedMinor: number; capMinor: number; createdAt: string }[];
  runs: { id: string; label: string; run_total_minor: string; fans_minor: string; creator_minor: string; platform_minor: string; cap_overflow_minor: string; input_hash: string; status: string; committed_at: string }[];
  statements: { id: string; period_label: string; covered_minor: string; collected_minor: string; status: string; verification: string }[];
  settlements: { provider_ref: string; amount_minor: string; reference: string; settled_at: string; statement_id: string | null }[];
  tranches: { id: string; seq: number; pct: number; milestone: string | null; status: string; released_minor: string | null }[];
  breaks: { id: string; kind: string; amount_minor: string; refs: Record<string, unknown> | null; opened_at: string }[];
  ops: { id: string; kind: string; amount_minor: string; status: string; provider_ref: string | null; attempts: number; last_error: string | null }[];
}
export interface ReconPool { poolId: string; escrow: { ledgerMinor: number; providerMinor: number; diffMinor: number }; collection: { ledgerMinor: number; providerMinor: number; diffMinor: number }; breaks: { kind: string; amountMinor: number }[] }
export interface ReconResult {
  revenue: { unallocated_minor?: number } & Record<string, unknown>;
  ledger: { diffMinor: number; pools: ReconPool[]; inFlight: { poolId: string; ref: string; kind: string; amountMinor: number }[]; breaks: { poolId: string; kind: string; amountMinor: number }[] };
}
/** POST /investments/:id/cancel — `cancel_pending` while a payment may still be on its way (L2-T-031, L2-T-043). */
export interface CancelResult { result: "cancelled" | "cancel_pending" | string; investment: InvestmentView }

const post = <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}), idempotencyKey });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const l2 = {
  pools: (q: { tab?: "live" | "closed"; revenueType?: string; badge?: string; genre?: string; sort?: "ending" | "newest" } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return request<{ pools: PoolCardView[] }>(`/v1/pools${p.size ? `?${p}` : ""}`);
  },
  pool: (slug: string) => request<PoolDetailView>(`/v1/pools/${encodeURIComponent(slug)}`),
  formC: (slug: string) => request<FormCDoc>(`/v1/pools/${encodeURIComponent(slug)}/form-c`),
  investorMe: () => request<InvestorMeView>("/v1/investor/me"),
  startKyc: (b: KycStartRequest) => post<{ kycStatus: string }>("/v1/investor/kyc", b),
  certify: (b: CertificationRequest) => post<InvestorMeView>("/v1/investor/certification", b),
  invest: (poolId: string, units: number, riskAckVersion: string, key: string) => post<InvestResponse>(`/v1/pools/${poolId}/investments`, { units, riskAckVersion }, key),
  investment: (id: string) => request<InvestmentView>(`/v1/investments/${id}`),
  /** The investor's own investments — a completion route, for the flag-off cancel-only list (review round 2, finding 2). */
  investments: () => request<{ investments: InvestmentView[] }>("/v1/investments"),
  cancel: (id: string) => post<CancelResult>(`/v1/investments/${id}/cancel`),
  portfolio: () => request<{ investor: InvestorMeView; investments: InvestmentView[] }>("/v1/portfolio"),

  creatorPools: () => request<{ pools: PoolCardView[] }>("/v1/creator/pools"),
  creatorPool: (id: string) => request<CreatorPoolView>(`/v1/creator/pools/${id}`),
  periods: (id: string) => request<{ periods: PeriodWindow[] }>(`/v1/creator/pools/${id}/periods`),
  createPool: (b: PoolDraftRequest) => post<{ id: string; slug: string }>("/v1/creator/pools", b),
  updatePool: (id: string, b: PoolDraftRequest) => patch<{ id: string }>(`/v1/creator/pools/${id}`, b),
  /** Issuer attestation (design §4.1; L2-Q12): other Reg CF sales in the last 12 months, asked at submit and at launch. */
  submitPool: (id: string, otherRegCfSales12mMinor: number) => post<{ status: string; formC: { sha256: string } }>(`/v1/creator/pools/${id}/submit`, { otherRegCfSales12mMinor }),
  launchPool: (id: string, b: PoolLaunchRequest) => post<{ status: string; endsAt: string }>(`/v1/creator/pools/${id}/launch`, b),
  addStatement: (id: string, b: StatementRequest) => post<{ id: string; coveredMinor: number }>(`/v1/creator/pools/${id}/statements`, b),
  trancheEvidence: (trancheId: string, notes: string, links: string[] = []) => post<{ evidenceId: string }>(`/v1/creator/pool-tranches/${trancheId}/evidence`, { notes, links }),

  staffQueue: () => request<{ items: StaffQueueItem[] }>("/v1/staff/l2/queue"),
  /** M1 staff queue filtered to one type (`pool_dead_letters`, `pool_breaks`). */
  staffM1Queue: (type: "pool_dead_letters" | "pool_breaks") => request<{ items: M1QueueItem[] }>(`/v1/staff/queue?type=${type}`),
  staffPools: () => request<{ pools: PoolCardView[] }>("/v1/staff/l2/pools"),
  staffMoney: (id: string) => request<StaffMoney>(`/v1/staff/l2/pools/${id}/money`),
  staffFormC: (id: string) => request<{ version: number; sha256: string; body: Record<string, unknown> }>(`/v1/staff/l2/pools/${id}/form-c`),
  staffInvestors: () => request<{ investors: { userId: string; name: string; kycStatus: string; state: string | null; certified: boolean; accredited: boolean; updatedAt: string }[] }>("/v1/staff/l2/investors"),
  review: (id: string, decision: "approved" | "revisions_requested", reason: string, notes?: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/review`, { decision, reason, notes }),
  executeCollection: (id: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/collection/execute`, { reason }),
  decideKyc: (userId: string, decision: "approved" | "rejected", reason: string) => post<StaffAction>(`/v1/staff/l2/investors/${userId}/kyc`, { decision, reason }),
  verifyTranche: (id: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pool-tranches/${id}/verify`, { reason }),
  recon: (id: string) => post<ReconResult>(`/v1/staff/l2/pools/${id}/recon`),
  deposit: (id: string, amountMinor: number, reference: string) => post<{ depositId: string | null; status: string }>(`/v1/staff/l2/pools/${id}/deposits`, { amountMinor, reference }),
  dryRun: (id: string, label: string) => post<DryRun>(`/v1/staff/l2/pools/${id}/distributions/dry-run`, { label }),
  commitRun: (id: string, label: string, hash: string, reason: string) => post<CommitResult>(`/v1/staff/l2/pools/${id}/distributions/commit`, { label, hash, reason }),
  collectionState: (id: string, to: "REMEDIATION" | "CHARGED_OFF" | "COLLECTING", reason: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/collection-state`, { to, reason }),
  /** `pool_op.replay` (L2-T-046): a failed/dead op back to `initiated` (or a `sent` op with an open `op_unconfirmed`). */
  replayPoolOp: (opId: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pool-ops/${opId}/replay`, { reason }),
  /** `pool_break.resolve` (L2-T-056): only `amount_mismatch` / `unapplied_funding`. */
  resolvePoolBreak: (breakId: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pool-breaks/${breakId}/resolve`, { reason }),
  /** Mock provider only (local/CI): move the provider clock and run one worker tick. */
  advance: (seconds: number) => post<unknown>("/v1/dev/l2/advance", { seconds }),
};

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Break kinds staff close by hand (`pool_break.resolve`); the others clear when recon no longer finds them. */
export const STAFF_RESOLVED_BREAKS = new Set(["amount_mismatch", "unapplied_funding"]);

/**
 * Human copy for Layer 2 error codes (Brand §7: say what happened and what to do next; never blame; potential payouts
 * only). The server's sentence is used when no entry exists. `next` names the one action that helps.
 */
const COPY: Record<string, { title: string; body?: string; next?: "restart" | "reload" | "retry" | "verify" | "pools" | "resubmit" }> = {
  // Purchase (design §5 resume guard)
  reservation_expired: { title: "Your reservation expired", body: "Your Units were held for a short time and that time ran out. Start again to reserve them.", next: "restart" },
  investment_cancelled: { title: "This investment was cancelled", next: "restart" },
  payment_not_applied: { title: "Your payment couldn't be applied", body: "It arrived after the reservation ended or didn't match. It will be refunded in full.", next: "pools" },
  funding_returned: { title: "Your bank returned the payment", body: "No Units were issued and nothing stays with the offering. You can start again with another payment.", next: "restart" },
  in_progress: { title: "Still working on it", body: "Your purchase is being processed. Wait a moment, then try again — you won't be charged twice.", next: "retry" },
  regcf_limit_exceeded: { title: "That's more than your Reg CF limit allows", body: "Choose fewer Units, or update your income and net worth if they've changed.", next: "verify" },
  issuer_cap_reached: { title: "This offering has reached its limit", body: "The creator can't take more Reg CF investment in this 12-month period.", next: "pools" },
  pool_sold_out: { title: "Not enough Units left", body: "Someone reserved the last Units first. Choose fewer Units.", next: "reload" },
  pool_closed: { title: "This offering has closed", next: "pools" },
  below_minimum: { title: "Below this Pool's minimum", next: "reload" },
  kyc_required: { title: "Verify your identity first", next: "verify" },
  certification_required: { title: "Set your investment limit first", next: "verify" },
  state_not_eligible: { title: "Not available in your state" },
  self_investment: { title: "You can't invest in your own Pool" },
  acceptance_required: { title: "Please accept the current terms first", body: "Our Terms or Privacy Policy changed. Review them from your account, then come back.", next: "reload" },
  risk_ack_required: { title: "The risk disclosure changed", body: "Reload the page, read the updated disclosure and confirm again.", next: "reload" },
  terms_changed: { title: "The offering terms changed", body: "The terms changed after review, so it has to be reviewed again before anyone can invest.", next: "resubmit" },
  // Cancellation
  cancel_window_closed: { title: "It's too late to cancel", body: "Investments can't be cancelled within 48 hours of the offering deadline." },
  not_cancellable: { title: "This investment can't be cancelled now" },
  // Creator
  launch_window_too_short: { title: "Not enough time left to launch", body: "A Reg CF offering must stay open at least 21 days. Try launching again — a new deadline will be set.", next: "retry" },
  launch_deadline_mismatch: { title: "The launch deadline changed", body: "Reload the page and launch again.", next: "reload" },
  tier_cap_exceeded: { title: "Over the 12-month Reg CF limit for issuers", body: "With the other Reg CF sales you entered, this maximum is more than you can raise in 12 months. Lower the maximum raise." },
  attestation_required: { title: "Tell us about other Reg CF sales", body: "Enter the total of other Reg CF offerings in the last 12 months (enter 0 if none)." },
  duration_too_short: { title: "The offering must run at least 21 days" },
  period_not_expected: { title: "Pick a royalty period from the list", body: "Statements cover exactly one period of the Pool's schedule." },
  pool_matured: { title: "This Pool has matured", body: "There are no royalty periods after its maturity date." },
  statement_exists: { title: "A statement for that period is already on file" },
  invalid_period: { title: "Check the period dates", body: "The period must end after it starts." },
  slug_taken: { title: "That Pool address is taken", body: "Try another address." },
  provider_unavailable: { title: "The escrow provider didn't answer", body: "Nothing was lost. Try again in a moment.", next: "retry" },
  provider_not_ready: { title: "The escrow provider isn't ready for this yet", body: "Try again in a moment.", next: "retry" },
  state_locked: { title: "Your state of residence is already set", body: "It was set when your identity check started. Contact support to change it." },
  // Staff
  run_stale: { title: "The numbers changed since the dry-run", body: "Collected revenue or holdings changed. Run the dry-run again, then commit.", next: "reload" },
  not_cured: { title: "The Pool is still past due", body: "Collection can go back to normal only after the late royalty cash has arrived and been reconciled." },
  replay_requires_resolution: { title: "Resolve the amount mismatch first", body: "This operation failed because the provider reported a different amount. Resolve that break, then replay." },
  break_not_staff_resolved: { title: "This break clears on its own", body: "It closes when reconciliation no longer finds the difference. Fix the cause and reconcile again." },
  break_not_open: { title: "This break is already resolved", next: "reload" },
  illegal_collection_transition: { title: "That collection change isn't allowed from here" },
  nothing_to_distribute: { title: "Nothing to distribute", body: "No collected royalties are waiting for a run." },
  layer2_disabled: { title: "Investing isn't open right now", body: "Layer 2 is switched off. Money already in flight still finishes." },
};

export function l2ErrorCopy(e: unknown): { title: string; body: string; next?: (typeof COPY)[string]["next"]; refundPending: boolean; code: string } {
  if (!(e instanceof ApiError)) return { title: "Something went wrong", body: "Something went wrong on our side. Try again.", refundPending: false, code: "error" };
  const c = COPY[e.code];
  const refundPending = e.details?.refundPending === true;
  const body = c?.body ?? e.message;
  return {
    title: c?.title ?? (e.status === 0 ? "We couldn't reach FanZuP" : "That didn't work"),
    body: refundPending && !/refund/i.test(body) ? `${body} Any payment taken will be refunded in full.` : body,
    next: c?.next,
    refundPending,
    code: e.code,
  };
}

/** Purchase errors stored as the final answer for an Idempotency-Key: a new attempt needs a new key. */
export const TERMINAL_PURCHASE_CODES = new Set(["reservation_expired", "investment_cancelled", "funding_returned", "payment_not_applied", "regcf_limit_exceeded", "pool_sold_out", "below_minimum", "pool_closed", "issuer_cap_reached", "risk_ack_required", "kyc_required", "certification_required", "state_not_eligible", "self_investment"]);
