import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowRight, CheckCircle2, Clock, Landmark } from "lucide-react";
import { Button, Callout, Card, Container, KeyValue, LockupNotice, PageHeader, RegulatoryFooter } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { CancelInvestment, cancelOutcome, CANNOT_CANCEL_LINE, pastCancelBy } from "@/components/invest/CancelInvestment";
import { apiMessage, displayStatus, ErrorBox, INVESTMENT_STATUS, StatusBadge, statusHelp } from "@/components/invest/l2ui";
import { l2, type InvestmentView } from "@/lib/l2";
import { formatInstant, formatUsd } from "@/lib/format";

/**
 * Source: Fan Profile Setup InvestmentConfirmation.tsx, rebuilt on the API (CR-002).
 * The commitment summary (17 CFR 227.303(d); L2-T-044): amount, Unit price, Units, issuer, and the date and time until
 * which the investor can cancel — or that it can't be cancelled any more (within the 48-hour cut-off). Polls the
 * investment until the fund move settles in escrow (or is returned). Cancel is offered whenever the API allows it.
 */
export default function InvestmentConfirmationPage() {
  return (
    <RequireAccount>
      <InvestmentConfirmation />
    </RequireAccount>
  );
}

const MOVING = ["reserved", "funding", "refund_pending"];

function InvestmentConfirmation() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const investmentId = params.get("investment") ?? "";
  const [inv, setInv] = useState<InvestmentView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => l2.investment(investmentId).then((v) => alive && setInv(v)).catch((e) => alive && setErr(apiMessage(e)));
    poll();
    // Poll only while money is moving; no live region — the status text updates quietly.
    const t = setInterval(() => {
      if (inv && !MOVING.includes(inv.status)) return;
      poll();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [investmentId, inv?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = inv ? displayStatus(inv) : null;
  const title = !inv
    ? ""
    : status === "cancel_pending"
      ? "Cancellation received"
      : inv.status === "funded"
        ? "Your money is in escrow"
        : inv.status === "funding" || inv.status === "reserved"
          ? "Your payment is on its way"
          : INVESTMENT_STATUS[inv.status]?.label ?? inv.status;
  const open = inv && ["reserved", "funding", "funded"].includes(inv.status) && !inv.cancelRequestedAt;

  return (
    <Container size="md" className="flex flex-col gap-8 py-8">
      {err && <ErrorBox title="Something went wrong" body={err} />}
      {!inv && !err && <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading your investment" />}
      {inv && status && (
        <>
          <PageHeader eyebrow="Investment" title={title} description={statusHelp(inv)} />
          <Card className="flex flex-col gap-4" data-testid="confirmation" data-status={status}>
            <div className="flex flex-wrap items-center gap-3">
              {inv.status === "funded" ? <CheckCircle2 className="size-6 text-success" aria-hidden /> : inv.status === "funding" ? <Clock className="size-6 text-warning" aria-hidden /> : <Landmark className="size-6 text-muted" aria-hidden />}
              <p className="font-semibold text-fg">{inv.poolTitle}</p>
              <StatusBadge status={status} />
            </div>
            <dl className="divide-y divide-line" data-testid="commitment">
              <KeyValue k="Amount" v={<span className="num" data-testid="c-amount">{formatUsd(inv.amountMinor)}</span>} />
              <KeyValue k="Price per Unit" v={<span className="num" data-testid="c-price">{formatUsd(inv.unitPriceMinor)}</span>} />
              <KeyValue k="Units" v={<span className="num" data-testid="c-units">{inv.units}</span>} />
              <KeyValue k="Issuer" v={<span data-testid="c-issuer">{inv.issuerName ?? inv.artistDisplay}</span>} />
              <KeyValue k="Offering closes" v={<span className="num">{inv.poolEndsAt ? formatInstant(inv.poolEndsAt) : "—"}</span>} />
              {open && (
                <KeyValue
                  k="Cancel by"
                  v={
                    inv.cancelBy && !pastCancelBy(inv) ? (
                      <span className="num" data-testid="c-cancel-by">{formatInstant(inv.cancelBy)}</span>
                    ) : (
                      <span data-testid="c-cancel-by">{CANNOT_CANCEL_LINE}</span>
                    )
                  }
                />
              )}
              <KeyValue k="Reference" v={<span className="num text-xs">{inv.id.slice(0, 8)}</span>} />
            </dl>
            <CancelInvestment
              i={inv}
              onDone={(next, result) => {
                setInv(next);
                setOutcome(cancelOutcome(result, next));
              }}
            />
            {outcome && <Callout tone="info" title="Done"><span data-testid="cancel-outcome">{outcome}</span></Callout>}
          </Card>
          {inv.lockupEndsAt && <LockupNotice unlocksOn={inv.lockupEndsAt} />}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild><Link to="/portfolio" data-testid="go-portfolio">See your portfolio <ArrowRight /></Link></Button>
            <Button asChild variant="ghost"><Link to={`/pools/${id}`}>Back to the Pool</Link></Button>
          </div>
        </>
      )}
      <RegulatoryFooter />
    </Container>
  );
}
