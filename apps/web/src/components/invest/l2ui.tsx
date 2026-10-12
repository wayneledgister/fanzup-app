/**
 * Layer 2 building blocks on real data (CR-002). Disclosure wording lives here or in brand/compliance.tsx only.
 * Copy is product guidance pending counsel review — not legal advice.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Building2, CircleAlert, FlaskConical, RefreshCw, ShieldCheck, ShieldQuestion, ShieldHalf } from "lucide-react";
import { illustratePerUnit, RISK_BADGE_COPY, REVENUE_TYPE_COPY, type RevenueType, type RiskBadge } from "@fanzup/shared/l2";
import { Badge, Button, Callout, Card, Container, EmptyState, KeyValue } from "@/components/brand";
import { ApiError } from "@/lib/api";
import { isL2Disabled, l2ErrorCopy, type InvestmentView } from "@/lib/l2";
import { formatDate, formatUsd } from "@/lib/format";
import { illustrationPeriod, illustrationYears } from "./l2copy";

/* ── Loading / error / disabled ─────────────────────────── */

export type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: ApiError | Error } | { state: "disabled" };

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [s, setS] = useState<Load<T>>({ state: "loading" });
  const reload = useCallback(() => {
    fn()
      .then((data) => setS({ state: "ready", data }))
      .catch((e) => setS(isL2Disabled(e) ? { state: "disabled" } : { state: "error", error: e }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    setS({ state: "loading" });
    reload();
  }, [reload]);
  return { s, reload, set: (data: T) => setS({ state: "ready", data }) };
}

export function L2Unavailable() {
  return (
    <Container size="md" className="py-20">
      <EmptyState icon={<FlaskConical />} title="Investing isn't open yet">
        Revenue-share Pools aren't available right now. You can still back campaigns, subscribe, and shop merch and tickets.
      </EmptyState>
    </Container>
  );
}

export function LoadGate<T>({ load, children, what = "this page" }: { load: { s: Load<T>; reload: () => void }; children: (data: T) => ReactNode; what?: string }) {
  const { s, reload } = load;
  if (s.state === "loading") return <div className="h-48 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label={`Loading ${what}`} />;
  if (s.state === "disabled") return <L2Unavailable />;
  if (s.state === "error") {
    const e = s.error as ApiError;
    if (e.status === 404) return <ErrorBox title="We can't find that" body={e.message} />;
    return (
      <Callout tone="error" icon={<CircleAlert />} title={`We couldn't load ${what}`}>
        {e.message} {e.correlationId && <span className="num text-xs">Ref {e.correlationId.slice(0, 8)}</span>}{" "}
        <Button variant="ghost" size="sm" onClick={reload}>
          <RefreshCw /> Retry
        </Button>
      </Callout>
    );
  }
  return <>{children(s.data)}</>;
}

export function ErrorBox({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <Callout tone="error" icon={<CircleAlert />} title={title}>
      {body} {action}
    </Callout>
  );
}

/** One line of human copy for an API error (Brand §7): the mapped sentence for known Layer 2 codes, else the server's. */
export function apiMessage(e: unknown) {
  if (!(e instanceof ApiError)) return "Something went wrong on our side.";
  const c = l2ErrorCopy(e);
  return c.body && c.body !== e.message ? `${c.title}. ${c.body}` : e.message;
}

/* ── Risk badge (design §8) ─────────────────────────────── */

const BADGE_TONE: Record<RiskBadge, { tone: "success" | "info" | "warning"; icon: ReactNode }> = {
  SECURED_ISH: { tone: "success", icon: <ShieldCheck /> },
  VERIFIED: { tone: "info", icon: <ShieldHalf /> },
  TRUST_BASED: { tone: "warning", icon: <ShieldQuestion /> },
};

/** The line that always sits next to the strongest badge (FR-L2-CR-004, gate cond. 5, L2-T-021). */
export const UNSECURED_LINE = "Your claim is unsecured";

/**
 * The collection badge. The strongest badge ("More secure collection") never stands alone: wherever it shows,
 * "Your claim is unsecured" sits right next to it, so "more secure" can't be read as "secured".
 */
export function RiskBadgeChip({ badge }: { badge: RiskBadge | null }) {
  if (!badge) return null;
  const chip = (
    <Badge tone={BADGE_TONE[badge].tone} icon={BADGE_TONE[badge].icon}>
      {RISK_BADGE_COPY[badge].label}
    </Badge>
  );
  if (badge !== "SECURED_ISH") return chip;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1" data-testid="risk-badge-strongest">
      {chip}
      <span className="text-xs font-medium text-fg" data-testid="unsecured-line">{UNSECURED_LINE}</span>
    </span>
  );
}

export function RiskBadgeExplainer({ badge, mechanism }: { badge: RiskBadge | null; mechanism: string }) {
  if (!badge) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadgeChip badge={badge} />
        <span className="text-xs text-muted">Collection: {mechanismLabel(mechanism)}</span>
      </div>
      <p className="text-sm text-muted">{RISK_BADGE_COPY[badge].short}</p>
      <p className="text-sm text-muted">
        Whatever the collection method, your claim is <strong className="text-fg">unsecured</strong>: there's no collateral, and if royalties stop, you may not get
        your money back.
      </p>
    </Card>
  );
}

export const mechanismLabel = (m: string) =>
  ({ DISTRIBUTOR_REDIRECT: "Distributor pays the Pool directly", SPLIT_PAYEE: "Split payee at the distributor", LOCKBOX: "Lockbox account", LETTER_OF_DIRECTION: "Letter of direction", SELF_REPORT: "Artist self-reports" })[m] ?? m;

export function RevenueTypes({ types }: { types: RevenueType[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {types.map((t) => (
        <li key={t}>
          <Badge tone={t === "publishing" ? "warning" : "neutral"}>
            {REVENUE_TYPE_COPY[t].label}
            {REVENUE_TYPE_COPY[t].note && t === "publishing" ? ` · ${REVENUE_TYPE_COPY[t].note}` : ""}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/* ── Intermediary (D-4, L2-T-025) ───────────────────────── */

/**
 * No SEC-registered intermediary (funding portal or broker-dealer) is engaged (L2-Q3); no Layer 2 screen may say one
 * is. Shown on the Pool page, the documents/purchase step and the Form C view.
 */
export const INTERMEDIARY_LINE = "Intermediary: pending — L2-Q3";
export function IntermediaryPending({ className }: { className?: string }) {
  return (
    <div className={`flex gap-3 rounded-lg border border-line bg-surface-2 p-4 text-sm ${className ?? ""}`} role="note">
      <Building2 className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-fg" data-testid="intermediary-line">{INTERMEDIARY_LINE}</p>
        <p className="text-muted">
          A Reg CF offering has to be made through a funding portal or broker-dealer registered with the SEC. None has been chosen for this demo, so nothing here is an
          offer. FanZuP provides the technology and doesn't give investment advice.
        </p>
      </div>
    </div>
  );
}

/* ── Potential payout illustration (always includes zero) ── */

/** Yearly covered royalties the album might earn: none, modest, strong. Illustrations, not forecasts. */
const SCENARIOS = [
  { label: "If the album earns nothing", yearly: 0 },
  { label: "If it earns $5,000 a year", yearly: 5_000_00 },
  { label: "If it earns $40,000 a year", yearly: 40_000_00 },
];

/**
 * The closing sentence is computed from the scenario results (round-1 review of PR #13): it counts how many
 * illustrations pay back less than the price — never a blanket claim the numbers may contradict.
 */
export function illustrationSummary(totals: number[], paidMinor: number): string {
  const below = totals.filter((t) => t < paidMinor).length;
  const n = totals.length;
  const paid = formatUsd(paidMinor);
  if (below === n) return `In all ${n} illustrations, the total paid back is less than the ${paid} paid.`;
  if (below === 0) return `In these ${n} illustrations the total reaches at least the ${paid} paid only because royalties are assumed to keep coming in; real royalties can be lower or zero.`;
  return `In ${below} of these ${n} illustrations, the total paid back is less than the ${paid} paid.`;
}

export function PayoutIllustration({ fansBps, unitsTotal, unitPriceMinor, capBps, maturityMonths, units = 1 }: { fansBps: number; unitsTotal: number; unitPriceMinor: number; capBps: number; maturityMonths: number; units?: number }) {
  // Fractional years (PR #13 review round 2, finding 4): an 18-month Pool illustrates 1.5 years, labelled "18 months".
  const years = illustrationYears(maturityMonths);
  const results = SCENARIOS.map((s) => ({ ...s, totalMinor: illustratePerUnit({ yearlyCoveredRoyaltiesMinor: s.yearly, fansBps, unitsTotal, unitPriceMinor, capBps, years }).totalMinor * units }));
  const paidMinor = unitPriceMinor * units;
  return (
    <Card className="flex flex-col gap-4" data-testid="payout-illustration">
      <div>
        <p className="font-semibold text-fg">What {units === 1 ? "one Unit" : `${units} Units`} could pay — an illustration, not a forecast</p>
        <p className="text-sm text-muted">
          Potential payouts over {illustrationPeriod(maturityMonths)} from the fan share of royalties, capped at {capBps / 10_000}× the price. Real results depend on royalties actually
          collected and can be zero.
        </p>
      </div>
      <dl className="divide-y divide-line">
        {results.map((r) => <KeyValue key={r.label} k={r.label} v={<span className="num">{formatUsd(r.totalMinor)} total</span>} />)}
      </dl>
      <p className="text-xs text-muted" data-testid="illustration-summary">
        {units === 1 ? "One Unit costs" : `${units} Units cost`} <span className="num">{formatUsd(paidMinor)}</span>. {illustrationSummary(results.map((r) => r.totalMinor), paidMinor)}{" "}
        Potential payouts are never guaranteed.
      </p>
    </Card>
  );
}

/* ── Investment status ──────────────────────────────────── */

export const INVESTMENT_STATUS: Record<string, { label: string; tone: "gold" | "success" | "info" | "warning" | "neutral" | "error"; help: string }> = {
  reserved: { label: "Units reserved", tone: "warning", help: "Your Units are held while your payment starts." },
  funding: { label: "Payment moving", tone: "warning", help: "Your bank payment is on its way to the offering's escrow account." },
  funded: { label: "Held in escrow", tone: "gold", help: "Your money is in the offering's escrow account. If the target isn't reached, you're refunded in full." },
  issued: { label: "Units issued", tone: "success", help: "The offering closed at its target and your Units were issued." },
  expired: { label: "Reservation expired", tone: "neutral", help: "The payment didn't start in time. Nothing was charged." },
  cancelled: { label: "Cancelled", tone: "neutral", help: "You cancelled. Nothing was charged." },
  cancel_pending: { label: "Cancellation received", tone: "warning", help: "Cancellation received — we'll refund your payment in full as soon as it arrives." },
  returned: { label: "Payment returned", tone: "error", help: "Your bank returned the payment, so no Units were issued." },
  refund_pending: { label: "Refund on its way", tone: "warning", help: "Your refund from escrow has started." },
  refunded: { label: "Refunded", tone: "neutral", help: "You were refunded in full from escrow." },
};

type StatusFields = Pick<InvestmentView, "status" | "statusReason"> & { cancelRequestedAt?: string | null };

/**
 * What to show for an investment. `cancel_pending` isn't a stored status: the investor asked to cancel while a payment
 * may still be on its way (`cancelRequestedAt` set on a `reserved` or `funding` investment — L2-T-031, L2-T-043).
 */
export function displayStatus(i: StatusFields): string {
  if (i.cancelRequestedAt && (i.status === "reserved" || i.status === "funding")) return "cancel_pending";
  return i.status;
}

export function statusHelp(i: StatusFields): string {
  const s = displayStatus(i);
  // A reservation with a provider call started: a payment may or may not have been taken (design §4.3).
  if (s === "cancel_pending" && i.status === "reserved") return "Cancellation received — if any payment was taken, we'll refund it in full as soon as it arrives.";
  if (i.status === "refund_pending" && i.statusReason === "cancelled_by_investor") return "Cancelled. Your refund from escrow has started, for the full amount received.";
  return INVESTMENT_STATUS[s]?.help ?? "";
}

export function StatusBadge({ status }: { status: string }) {
  const s = INVESTMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const COLLECTION_STATE_COPY: Record<string, { label: string; tone: "success" | "warning" | "error" | "info" | "neutral" }> = {
  COLLECTING: { label: "Collecting", tone: "success" },
  AT_RISK: { label: "Payment late", tone: "warning" },
  DEFAULT: { label: "In default", tone: "error" },
  REMEDIATION: { label: "Remediation", tone: "info" },
  CHARGED_OFF: { label: "Charged off", tone: "error" },
};

export function CollectionStateBadge({ state }: { state: string }) {
  const c = COLLECTION_STATE_COPY[state] ?? { label: state, tone: "neutral" as const };
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

export const POOL_STATUS_COPY: Record<string, string> = {
  draft: "Draft", in_review: "Form C review", revisions_requested: "Revisions requested", approved: "Approved", live: "Open",
  funded: "Funded", failed: "Didn't reach its target", refunded: "Refunded", matured: "Ended", withdrawn: "Withdrawn",
};

export function daysLeft(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export const shortDate = (iso: string | null) => (iso ? formatDate(iso) : "—");

export function FormCLinkTo({ slug, children = "Read the Form C" }: { slug: string; children?: ReactNode }) {
  return (
    <Link to={`/pools/${slug}/form-c`} className="text-sm font-medium text-gold underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
