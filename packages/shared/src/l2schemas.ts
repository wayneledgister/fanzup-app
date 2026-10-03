/**
 * Layer 2 API contracts (CR-002; L2 gate condition 3). Request schemas validate in the API; response types are
 * used by the web client. Amounts are integer cents.
 */
import { z } from "zod";
import { COLLECTION_MECHANISMS, REVENUE_TYPES, type CollectionState, type InvestmentStatus, type KycStatus, type PoolStatus, type RevenueType, type RiskBadge } from "./l2";
import { POLICY } from "./policy";

const Cents = z.number().int().nonnegative();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PoolTrancheInput = z.object({
  seq: z.number().int().min(1).max(3),
  pct: z.number().int().min(1).max(100),
  milestone: z.string().max(200).nullish(),
  evidenceRequired: z.string().max(500).nullish(),
  targetDate: Day.nullish(),
});

export const PoolDraftRequest = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  title: z.string().min(2).max(90),
  artistDisplay: z.string().min(1).max(80).optional(),
  genre: z.string().max(40).nullish(),
  releaseDate: Day.nullish(),
  tracklist: z.array(z.string().min(1).max(120)).min(1).max(30),
  story: z.string().max(20000).nullish(),
  risks: z.string().max(5000).nullish(),
  useOfFunds: z.array(z.object({ label: z.string().min(2).max(120), amountMinor: z.number().int().positive() })).min(1).max(12),
  revenueTypes: z.array(z.enum(REVENUE_TYPES)).min(1).max(3),
  fansBps: z.number().int().min(100).max(9000),
  platformBps: z.number().int().min(0).max(2000).default(POLICY.l2.defaults.platformBps),
  unitsTotal: z.number().int().min(1).max(1_000_000),
  unitPriceMinor: z.number().int().min(100).max(100_000_000),
  minUnits: z.number().int().min(1).default(1),
  durationDays: z.number().int().min(POLICY.l2.deadlineDays.min).max(POLICY.l2.deadlineDays.max),
  returnCapBps: z.number().int().min(10_000).max(30_000).default(POLICY.l2.defaults.returnCapBps),
  maturityMonths: z.number().int().min(12).max(120).default(POLICY.l2.defaults.maturityMonths),
  collectionMechanism: z.enum(COLLECTION_MECHANISMS),
  collectionDetails: z.object({ counterparty: z.string().max(120).optional(), notes: z.string().max(500).optional() }).default({}),
  tranches: z.array(PoolTrancheInput).min(2).max(3),
});
export type PoolDraftRequest = z.input<typeof PoolDraftRequest>;

export const StatementRequest = z.object({
  periodLabel: z.string().min(2).max(40),
  periodStart: Day,
  periodEnd: Day,
  lines: z.array(z.object({ revenueType: z.enum(REVENUE_TYPES), source: z.string().min(1).max(80), amountMinor: Cents })).min(1).max(50),
});
export type StatementRequest = z.infer<typeof StatementRequest>;

export const KycStartRequest = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  state: z.string().regex(/^[A-Z]{2}$/),
});
export type KycStartRequest = z.infer<typeof KycStartRequest>;

export const CertificationRequest = z.object({
  annualIncomeMinor: Cents.max(1e14),
  netWorthMinor: Cents.max(1e14),
  accredited: z.boolean(),
  elsewhereMinor: Cents.max(1e14).default(0),
  state: z.string().regex(/^[A-Z]{2}$/).optional(),
});
export type CertificationRequest = z.input<typeof CertificationRequest>;

export const InvestRequest = z.object({ units: z.number().int().min(1).max(1_000_000), riskAckVersion: z.string().min(1).max(60) });
export type InvestRequest = z.infer<typeof InvestRequest>;

// ── Responses ──────────────────────────────────────────────────────────
export interface PoolCardView {
  id: string;
  slug: string;
  title: string;
  artistDisplay: string;
  artist: { id: string; slug: string; name: string; genre: string | null; city: string | null; tier: string };
  status: PoolStatus;
  revenueTypes: RevenueType[];
  riskBadge: RiskBadge | null;
  fansBps: number;
  unitPriceMinor: number;
  unitsTotal: number;
  unitsLeft: number;
  targetMinor: number;
  maxMinor: number;
  raisedMinor: number;
  investors: number;
  returnCapBps: number;
  maturityMonths: number;
  endsAt: string | null;
  releaseDate: string | null;
}

export interface PoolDetailView extends PoolCardView {
  story: string | null;
  risks: string | null;
  tracklist: string[];
  useOfFunds: { label: string; amountMinor: number }[];
  creatorBps: number;
  platformBps: number;
  minUnits: number;
  distributionFrequency: string;
  collectionMechanism: string;
  collectionState: CollectionState;
  tranches: { seq: number; pct: number; milestone: string | null; status: string; targetDate: string | null; releasedAt: string | null }[];
  formC: { version: number; sha256: string } | null;
  closedAt: string | null;
  maturesAt: string | null;
  lockupMonths: number;
  cancelCutoffHours: number;
  riskAckVersion: string;
  revenue: { collectedMinor: number; distributedToFansMinor: number; periods: number };
}

export interface InvestorMeView {
  kycStatus: KycStatus;
  state: string | null;
  certified: boolean;
  accredited: boolean;
  /** null = no limit (accredited). */
  limitMinor: number | null;
  usedMinor: number;
  remainingMinor: number | null;
  regCf: { verifiedOn: string };
}

export interface InvestmentView {
  id: string;
  poolId: string;
  poolSlug: string;
  poolTitle: string;
  artistDisplay: string;
  units: number;
  unitPriceMinor: number;
  amountMinor: number;
  status: InvestmentStatus;
  statusReason: string | null;
  createdAt: string;
  fundedAt: string | null;
  issuedAt: string | null;
  lockupEndsAt: string | null;
  capMinor: number;
  distributedMinor: number;
  receivedMinor: number;
  refundedAt: string | null;
  poolStatus: PoolStatus;
  poolEndsAt: string | null;
  maturesAt: string | null;
  collectionState: CollectionState;
  riskBadge: RiskBadge | null;
  canCancelUntil: string | null;
  payouts: { label: string; amountMinor: number; status: string; paidAt: string | null; taxForm: string | null }[];
}

export interface InvestResponse {
  investmentId: string;
  status: InvestmentStatus;
  amountMinor: number;
  units: number;
}
