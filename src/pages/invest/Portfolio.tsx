import { Link, useSearchParams } from "react-router";
import { ArrowRight, Compass, FileText, LineChart, Lock, Vote } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, PageHeader, ProgressBar, RegulatoryFooter, SectionHeading, Stat, WhenFlag } from "@/components/brand";
import { LimitMeter } from "@/components/invest/ui";
import { day, holdingViews, regCfUsage, TODAY, type HoldingView } from "@/components/invest/data";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: FanZuP FanApp.tsx dashboard (rebuilt per CONSOLIDATION.md).
 * Changes: "All-time yield", "accrued yield / ready to claim", "global ranking", asset-allocation chart
 * and "+12.4% vs last month" removed. Shows only amounts invested, distributions actually received,
 * return-cap progress, maturity, lock-up end and Reg CF limit usage. `?state=empty` shows the empty state.
 */
export default function Portfolio() {
  const [params] = useSearchParams();
  const views = params.get("state") === "empty" ? [] : holdingViews();
  const usage = regCfUsage();
  const invested = views.reduce((s, v) => s + v.holding.investedMinor, 0);
  const distributions = views.reduce((s, v) => s + v.holding.distributionsMinor, 0);

  return (
    <Container size="xl" className="flex flex-col gap-10 py-8 sm:py-10">
      <PageHeader
        eyebrow="Portfolio"
        title="Your Pools"
        description="What you've invested, what's been paid out, and when your Units unlock."
        actions={
          <Button asChild variant="secondary">
            <Link to="/pools">
              <Compass /> Browse Pools
            </Link>
          </Button>
        }
        className="pb-0"
      />

      {views.length === 0 ? (
        <EmptyState
          icon={<LineChart />}
          title="You don't hold any Pool Units yet"
          action={
            <Button asChild>
              <Link to="/pools">
                Browse Pools <ArrowRight />
              </Link>
            </Button>
          }
        >
          When you invest in a Pool, your Units, distributions and lock-up dates show up here. Investing is optional and risky — read each Form C
          first.
        </EmptyState>
      ) : (
        <>
          <Card className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Amount invested" value={formatMoney(invested)} hint="Across all your Pools" />
            <Stat label="Distributions received" value={formatMoney(distributions, { cents: true })} hint="Paid to you to date" />
            <Stat label="Pools held" value={views.length} hint={`${views.reduce((s, v) => s + v.holding.units, 0)} Units in total`} />
            <Stat label="Reg CF limit left" value={formatMoney(usage.remaining)} hint="Rolling 12 months" />
          </Card>

          <section>
            <SectionHeading eyebrow="Holdings" title="Pools you hold" />
            {/* Desktop table */}
            <Card padded={false} className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    {["Pool", "Units", "Invested", "Distributions", "Progress to cap", "Matures", "Lock-up ends", ""].map((h) => (
                      <th key={h} scope="col" className="px-5 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {views.map((v) => (
                    <HoldingRow key={v.pool.id} v={v} />
                  ))}
                </tbody>
              </table>
            </Card>
            {/* Mobile cards */}
            <div className="flex flex-col gap-4 lg:hidden">
              {views.map((v) => (
                <HoldingCard key={v.pool.id} v={v} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Progress to cap counts distributions actually received. Reaching the cap isn't expected or assured.</p>
          </section>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Reg CF limit</h2>
              <p className="text-sm text-muted">What you can still invest through Reg CF in the current rolling 12 months, on any platform.</p>
            </div>
            <Link to="/investor/certification" className="shrink-0 text-sm font-medium text-gold hover:underline">
              Update
            </Link>
          </div>
          <LimitMeter limit={usage.limit} used={params.get("state") === "empty" ? 0 : usage.used} />
          <p className="text-xs text-muted">
            Includes <span className="num">{formatMoney(usage.elsewhere)}</span> you reported investing on other platforms.
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Documents and votes</h2>
          <Link to="/settings/tax" className="flex items-center gap-3 rounded-md px-1 py-2 text-sm text-fg hover:text-gold">
            <FileText className="size-4 text-muted" aria-hidden /> Tax documents
          </Link>
          <WhenFlag flag="postBeta">
            <Link to="/governance" className="flex items-center gap-3 rounded-md px-1 py-2 text-sm text-fg hover:text-gold">
              <Vote className="size-4 text-muted" aria-hidden /> Holder communications & votes
            </Link>
          </WhenFlag>
          <p className="text-xs text-muted">Annual reports (Form C-AR) for each Pool are on its holding page.</p>
        </Card>
      </div>

      <RegulatoryFooter />
    </Container>
  );
}

function LockCell({ unlocksOn }: { unlocksOn: string }) {
  const locked = new Date(day(unlocksOn)) > TODAY;
  return (
    <span className="flex items-center gap-1.5">
      {locked && <Lock className="size-3.5 text-muted" aria-label="Locked" />}
      <span className="num">{formatDate(day(unlocksOn))}</span>
    </span>
  );
}

function HoldingRow({ v }: { v: HoldingView }) {
  return (
    <tr className="hover:bg-surface-2/50">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <ArtistArt seed={v.pool.artistId} label={v.artistName} rounded="md" className="size-10 shrink-0" />
          <div className="flex flex-col">
            <Link to={`/portfolio/${v.pool.id}`} className="font-medium text-fg hover:text-gold">
              {v.pool.title}
            </Link>
            <span className="text-xs text-muted">{v.pool.kind} Pool</span>
          </div>
        </div>
      </td>
      <td className="num px-5 py-4">{v.holding.units}</td>
      <td className="num px-5 py-4">{formatMoney(v.holding.investedMinor)}</td>
      <td className="num px-5 py-4">{formatMoney(v.holding.distributionsMinor, { cents: true })}</td>
      <td className="px-5 py-4">
        <div className="flex w-36 flex-col gap-1.5">
          <ProgressBar value={v.capProgress} max={1} tone="info" label={`Progress to ${v.pool.returnCapMultiple}× cap`} />
          <span className="num text-xs text-muted">
            {(v.capProgress * 100).toFixed(1)}% of {v.pool.returnCapMultiple}× cap
          </span>
        </div>
      </td>
      <td className="num px-5 py-4">{formatDate(day(v.maturesOn))}</td>
      <td className="px-5 py-4">
        <LockCell unlocksOn={v.holding.unlocksOn} />
      </td>
      <td className="px-5 py-4 text-right">
        <Link to={`/portfolio/${v.pool.id}`} className="text-sm font-medium text-gold hover:underline" aria-label={`View ${v.pool.title}`}>
          View
        </Link>
      </td>
    </tr>
  );
}

function HoldingCard({ v }: { v: HoldingView }) {
  return (
    <Card interactive padded={false}>
      <Link to={`/portfolio/${v.pool.id}`} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <ArtistArt seed={v.pool.artistId} label={v.artistName} rounded="md" className="size-12 shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-fg">{v.pool.title}</span>
            <Badge tone="neutral" className="w-fit">
              {v.pool.kind} Pool
            </Badge>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Units", String(v.holding.units)],
            ["Invested", formatMoney(v.holding.investedMinor)],
            ["Distributions", formatMoney(v.holding.distributionsMinor, { cents: true })],
            ["Matures", formatDate(day(v.maturesOn))],
          ].map(([k, val]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="num text-fg">{val}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={v.capProgress} max={1} tone="info" label="Progress to cap" />
          <span className="num text-xs text-muted">
            {(v.capProgress * 100).toFixed(1)}% of {v.pool.returnCapMultiple}× cap
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-line pt-3 text-sm text-muted">
          <span>Lock-up ends</span>
          <LockCell unlocksOn={v.holding.unlocksOn} />
        </div>
      </Link>
    </Card>
  );
}
