/**
 * Layer 2 API client (CR-002). Every call can come back 404 `layer2_disabled` — the server is the gate (FR-PLT-001);
 * pages show the "isn't open yet" state when it does.
 */
import type {
  CertificationRequest, InvestmentView, InvestorMeView, InvestResponse, KycStartRequest, PoolCardView, PoolDetailView, PoolDraftRequest, StatementRequest,
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
export interface StaffQueueItem { type: string; id: string; poolId: string | null; summary: string; createdAt: string }
export interface StaffAction { action: { id: string; status: "executed" | "scheduled"; executeAfter: string | null; correlationId: string | null } }
export interface DryRun {
  poolId: string; label: string; poolStatus: string; hash: string; fanPoolMinor: number; allCapped: boolean;
  input: { collectedMinor: number; fansBps: number; creatorBps: number; platformBps: number; holdings: { investmentId: string; units: number; capRemainingMinor: number }[] };
  allocation: { runTotalMinor: number; payouts: { investmentId: string; amountMinor: number }[]; creatorMinor: number; platformMinor: number; capOverflowMinor: number };
}
export interface StaffMoney {
  pool: PoolCardView & { collectionState: string; collectionMechanism: string; offeringRef: string | null; collectionRef: string | null; closedAt: string | null; maturesAt: string | null; fansBps: number; creatorBps: number; platformBps: number; formCSha256: string | null; collection: { mechanism: string; badge: string; status: string; details: Record<string, string>; executed_at: string | null } | null };
  ledger: Record<string, number>;
  investments: { id: string; investor: string; units: number; amountMinor: number; status: string; distributedMinor: number; capMinor: number; createdAt: string }[];
  runs: { id: string; label: string; run_total_minor: string; fans_minor: string; creator_minor: string; platform_minor: string; cap_overflow_minor: string; input_hash: string; status: string; committed_at: string }[];
  statements: { id: string; period_label: string; covered_minor: string; collected_minor: string; status: string; verification: string }[];
  settlements: { provider_ref: string; amount_minor: string; reference: string; settled_at: string; statement_id: string | null }[];
  tranches: { id: string; seq: number; pct: number; milestone: string | null; status: string; released_minor: string | null }[];
  breaks: { id: string; kind: string; amount_minor: string; opened_at: string }[];
  ops: { id: string; kind: string; amount_minor: string; status: string; provider_ref: string | null; attempts: number; last_error: string | null }[];
}
export interface ReconResult { revenue: unknown; ledger: { diffMinor: number; pools: { poolId: string; escrow: { ledgerMinor: number; providerMinor: number; diffMinor: number }; collection: { ledgerMinor: number; providerMinor: number; diffMinor: number } }[] } }

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
  cancel: (id: string) => post<InvestmentView>(`/v1/investments/${id}/cancel`),
  portfolio: () => request<{ investor: InvestorMeView; investments: InvestmentView[] }>("/v1/portfolio"),

  creatorPools: () => request<{ pools: PoolCardView[] }>("/v1/creator/pools"),
  creatorPool: (id: string) => request<CreatorPoolView>(`/v1/creator/pools/${id}`),
  createPool: (b: PoolDraftRequest) => post<{ id: string; slug: string }>("/v1/creator/pools", b),
  updatePool: (id: string, b: PoolDraftRequest) => patch<{ id: string }>(`/v1/creator/pools/${id}`, b),
  submitPool: (id: string) => post<{ status: string; formC: { sha256: string } }>(`/v1/creator/pools/${id}/submit`),
  launchPool: (id: string) => post<{ status: string; endsAt: string }>(`/v1/creator/pools/${id}/launch`),
  addStatement: (id: string, b: StatementRequest) => post<{ id: string; coveredMinor: number }>(`/v1/creator/pools/${id}/statements`, b),
  trancheEvidence: (trancheId: string, notes: string, links: string[] = []) => post<{ evidenceId: string }>(`/v1/creator/pool-tranches/${trancheId}/evidence`, { notes, links }),

  staffQueue: () => request<{ items: StaffQueueItem[] }>("/v1/staff/l2/queue"),
  staffPools: () => request<{ pools: PoolCardView[] }>("/v1/staff/l2/pools"),
  staffMoney: (id: string) => request<StaffMoney>(`/v1/staff/l2/pools/${id}/money`),
  staffFormC: (id: string) => request<{ version: number; sha256: string; body: Record<string, unknown> }>(`/v1/staff/l2/pools/${id}/form-c`),
  staffInvestors: () => request<{ investors: { userId: string; name: string; kycStatus: string; state: string | null; certified: boolean; accredited: boolean; updatedAt: string }[] }>("/v1/staff/l2/investors"),
  review: (id: string, decision: "approved" | "revisions_requested", reason: string, notes?: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/review`, { decision, reason, notes }),
  executeCollection: (id: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/collection/execute`, { reason }),
  decideKyc: (userId: string, decision: "approved" | "rejected", reason: string) => post<StaffAction>(`/v1/staff/l2/investors/${userId}/kyc`, { decision, reason }),
  verifyTranche: (id: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pool-tranches/${id}/verify`, { reason }),
  recon: (id: string) => post<ReconResult>(`/v1/staff/l2/pools/${id}/recon`),
  deposit: (id: string, amountMinor: number, reference: string) => post<{ depositId: string }>(`/v1/staff/l2/pools/${id}/deposits`, { amountMinor, reference }),
  dryRun: (id: string, label: string) => post<DryRun>(`/v1/staff/l2/pools/${id}/distributions/dry-run`, { label }),
  commitRun: (id: string, label: string, hash: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/distributions/commit`, { label, hash, reason }),
  collectionState: (id: string, to: string, reason: string) => post<StaffAction>(`/v1/staff/l2/pools/${id}/collection-state`, { to, reason }),
  /** Mock provider only (local/CI): move the provider clock and run one worker tick. */
  advance: (seconds: number) => post<unknown>("/v1/dev/l2/advance", { seconds }),
};

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
