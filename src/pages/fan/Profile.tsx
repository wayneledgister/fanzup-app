import { Link } from "react-router";
import { Award, CalendarCheck2, Flame, Gem, HandCoins, MapPin, MessageSquareHeart, Pencil, Ticket, Trophy, UserPlus, Vote } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, Logo, ProgressBar, SectionHeading } from "@/components/brand";
import { artistById, fan } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { formatDay } from "@/components/fan/kit";

/**
 * Source: routes.tsx stub AC + FanZuP FanLoyaltyBadges.tsx (engagement badges) + FanTierRewards All-Access card (Brand §6.2/§9).
 * Doc-driven: "Stake longer, earn priority", LP points, "top 10% of fans", marketplace priority and the
 * Star/Nebula/Galaxy/Supernova dollar tiers are removed. Badges count engagement only (campaigns, months
 * subscribed, shows) — never money spent or invested. The All-Access card is an identity artifact, not a payment card.
 */

const BIO = "Little Rock by way of Memphis. Front row at every Afrobeats night, back row at every folk show. Vinyl first.";

interface EngagementBadge {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  progress: number;
  goal: number;
  earnedOn?: string;
}

const BADGES: EngagementBadge[] = [
  { id: "first", title: "First Backer", description: "Backed your first campaign.", icon: <HandCoins />, progress: 1, goal: 1, earnedOn: "2026-05-14" },
  { id: "early", title: "Day One", description: "Backed a campaign in its first 48 hours.", icon: <Flame />, progress: 1, goal: 1, earnedOn: "2026-07-21" },
  { id: "streak", title: "Subscriber Streak", description: "Subscribed to an artist 3 months running.", icon: <CalendarCheck2 />, progress: 3, goal: 3, earnedOn: "2026-08-01" },
  { id: "five", title: "Five Campaigns Backed", description: "Back five different campaigns.", icon: <Trophy />, progress: 3, goal: 5 },
  { id: "shows", title: "Shows Attended", description: "Check in at three shows booked through FanZuP.", icon: <Ticket />, progress: 1, goal: 3 },
  { id: "voice", title: "Loud Voice", description: "Vote in ten artist polls.", icon: <Vote />, progress: 7, goal: 10 },
];

const ACTIVITY = [
  { icon: <HandCoins />, text: <>Backed <strong className="font-medium text-fg">Take the band on the road</strong> by Nova Reyes</>, on: "2026-09-12" },
  { icon: <Vote />, text: <>Voted in Sol Amara's poll: <strong className="font-medium text-fg">which song opens the headline show</strong></>, on: "2026-09-29" },
  { icon: <Gem />, text: <>Perk delivered: <strong className="font-medium text-fg">Tour diary #3</strong></>, on: "2026-09-26" },
  { icon: <UserPlus />, text: <>Followed <strong className="font-medium text-fg">Velvet Circuit</strong></>, on: "2026-09-02" },
  { icon: <Award />, text: <>Earned the <strong className="font-medium text-fg">Subscriber Streak</strong> badge</>, on: "2026-08-01" },
  { icon: <MessageSquareHeart />, text: <>Subscribed to <strong className="font-medium text-fg">Sol Amara</strong></>, on: "2026-06-03" },
].sort((a, b) => b.on.localeCompare(a.on));

export default function Profile() {
  const followed = fan.following.map(artistById);
  const earned = BADGES.filter((b) => b.earnedOn);

  return (
    <Container size="xl" className="py-8 sm:py-10">
      {/* Identity header */}
      <section className="mb-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex size-24 shrink-0 items-center justify-center rounded-full border-2 border-gold/60 bg-surface-2 font-display text-3xl font-bold text-gold" aria-hidden>
            JP
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <h1 className="text-3xl font-bold sm:text-4xl">{fan.name}</h1>
              <p className="text-muted">
                {fan.handle} · <MapPin className="mb-0.5 inline size-4" /> {fan.city}
              </p>
            </div>
            <p className="max-w-xl text-sm text-fg/90">{BIO}</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <li>
                <span className="num text-fg">{fan.following.length}</span> following
              </li>
              <li>
                <span className="num text-fg">{fan.backed.length + 1}</span> campaigns backed
              </li>
              <li>
                <span className="num text-fg">{earned.length}</span> badges
              </li>
            </ul>
            <div>
              <Button asChild variant="secondary">
                <Link to="/onboarding/profile">
                  <Pencil /> Edit profile
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <AllAccessCard />
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-10">
          {/* Badges */}
          <section>
            <SectionHeading eyebrow="Engagement" title="Badges" />
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {BADGES.map((b) => {
                const done = !!b.earnedOn;
                return (
                  <li key={b.id}>
                    <Card className={cn("flex h-full flex-col gap-3 p-5", !done && "bg-surface/60")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className={cn("flex size-11 items-center justify-center rounded-full border [&_svg]:size-5", done ? "border-gold/50 bg-gold/10 text-gold" : "border-line bg-surface-2 text-muted")}>{b.icon}</div>
                        {done ? <Badge tone="success">Earned</Badge> : <span className="num text-xs text-muted">{b.progress} / {b.goal}</span>}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">{b.title}</h3>
                        <p className="text-xs text-muted">{b.description}</p>
                      </div>
                      <div className="mt-auto">
                        {done ? (
                          <p className="text-xs text-muted">
                            Earned <span className="num">{formatDay(b.earnedOn!)}</span>
                          </p>
                        ) : (
                          <ProgressBar value={b.progress} max={b.goal} tone="info" label={`${b.title} progress`} />
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Following */}
          <section>
            <SectionHeading title="Artists you follow" action={<Link to="/explore" className="text-sm text-gold hover:underline">Find more</Link>} />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {followed.map((a) => (
                <li key={a.id}>
                  <Link to={`/artist/${a.id}`} className="group flex flex-col items-center gap-3 rounded-lg border border-line bg-surface p-4 text-center transition-shadow hover:shadow-gold">
                    <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-16" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="truncate text-xs text-muted">{a.genre}</p>
                    </div>
                    {fan.subscriptions.includes(a.id) && <Badge tone="gold">Subscriber</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Activity */}
        <section>
          <SectionHeading title="Recent activity" />
          <Card className="p-2">
            <ol className="flex flex-col">
              {ACTIVITY.map((a, i) => (
                <li key={i} className="flex gap-3 rounded-md px-3 py-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted [&_svg]:size-4">{a.icon}</span>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm text-muted">{a.text}</p>
                    <span className="num text-xs text-muted/80">{formatDay(a.on)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </div>
    </Container>
  );
}

/** Brand §6.2 / §9: matte-black All-Access card with gold-foil edge and monogram. Identity only — not a payment card. */
function AllAccessCard() {
  return (
    <figure className="flex flex-col gap-2">
      <div className="rounded-xl bg-gold-gradient p-px shadow-gold">
        <div className="relative aspect-[1.586] overflow-hidden rounded-[15px] bg-canvas p-6">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-gold/15 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 size-56 rounded-full bg-surface-2 blur-3xl" />
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-display text-xs font-semibold tracking-[0.3em] text-gold">ALL-ACCESS</span>
                <span className="text-[11px] text-muted">FanZuP member</span>
              </div>
              <Logo size="lg" showWordmark={false} />
            </div>
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-display text-xl font-semibold tracking-wide">{fan.name.toUpperCase()}</span>
                <span className="num text-xs text-muted">{fan.handle}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-widest text-muted">Member since</span>
                <span className="num text-sm text-gold">{new Date(fan.joined).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="text-center text-xs text-muted">
        Member <span className="num">No. 004812</span> · Your FanZuP identity card, not a payment card.
      </figcaption>
    </figure>
  );
}
