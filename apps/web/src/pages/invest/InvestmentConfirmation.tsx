import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowRight, CheckCircle2, Clock, Landmark, Undo2 } from "lucide-react";
import { Button, Card, Container, KeyValue, LockupNotice, PageHeader, RegulatoryFooter } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { apiMessage, ErrorBox, INVESTMENT_STATUS, StatusBadge } from "@/components/invest/l2ui";
import { l2, type InvestmentView } from "@/lib/l2";
import { formatInstant, formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup InvestmentConfirmation.tsx, rebuilt on the API (CR-002).
 * Polls the investment until the fund move settles in escrow (or is returned). Funds sit with the offering's escrow
 * agent, never FanZuP or the artist; the fan can cancel until the cutoff.
 */
export default function InvestmentConfirmationPage() {
  return (
    <RequireAccount>
      <InvestmentConfirmation />
    </RequireAccount>
  );
}

function InvestmentConfirmation() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const investmentId = params.get("investment") ?? "";
  const [inv, setInv] = useState<InvestmentView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = () => l2.investment(investmentId).then((v) => alive && setInv(v)).catch((e) => alive && setErr(apiMessage(e)));
    poll();
    const t = setInterval(() => {
      if (inv && !["reserved", "funding", "refund_pending"].includes(inv.status)) return;
      poll();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [investmentId, inv?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    if (!inv) return;
    setCancelling(true);
    try {
      setInv(await l2.cancel(inv.id));
    } catch (e) {
      setErr(apiMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Container size="md" className="flex flex-col gap-8 py-8">
      {err && <ErrorBox title="Something went wrong" body={err} />}
      {!inv && !err && <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" />}
      {inv && (
        <>
          <PageHeader
            eyebrow="Investment"
            title={inv.status === "funded" ? "Your money is in escrow" : inv.status === "funding" || inv.status === "reserved" ? "Your payment is on its way" : INVESTMENT_STATUS[inv.status]?.label ?? inv.status}
            description={INVESTMENT_STATUS[inv.status]?.help}
          />
          <Card className="flex flex-col gap-4" data-testid="confirmation" data-status={inv.status}>
            <div className="flex items-center gap-3">
              {inv.status === "funded" ? <CheckCircle2 className="size-6 text-success" /> : inv.status === "funding" ? <Clock className="size-6 text-warning" /> : <Landmark className="size-6 text-muted" />}
              <p className="font-semibold text-fg">{inv.poolTitle}</p>
              <StatusBadge status={inv.status} />
            </div>
            <dl className="divide-y divide-line">
              <KeyValue k="Units" v={<span className="num">{inv.units}</span>} />
              <KeyValue k="Amount" v={<span className="num">{formatMoney(inv.amountMinor)}</span>} />
              <KeyValue k="Offering closes" v={<span className="num">{inv.poolEndsAt ? formatInstant(inv.poolEndsAt) : "—"}</span>} />
              {inv.canCancelUntil && <KeyValue k="Cancel until" v={<span className="num">{formatInstant(inv.canCancelUntil)}</span>} />}
              <KeyValue k="Reference" v={<span className="num text-xs">{inv.id.slice(0, 8)}</span>} />
            </dl>
          </Card>
          {inv.lockupEndsAt && <LockupNotice unlocksOn={inv.lockupEndsAt} />}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild><Link to="/portfolio" data-testid="go-portfolio">See your portfolio <ArrowRight /></Link></Button>
            {inv.canCancelUntil && inv.status === "funded" && (
              <Button variant="secondary" onClick={cancel} disabled={cancelling}><Undo2 /> {cancelling ? "Cancelling…" : "Cancel and get a full refund"}</Button>
            )}
            <Button asChild variant="ghost"><Link to={`/pools/${id}`}>Back to the Pool</Link></Button>
          </div>
        </>
      )}
      <RegulatoryFooter />
    </Container>
  );
}
