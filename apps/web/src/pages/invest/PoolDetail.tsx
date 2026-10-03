import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, CircleAlert, FileText, Minus, Plus } from "lucide-react";
import {
  ArtistArt, Badge, Button, Callout, Card, Container, InvestmentRiskDisclosure, KeyValue, ProgressBar, RegulatoryFooter, SectionHeading,
} from "@/components/brand";
import { IntermediaryDisclosure, LimitMeter, LockupExplainer, OfferingEscrowNotice } from "@/components/invest/ui";
import {
  CollectionStateBadge, daysLeft, FormCLinkTo, LoadGate, PayoutIllustration, POOL_STATUS_COPY, RevenueTypes, RiskBadgeChip, RiskBadgeExplainer, shortDate, useLoad,
} from "@/components/invest/l2ui";
import { l2, type InvestorMeView, type PoolDetailView } from "@/lib/l2";
import { useSession } from "@/lib/session";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup CampaignDetailPage.tsx (investment variant), rebuilt on the API (CR-002, FR-L2-INV-001).
 * Above the purchase panel: terms in plain language, the collection badge and what it means, illiquidity /
 * principal-at-risk / unsecured-claim disclosures, Form C link, lock-up and maturity, and a potential-payout
 * illustration that always shows the zero case. The Unit selector is bounded by the investor's remaining Reg CF limit.
 */
export default function PoolDetail() {
  const { id = "" } = useParams();
  const load = useLoad(() => l2.pool(id), [id]);
  return (
    <Container size="xl" className="flex flex-col gap-8 py-8 sm:py-10">
      <Link to="/pools" className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All Pools
      </Link>
      <LoadGate load={load} what="this Pool">
        {(p) => <Offering p={p} />}
      </LoadGate>
    </Container>
  );
}

function Offering({ p }: { p: PoolDetailView }) {
  const live = p.status === "live";
  const left = daysLeft(p.endsAt);
  const lockupEstimate = p.endsAt ? new Date(new Date(p.endsAt).getTime() + p.lockupMonths * 30.44 * 86_400_000).toISOString() : null;
  return (
    <>
      <section className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
        <ArtistArt seed={p.slug} label={p.title} className="aspect-square w-28 sm:w-36" />
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">Album royalty Pool</Badge>
            <Badge tone="info">Reg CF offering</Badge>
            <RiskBadgeChip badge={p.riskBadge} />
            {!live && <Badge tone="neutral">{POOL_STATUS_COPY[p.status]}</Badge>}
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl" data-testid="pool-title">{p.title}</h1>
          <p className="text-muted">
            <Link to={`/artist/${p.artist.slug}`} className="text-fg hover:text-gold">{p.artistDisplay}</Link> · {p.artist.genre ?? "Music"} · {p.artist.tier} tier
            {p.releaseDate && <> · planned release <span className="num">{formatDate(p.releaseDate)}</span></>}
          </p>
        </div>
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-10">
          <Card className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="num text-lg font-medium text-fg">{formatMoney(p.raisedMinor)}</span>
              <span className="text-sm text-muted">
                target <span className="num">{formatMoney(p.targetMinor)}</span> · max <span className="num">{formatMoney(p.maxMinor)}</span>
              </span>
            </div>
            <ProgressBar value={p.raisedMinor} max={p.targetMinor} tone="info" label="Progress to target" />
            <p className="text-sm text-muted">
              {live ? (
                <>
                  Closes <span className="num text-fg">{p.endsAt ? formatDate(p.endsAt, "long") : "—"}</span> (<span className="num">{left}</span> days). If it doesn't
                  reach its target by then, every investor is refunded in full from escrow.
                </>
              ) : (
                <>This offering is closed: {POOL_STATUS_COPY[p.status].toLowerCase()}.</>
              )}
            </p>
          </Card>

          <section>
            <SectionHeading eyebrow="Deal terms" title="What a Unit is" />
            <Card className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-3 text-sm text-muted">
                <p>
                  Each Unit is a contractual right to a share of the royalties this album earns from the revenue below. Together, all{" "}
                  <span className="num text-fg">{p.unitsTotal}</span> Units receive <span className="num text-fg">{p.fansBps / 100}%</span> of collected royalties,
                  paid quarterly in proportion to Units held, until each Unit has received <span className="num text-fg">{p.returnCapBps / 10_000}×</span> its price
                  or <span className="num text-fg">{p.maturityMonths / 12}</span> years pass — whichever comes first.
                </p>
                <p>Units aren't shares of the artist's business and don't give you ownership of the music.</p>
                <RevenueTypes types={p.revenueTypes} />
              </div>
              <dl className="divide-y divide-line">
                <KeyValue k="Unit price" v={<span className="num">{formatMoney(p.unitPriceMinor)}</span>} />
                <KeyValue k="Fan share of royalties" v={<span className="num">{p.fansBps / 100}%</span>} />
                <KeyValue k="Artist / platform share" v={<span className="num">{p.creatorBps / 100}% / {p.platformBps / 100}%</span>} />
                <KeyValue k="Return cap" v={<span className="num">{p.returnCapBps / 10_000}× what you paid</span>} />
                <KeyValue k="Pool ends" v={<span className="num">after {p.maturityMonths / 12} years or at the cap</span>} />
                <KeyValue k="Distributions" v="Quarterly, collected royalties only" />
                <KeyValue k="Minimum" v={<span className="num">{p.minUnits} Unit{p.minUnits > 1 ? "s" : ""}</span>} />
              </dl>
            </Card>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading eyebrow="Collection" title="How royalties reach the Pool" />
            <RiskBadgeExplainer badge={p.riskBadge} mechanism={p.collectionMechanism} />
            {p.status === "funded" && (
              <Card className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted">Collection status</span> <CollectionStateBadge state={p.collectionState} />
                <span className="text-muted">
                  Collected so far <span className="num text-fg">{formatMoney(p.revenue.collectedMinor)}</span> · paid to holders{" "}
                  <span className="num text-fg">{formatMoney(p.revenue.distributedToFansMinor)}</span> across <span className="num">{p.revenue.periods}</span> distributions
                </span>
              </Card>
            )}
          </section>

          <section>
            <SectionHeading eyebrow="Potential payouts" title="An illustration, including zero" />
            <PayoutIllustration fansBps={p.fansBps} unitsTotal={p.unitsTotal} unitPriceMinor={p.unitPriceMinor} capBps={p.returnCapBps} maturityMonths={p.maturityMonths} />
          </section>

          <section>
            <SectionHeading eyebrow="The album" title="Story, tracklist and use of funds" />
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="flex flex-col gap-3">
                {p.story && <p className="whitespace-pre-line text-sm text-muted">{p.story}</p>}
                <ol className="list-decimal pl-5 text-sm text-fg">
                  {p.tracklist.map((t) => <li key={t}>{t}</li>)}
                </ol>
              </Card>
              <Card>
                <dl className="divide-y divide-line">
                  {p.useOfFunds.map((u) => <KeyValue key={u.label} k={u.label} v={<span className="num">{formatMoney(u.amountMinor)}</span>} />)}
                </dl>
                <p className="mt-3 text-xs text-muted">Released to the artist in stages: {p.tranches.map((t) => `${t.pct}% ${t.seq === 1 ? "at close" : `after "${t.milestone}" is verified`}`).join(", then ")}.</p>
              </Card>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading eyebrow="Before you invest" title="Risks and restrictions" />
            <InvestmentRiskDisclosure lockupMonths={p.lockupMonths} />
            {p.risks && (
              <Callout tone="warning" icon={<CircleAlert />} title="Risks the artist names">
                {p.risks}
              </Callout>
            )}
            {lockupEstimate && <LockupExplainer unlocksOn={shortDate(lockupEstimate)} />}
            <OfferingEscrowNotice />
            <IntermediaryDisclosure />
          </section>

          <section>
            <SectionHeading eyebrow="Documents" title="Offering documents" />
            <Card padded={false} className="divide-y divide-line">
              <div className="flex items-center gap-4 p-4 sm:p-5">
                <FileText className="size-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">Form C (mock)</p>
                  <p className="text-sm text-muted">
                    Generated from this Pool's data for the demo. Not filed. {p.formC && <span className="num">v{p.formC.version} · {p.formC.sha256.slice(0, 12)}</span>}
                  </p>
                </div>
                <FormCLinkTo slug={p.slug}>Read</FormCLinkTo>
              </div>
            </Card>
          </section>
          <RegulatoryFooter />
        </div>

        <aside className="lg:sticky lg:top-24">{live ? <PurchasePanel p={p} /> : <ClosedPanel p={p} />}</aside>
      </div>
    </>
  );
}

function ClosedPanel({ p }: { p: PoolDetailView }) {
  return (
    <Card className="flex flex-col gap-3">
      <p className="font-semibold text-fg">This offering is closed</p>
      <p className="text-sm text-muted">
        {p.status === "funded" || p.status === "matured"
          ? "Units were issued to investors when it closed. There's no marketplace to buy or sell them."
          : "It didn't reach its target, so every investor was refunded in full."}
      </p>
      <Button asChild variant="secondary">
        <Link to="/pools">Browse open Pools</Link>
      </Button>
    </Card>
  );
}

function PurchasePanel({ p }: { p: PoolDetailView }) {
  const navigate = useNavigate();
  const session = useSession();
  const [me, setMe] = useState<InvestorMeView | null>(null);
  useEffect(() => {
    if (session.session) l2.investorMe().then(setMe).catch(() => setMe(null));
  }, [session.session]);
  const remaining = me?.remainingMinor ?? null; // null = no limit (accredited)
  const maxByLimit = remaining == null ? p.unitsLeft : Math.floor(remaining / p.unitPriceMinor);
  const max = Math.min(p.unitsLeft, maxByLimit);
  const [units, setUnits] = useState(Math.max(p.minUnits, 1));
  const total = units * p.unitPriceMinor;
  const ready = me && me.kycStatus === "approved" && me.certified;
  const over = ready && units > max;
  const invalid = units < p.minUnits || !!over || units > p.unitsLeft;

  return (
    <Card className="flex flex-col gap-5" data-testid="purchase-panel">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Unit price</span>
        <span className="num text-2xl font-medium text-fg">{formatMoney(p.unitPriceMinor)}</span>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="units" className="text-sm font-medium text-fg">Units</label>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Fewer Units" onClick={() => setUnits((u) => Math.max(p.minUnits, u - 1))} disabled={units <= p.minUnits}>
            <Minus />
          </Button>
          <input
            id="units"
            data-testid="units-input"
            type="number"
            min={p.minUnits}
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
        <p className="text-xs text-muted"><span className="num">{p.unitsLeft}</span> of <span className="num">{p.unitsTotal}</span> Units left</p>
      </div>
      <dl className="border-y border-line py-2">
        <KeyValue k="Total" v={<span className="num text-lg font-medium">{formatMoney(total)}</span>} />
        <KeyValue k="Most it can ever pay (cap)" v={<span className="num">{formatMoney(Math.floor((total * p.returnCapBps) / 10_000))}</span>} />
        <KeyValue k="Least it can pay" v={<span className="num">{formatMoney(0)}</span>} />
      </dl>

      {!session.session ? (
        <Button asChild block size="lg">
          <Link to={`/login?next=${encodeURIComponent(`/pools/${p.slug}`)}`}>Sign in to invest</Link>
        </Button>
      ) : !ready ? (
        <>
          <Callout tone="info" title="Verify your identity first">
            Investing needs an identity check and your income and net worth, which set your 12-month Reg CF limit.
          </Callout>
          <Button asChild block size="lg">
            <Link to={`/investor/certification?next=${encodeURIComponent(`/pools/${p.slug}`)}`}>Start investor verification <ArrowRight /></Link>
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">Your Reg CF limit (12 months)</span>
            {me.limitMinor == null ? (
              <p className="text-sm text-muted">Accredited investor: no Reg CF limit applies.</p>
            ) : (
              <LimitMeter limit={me.limitMinor} used={me.usedMinor} extra={Math.min(total, Math.max(0, me.limitMinor - me.usedMinor))} />
            )}
          </div>
          {over && (
            <p className="text-sm text-error" role="alert">
              That's more than you can buy here. Up to <span className="num">{max}</span> Units fit your remaining limit and what's left.
            </p>
          )}
          <Button block size="lg" disabled={invalid} data-testid="review-documents" onClick={() => navigate(`/invest/${p.slug}/documents?units=${units}`)}>
            Review documents <ArrowRight />
          </Button>
        </>
      )}
      <p className="text-center text-xs text-muted">You can cancel until {p.cancelCutoffHours} hours before the offering closes.</p>
    </Card>
  );
}
