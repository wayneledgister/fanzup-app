/**
 * Shared building blocks for the Layer 2 investing area (KYC, Pools, Portfolio).
 * Disclosure copy that isn't covered by `@/components/brand/compliance` lives here so it stays in
 * one place; candidates to promote into compliance.tsx after counsel review.
 * Copy is product guidance pending counsel review — not legal advice.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, Building2, Landmark, Lock, SearchX, ShieldCheck, Undo2 } from "lucide-react";
import { Badge, Button, Callout, Container, EmptyState, KeyValue, ProgressBar, Stepper } from "@/components/brand";
import { formatMoney } from "@/lib/format";
import type { Pool } from "@/lib/mock";
import { COLLECTION_INFO } from "./data";

/* ── KYC wizard frame ───────────────────────────────────── */

export const KYC_STEPS = ["Start", "ID type", "Document", "Selfie", "Review"];

/** Partner banner: these steps are rendered by the vendor-hosted identity SDK in production (PRD 01 §9.7). */
export function PartnerBanner() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
      <ShieldCheck className="size-5 shrink-0 text-gold" aria-hidden />
      <p className="text-muted">
        <span className="font-medium text-fg">Verification by our identity partner.</span> Your ID images go straight to them — FanZuP
        doesn't store your documents.
      </p>
    </div>
  );
}

export function KycFrame({ step, title, description, children, footer }: { step: number; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <span className="eyebrow text-gold">Investor verification</span>
          <span className="num text-xs text-muted">
            Step {Math.min(step, KYC_STEPS.length)} of {KYC_STEPS.length}
          </span>
        </div>
        <Stepper steps={KYC_STEPS} current={step} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{title}</h1>
        {description && <p className="text-muted">{description}</p>}
      </div>
      {children}
      {footer}
    </div>
  );
}

export function WizardFooter({ backTo, backLabel = "Back", children }: { backTo?: string; backLabel?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      {backTo ? (
        <Button asChild variant="ghost">
          <Link to={backTo}>
            <ArrowLeft /> {backLabel}
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col gap-3 sm:flex-row">{children}</div>
    </div>
  );
}

/* ── Pool terms ─────────────────────────────────────────── */

export function CollectionBadge({ collection }: { collection: Pool["collection"] }) {
  const info = COLLECTION_INFO[collection];
  return <Badge tone={info.tone}>{info.label}</Badge>;
}

export function PoolTerms({ pool, className }: { pool: Pool; className?: string }) {
  return (
    <dl className={className}>
      <KeyValue k="Revenue share" v={<span className="num">{pool.revenueSharePct}% of covered revenue</span>} />
      <KeyValue k="Return cap" v={<span className="num">{pool.returnCapMultiple}× what you paid</span>} />
      <KeyValue k="Maturity" v={<span className="num">{pool.maturityYears} years</span>} />
      <KeyValue k="Distributions" v={pool.distribution} />
      <KeyValue k="Unit price" v={<span className="num">{formatMoney(pool.unitPriceMinor)}</span>} />
      <KeyValue k="Collection" v={<CollectionBadge collection={pool.collection} />} />
    </dl>
  );
}

/** Raised vs target for a Pool (investors, not backers). */
export function OfferingProgress({ pool, daysLeft }: { pool: Pool; daysLeft: number }) {
  const pct = Math.round((pool.raisedMinor / pool.targetMinor) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-lg font-medium text-fg">{formatMoney(pool.raisedMinor)}</span>
        <span className="num text-sm text-muted">{pct}% of target</span>
      </div>
      <ProgressBar value={pool.raisedMinor} max={pool.targetMinor} tone="info" label="Offering progress" />
      <div className="flex justify-between gap-2 text-xs text-muted">
        <span>
          of <span className="num">{formatMoney(pool.targetMinor)}</span> target · <span className="num">{pool.investors.toLocaleString()}</span> investors
        </span>
        <span className="num">{daysLeft > 0 ? `${daysLeft}d left` : "Closed"}</span>
      </div>
    </div>
  );
}

/* ── Layer 2 disclosures not covered by compliance.tsx ──── */

/** Reg CF offering escrow (distinct from Layer 1 EscrowNotice, which says "not an investment"). */
export function OfferingEscrowNotice() {
  return (
    <Callout tone="info" icon={<Landmark />} title="Held in escrow until the offering closes">
      Your money is held by the intermediary's escrow agent — not by FanZuP and not by the artist. If the offering doesn't reach its
      target by the deadline, or you cancel in time, it's returned to you.
    </Callout>
  );
}

export function CancellationNotice({ cancelBy }: { cancelBy?: string }) {
  return (
    <Callout tone="info" icon={<Undo2 />} title="You can cancel up to 48 hours before the offering closes">
      {cancelBy ? (
        <>
          Cancel any time until <span className="num text-fg">{cancelBy}</span> and your money is returned in full.{" "}
        </>
      ) : (
        "Until then you can cancel and get your money back in full. "
      )}
      If the offering terms change materially, you'll be asked to reconfirm — if you don't, your investment is cancelled and refunded.
    </Callout>
  );
}

export function IntermediaryDisclosure() {
  return (
    <Callout tone="info" icon={<Building2 />} title="Who you're investing through">
      This offering is made under Regulation Crowdfunding through our FINRA-registered intermediary, which hosts the Form C and runs
      the offering. FanZuP provides the technology. Neither FanZuP nor the intermediary gives investment advice or recommends this
      offering.
    </Callout>
  );
}

/** Pre-purchase explanation of the 12-month resale restriction (LockupNotice covers holdings). */
export function LockupExplainer({ unlocksOn }: { unlocksOn: string }) {
  return (
    <Callout tone="info" icon={<Lock />} title="Plan to hold your Units">
      For 12 months after Units are issued (estimated through <span className="num text-fg">{unlocksOn}</span>) they can only be
      transferred back to the issuer, to an accredited investor, to a family member, or in limited other cases. After that there is
      still no marketplace to sell them.
    </Callout>
  );
}

/** Used vs remaining Reg CF limit. */
export function LimitMeter({ limit, used, extra = 0 }: { limit: number; used: number; extra?: number }) {
  const remaining = Math.max(0, limit - used - extra);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">
          <span className="num text-fg">{formatMoney(used + extra)}</span> used of <span className="num">{formatMoney(limit)}</span>
        </span>
        <span className="num text-fg">{formatMoney(remaining)} left</span>
      </div>
      <ProgressBar value={used + extra} max={limit} tone={used + extra > limit ? "gold" : "info"} label="Reg CF limit used" />
    </div>
  );
}

export function PoolNotFound({ backTo = "/pools", backLabel = "Browse open Pools" }: { backTo?: string; backLabel?: string }) {
  return (
    <Container size="md" className="py-16">
      <EmptyState
        icon={<SearchX />}
        title="We can't find that Pool"
        action={
          <Button asChild variant="secondary">
            <Link to={backTo}>{backLabel}</Link>
          </Button>
        }
      >
        It may have closed, or the link may be wrong.
      </EmptyState>
    </Container>
  );
}
