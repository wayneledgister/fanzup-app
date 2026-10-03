import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Download, FileText, Megaphone, Repeat } from "lucide-react";
import {
  ArtistArt, Badge, Button, Card, Container, EmptyState, KeyValue, LockupNotice, ProgressBar, RegulatoryFooter, SectionHeading, Stat, WhenFlag,
} from "@/components/brand";
import { CollectionBadge, PoolNotFound } from "@/components/invest/ui";
import { ARTIST_UPDATES, day, DISTRIBUTIONS, holdingViews, SPV_POOLS, UNITS_OUTSTANDING } from "@/components/invest/data";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: (new) holding detail + LockupNotice + soft-transfer link (postBeta) per Mechanism 07.
 * Distribution history shows only amounts actually collected and paid; the permitted-transfer link
 * renders only inside <WhenFlag flag="postBeta">.
 */
export default function HoldingDetail() {
  const { poolId = "" } = useParams();
  const v = holdingViews().find((x) => x.pool.id === poolId);
  if (!v) return <PoolNotFound backTo="/portfolio" backLabel="Back to Portfolio" />;
  const { pool, holding } = v;
  const history = DISTRIBUTIONS[pool.id] ?? [];
  const updates = ARTIST_UPDATES[pool.id] ?? [];
  const outstanding = UNITS_OUTSTANDING[pool.id] ?? 1;

  return (
    <Container size="xl" className="flex flex-col gap-10 py-8 sm:py-10">
      <Link to="/portfolio" className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Portfolio
      </Link>

      <header className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <ArtistArt seed={pool.artistId} label={v.artistName} className="size-16 shrink-0 sm:size-20" />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{pool.kind} Pool</Badge>
              <CollectionBadge collection={pool.collection} />
              {SPV_POOLS[pool.id] && <Badge tone="info">Held through SPV</Badge>}
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl">{pool.title}</h1>
            <p className="text-sm text-muted">
              Bought <span className="num">{formatDate(day(holding.purchasedOn))}</span> · <span className="num">{holding.units}</span> Units
            </p>
          </div>
        </div>
        <Button asChild variant="secondary">
          <Link to={`/pools/${pool.id}`}>View offering terms</Link>
        </Button>
      </header>

      <Card className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invested" value={formatMoney(holding.investedMinor)} hint={`${holding.units} × ${formatMoney(pool.unitPriceMinor)}`} />
        <Stat label="Distributions received" value={formatMoney(holding.distributionsMinor, { cents: true })} hint="Paid to you to date" />
        <Stat label="Matures" value={formatDate(day(v.maturesOn))} hint={`${pool.maturityYears}-year term`} />
        <Stat label="Lock-up ends" value={formatDate(day(holding.unlocksOn))} hint="12 months after issue" />
      </Card>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-10">
          <section>
            <SectionHeading eyebrow="Return cap" title="Progress toward the cap" />
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-muted">
                  <span className="num text-fg">{formatMoney(holding.distributionsMinor, { cents: true })}</span> received of a{" "}
                  <span className="num">{formatMoney(v.capMinor)}</span> maximum ({pool.returnCapMultiple}×)
                </span>
                <span className="num text-fg">{(v.capProgress * 100).toFixed(1)}%</span>
              </div>
              <ProgressBar value={v.capProgress} max={1} tone="info" label="Progress toward return cap" />
              <p className="text-xs text-muted">
                Payouts stop when the cap is reached or the Pool matures, whichever comes first. The cap is a ceiling, not a forecast — you may receive
                less than you invested.
              </p>
            </Card>
          </section>

          <section>
            <SectionHeading eyebrow="Waterfall" title="Distribution history" />
            {history.length === 0 ? (
              <EmptyState icon={<FileText />} title="No distributions yet">
                Distributions are paid {pool.distribution.toLowerCase()} from revenue actually collected. The first one can only come after revenue
                is earned and collected.
              </EmptyState>
            ) : (
              <Card padded={false} className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th scope="col" className="px-5 py-3 font-medium">Period</th>
                      <th scope="col" className="px-5 py-3 font-medium">Paid</th>
                      <th scope="col" className="px-5 py-3 text-right font-medium">Revenue collected</th>
                      <th scope="col" className="px-5 py-3 text-right font-medium">Pool share ({pool.revenueSharePct}%)</th>
                      <th scope="col" className="px-5 py-3 text-right font-medium">You received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {history.map((h) => (
                      <tr key={h.period}>
                        <td className="px-5 py-3 text-fg">{h.period}</td>
                        <td className="num px-5 py-3 text-muted">{formatDate(day(h.paidOn))}</td>
                        <td className="num px-5 py-3 text-right">{formatMoney(h.collectedMinor, { cents: true })}</td>
                        <td className="num px-5 py-3 text-right">{formatMoney(Math.round((h.collectedMinor * pool.revenueSharePct) / 100), { cents: true })}</td>
                        <td className="num px-5 py-3 text-right text-fg">{formatMoney(h.yourShareMinor, { cents: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-5 py-3 text-xs text-muted">
                  Your share = Pool share × your <span className="num">{holding.units}</span> Units ÷ <span className="num">{outstanding}</span> Units
                  outstanding.
                </p>
              </Card>
            )}
          </section>

          <section>
            <SectionHeading eyebrow="From the artist" title="Updates" />
            {updates.length === 0 ? (
              <p className="text-sm text-muted">No updates yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {updates.map((u) => (
                  <li key={u.title}>
                    <Card className="flex gap-4 p-5">
                      <Megaphone className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                      <div className="flex flex-col gap-1">
                        <p className="font-medium text-fg">{u.title}</p>
                        <p className="num text-xs text-muted">{formatDate(day(u.date))}</p>
                        <p className="text-sm text-muted">{u.body}</p>
                      </div>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <LockupNotice unlocksOn={day(holding.unlocksOn)} />

          <WhenFlag flag="postBeta">
            <Card className="flex flex-col gap-3">
              <p className="flex items-center gap-2 font-semibold text-fg">
                <Repeat className="size-4 text-muted" aria-hidden /> Permitted transfers
              </p>
              <p className="text-sm text-muted">
                You can ask to transfer Units to the issuer, an accredited investor or a family member. FanZuP doesn't run a marketplace or set prices.
              </p>
              <Button asChild variant="secondary">
                <Link to={`/portfolio/${pool.id}/transfer`}>
                  Request a permitted transfer <ArrowRight />
                </Link>
              </Button>
            </Card>
          </WhenFlag>

          <Card padded={false}>
            <p className="px-5 pt-5 font-semibold text-fg">Documents</p>
            <ul className="divide-y divide-line">
              {[
                { t: "Form C", d: "Offering statement", ok: true },
                { t: "Subscription agreement", d: "Signed copy", ok: true },
                { t: "Form C-AR 2026", d: "Annual report · due by Apr 2027", ok: false },
              ].map((doc) => (
                <li key={doc.t} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">{doc.t}</p>
                    <p className="text-xs text-muted">{doc.d}</p>
                  </div>
                  {doc.ok ? (
                    <Button variant="ghost" size="sm" aria-label={`Download ${doc.t}`}>
                      <Download />
                    </Button>
                  ) : (
                    <Badge tone="neutral">Not filed</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <p className="mb-1 font-semibold text-fg">Terms</p>
            <dl className="divide-y divide-line">
              <KeyValue k="Revenue share" v={<span className="num">{pool.revenueSharePct}%</span>} />
              <KeyValue k="Return cap" v={<span className="num">{pool.returnCapMultiple}×</span>} />
              <KeyValue k="Distributions" v={pool.distribution} />
            </dl>
          </Card>
        </aside>
      </div>

      <RegulatoryFooter />
    </Container>
  );
}
