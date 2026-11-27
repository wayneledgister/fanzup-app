import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CircleAlert, MapPin, RefreshCw, Search, Store, Wrench } from "lucide-react";
import { Badge, Button, Callout, Card, Checkbox, Container, EmptyState, Field, PageHeader, Select, TextInput } from "@/components/brand";
import { api } from "@/lib/api";
import { MARKETPLACE_CATEGORIES, MKT_VETTING_NOTE, categoryLabel, priceFromLabel, turnaroundLabel, type ServiceResult } from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-005 MKT-1, FR-MKT-005. Browse vetted providers' services by category, text and remote.
 * Ordered by most recently listed; never by money (no paid placement). Prices are "starting at" guides only:
 * FanZuP takes no payment for services in MKT-1 (ADR-010).
 */
export default function ServicesBrowse() {
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState(false);
  const [items, setItems] = useState<ServiceResult[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Review finding 7: only the latest request may update the list, so a slow earlier search can't overwrite it.
  const seq = useRef(0);
  const load = (more = false) => {
    const n = ++seq.current;
    setError(false);
    if (more) setLoadingMore(true);
    else setItems(null);
    api
      .services({ category: category || undefined, q: query || undefined, remote, cursor: more ? cursor : null })
      .then((r) => {
        if (n !== seq.current) return;
        setItems((prev) => (more && prev ? [...prev, ...r.items] : r.items));
        setCursor(r.nextCursor);
      })
      .catch(() => n === seq.current && setError(true))
      .finally(() => n === seq.current && setLoadingMore(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [category, query, remote]);

  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader
        eyebrow="Services for artists"
        title="Find the people who help you finish the work"
        description={`Producers, engineers, video, design and promotion for your next show, tour or record. ${MKT_VETTING_NOTE}`}
        actions={<Button asChild variant="secondary"><Link to="/provider">Offer your services</Link></Button>}
      />

      <form
        className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Field label="Search" htmlFor="svc-q">
          <TextInput id="svc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mixing, music video, cover art…" maxLength={80} />
        </Field>
        <Field label="Category" htmlFor="svc-cat">
          <Select id="svc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {MARKETPLACE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <Button type="submit"><Search /> Search</Button>
        <Checkbox id="svc-remote" checked={remote} onChange={setRemote} className="sm:col-span-3">Only providers who work remotely</Checkbox>
      </form>

      {error && (
        <Callout tone="error" icon={<CircleAlert />} title="We couldn't load services">
          Check your connection and try again. <Button variant="ghost" size="sm" onClick={() => load()}><RefreshCw /> Retry</Button>
        </Callout>
      )}
      {!items && !error && <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading services" />}
      {items && items.length === 0 && (
        <EmptyState icon={<Store />} title="No services match yet" action={<Button asChild variant="secondary"><Link to="/provider">List your services <ArrowRight /></Link></Button>}>
          Try another category or search, or come back soon: new providers are added after review.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="service-results">
          {items.map((s) => (
            <li key={s.id}>
              <Card interactive className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/services/${s.provider.slug}`} className="font-semibold hover:underline">{s.title}</Link>
                    <p className="text-sm text-muted">{s.provider.displayName} · {s.provider.headline}</p>
                  </div>
                  <Badge icon={<Wrench />}>{categoryLabel(s.category)}</Badge>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="num text-fg">{priceFromLabel(s.priceFromMinor, s.priceUnit)}</span>
                  {turnaroundLabel(s.turnaroundDays) && <span>{turnaroundLabel(s.turnaroundDays)}</span>}
                  <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{s.provider.remoteOk ? (s.provider.city ? `${s.provider.city} or remote` : "Remote") : s.provider.city ?? "In person"}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {cursor && items && (
        <Button variant="secondary" className="self-center" onClick={() => load(true)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show more"}
        </Button>
      )}
    </Container>
  );
}
