import { useState } from "react";
import { Link, useParams } from "react-router";
import { BadgeCheck, Bell, BellRing, CalendarDays, Disc3, ExternalLink, Heart, Lock, MapPin, Megaphone, MessageSquare, Music2, Play, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, IconChip, Stat } from "@/components/brand";
import { CampaignCard, TierBadge, VerifiedBadge } from "@/components/public/cards";
import { artists, campaigns, events, merch } from "@/lib/mock";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FPS profile/PublicCreatorProfile.tsx.
 * Doc-driven changes: "Become a Pool Holder", "Your Investment / units owned" and "Unit Holders" stats removed
 * (Layer 1; Brand §7.4) — replaced by Subscribe (paid membership) and campaigns by this artist. Community
 * post "Just bought 5 more units!" dropped. Tabs Posts / Music / Merch / Events per CONSOLIDATION.md.
 */

type Tab = "posts" | "music" | "merch" | "events";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "posts", label: "Posts", icon: <MessageSquare /> },
  { id: "music", label: "Music", icon: <Music2 /> },
  { id: "merch", label: "Merch", icon: <ShoppingBag /> },
  { id: "events", label: "Events", icon: <CalendarDays /> },
];

const TRACKS = [["Slow Burn", "3:42"], ["Brass & Neon", "4:05"], ["Late Checkout", "3:18"], ["Southside Hymn", "5:01"], ["Keep the Lights On", "3:56"]];

export default function ArtistProfile() {
  const { id = "" } = useParams();
  const artist = artists.find((a) => a.id === id);
  const [tab, setTab] = useState<Tab>("posts");
  const [following, setFollowing] = useState(false);

  if (!artist) {
    return (
      <Container size="md" className="py-20">
        <EmptyState
          icon={<UserRound />}
          title="We couldn't find that artist"
          action={
            <Button asChild>
              <Link to="/explore">Discover artists</Link>
            </Button>
          }
        >
          The profile may have moved or the link is mistyped.
        </EmptyState>
      </Container>
    );
  }

  const a = artist;
  const theirCampaigns = campaigns.filter((c) => c.artistId === a.id && c.status !== "draft");
  const theirEvents = events.filter((e) => e.artistId === a.id);
  const theirMerch = merch.filter((m) => m.artistId === a.id);

  return (
    <>
      {/* ── Hero ── */}
      <section className="border-b border-line">
        <div className="relative">
          <ArtistArt seed={a.id + "-banner"} label={`${a.name} banner`} className="h-40 w-full rounded-none sm:h-64" />
          <div className="absolute inset-0 bg-scrim" />
        </div>
        <Container size="xl" className="relative pb-8">
          <div className="-mt-14 flex flex-col gap-6 sm:-mt-16 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-28 shrink-0 border-4 border-canvas sm:size-32" />
              <div className="flex flex-col gap-2 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-bold sm:text-4xl">{a.name}</h1>
                  {a.verified && <BadgeCheck className="size-6 text-success" aria-label="Identity verified" />}
                </div>
                <p className="flex flex-wrap items-center gap-x-2 text-muted">
                  <span>{a.handle}</span>·<span>{a.genre}</span>·
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5" /> {a.city}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <TierBadge tier={a.tier} />
                  {a.verified ? <VerifiedBadge /> : <Badge tone="warning">Verification pending</Badge>}
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" aria-pressed={following} onClick={() => setFollowing((f) => !f)} className="flex-1 sm:flex-none">
                {following ? <BellRing /> : <Bell />} {following ? "Following" : "Follow"}
              </Button>
              <Button asChild className="flex-1 sm:flex-none">
                <Link to={`/signup?next=/artist/${a.id}`}>
                  <Heart /> Subscribe <span className="num">$5/mo</span>
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Monthly listeners" value={formatNumber(a.monthlyListeners, true)} />
            <Stat label="Subscribers" value={formatNumber(a.subscribers, true)} />
            <Stat label="Campaigns" value={theirCampaigns.length} />
            <Stat label="Upcoming shows" value={theirEvents.length} />
          </div>
        </Container>
      </section>

      <Container size="xl" className="grid gap-10 py-10 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-10">
          {/* Campaigns */}
          <section aria-labelledby="camp-h">
            <h2 id="camp-h" className="mb-4 text-xl font-semibold">
              Campaigns by {a.name}
            </h2>
            {theirCampaigns.length ? (
              <div className="grid gap-6 sm:grid-cols-2">
                {theirCampaigns.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
                {theirCampaigns.length === 1 && (
                  <Card className="flex flex-col justify-center gap-4">
                    <IconChip>
                      <ShieldCheck />
                    </IconChip>
                    <h3 className="text-lg font-semibold">How backing works</h3>
                    <ul className="flex flex-col gap-2 text-sm text-muted">
                      <li>Pick a perk — tickets, vinyl, credits, access.</li>
                      <li>Your money waits with our escrow partner until the goal is met.</li>
                      <li>Goal missed? Every backer is refunded automatically.</li>
                    </ul>
                    <Link to="/trust" className="text-sm font-medium text-gold hover:underline">
                      How money moves on FanZuP →
                    </Link>
                  </Card>
                )}
              </div>
            ) : (
              <EmptyState icon={<Megaphone />} title="No campaign running right now">
                Follow {a.name} and we'll let you know the moment they launch one.
              </EmptyState>
            )}
          </section>

          {/* Tabs */}
          <section>
            <div role="tablist" aria-label={`${a.name} content`} className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 [contain:paint] sm:mx-0 sm:px-0">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "-mb-px flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium [&_svg]:size-4",
                    tab === t.id ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg",
                  )}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {tab === "posts" && <Posts name={a.name} />}

            {tab === "music" && (
              <Card padded={false}>
                <ol className="divide-y divide-line">
                  {TRACKS.map(([t, len], i) => (
                    <li key={t} className="flex items-center gap-4 px-5 py-3">
                      <span className="num w-5 text-sm text-muted">{i + 1}</span>
                      <Button variant="ghost" size="icon" aria-label={`Play ${t}`} className="size-9">
                        <Play />
                      </Button>
                      <span className="flex-1 truncate">{t}</span>
                      <span className="num text-sm text-muted">{len}</span>
                    </li>
                  ))}
                </ol>
                <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
                  <Disc3 className="size-3.5" /> Previews. Full tracks on your streaming service.
                </p>
              </Card>
            )}

            {tab === "merch" &&
              (theirMerch.length ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {theirMerch.map((m) => (
                    <Card key={m.id} padded={false} className="overflow-hidden">
                      <ArtistArt seed={m.id + a.id} label={m.title} className="aspect-square w-full rounded-none" />
                      <div className="flex flex-col gap-2 p-4">
                        <Badge tone="neutral" className="w-fit">
                          {m.kind}
                        </Badge>
                        <p className="font-semibold">{m.title}</p>
                        <div className="flex items-center justify-between">
                          <span className="num">{formatMoney(m.priceMinor)}</span>
                          {m.native ? (
                            <Link to="/merch" className="text-sm font-medium text-gold hover:underline">
                              Shop
                            </Link>
                          ) : (
                            <span className="flex items-center gap-1 text-sm text-muted">
                              Artist store <ExternalLink className="size-3.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<ShoppingBag />} title="No merch yet">
                  {a.name} hasn't listed any merch.
                </EmptyState>
              ))}

            {tab === "events" &&
              (theirEvents.length ? (
                <div className="flex flex-col gap-3">
                  {theirEvents.map((e) => (
                    <Card key={e.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                      <div className="flex w-16 shrink-0 flex-col items-center rounded-md border border-line bg-surface-2 py-2">
                        <span className="eyebrow">{new Date(e.date).toLocaleString("en-US", { month: "short" })}</span>
                        <span className="num text-2xl font-medium">{new Date(e.date).getUTCDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{e.title}</p>
                        <p className="text-sm text-muted">
                          {e.venue} · {e.city}
                        </p>
                      </div>
                      {e.remaining > 0 ? (
                        <Button asChild variant="secondary">
                          <Link to="/tickets">
                            Tickets · <span className="num">{formatMoney(e.priceMinor)}</span>
                          </Link>
                        </Button>
                      ) : (
                        <Badge tone="neutral">Sold out</Badge>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<CalendarDays />} title="No upcoming shows">
                  Follow {a.name} to hear about new dates first.
                </EmptyState>
              ))}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">About</h2>
            <p className="text-sm text-muted">{a.bio}</p>
          </Card>
          <Card className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <IconChip>
                <Heart />
              </IconChip>
              <div>
                <h2 className="font-semibold">Subscribe to {a.name}</h2>
                <p className="text-sm text-muted">
                  <span className="num text-fg">$5</span> a month · cancel anytime
                </p>
              </div>
            </div>
            <ul className="flex flex-col gap-2 text-sm text-muted">
              <li>Subscriber-only posts and demos</li>
              <li>Ticket presales before the public</li>
              <li>Backstage livestreams</li>
            </ul>
            <Button asChild variant="secondary" block>
              <Link to={`/signup?next=/artist/${a.id}`}>Subscribe</Link>
            </Button>
          </Card>
          <p className="text-xs text-muted">
            {a.verified ? "This artist's identity has been verified by FanZuP." : "This artist hasn't completed identity verification yet and can't launch campaigns."}{" "}
            <Link to="/trust" className="text-gold hover:underline">
              About verification
            </Link>
          </p>
        </aside>
      </Container>
    </>
  );
}

function Posts({ name }: { name: string }) {
  const posts = [
    { date: "2026-09-28", body: "Rehearsal tape from last night. The horns finally landed the bridge on take four.", locked: false },
    { date: "2026-09-21", body: "Full demo of the new single, plus the voice memo it started as.", locked: true },
    { date: "2026-09-12", body: "Thank you for 1,000 subscribers. Every one of you is in the credits of what comes next.", locked: false },
  ];
  return (
    <div className="flex flex-col gap-4">
      {posts.map((p) => (
        <Card key={p.date} className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{name}</span>
            <span className="num">{formatDate(p.date)}</span>
          </div>
          {p.locked ? (
            <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-muted">
                <Lock className="size-4 text-gold" /> Subscriber-only post
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link to="/signup">Subscribe to unlock</Link>
              </Button>
            </div>
          ) : (
            <p>{p.body}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
