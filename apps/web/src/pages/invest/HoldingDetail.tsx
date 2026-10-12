import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, FileText } from "lucide-react";
import { Callout, Card, Container, EmptyState, KeyValue, LockupNotice, PageHeader, ProgressBar, RegulatoryFooter, SectionHeading } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { CancelInvestment, cancelOutcome, CANNOT_CANCEL_LINE, pastCancelBy } from "@/components/invest/CancelInvestment";
import { CollectionStateBadge, displayStatus, FormCLinkTo, LoadGate, RiskBadgeChip, shortDate, StatusBadge, statusHelp, useLoad } from "@/components/invest/l2ui";
import { l2, type InvestmentView } from "@/lib/l2";
import { formatInstant, formatMoney } from "@/lib/format";

/**
 * Source: (new) holding detail + LockupNotice per Mechanism 07 P0, rebuilt on the API (CR-002).
 * Each investment in one Pool: status, lock-up, received vs potential, distribution statements with their tax form
 * (1099-DIV default, pending counsel), Form C, and the cancel right while it lasts. No prices and no transfer actions
 * (soft transfers are postBeta). The same investment by id, with a cancel-only view while the flag is off, is
 * /investments/:id (InvestmentView.tsx).
 */
export default function HoldingDetailPage() {
  return (
    <RequireAccount verified={false}>
      <HoldingDetail />
    </RequireAccount>
  );
}

function HoldingDetail() {
  const { poolId = "" } = useParams();
  const load = useLoad(async () => (await l2.portfolio()).investments.filter((i) => i.poolSlug === poolId), [poolId]);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <Link to="/portfolio" className="flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Portfolio</Link>
      <LoadGate load={load} what="this holding">
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={<FileText />} title="You don't hold Units in this Pool" />
          ) : (
            <>
              <PageHeader eyebrow={list[0].artistDisplay} title={list[0].poolTitle} actions={<FormCLinkTo slug={list[0].poolSlug} />} />
              {list.map((i) => <Holding key={i.id} i={i} onChange={load.reload} />)}
            </>
          )
        }
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}

/** Whether an open investment has passed its cancel-by time (so the page says it can't be cancelled any more). */
const showCannotCancel = (i: InvestmentView) =>
  !i.canCancelUntil && !i.cancelRequestedAt && ["reserved", "funding", "funded"].includes(i.status) && i.poolStatus === "live" && pastCancelBy(i);

export function Holding({ i, onChange, cancelOnly = false }: { i: InvestmentView; onChange: () => void; cancelOnly?: boolean }) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const status = displayStatus(i);
  return (
    <section className="flex flex-col gap-4" data-testid="holding" data-status={status}>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <RiskBadgeChip badge={i.riskBadge} />
          {i.status === "issued" && <CollectionStateBadge state={i.collectionState} />}
        </div>
        <p className="text-sm text-muted" data-testid="holding-help">{statusHelp(i)}</p>
        <dl className="divide-y divide-line">
          <KeyValue k="Units" v={<span className="num">{i.units}</span>} />
          <KeyValue k="Amount" v={<span className="num">{formatMoney(i.amountMinor)}</span>} />
          {!cancelOnly && <KeyValue k="Received so far" v={<span className="num">{formatMoney(i.receivedMinor)}</span>} />}
          {!cancelOnly && <KeyValue k="Most it can still pay" v={<span className="num">{formatMoney(Math.max(0, i.capMinor - i.distributedMinor))}</span>} />}
          {!cancelOnly && <KeyValue k="Pool ends by" v={<span className="num">{shortDate(i.maturesAt)}</span>} />}
          {i.cancelRequestedAt && <KeyValue k="Cancellation received" v={<span className="num">{formatInstant(i.cancelRequestedAt)}</span>} />}
          {i.refundedAt && <KeyValue k="Refunded" v={<span className="num">{formatInstant(i.refundedAt)}</span>} />}
        </dl>
        {i.status === "issued" && <ProgressBar value={i.distributedMinor} max={i.capMinor} tone="info" label="Progress to the return cap" />}
        <CancelInvestment
          i={i}
          onDone={(next, result) => {
            setOutcome(cancelOutcome(result, next));
            onChange();
          }}
        />
        {showCannotCancel(i) && <p className="text-sm text-muted" data-testid="cannot-cancel">{CANNOT_CANCEL_LINE}.</p>}
        {outcome && <Callout tone="info" title="Done">{outcome}</Callout>}
      </Card>
      {!cancelOnly && i.lockupEndsAt && <LockupNotice unlocksOn={i.lockupEndsAt} />}
      {!cancelOnly && i.collectionState !== "COLLECTING" && i.status === "issued" && (
        <Callout tone="warning" title="Royalty collection needs attention">The artist's royalty payment is late or short. Potential payouts may be smaller or delayed. Your claim is unsecured.</Callout>
      )}
      {!cancelOnly && i.status === "issued" && (
        <div>
          <SectionHeading eyebrow="Waterfall" title="Distributions" />
          {i.payouts.length === 0 ? (
            <p className="text-sm text-muted">No distributions yet. They're paid quarterly from collected royalties only, and can be zero.</p>
          ) : (
            <Card padded={false} className="divide-y divide-line" data-testid="payouts">
              {i.payouts.map((p) => (
                <div key={p.label} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span className="text-fg">{p.label}</span>
                  <span className="text-sm text-muted">{p.status === "paid" ? `Paid ${shortDate(p.paidAt)}` : "On its way"} · {p.taxForm ?? "—"} (pending counsel)</span>
                  <span className="num text-fg">{formatMoney(p.amountMinor, { cents: true })}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
