import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Compass, RefreshCw, SearchX, WifiOff } from "lucide-react";
import { Button, Callout, Container, EmptyState, PageHeader } from "@/components/brand";
import { LiveCampaignCard } from "@/components/campaign/LiveCampaignCard";
import { api, type CampaignCard } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Source: FPS marketplace/MarketplaceExplore + NonContentStatesShowcase.
 * M1 (FR-CMP-008, NFR-PERF-06): live campaigns from the API, ending soonest first, with a "Recently funded" tab,
 * a type filter and paging. Never ordered by money raised or anything return-like (PRD 02 §8). Text search,
 * genre/city filters and the artist/event rails come back at M2/P1 with their own endpoints; until then this page
 * shows only real data (FR-PLT-002).
 */

const TYPES = ["All", "Show", "Tour", "Album", "Music Video", "Documentary"] as const;
type Tab = "live" | "funded";

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "funded" ? "funded" : "live";
  const type = (TYPES as readonly string[]).includes(params.get("type") ?? "") ? (params.get("type") as (typeof TYPES)[number]) : "All";
  const [items, setItems] = useState<CampaignCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "more">("loading");

  const load = useCallback(
    async (from: string | null) => {
      setState(from ? "more" : "loading");
      try {
        const r = await api.campaigns({ tab, type: type === "All" ? undefined : type, cursor: from });
        setItems((prev) => (from ? [...prev, ...r.campaigns] : r.campaigns));
        setCursor(r.nextCursor);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [tab, type],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <Container size="xl" className="flex flex-col gap-8 py-10">
      <PageHeader eyebrow="Discover" title="Back a show, a tour or a record" description="Every campaign is all-or-nothing: if it doesn't reach its goal by the deadline, every backer is refunded in full." />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Campaigns" className="flex gap-1 border-b border-line">
          {(["live", "funded"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => set("tab", t === "live" ? null : t)}
              className={cn("-mb-px h-11 border-b-2 px-4 text-sm font-medium", tab === t ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg")}
            >
              {t === "live" ? "Live now" : "Recently funded"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Campaign type">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => set("type", t === "All" ? null : t)}
              className={cn("h-9 rounded-full border px-3 text-sm", type === t ? "border-gold text-fg" : "border-line text-muted hover:text-fg")}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {state === "loading" && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading campaigns">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-80 animate-pulse rounded-lg border border-line bg-surface" />)}
        </div>
      )}

      {state === "error" && (
        <Callout tone="error" icon={<WifiOff />} title="We couldn't load campaigns">
          Check your connection and try again.{" "}
          <Button variant="ghost" size="sm" onClick={() => void load(null)}><RefreshCw /> Retry</Button>
        </Callout>
      )}

      {(state === "ready" || state === "more") && items.length === 0 && (
        <EmptyState icon={tab === "live" ? <Compass /> : <SearchX />} title={tab === "live" ? "No live campaigns right now" : "No funded campaigns yet"}>
          {type !== "All" ? "Try another type, or look at all campaigns." : "New campaigns are reviewed before they go live. Check back soon."}
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => <LiveCampaignCard key={c.id} campaign={c} />)}
        </div>
      )}

      {cursor && state !== "loading" && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void load(cursor)} disabled={state === "more"}>
            {state === "more" ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </Container>
  );
}
