/**
 * Layer 2 building blocks on real data (CR-002). Disclosure wording lives here or in brand/compliance.tsx only.
 * Copy is product guidance pending counsel review — not legal advice.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlert, FlaskConical, RefreshCw, ShieldCheck, ShieldQuestion, ShieldHalf } from "lucide-react";
import { illustratePerUnit, RISK_BADGE_COPY, REVENUE_TYPE_COPY, type RevenueType, type RiskBadge } from "@fanzup/shared/l2";
import { Badge, Button, Callout, Card, Container, EmptyState, KeyValue } from "@/components/brand";
import { ApiError } from "@/lib/api";
import { isL2Disabled } from "@/lib/l2";
import { formatDate, formatMoney } from "@/lib/format";

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
        Investment Pools launch once our registered funding-portal partner is live. Until then you can back campaigns, subscribe, and shop merch and tickets.
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

export function apiMessage(e: unknown) {
  return e instanceof ApiError ? e.message : "Something went wrong on our side.";
}

/* ── Risk badge (design §8) ─────────────────────────────── */

const BADGE_TONE: Record<RiskBadge, { tone: "success" | "info" | "warning"; icon: ReactNode }> = {
  SECURED_ISH: { tone: "success", icon: <ShieldCheck /> },
  VERIFIED: { tone: "info", icon: <ShieldHalf /> },
  TRUST_BASED: { tone: "warning", icon: <ShieldQuestion /> },
};

export function RiskBadgeChip({ badge }: { badge: RiskBadge | null }) {
  if (!badge) return null;
  return (
    <Badge tone={BADGE_TONE[badge].tone} icon={BADGE_TONE[badge].icon}>
      {RISK_BADGE_COPY[badge].label}
    </Badge>
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

/* ── Potential payout illustration (always includes zero) ── */

export function PayoutIllustration({ fansBps, unitsTotal, unitPriceMinor, capBps, maturityMonths, units = 1 }: { fansBps: number; unitsTotal: number; unitPriceMinor: number; capBps: number; maturityMonths: number; units?: number }) {
  const years = Math.max(1, Math.round(maturityMonths / 12));
  // Yearly covered royalties the album might earn: none, modest, strong. Illustrations, not forecasts.
  const scenarios = [
    { label: "If the album earns nothing", yearly: 0 },
    { label: "If it earns $5,000 a year", yearly: 5_000_00 },
    { label: "If it earns $40,000 a year", yearly: 40_000_00 },
  ];
  return (
    <Card className="flex flex-col gap-4" data-testid="payout-illustration">
      <div>
        <p className="font-semibold text-fg">What {units === 1 ? "one Unit" : `${units} Units`} could pay — an illustration, not a forecast</p>
        <p className="text-sm text-muted">
          Potential payouts over {years} years from the fan share of royalties, capped at {capBps / 10_000}× what you paid. Real results depend on royalties
          actually collected and can be zero.
        </p>
      </div>
      <dl className="divide-y divide-line">
        {scenarios.map((s) => {
          const r = illustratePerUnit({ yearlyCoveredRoyaltiesMinor: s.yearly, fansBps, unitsTotal, unitPriceMinor, capBps, years });
          return <KeyValue key={s.label} k={s.label} v={<span className="num">{formatMoney(r.totalMinor * units, { cents: true })} total</span>} />;
        })}
      </dl>
      <p className="text-xs text-muted">
        You paid <span className="num">{formatMoney(unitPriceMinor * units)}</span>. Most of these scenarios return less than that. Potential payouts are never
        guaranteed.
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
  cancelled: { label: "Cancelled", tone: "neutral", help: "You cancelled before paying." },
  returned: { label: "Payment returned", tone: "error", help: "Your bank returned the payment, so no Units were issued." },
  refund_pending: { label: "Refund on its way", tone: "warning", help: "Your refund from escrow has started." },
  refunded: { label: "Refunded", tone: "neutral", help: "You were refunded in full from escrow." },
};

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
