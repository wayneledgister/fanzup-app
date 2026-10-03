import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, BadgeCheck, CircleAlert, FileText, Minus, Plus } from "lucide-react";
import {
  ArtistArt, Badge, Button, Callout, Card, Container, FormCLink, InvestmentRiskDisclosure, KeyValue, RegulatoryFooter, SectionHeading,
} from "@/components/brand";
import { CollectionBadge, IntermediaryDisclosure, PoolNotFound, LimitMeter, LockupExplainer, OfferingEscrowNotice, OfferingProgress, PoolTerms } from "@/components/invest/ui";
import { addMonths, COLLECTION_INFO, day, daysLeft, regCfUsage } from "@/components/invest/data";
import { artistById, poolById, type Pool } from "@/lib/mock";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup src/pages/campaign/CampaignDetailPage.tsx (investment variant).
 * Changes: Layer 2 offering page — terms, Waterfall ("only collected revenue is distributed"),
 * collection + default handling, risk / Form C / intermediary / lock-up disclosures above the fold of
 * the purchase panel, and a Unit selector bounded by the fan's remaining Reg CF limit (PRD 01 §11).
 */
export default function PoolDetail() {
  const { id = "" } = useParams();
  const pool = poolById(id);
  if (!pool) return <PoolNotFound />;
  return <Offering pool={pool} />;
}

function Offering({ pool }: { pool: Pool }) {
  const navigate = useNavigate();
  const a = artistById(pool.artistId);
  const usage = regCfUsage();
  const maxUnits = Math.max(0, Math.floor(usage.remaining / pool.unitPriceMinor));
  const [units, setUnits] = useState(Math.min(2, Math.max(1, maxUnits)));
  const total = units * pool.unitPriceMinor;
  const overLimit = total > usage.remaining;
  const invalid = units < 1 || overLimit;
  const dl = daysLeft(pool.endsOn);
  const info = COLLECTION_INFO[pool.collection];
  const capPerUnit = Math.round(pool.unitPriceMinor * pool.returnCapMultiple);

  return (
    <Container size="xl" className="flex flex-col gap-8 py-8 sm:py-10">
      <Link to="/pools" className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All Pools
      </Link>

      {/* Header */}
      <section className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
        <ArtistArt seed={a.id} label={a.name} className="aspect-square w-28 sm:w-36" />
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{pool.kind} Pool</Badge>
            <Badge tone="info">Reg CF offering</Badge>
            {a.verified && (
              <Badge tone="success" icon={<BadgeCheck />}>
                Verified artist
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">{pool.title}</h1>
          <p className="text-muted">
            <Link to={`/artist/${a.id}`} className="text-fg hover:text-gold">
              {a.name}
            </Link>{" "}
            · {a.genre} · {a.city} · {a.tier} tier
          </p>
        </div>
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-10">
          <Card>
            <OfferingProgress pool={pool} daysLeft={dl} />
            <p className="mt-4 text-sm text-muted">
              Offering closes <span className="num text-fg">{formatDate(day(pool.endsOn), "long")}</span>. If it doesn't reach its target by then, every
              investor is refunded.
            </p>
          </Card>

          <section>
            <SectionHeading eyebrow="Deal terms" title="What you're buying" />
            <Card className="grid gap-6 md:grid-cols-2">
              <p className="text-sm text-muted">
                Each Unit is a right to a share of the revenue this Pool covers. Together, Units receive{" "}
                <span className="num text-fg">{pool.revenueSharePct}%</span> of covered revenue, paid{" "}
                {pool.distribution.toLowerCase()}, until Units have received <span className="num text-fg">{pool.returnCapMultiple}×</span> what
                was paid for them or the Pool reaches maturity after <span className="num text-fg">{pool.maturityYears}</span> years — whichever
                comes first. Units aren't equity and don't give you ownership of the artist's music or business.
              </p>
              <PoolTerms pool={pool} className="divide-y divide-line" />
            </Card>
          </section>

          <section>
            <SectionHeading eyebrow="The Waterfall" title="How payouts work" />
            <ol className="flex flex-col gap-3">
              {[
                { t: "The artist earns covered revenue", d: "Revenue from the sources named in the Form C, such as streaming royalties." },
                { t: "The Pool's share is collected", d: `${info.label}: ${info.short}` },
                { t: `${pool.revenueSharePct}% is split across all Units`, d: `Paid ${pool.distribution.toLowerCase()}, in proportion to the Units you hold, after any fees disclosed in the Form C.` },
                {
                  t: "Payouts stop at the cap or at maturity",
                  d: `Once Units have received ${pool.returnCapMultiple}× their price (${formatMoney(capPerUnit, { cents: true })} per Unit), or after ${pool.maturityYears} years, the Pool ends — whichever comes first.`,
                },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-4 rounded-lg border border-line bg-surface p-4">
                  <span className="num flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-sm text-gold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium text-fg">{s.t}</p>
                    <p className="text-sm text-muted">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 rounded-md border border-line bg-surface-2 p-4 text-sm text-muted">
              <strong className="text-fg">Only revenue that's actually collected is distributed.</strong> If the artist earns less than expected, or
              nothing is collected in a period, payouts are smaller or zero for that period. There's no minimum payout and the cap is a ceiling,
              not a target.
            </p>
          </section>

          <section>
            <SectionHeading eyebrow="Collection" title="How revenue is collected — and what if it isn't" />
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <CollectionBadge collection={pool.collection} />
                </div>
                <p className="text-sm text-muted">{info.long}</p>
              </Card>
              <Card className="flex flex-col gap-3">
                <p className="flex items-center gap-2 font-semibold text-fg">
                  <CircleAlert className="size-4 text-warning" aria-hidden /> If a payment or report is missed
                </p>
                <p className="text-sm text-muted">
                  The servicer contacts the artist and tells holders what happened. Missed amounts stay owed under the revenue-share agreement and
                  the Form C explains the steps that follow, but your claim is unsecured — there's no collateral, and recovery isn't assured.
                </p>
              </Card>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading eyebrow="Before you invest" title="Risks and restrictions" />
            <InvestmentRiskDisclosure />
            <LockupExplainer unlocksOn={formatDate(day(addMonths(pool.endsOn, 12)))} />
            <OfferingEscrowNotice />
            <IntermediaryDisclosure />
          </section>

          <section>
            <SectionHeading eyebrow="Documents" title="Offering documents" />
            <Card padded={false} className="divide-y divide-line">
              {[
                { t: "Form C", d: "The issuer's filed offering statement: business, use of funds, terms and risk factors." },
                { t: "Revenue-share agreement", d: "The contract that defines covered revenue, the cap, maturity and default terms." },
                { t: "Risk factors", d: "Everything that could cause you to lose some or all of your money." },
              ].map((doc) => (
                <div key={doc.t} className="flex items-center gap-4 p-4 sm:p-5">
                  <FileText className="size-5 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">{doc.t}</p>
                    <p className="text-sm text-muted">{doc.d}</p>
                  </div>
                  {doc.t === "Form C" ? <FormCLink href={`/invest/${pool.id}/documents`}>Read</FormCLink> : <span className="text-xs text-muted">At review</span>}
                </div>
              ))}
            </Card>
          </section>

          <RegulatoryFooter />
        </div>

        {/* Purchase panel */}
        <aside className="lg:sticky lg:top-24">
          <Card className="flex flex-col gap-5">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Unit price</span>
              <span className="num text-2xl font-medium text-fg">{formatMoney(pool.unitPriceMinor)}</span>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="units" className="text-sm font-medium text-fg">
                Units
              </label>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="icon" aria-label="Fewer Units" onClick={() => setUnits((u) => Math.max(1, u - 1))} disabled={units <= 1}>
                  <Minus />
                </Button>
                <input
                  id="units"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={units}
                  onChange={(e) => setUnits(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  aria-invalid={invalid}
                  className="num h-11 w-full min-w-0 rounded-md border border-line bg-surface-2 text-center text-lg text-fg focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 aria-[invalid=true]:border-error"
                />
                <Button variant="secondary" size="icon" aria-label="More Units" onClick={() => setUnits((u) => u + 1)}>
                  <Plus />
                </Button>
              </div>
            </div>

            <dl className="border-y border-line py-2">
              <KeyValue k="Total" v={<span className="num text-lg font-medium">{formatMoney(total)}</span>} />
              <KeyValue k="Maximum total payouts (cap)" v={<span className="num">{formatMoney(Math.round(total * pool.returnCapMultiple))}</span>} />
              <KeyValue k="Platform fee" v={<span className="text-muted">Shown in the Form C</span>} />
            </dl>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg">Your Reg CF limit (12 months)</span>
              <LimitMeter limit={usage.limit} used={usage.used} extra={Math.min(total, usage.limit)} />
            </div>

            {units < 1 && <p className="text-sm text-error">Choose at least 1 Unit.</p>}
            {overLimit && (
              <p className="text-sm text-error" role="alert">
                That's more than your remaining limit. You can buy up to <span className="num">{maxUnits}</span> {maxUnits === 1 ? "Unit" : "Units"} in this Pool.
              </p>
            )}

            <Button block size="lg" disabled={invalid} onClick={() => navigate(`/invest/${pool.id}/documents?units=${units}`)}>
              Review documents <ArrowRight />
            </Button>
            <p className="text-center text-xs text-muted">You won't be charged until you sign. You can cancel up to 48 hours before the offering closes.</p>
          </Card>

          <Callout tone="warning" className="mt-4" title="The cap isn't a forecast">
            {pool.returnCapMultiple}× is the most Units can ever receive. Total payouts can be lower than what you invested, or nothing at all.
          </Callout>
        </aside>
      </div>
    </Container>
  );
}
