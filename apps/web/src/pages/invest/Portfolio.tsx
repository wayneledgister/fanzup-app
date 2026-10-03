import { Link } from "react-router";
import { ArrowRight, Briefcase, Lock } from "lucide-react";
import { ArtistArt, Button, Card, Container, EmptyState, PageHeader, ProgressBar, RegulatoryFooter, Stat } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { CollectionStateBadge, LoadGate, RiskBadgeChip, shortDate, StatusBadge, useLoad } from "@/components/invest/l2ui";
import { LimitMeter } from "@/components/invest/ui";
import { l2, type InvestmentView } from "@/lib/l2";
import { formatMoney } from "@/lib/format";

/**
 * Source: FanZuP FanApp dashboard, rebuilt on the API per CONSOLIDATION.md (CR-002, FR-L2-INV-005).
 * "Your Pools": Units held, amount, status, lock-up end and countdown (Mechanism 07 P0: no transfers, no prices),
 * received vs potential (cap) distributions, maturity. Newest first — never ranked by amount or payout.
 */
export default function PortfolioPage() {
  return (
    <RequireAccount verified={false}>
      <Portfolio />
    </RequireAccount>
  );
}

function Portfolio() {
  const load = useLoad(() => l2.portfolio(), []);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Your Pools" title="Portfolio" description="Your Units, where your money is, and what each Pool has paid so far." />
      <LoadGate load={load} what="your portfolio">
        {({ investor, investments }) => {
          const held = investments.filter((i) => ["issued", "funded", "funding"].includes(i.status));
          const invested = held.reduce((s, i) => s + i.amountMinor, 0);
          const received = investments.reduce((s, i) => s + i.receivedMinor, 0);
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card><Stat label="In Pools" value={<span className="num">{formatMoney(invested)}</span>} hint="Held in escrow or issued as Units" /></Card>
                <Card><Stat label="Paid to you" value={<span className="num">{formatMoney(received)}</span>} hint="From collected royalties" /></Card>
                <Card>
                  {investor.limitMinor == null ? (
                    <Stat label="Reg CF limit" value="No limit" hint="Accredited investor" />
                  ) : (
                    <div className="flex flex-col gap-2"><span className="text-sm text-muted">Reg CF limit (12 months)</span><LimitMeter limit={investor.limitMinor} used={investor.usedMinor} /></div>
                  )}
                </Card>
              </div>
              {investments.length === 0 ? (
                <EmptyState icon={<Briefcase />} title="No Pools yet" action={<Button asChild><Link to="/pools">Browse Pools <ArrowRight /></Link></Button>}>
                  When you buy Units, they show up here.
                </EmptyState>
              ) : (
                <ul className="flex flex-col gap-4" data-testid="portfolio-list">
                  {investments.map((i) => <Row key={i.id} i={i} />)}
                </ul>
              )}
            </>
          );
        }}
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}

function Row({ i }: { i: InvestmentView }) {
  const lockDays = i.lockupEndsAt ? Math.max(0, Math.ceil((new Date(i.lockupEndsAt).getTime() - Date.now()) / 86_400_000)) : null;
  return (
    <li>
      <Card className="flex flex-col gap-4" data-testid="holding-row" data-status={i.status} data-pool={i.poolSlug}>
        <div className="flex flex-wrap items-start gap-4">
          <ArtistArt seed={i.poolSlug} label={i.poolTitle} rounded="md" className="size-14 shrink-0" />
          <div className="min-w-0 flex-1 basis-48">
            <Link to={`/portfolio/${i.poolSlug}`} className="font-semibold hover:underline">{i.poolTitle}</Link>
            <p className="text-sm text-muted">{i.artistDisplay}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={i.status} />
              <RiskBadgeChip badge={i.riskBadge} />
              {i.status === "issued" && <CollectionStateBadge state={i.collectionState} />}
            </div>
          </div>
          <div className="text-right">
            <p className="num text-lg text-fg">{i.units} Units</p>
            <p className="num text-sm text-muted">{formatMoney(i.amountMinor)}</p>
          </div>
        </div>
        {i.status === "issued" && (
          <>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Paid to you <span className="num text-fg" data-testid="received">{formatMoney(i.receivedMinor)}</span></span>
                <span className="text-muted">cap <span className="num">{formatMoney(i.capMinor)}</span></span>
              </div>
              <ProgressBar value={i.distributedMinor} max={i.capMinor} tone="info" label="Progress to the return cap" />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1"><Lock className="size-4" /> {lockDays && lockDays > 0 ? <>Locked for <span className="num text-fg">{lockDays}</span> more days (until {shortDate(i.lockupEndsAt)})</> : "Lock-up ended · no marketplace"}</span>
              <span>Pool ends by <span className="num">{shortDate(i.maturesAt)}</span></span>
            </div>
          </>
        )}
      </Card>
    </li>
  );
}
