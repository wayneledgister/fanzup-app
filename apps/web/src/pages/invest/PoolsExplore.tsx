import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Search, TriangleAlert } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, Field, PageHeader, RegulatoryFooter, Select, TextInput } from "@/components/brand";
import { CollectionBadge, OfferingProgress } from "@/components/invest/ui";
import { COLLECTION_INFO, day, daysLeft, regCfUsage, visiblePools } from "@/components/invest/data";
import { artistById, type Pool } from "@/lib/mock";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: (new) Layer 2 discovery per PRD 02 §8.
 * Rules applied: never sorted or filtered by potential payout; sort options are deadline and artist
 * name only; every card shows terms + an honest collection-mechanism label; illiquidity banner on top.
 */
type Kind = "All" | Pool["kind"];
type Sort = "closing" | "artist";

export default function PoolsExplore() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("All");
  const [collection, setCollection] = useState<"All" | Pool["collection"]>("All");
  const [sort, setSort] = useState<Sort>("closing");
  const usage = regCfUsage();

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = visiblePools().filter((p) => {
      const a = artistById(p.artistId);
      return (
        (kind === "All" || p.kind === kind) &&
        (collection === "All" || p.collection === collection) &&
        (!term || `${p.title} ${a.name} ${a.genre} ${a.city}`.toLowerCase().includes(term))
      );
    });
    return sort === "artist" ? [...filtered].sort((x, y) => artistById(x.artistId).name.localeCompare(artistById(y.artistId).name)) : filtered;
  }, [q, kind, collection, sort]);

  const clear = () => {
    setQ("");
    setKind("All");
    setCollection("All");
  };

  return (
    <Container size="xl" className="flex flex-col gap-8 py-8 sm:py-10">
      <PageHeader
        eyebrow="Pools · Reg CF offerings"
        title="Invest in the artists you back"
        description="Pools let you buy Units that may pay you a share of an artist's revenue, up to a cap. Read every offering's terms and Form C before you decide."
        actions={
          <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <span className="text-muted">Your Reg CF limit left: </span>
            <span className="num font-medium text-fg">{formatMoney(usage.remaining)}</span>
          </div>
        }
        className="pb-0"
      />

      <Callout tone="warning" icon={<TriangleAlert />} title="Investing in Pools is risky and illiquid">
        You could lose all the money you invest. Payouts depend on revenue that's actually collected and aren't guaranteed. You can't resell
        Units for 12 months, and there's no marketplace to sell them after that.
      </Callout>

      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <Field label="Search" htmlFor="pool-search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <TextInput id="pool-search" className="pl-10" placeholder="Artist, genre or city" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </Field>
        <Field label="Pool type" htmlFor="pool-kind">
          <Select id="pool-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {["All", "Creator", "Project", "Brand"].map((k) => (
              <option key={k} value={k}>
                {k === "All" ? "All types" : `${k} Pools`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Collection" htmlFor="pool-collection">
          <Select id="pool-collection" value={collection} onChange={(e) => setCollection(e.target.value as typeof collection)}>
            <option value="All">Any method</option>
            {Object.entries(COLLECTION_INFO).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sort by" htmlFor="pool-sort">
          <Select id="pool-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="closing">Closing soonest</option>
            <option value="artist">Artist name (A–Z)</option>
          </Select>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-4 text-sm text-muted">
        <span>
          <span className="num text-fg">{list.length}</span> open {list.length === 1 ? "offering" : "offerings"}
        </span>
        <span className="hidden sm:inline">We never rank Pools by potential payout.</span>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No Pools match those filters"
          action={
            <Button variant="secondary" onClick={clear}>
              Clear filters
            </Button>
          }
        >
          Try a different search, or widen the type and collection filters.
        </EmptyState>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {list.map((p) => (
            <PoolCard key={p.id} pool={p} />
          ))}
        </div>
      )}

      <div className="border-t border-line pt-6">
        <RegulatoryFooter />
      </div>
    </Container>
  );
}

function PoolCard({ pool }: { pool: Pool }) {
  const a = artistById(pool.artistId);
  const info = COLLECTION_INFO[pool.collection];
  return (
    <Card padded={false} interactive className="flex flex-col overflow-hidden">
      <Link to={`/pools/${pool.id}`} className="flex flex-1 flex-col focus:outline-none" aria-label={`${pool.title} — view offering`}>
        <div className="flex items-center gap-4 border-b border-line p-5">
          <ArtistArt seed={a.id} label={a.name} rounded="md" className="size-16 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{pool.kind} Pool</Badge>
              {a.verified && (
                <Badge tone="success" icon={<BadgeCheck />}>
                  Verified
                </Badge>
              )}
            </div>
            <h3 className="truncate text-lg font-semibold">{pool.title}</h3>
            <p className="truncate text-sm text-muted">
              {a.name} · {a.genre} · {a.city}
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 p-5">
          <OfferingProgress pool={pool} daysLeft={daysLeft(pool.endsOn)} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-line bg-surface-2 p-4 text-sm sm:grid-cols-4">
            {[
              ["Revenue share", `${pool.revenueSharePct}%`],
              ["Return cap", `${pool.returnCapMultiple}×`],
              ["Maturity", `${pool.maturityYears} yrs`],
              ["Payouts", pool.distribution],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={k === "Payouts" ? "text-fg" : "num text-fg"}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Collection</span>
              <CollectionBadge collection={pool.collection} />
            </div>
            <p className="text-sm text-muted">{info.short}</p>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
            <span className="text-muted">
              <span className="num text-fg">{formatMoney(pool.unitPriceMinor)}</span> per Unit · closes <span className="num">{formatDate(day(pool.endsOn))}</span>
            </span>
            <span className="flex items-center gap-1 font-medium text-gold">
              View <ArrowRight className="size-4" />
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
