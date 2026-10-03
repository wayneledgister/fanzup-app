import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Disc3, SearchX } from "lucide-react";
import { RISK_BADGE_COPY, REVENUE_TYPE_COPY, type RiskBadge } from "@fanzup/shared/l2";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, Field, PageHeader, ProgressBar, RegulatoryFooter, Select } from "@/components/brand";
import { InvestmentRiskDisclosure } from "@/components/brand";
import { daysLeft, LoadGate, POOL_STATUS_COPY, RiskBadgeChip, useLoad } from "@/components/invest/l2ui";
import { l2, type PoolCardView } from "@/lib/l2";
import { formatMoney } from "@/lib/format";

/**
 * Source: (new) Layer 2 discovery, PRD 02 §8 — rebuilt on the API (CR-002, FR-L2-INV-001).
 * Rules: filters by revenue type, collection badge and genre; ordered by deadline (soonest first) or newest — never by
 * money raised, Units sold or anything return-like; no leaderboards. Every card shows terms and its collection badge.
 */
export default function PoolsExplore() {
  const [tab, setTab] = useState<"live" | "closed">("live");
  const [revenueType, setRevenueType] = useState("");
  const [badge, setBadge] = useState("");
  const [sort, setSort] = useState<"ending" | "newest">("ending");
  const load = useLoad(() => l2.pools({ tab, revenueType, badge, sort }), [tab, revenueType, badge, sort]);

  return (
    <Container size="xl" className="flex flex-col gap-8 py-8 sm:py-10">
      <PageHeader
        eyebrow="Revenue-share Pools"
        title="Album royalty Pools"
        description="Buy Units in an album's royalties. Potential payouts come only from royalties actually collected, are capped, and can be zero."
      />
      <InvestmentRiskDisclosure />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex gap-2" role="tablist" aria-label="Pool status">
          {(["live", "closed"] as const).map((t) => (
            <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>
              {t === "live" ? "Open now" : "Closed"}
            </Button>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Revenue type" htmlFor="f-rev">
            <Select id="f-rev" value={revenueType} onChange={(e) => setRevenueType(e.target.value)}>
              <option value="">Any</option>
              {(["master", "sync", "publishing"] as const).map((t) => <option key={t} value={t}>{REVENUE_TYPE_COPY[t].label}</option>)}
            </Select>
          </Field>
          <Field label="Collection" htmlFor="f-badge">
            <Select id="f-badge" value={badge} onChange={(e) => setBadge(e.target.value)}>
              <option value="">Any</option>
              {(Object.keys(RISK_BADGE_COPY) as RiskBadge[]).map((b) => <option key={b} value={b}>{RISK_BADGE_COPY[b].label}</option>)}
            </Select>
          </Field>
          <Field label="Order" htmlFor="f-sort">
            <Select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value as "ending" | "newest")}>
              <option value="ending">Closing soonest</option>
              <option value="newest">Newest</option>
            </Select>
          </Field>
        </div>
      </div>

      <LoadGate load={load} what="Pools">
        {({ pools }) =>
          pools.length === 0 ? (
            <EmptyState icon={<SearchX />} title={tab === "live" ? "No Pools are open right now" : "No closed Pools match"}>
              Try a different filter, or check back soon.
            </EmptyState>
          ) : (
            <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="pool-list">
              {pools.map((p) => <PoolCard key={p.id} p={p} />)}
            </ul>
          )
        }
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}

function PoolCard({ p }: { p: PoolCardView }) {
  const left = daysLeft(p.endsAt);
  return (
    <li>
      <Card interactive className="flex h-full flex-col gap-4" data-testid="pool-card">
        <div className="flex items-start gap-4">
          <ArtistArt seed={p.slug} label={p.title} rounded="md" className="size-20 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{p.artistDisplay}</p>
            <Link to={`/pools/${p.slug}`} className="block text-lg font-semibold text-fg hover:text-gold">
              {p.title}
            </Link>
            <div className="mt-2 flex flex-wrap gap-2">
              <RiskBadgeChip badge={p.riskBadge} />
              {p.status !== "live" && <Badge tone="neutral">{POOL_STATUS_COPY[p.status]}</Badge>}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Fan share</dt>
            <dd className="num text-fg">{p.fansBps / 100}% of royalties</dd>
          </div>
          <div>
            <dt className="text-muted">Unit price</dt>
            <dd className="num text-fg">{formatMoney(p.unitPriceMinor)}</dd>
          </div>
          <div>
            <dt className="text-muted">Cap</dt>
            <dd className="num text-fg">{p.returnCapBps / 10_000}× per Unit</dd>
          </div>
          <div>
            <dt className="text-muted">Ends after</dt>
            <dd className="num text-fg">{p.maturityMonths / 12} years</dd>
          </div>
        </dl>
        {p.status === "live" && (
          <div className="mt-auto flex flex-col gap-2">
            <ProgressBar value={p.raisedMinor} max={p.targetMinor} tone="info" label="Progress to target" />
            <div className="flex justify-between text-xs text-muted">
              <span>
                Target <span className="num">{formatMoney(p.targetMinor)}</span>
              </span>
              <span className="num">{left > 0 ? `${left}d left` : "Closing"}</span>
            </div>
          </div>
        )}
        <Button asChild variant="secondary" className="mt-auto">
          <Link to={`/pools/${p.slug}`}>
            <Disc3 /> See the terms <ArrowRight />
          </Link>
        </Button>
      </Card>
    </li>
  );
}
