import { useMemo, useRef, useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, CalendarDays, Compass, Megaphone, RefreshCw, Search, SearchX, SlidersHorizontal, Users, WifiOff, X } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, PageHeader, SectionHeading, Select, WhenFlag } from "@/components/brand";
import { ArtistCard, CampaignCard, PoolCard } from "@/components/public/cards";
import { artistById, artists, campaigns, events, pools, type CampaignType } from "@/lib/mock";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FPS marketplace/MarketplaceExplore + MarketplaceHomepage + CreatorCardShowcase +
 * NonContentStatesShowcase + search/SearchOverlay, merged into one Discover page.
 * Doc-driven changes: "Support & Invest / purchase pool units" first-visit copy and "holders" counts
 * removed for Layer 1 (Brand §7.4); Pools only appear behind `layer2` in their own section;
 * sort options never rank by money or return (PRD 02 §8). Non-content states reachable via ?state=loading|error.
 */

const TYPES: ("All" | CampaignType)[] = ["All", "Album", "Tour", "Show", "Music Video", "Documentary"];
const GENRES = ["All genres", ...Array.from(new Set(artists.map((a) => a.genre)))];
const CITIES = ["Anywhere", ...Array.from(new Set(artists.map((a) => a.city)))];
const SORTS = [
  { id: "ending", label: "Ending soon" },
  { id: "backers", label: "Most backers" },
  { id: "goal", label: "Closest to goal" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

const TRENDING_SEARCHES = ["Afrobeats", "Vinyl", "Tour", "Detroit", "Hip-Hop"];

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const forced = params.get("state"); // loading | error (review states)
  const [q, setQ] = useState(params.get("q") ?? "");
  const [type, setType] = useState<(typeof TYPES)[number]>("All");
  const [genre, setGenre] = useState(GENRES[0]);
  const [city, setCity] = useState(CITIES[0]);
  const [sort, setSort] = useState<SortId>("ending");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = campaigns.filter((c) => {
      if (c.status === "draft") return false;
      const a = artistById(c.artistId);
      if (type !== "All" && c.type !== type) return false;
      if (genre !== GENRES[0] && a.genre !== genre) return false;
      if (city !== CITIES[0] && a.city !== city) return false;
      if (query && ![c.title, c.blurb, c.type, a.name, a.genre, a.city].some((s) => s.toLowerCase().includes(query))) return false;
      return true;
    });
    return list.sort((x, y) => {
      if (sort === "backers") return y.backers - x.backers;
      if (sort === "goal") return y.raisedMinor / y.goalMinor - x.raisedMinor / x.goalMinor;
      return daysUntil(x.endsOn) - daysUntil(y.endsOn);
    });
  }, [type, genre, city, query, sort]);

  const matchingArtists = artists.filter((a) => {
    if (genre !== GENRES[0] && a.genre !== genre) return false;
    if (city !== CITIES[0] && a.city !== city) return false;
    if (query && ![a.name, a.genre, a.city, a.handle].some((s) => s.toLowerCase().includes(query))) return false;
    return true;
  });

  const activeFilters = (type !== "All" ? 1 : 0) + (genre !== GENRES[0] ? 1 : 0) + (city !== CITIES[0] ? 1 : 0);
  const clearAll = () => {
    setQ("");
    setType("All");
    setGenre(GENRES[0]);
    setCity(CITIES[0]);
  };

  return (
    <Container size="xl" className="py-10 sm:py-14">
      <PageHeader
        eyebrow="Discover"
        title="Find your next favorite artist"
        description="Back campaigns from independent artists. Every campaign is all-or-nothing — your money waits in escrow until the goal is met."
      />

      {/* Search + filters */}
      <div className="sticky top-16 z-30 -mx-4 mb-8 border-b border-line bg-canvas/90 px-4 pb-4 pt-2 backdrop-blur-md sm:mx-0 sm:rounded-lg sm:border sm:bg-surface/80 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              const next = new URLSearchParams(params);
              if (v) next.set("q", v);
              else next.delete("q");
              setParams(next, { replace: true });
            }}
          />
          <div className="flex gap-3">
            <Button variant="secondary" className="lg:hidden" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="explore-filters">
              <SlidersHorizontal /> Filters
              {activeFilters > 0 && <span className="num rounded-full bg-gold px-1.5 text-xs text-on-gold">{activeFilters}</span>}
            </Button>
            <label className="sr-only" htmlFor="sort">
              Sort campaigns
            </label>
            <Select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortId)} className="w-full lg:w-48">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div id="explore-filters" className={cn("mt-3 flex-col gap-3 lg:flex lg:flex-row lg:items-center", filtersOpen ? "flex" : "hidden")}>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [contain:paint] lg:flex-1" role="radiogroup" aria-label="Campaign type">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn(
                  "h-9 shrink-0 rounded-full border px-4 text-sm transition-colors",
                  type === t ? "border-gold bg-gold/12 text-gold" : "border-line text-muted hover:border-muted/50 hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:flex">
            <label className="sr-only" htmlFor="genre">
              Genre
            </label>
            <Select id="genre" value={genre} onChange={(e) => setGenre(e.target.value)} className="lg:w-48">
              {GENRES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
            <label className="sr-only" htmlFor="city">
              City
            </label>
            <Select id="city" value={city} onChange={(e) => setCity(e.target.value)} className="lg:w-48">
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {forced === "loading" ? (
        <LoadingGrid />
      ) : forced === "error" ? (
        <ErrorState />
      ) : filtered.length === 0 && matchingArtists.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={query ? `No results for “${q.trim()}”` : "Nothing matches these filters"}
          action={
            <div className="flex flex-col items-center gap-4">
              <Button onClick={clearAll}>Clear search and filters</Button>
              <div className="flex flex-wrap justify-center gap-2">
                {TRENDING_SEARCHES.map((t) => (
                  <button key={t} type="button" onClick={() => { clearAll(); setQ(t); }} className="h-9 rounded-full border border-line px-3 text-sm text-muted hover:text-fg">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          Try a different artist, city or genre — or start from one of these popular searches.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-16">
          {/* Campaign grid */}
          <section aria-labelledby="campaigns-h">
            <SectionHeading
              eyebrow={
                <span>
                  <span className="num">{filtered.length}</span> {filtered.length === 1 ? "campaign" : "campaigns"}
                </span>
              }
              title={<span id="campaigns-h">Campaigns you can back</span>}
              action={
                activeFilters > 0 || query ? (
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    <X /> Clear all
                  </Button>
                ) : undefined
              }
            />
            {filtered.length ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Megaphone />} title="No live campaigns here yet">
                Follow these artists below to hear first when they launch one.
              </EmptyState>
            )}
          </section>

          {/* Artist rail */}
          {matchingArtists.length > 0 && (
            <section aria-labelledby="artists-h">
              <SectionHeading eyebrow="Artists" title={<span id="artists-h">Independent artists on FanZuP</span>} />
              <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 [contain:paint] sm:mx-0 sm:[contain:none] sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
                {matchingArtists.map((a) => (
                  <ArtistCard key={a.id} artist={a} className="w-44 shrink-0 snap-start sm:w-auto" />
                ))}
              </div>
            </section>
          )}

          {/* Upcoming shows (Layer 1 tickets) */}
          {!query && activeFilters === 0 && (
            <section aria-labelledby="events-h">
              <SectionHeading
                eyebrow="On sale"
                title={<span id="events-h">Upcoming shows</span>}
                action={
                  <Link to="/tickets" className="hidden items-center gap-1 text-sm font-medium text-gold hover:underline sm:flex">
                    All tickets <ArrowRight className="size-4" />
                  </Link>
                }
              />
              <div className="grid gap-4 md:grid-cols-2">
                {events.filter((e) => e.remaining > 0).slice(0, 4).map((e) => {
                  const a = artistById(e.artistId);
                  return (
                    <Card key={e.id} className="flex min-w-0 items-center gap-4 p-4">
                      <ArtistArt seed={a.id} label={a.name} rounded="md" className="size-16 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{e.title}</p>
                        <p className="flex items-center gap-1.5 text-sm text-muted">
                          <CalendarDays className="size-3.5" /> <span className="num">{formatDate(e.date)}</span> · {e.city}
                        </p>
                        {e.backerPresale && (
                          <Badge tone="info" className="mt-2">
                            Backer presale
                          </Badge>
                        )}
                      </div>
                      <span className="num shrink-0 text-sm">from {formatMoney(e.priceMinor)}</span>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* Layer 2 — separate, clearly labeled, never mixed into campaign results */}
          <WhenFlag flag="layer2">
            <section aria-labelledby="pools-h" className="rounded-lg border border-line bg-surface/40 p-6 sm:p-8">
              <SectionHeading
                eyebrow="Reg CF offerings"
                title={<span id="pools-h">Investment Pools</span>}
                action={
                  <Link to="/pools" className="flex items-center gap-1 text-sm font-medium text-gold hover:underline">
                    View Pools <ArrowRight className="size-4" />
                  </Link>
                }
              />
              <Callout tone="warning" className="mb-6" title="Pools are investments, not campaigns">
                Units are speculative and illiquid, can't be resold for 12 months, and you could lose everything you put in. Read each
                Pool's Form C before investing.
              </Callout>
              <div className="grid gap-6 md:grid-cols-2">
                {pools.map((p) => (
                  <PoolCard key={p.id} pool={p} />
                ))}
              </div>
            </section>
          </WhenFlag>

          {/* Signed-out nudge */}
          <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-gold">
                <Compass className="size-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Get recommendations that fit your sound</h2>
                <p className="text-sm text-muted">Pick your genres and follow artists — we'll tell you the moment they launch.</p>
              </div>
            </div>
            <Button asChild>
              <Link to="/signup">Create your account</Link>
            </Button>
          </Card>
        </div>
      )}
    </Container>
  );
}

/* ── Search with suggestion overlay ───────────────────── */

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const q = value.trim().toLowerCase();
  const ar = q ? artists.filter((a) => [a.name, a.genre, a.city].some((s) => s.toLowerCase().includes(q))).slice(0, 3) : artists.slice(0, 3);
  const ca = q ? campaigns.filter((c) => [c.title, c.type, artistById(c.artistId).name].some((s) => s.toLowerCase().includes(q))).slice(0, 3) : [];
  const ev = q ? events.filter((e) => [e.title, e.city, e.venue].some((s) => s.toLowerCase().includes(q))).slice(0, 2) : [];

  return (
    <div ref={wrap} className="relative flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-suggestions"
        aria-label="Search artists, campaigns and shows"
        placeholder="Search artists, campaigns, cities…"
        value={value}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        className="h-11 w-full rounded-md border border-line bg-surface-2 pl-10 pr-10 text-sm text-fg placeholder:text-muted/70 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-0 top-0 flex size-11 items-center justify-center text-muted hover:text-fg">
          <X className="size-4" />
        </button>
      )}
      {open && (
        <div id="search-suggestions" className="absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface-2 p-2 shadow-lg">
          {!q && (
            <div className="px-3 pb-2 pt-2">
              <p className="eyebrow mb-2">Popular searches</p>
              <div className="flex flex-wrap gap-2">
                {TRENDING_SEARCHES.map((t) => (
                  <button key={t} type="button" onClick={() => onChange(t)} className="h-8 rounded-full border border-line px-3 text-sm text-muted hover:text-fg">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          <SuggestGroup label={q ? "Artists" : "Trending artists"} icon={<Users className="size-3.5" />}>
            {ar.map((a) => (
              <Link key={a.id} to={`/artist/${a.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-surface">
                <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-8" />
                <span className="flex-1 text-sm">{a.name}</span>
                <span className="text-xs text-muted">{a.genre}</span>
              </Link>
            ))}
          </SuggestGroup>
          {ca.length > 0 && (
            <SuggestGroup label="Campaigns" icon={<Megaphone className="size-3.5" />}>
              {ca.map((c) => (
                <Link key={c.id} to={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-surface">
                  <span className="truncate text-sm">{c.title}</span>
                  <span className="num shrink-0 text-xs text-muted">{Math.round((c.raisedMinor / c.goalMinor) * 100)}% funded</span>
                </Link>
              ))}
            </SuggestGroup>
          )}
          {ev.length > 0 && (
            <SuggestGroup label="Shows" icon={<CalendarDays className="size-3.5" />}>
              {ev.map((e) => (
                <Link key={e.id} to="/tickets" className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-surface">
                  <span className="truncate text-sm">{e.title}</span>
                  <span className="num shrink-0 text-xs text-muted">{formatDate(e.date)}</span>
                </Link>
              ))}
            </SuggestGroup>
          )}
          {q && ar.length + ca.length + ev.length === 0 && <p className="px-3 py-4 text-sm text-muted">No matches yet. Press Enter to search everything.</p>}
        </div>
      )}
    </div>
  );
}

function SuggestGroup({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="eyebrow flex items-center gap-1.5 px-3 py-2">
        {icon} {label}
      </p>
      {children}
    </div>
  );
}

/* ── Non-content states ───────────────────────────────── */

function LoadingGrid() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading campaigns">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="aspect-[16/10] animate-pulse bg-surface-2" />
          <div className="flex flex-col gap-3 p-5">
            <div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" />
            <div className="h-5 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <EmptyState
      icon={<WifiOff />}
      title="We couldn't load campaigns"
      action={
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => window.location.assign("/explore")}>
            <RefreshCw /> Try again
          </Button>
          <Button asChild variant="secondary">
            <Link to="/">Go to homepage</Link>
          </Button>
        </div>
      }
    >
      This is usually a brief connection problem. Check your internet and try again in a moment.
    </EmptyState>
  );
}
