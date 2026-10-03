import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, BadgeCheck, CalendarDays, Disc3, Heart, Megaphone, MessageCircle, Music2, Ticket, UserPlus, Vote } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, FundingProgress, IconChip, SectionHeading } from "@/components/brand";
import { SegmentedTabs, formatDay } from "@/components/fan/kit";
import { artistById, artists, campaignById, events, fan, merch } from "@/lib/mock";
import { daysUntil, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: routes.tsx stub AC — tabs For You / Following / Trending, stories rail, activity cards
 * (post, drop, event, campaign update, poll).
 * Doc-driven: Trending ranks by fan activity (comments, reactions), never by money raised or invested
 * (PRD 02 §8). `?following=none` previews the empty Following state.
 */

type Kind = "post" | "drop" | "event" | "update" | "poll";
interface FeedItem {
  id: string;
  kind: Kind;
  artistId: string;
  when: string;
  likes: number;
  comments: number;
  trending?: boolean;
  text?: string;
  campaignId?: string;
  eventId?: string;
  merchId?: string;
  poll?: { q: string; options: { id: string; label: string; votes: number }[] };
}

const FEED: FeedItem[] = [
  { id: "f1", kind: "update", artistId: "nova-reyes", when: "2h", likes: 214, comments: 38, trending: true, campaignId: "nova-live-band-tour", text: "75% there. We just locked the Atlanta and Charlotte dates — the horn section is officially coming. Thank you, all 412 of you." },
  { id: "f2", kind: "poll", artistId: "sol-amara", when: "4h", likes: 96, comments: 51, trending: true, poll: { q: "Which song should open the headline show?", options: [{ id: "a", label: "Harmattan", votes: 142 }, { id: "b", label: "Ozark Gold", votes: 211 }, { id: "c", label: "Back Porch Highlife", votes: 87 }] } },
  { id: "f3", kind: "drop", artistId: "the-low-ends", when: "6h", likes: 133, comments: 22, merchId: "m2", text: "Test pressings came back and they sound huge. Pre-orders for the 180g vinyl are open now." },
  { id: "f4", kind: "event", artistId: "nova-reyes", when: "1d", likes: 302, comments: 64, trending: true, eventId: "e1", text: "First stop with the full band. Backers get presale access before general sale." },
  { id: "f5", kind: "post", artistId: "velvet-circuit", when: "1d", likes: 77, comments: 9, text: "Location scouting for the Night Shift video. Found a warehouse in Corktown with the right kind of dust." },
  { id: "f6", kind: "update", artistId: "sol-amara", when: "2d", likes: 58, comments: 14, campaignId: "sol-amara-first-headline", text: "The Rail Yard is booked for January 23. Nine players, one night, my hometown." },
  { id: "f7", kind: "post", artistId: "kai-marlo", when: "3d", likes: 481, comments: 102, trending: true, text: "Dug through my uncle's crates this weekend. Three new samples cleared. Album two is moving." },
  { id: "f8", kind: "event", artistId: "kai-marlo", when: "3d", likes: 266, comments: 41, eventId: "e4", text: "Third Ward Homecoming is sold out. Thank you, Houston. Live stream details coming soon." },
];

const KIND_META: Record<Kind, { label: string; icon: React.ReactNode }> = {
  post: { label: "Post", icon: <MessageCircle /> },
  drop: { label: "New drop", icon: <Disc3 /> },
  event: { label: "Event", icon: <CalendarDays /> },
  update: { label: "Campaign update", icon: <Megaphone /> },
  poll: { label: "Poll", icon: <Vote /> },
};

type Tab = "foryou" | "following" | "trending";

export default function HomeFeed() {
  const [params] = useSearchParams();
  const following = params.get("following") === "none" ? [] : fan.following;
  const [tab, setTab] = useState<Tab>("foryou");

  const items = useMemo(() => {
    if (tab === "following") return FEED.filter((f) => following.includes(f.artistId));
    if (tab === "trending") return FEED.filter((f) => f.trending).sort((a, b) => b.comments + b.likes - (a.comments + a.likes));
    return FEED;
  }, [tab, following]);

  const suggestions = artists.filter((a) => !following.includes(a.id)).slice(0, 3);
  const upcoming = [...events].filter((e) => e.remaining > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-1">
        <span className="eyebrow">Home</span>
        <h1 className="text-3xl font-bold sm:text-4xl">Welcome back, {fan.name.split(" ")[0]}</h1>
      </header>

      {/* Stories rail */}
      <section aria-label="Artists you follow" className="-mx-4 mb-8 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-4 pb-2">
          {following.map((id, i) => {
            const a = artistById(id);
            const fresh = i < 2;
            return (
              <li key={id} className="shrink-0">
                <Link to={`/artist/${id}`} className="group flex w-20 flex-col items-center gap-2 focus:outline-none">
                  <span className={cn("rounded-full p-0.5 transition-shadow group-focus-visible:shadow-gold", fresh ? "bg-gold-gradient" : "bg-line")}>
                    <span className="block rounded-full bg-canvas p-0.5">
                      <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-16" />
                    </span>
                  </span>
                  <span className="w-full truncate text-center text-xs text-muted group-hover:text-fg">{a.name}</span>
                  {fresh && <span className="sr-only">New update</span>}
                </Link>
              </li>
            );
          })}
          <li className="shrink-0">
            <Link to="/explore" className="group flex w-20 flex-col items-center gap-2">
              <span className="flex size-[72px] items-center justify-center rounded-full border border-dashed border-line text-muted group-hover:border-gold/50 group-hover:text-gold">
                <UserPlus className="size-6" />
              </span>
              <span className="text-xs text-muted group-hover:text-fg">Find artists</span>
            </Link>
          </li>
        </ul>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <SegmentedTabs
            label="Feed"
            value={tab}
            onChange={setTab}
            className="self-start"
            tabs={[
              { id: "foryou", label: "For You" },
              { id: "following", label: "Following" },
              { id: "trending", label: "Trending" },
            ]}
          />

          {tab === "following" && following.length === 0 ? (
            <EmptyState
              icon={<Heart />}
              title="You're not following anyone yet"
              action={
                <Button asChild>
                  <Link to="/explore">
                    Discover artists <ArrowRight />
                  </Link>
                </Button>
              }
            >
              Follow artists to see their posts, drops, shows and campaign updates here first.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-5">
              {items.map((item) => (
                <li key={item.id}>
                  <FeedCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Side rail */}
        <aside className="flex flex-col gap-6">
          <Card>
            <SectionHeading title="Coming up" className="mb-2" action={<Link to="/tickets" className="text-sm text-gold hover:underline">Tickets</Link>} />
            <ul className="flex flex-col divide-y divide-line">
              {upcoming.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-md border border-line bg-surface-2">
                    <span className="text-[10px] uppercase text-muted">{new Date(e.date).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</span>
                    <span className="num text-base font-medium leading-none">{new Date(e.date).getUTCDate()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted">{e.venue} · {e.city}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <SectionHeading title="Artists to follow" className="mb-2" />
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted">You're following everyone we'd suggest right now.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {suggestions.map((a) => (
                  <SuggestRow key={a.id} id={a.id} />
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function SuggestRow({ id }: { id: string }) {
  const a = artistById(id);
  const [on, setOn] = useState(false);
  return (
    <li className="flex items-center gap-3">
      <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <Link to={`/artist/${a.id}`} className="block truncate text-sm font-medium hover:underline">{a.name}</Link>
        <p className="truncate text-xs text-muted">{a.genre} · {a.city}</p>
      </div>
      <Button size="sm" variant="secondary" aria-pressed={on} onClick={() => setOn((v) => !v)}>
        {on ? "Following" : "Follow"}
      </Button>
    </li>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const a = artistById(item.artistId);
  const meta = KIND_META[item.kind];
  const [liked, setLiked] = useState(false);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-5">
        <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link to={`/artist/${a.id}`} className="truncate text-sm font-semibold hover:underline">{a.name}</Link>
            {a.verified && <BadgeCheck className="size-4 shrink-0 text-gold" aria-label="Verified artist" />}
          </div>
          <p className="text-xs text-muted">
            {a.genre} · <span className="num">{item.when}</span> ago
          </p>
        </div>
        <Badge tone={item.kind === "update" ? "gold" : "neutral"} icon={meta.icon}>{meta.label}</Badge>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {item.text && <p className="text-sm leading-relaxed text-fg">{item.text}</p>}
        {item.kind === "update" && item.campaignId && <CampaignBlock id={item.campaignId} />}
        {item.kind === "event" && item.eventId && <EventBlock id={item.eventId} />}
        {item.kind === "drop" && item.merchId && <DropBlock id={item.merchId} />}
        {item.kind === "poll" && item.poll && <PollBlock poll={item.poll} />}
        {item.kind === "post" && <ArtistArt seed={`${item.id}-${a.id}`} label={`${a.name} photo`} className="aspect-[2/1] w-full" />}
      </div>

      <div className="flex items-center gap-1 border-t border-line px-3 py-1.5">
        <Button variant="ghost" size="sm" aria-pressed={liked} onClick={() => setLiked((v) => !v)} className={liked ? "text-error hover:text-error" : undefined}>
          <Heart className={liked ? "fill-current" : undefined} />
          <span className="num">{formatNumber(item.likes + (liked ? 1 : 0))}</span>
          <span className="sr-only">likes</span>
        </Button>
        <Button variant="ghost" size="sm">
          <MessageCircle />
          <span className="num">{formatNumber(item.comments)}</span>
          <span className="sr-only">comments</span>
        </Button>
      </div>
    </Card>
  );
}

function CampaignBlock({ id }: { id: string }) {
  const c = campaignById(id);
  if (!c) return null;
  const backed = fan.backed.includes(c.id);
  return (
    <Link to={`/campaigns/${c.id}`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4 transition-colors hover:border-gold/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{c.title}</span>
        {backed ? <Badge tone="success" className="shrink-0 whitespace-nowrap">You backed this</Badge> : <Badge className="shrink-0">{c.type}</Badge>}
      </div>
      <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={daysUntil(c.endsOn)} />
    </Link>
  );
}

function EventBlock({ id }: { id: string }) {
  const e = events.find((x) => x.id === id);
  if (!e) return null;
  const soldOut = e.remaining === 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:flex-row sm:items-center">
      <IconChip>
        <Ticket />
      </IconChip>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{e.title}</p>
        <p className="text-xs text-muted">
          <span className="num">{formatDay(e.date)}</span> · {e.venue}, {e.city}
        </p>
      </div>
      {soldOut ? (
        <Badge tone="neutral">Sold out</Badge>
      ) : (
        <Button asChild size="sm" variant="secondary">
          <Link to="/tickets">
            From <span className="num">{formatMoney(e.priceMinor)}</span>
          </Link>
        </Button>
      )}
    </div>
  );
}

function DropBlock({ id }: { id: string }) {
  const m = merch.find((x) => x.id === id);
  if (!m) return null;
  return (
    <Link to="/merch" className="flex items-center gap-4 rounded-lg border border-line bg-surface-2 p-3 transition-colors hover:border-gold/40">
      <ArtistArt seed={m.id} label={m.title} className="size-20 shrink-0" rounded="md" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Music2 className="size-3.5" /> {m.kind}
        </p>
        <p className="text-sm font-semibold">{m.title}</p>
        <p className="num text-sm text-fg">{formatMoney(m.priceMinor)}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

function PollBlock({ poll }: { poll: NonNullable<FeedItem["poll"]> }) {
  const [vote, setVote] = useState<string | null>(null);
  const total = poll.options.reduce((s, o) => s + o.votes, 0) + (vote ? 1 : 0);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">{poll.q}</legend>
      {poll.options.map((o) => {
        const votes = o.votes + (vote === o.id ? 1 : 0);
        const pct = Math.round((votes / total) * 100);
        return vote ? (
          <div key={o.id} className="relative overflow-hidden rounded-md border border-line bg-surface-2 px-4 py-3" aria-label={`${o.label}: ${pct}%`}>
            <div className={cn("absolute inset-y-0 left-0", vote === o.id ? "bg-gold/20" : "bg-surface")} style={{ width: `${pct}%` }} aria-hidden />
            <div className="relative flex justify-between text-sm">
              <span className={vote === o.id ? "font-medium text-fg" : "text-muted"}>{o.label}</span>
              <span className="num">{pct}%</span>
            </div>
          </div>
        ) : (
          <button key={o.id} type="button" onClick={() => setVote(o.id)} className="min-h-11 rounded-md border border-line bg-surface-2 px-4 py-3 text-left text-sm transition-colors hover:border-gold/50">
            {o.label}
          </button>
        );
      })}
      <p className="text-xs text-muted">
        <span className="num">{formatNumber(total)}</span> votes{vote && " · Thanks for voting"}
      </p>
    </fieldset>
  );
}
