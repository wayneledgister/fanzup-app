import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, FileText, Undo2 } from "lucide-react";
import { Button, Callout, Card, Container, EmptyState, KeyValue, LockupNotice, PageHeader, ProgressBar, RegulatoryFooter, SectionHeading } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { apiMessage, CollectionStateBadge, FormCLinkTo, INVESTMENT_STATUS, LoadGate, RiskBadgeChip, shortDate, StatusBadge, useLoad } from "@/components/invest/l2ui";
import { l2, type InvestmentView } from "@/lib/l2";
import { formatInstant, formatMoney } from "@/lib/format";

/**
 * Source: (new) holding detail + LockupNotice per Mechanism 07 P0, rebuilt on the API (CR-002).
 * Each investment in one Pool: status, lock-up, received vs potential, distribution statements with their tax form
 * (1099-DIV default, pending counsel), Form C. No prices and no transfer actions (soft transfers are postBeta).
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

function Holding({ i, onChange }: { i: InvestmentView; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const cancel = async () => {
    try {
      await l2.cancel(i.id);
      onChange();
    } catch (e) {
      setErr(apiMessage(e));
    }
  };
  return (
    <section className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={i.status} />
          <RiskBadgeChip badge={i.riskBadge} />
          {i.status === "issued" && <CollectionStateBadge state={i.collectionState} />}
        </div>
        <p className="text-sm text-muted">{INVESTMENT_STATUS[i.status]?.help}</p>
        <dl className="divide-y divide-line">
          <KeyValue k="Units" v={<span className="num">{i.units}</span>} />
          <KeyValue k="Amount" v={<span className="num">{formatMoney(i.amountMinor)}</span>} />
          <KeyValue k="Received so far" v={<span className="num">{formatMoney(i.receivedMinor)}</span>} />
          <KeyValue k="Most it can still pay" v={<span className="num">{formatMoney(Math.max(0, i.capMinor - i.distributedMinor))}</span>} />
          <KeyValue k="Pool ends by" v={<span className="num">{shortDate(i.maturesAt)}</span>} />
          {i.refundedAt && <KeyValue k="Refunded" v={<span className="num">{formatInstant(i.refundedAt)}</span>} />}
        </dl>
        {i.status === "issued" && <ProgressBar value={i.distributedMinor} max={i.capMinor} tone="info" label="Progress to the return cap" />}
        {i.canCancelUntil && i.status === "funded" && (
          <Button variant="secondary" onClick={cancel}><Undo2 /> Cancel until {formatInstant(i.canCancelUntil)}</Button>
        )}
        {err && <p className="text-sm text-error" role="alert">{err}</p>}
      </Card>
      {i.lockupEndsAt && <LockupNotice unlocksOn={i.lockupEndsAt} />}
      {i.collectionState !== "COLLECTING" && i.status === "issued" && (
        <Callout tone="warning" title="Royalty collection needs attention">The artist's royalty payment is late or short. Potential payouts may be smaller or delayed. Your claim is unsecured.</Callout>
      )}
      {i.status === "issued" && (
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
