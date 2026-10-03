import { useState } from "react";
import { useNavigate } from "react-router";
import { BadgeCheck, Check, Plus, Search, X } from "lucide-react";
import { ArtistArt, Button } from "@/components/brand";
import { OnboardingFooter, OnboardingHeader } from "@/components/public/onboarding";
import { artists } from "@/lib/mock";
import { cn } from "@/lib/utils";

/**
 * Source: FPS onboarding/StepDiscover.tsx (genre chips, artist search with suggestions, selected chips, skip).
 * Changes: real-world celebrity names replaced with FanZuP's (fictional) independent artists; selecting a genre
 * filters suggestions to it. Minimum to continue: one genre or one artist (inline message, not a silent disable).
 */

const GENRES = ["Hip-Hop", "R&B / Soul", "Alt R&B", "Afrobeats", "Electronic", "Indie Rock", "Folk / Americana", "Neo-Soul", "Gospel", "Amapiano", "Latin", "Jazz", "Reggae", "Country", "Metal", "K-Pop"];

export default function Discover() {
  const navigate = useNavigate();
  const [genres, setGenres] = useState<string[]>([]);
  const [follow, setFollow] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [tried, setTried] = useState(false);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const query = q.trim().toLowerCase();
  const suggestions = artists.filter((a) => {
    if (query) return [a.name, a.genre, a.city].some((s) => s.toLowerCase().includes(query));
    if (genres.length) return genres.some((g) => a.genre.toLowerCase().includes(g.toLowerCase().split(" ")[0]));
    return true;
  });
  const list = suggestions.length || query ? suggestions : artists;
  const ok = genres.length > 0 || follow.length > 0;

  return (
    <div>
      <OnboardingHeader step={4} title="What's your sound?" description="We'll use this to fill your feed with artists, campaigns and shows you'll actually care about." />

      <section aria-labelledby="genres-h" className="flex flex-col gap-3">
        <h2 id="genres-h" className="text-sm font-medium">
          Genres <span className="font-normal text-muted">· pick as many as you like</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => {
            const on = genres.includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => setGenres(toggle(genres, g))}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
                  on ? "border-gold bg-gold/12 text-gold" : "border-line text-muted hover:border-muted/50 hover:text-fg",
                )}
              >
                {on && <Check className="size-3.5" />} {g}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="artists-h" className="mt-10 flex flex-col gap-3">
        <h2 id="artists-h" className="text-sm font-medium">
          Artists to follow <span className="font-normal text-muted">· see their drops and campaigns first</span>
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search artists"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search artists, genres or cities"
            className="h-11 w-full rounded-md border border-line bg-surface-2 pl-10 pr-3 text-sm text-fg placeholder:text-muted/70 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </div>

        {follow.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Following">
            {follow.map((id) => {
              const a = artists.find((x) => x.id === id)!;
              return (
                <li key={id} className="flex h-9 items-center gap-2 rounded-full border border-gold/40 bg-gold/8 pl-1 pr-1 text-sm">
                  <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-7" />
                  {a.name}
                  <button type="button" aria-label={`Unfollow ${a.name}`} onClick={() => setFollow(toggle(follow, id))} className="flex size-7 items-center justify-center rounded-full text-muted hover:text-fg">
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="eyebrow mt-2">{query ? "Results" : genres.length ? "Matching your genres" : "Trending on FanZuP"}</p>
        {list.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((a) => {
              const on = follow.includes(a.id);
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                  <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate font-medium">
                      {a.name} {a.verified && <BadgeCheck className="size-3.5 shrink-0 text-success" aria-label="Verified" />}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {a.genre} · {a.city}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant={on ? "secondary" : "ghost"} aria-pressed={on} onClick={() => setFollow(toggle(follow, a.id))} className={cn(!on && "text-gold hover:text-gold")}>
                    {on ? (
                      <>
                        <Check /> Following
                      </>
                    ) : (
                      <>
                        <Plus /> Follow
                      </>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">No artists match “{q.trim()}” yet. Try a genre or city.</p>
        )}
      </section>

      {tried && !ok && <p className="mt-6 text-sm text-error">Pick at least one genre or artist — or skip for now.</p>}

      <OnboardingFooter
        back="/onboarding/profile"
        skip={
          <Button type="button" variant="ghost" size="lg" onClick={() => navigate("/onboarding/payment")}>
            Skip for now
          </Button>
        }
        primary={
          <Button size="lg" onClick={() => (ok ? navigate("/onboarding/payment") : setTried(true))}>
            Continue{ok && <span className="num">· {genres.length + follow.length}</span>}
          </Button>
        }
      />
    </div>
  );
}
