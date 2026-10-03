import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Gift,
  HandCoins,
  Headphones,
  Landmark,
  Megaphone,
  PartyPopper,
  Plus,
  Share2,
  ShoppingBag,
  UserPlus,
  Users,
} from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, FundingProgress, IconChip, Money, PageHeader, ProgressBar, SectionHeading } from "@/components/brand";
import { CHART, ChartCard, KpiCard, MoneyTooltip, axisProps, formatDay } from "@/components/creator/ui";
import { LIVE_CAMPAIGN_ID, ME, creatorCampaignById, creatorEvents, dashboardTasks, establishedCriteria, recentActivity, revenueByMonth } from "@/components/creator/data";
import { daysUntil, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup CreatorDashboardLanding + CreatorDashboardShowcase (active + new-creator states).
 * Doc-driven changes: "Pool Unit Holders", "Investors", "Pool Distributions" and "purchased pool units" activity
 * removed from this Layer 1 dashboard (Brand §7.4, CONSOLIDATION Layer 1); KPI row is campaign raised/goal,
 * backers, subscribers and monthly listeners. New-creator empty state reachable via `?state=new`.
 * Established tier criteria are placeholders until PRD 01 §6.3 defines them.
 */
export default function Dashboard() {
  const [params] = useSearchParams();
  if (params.get("state") === "new") return <NewCreator />;
  return <ActiveDashboard />;
}

function ActiveDashboard() {
  const c = creatorCampaignById(LIVE_CAMPAIGN_ID)!;
  const pct = Math.round((c.raisedMinor / c.goalMinor) * 100);
  const toGo = c.goalMinor - c.raisedMinor;
  const daysLeft = daysUntil(c.endsOn);
  const last = revenueByMonth[revenueByMonth.length - 1];
  const prev = revenueByMonth[revenueByMonth.length - 2];
  const upcoming = creatorEvents.filter((e) => e.status !== "past" && e.status !== "draft").sort((a, b) => a.date.localeCompare(b.date));
  const [done, setDone] = useState<Record<string, boolean>>({});

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Creator dashboard · <span className="text-gold">{ME.tier} tier</span>
          </span>
        }
        title={`Welcome back, ${ME.name.split(" ")[0]}`}
        description={`Your tour campaign has ${daysLeft} days left to reach its goal. Here's what needs you this week.`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={`/creator/campaigns/${c.id}#update`}>
                <Megaphone /> Post an update
              </Link>
            </Button>
            <Button asChild>
              <Link to="/creator/campaigns/new/basics">
                <Plus /> New campaign
              </Link>
            </Button>
          </>
        }
      />

      {/* KPI row */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="Campaign raised" icon={<HandCoins />} value={<Money minor={c.raisedMinor} />} hint={<>of <Money minor={c.goalMinor} /> goal</>}>
          <ProgressBar value={c.raisedMinor} max={c.goalMinor} label="Campaign progress" />
        </KpiCard>
        <KpiCard label="Backers" icon={<Users />} value={formatNumber(c.backers)} delta={0.112} hint="vs last week" />
        <KpiCard label="Subscribers" icon={<UserPlus />} value={formatNumber(ME.subscribers)} delta={0.038} hint="vs last month" />
        <KpiCard label="Monthly listeners" icon={<Headphones />} value={formatNumber(ME.monthlyListeners)} delta={0.071} hint="from your distributor" />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        {/* Live campaign */}
        <Card padded={false} className="overflow-hidden">
          <div className="grid sm:grid-cols-[200px_1fr]">
            <ArtistArt seed={ME.id} label={ME.name} className="aspect-[16/9] w-full rounded-none sm:aspect-auto sm:h-full" />
            <div className="flex flex-col gap-5 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">Live</Badge>
                <Badge>{c.type}</Badge>
                {c.milestoneRelease && <Badge>Milestone release</Badge>}
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">{c.title}</h2>
                <p className="text-sm text-muted">{c.blurb}</p>
              </div>
              <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={daysLeft} />
              <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-4">
                <span className="eyebrow">Next milestone</span>
                <p className="text-sm text-fg">
                  Reach the <Money minor={c.goalMinor} /> goal — <Money minor={toGo} className="text-gold" /> to go by{" "}
                  <span className="num">{formatDay(c.endsOn)}</span>.
                </p>
                <p className="text-xs text-muted">
                  When it's met, <span className="num">40%</span> is released from escrow for booking and deposits.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="sm">
                  <Link to={`/creator/campaigns/${c.id}`}>
                    Manage campaign <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link to={`/creator/campaigns/${c.id}#share`}>
                    <Share2 /> Share link
                  </Link>
                </Button>
              </div>
              <span className="sr-only">{pct}% funded</span>
            </div>
          </div>
        </Card>

        {/* Next steps */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Next steps</h2>
            <span className="num text-xs text-muted">
              {Object.values(done).filter(Boolean).length}/{dashboardTasks.length} done
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {dashboardTasks.map((t) => {
              const isDone = !!done[t.id];
              return (
                <li key={t.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isDone}
                    aria-label={`Mark "${t.label}" as done`}
                    onClick={() => setDone((d) => ({ ...d, [t.id]: !d[t.id] }))}
                    className="-m-2.5 flex size-11 shrink-0 items-center justify-center"
                  >
                    <span className={cn("flex size-5 items-center justify-center rounded-full border", isDone ? "border-success bg-success text-on-gold" : "border-line")}>
                      {isDone && <Check className="size-3" />}
                    </span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link to={t.to} className={cn("text-sm font-medium hover:text-gold", isDone ? "text-muted line-through" : "text-fg")}>
                      {t.label}
                    </Link>
                    <p className="text-xs text-muted">{t.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* Trend */}
      <ChartCard
        className="mt-6"
        title="Monthly revenue"
        subtitle="Subscriptions, tickets, merch, live streams and tips — last 12 months, before fees. Campaign proceeds are shown on Revenue."
        actions={
          <div className="flex items-end gap-6">
            <div className="flex flex-col items-start sm:items-end">
              <span className="eyebrow">September</span>
              <span className="num text-xl font-medium text-fg">{formatMoney(last.totalExCampaigns)}</span>
              <span className="num text-xs text-success">+{(((last.totalExCampaigns - prev.totalExCampaigns) / prev.totalExCampaigns) * 100).toFixed(1)}% vs Aug</span>
            </div>
          </div>
        }
        footer={
          <Link to="/creator/revenue" className="flex items-center gap-1 text-sm font-medium text-gold hover:underline">
            See revenue by source <ArrowRight className="size-4" />
          </Link>
        }
      >
        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueByMonth} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="dashRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.gold} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={CHART.gold} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatMoney(v, { compact: true })} />
              <Tooltip content={<MoneyTooltip />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="totalExCampaigns"
                name="Revenue"
                stroke={CHART.gold}
                strokeWidth={2}
                fill="url(#dashRev)"
                activeDot={{ r: 5, stroke: CHART.surface, strokeWidth: 2, fill: CHART.gold }}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="mt-6 grid grid-cols-1 gap-6 [&>*]:min-w-0 lg:grid-cols-3">
        {/* Activity */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <ul className="flex flex-col gap-4">
            {recentActivity.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <IconChip tone={a.kind === "milestone" ? "gold" : "muted"} className="size-9 [&_svg]:size-4">
                  {{ backer: <HandCoins />, subscriber: <UserPlus />, sale: <ShoppingBag />, milestone: <PartyPopper />, payout: <Landmark /> }[a.kind]}
                </IconChip>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-fg">{a.text}</span>
                  <span className="text-xs text-muted">{a.at}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Events */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upcoming events</h2>
            <Link to="/creator/events" className="text-sm font-medium text-gold hover:underline">
              All events
            </Link>
          </div>
          <ul className="flex flex-col gap-3">
            {upcoming.map((e) => {
              const d = new Date(e.date);
              return (
                <li key={e.id} className="flex gap-3 rounded-md border border-line bg-surface-2 p-3">
                  <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-md bg-surface py-1.5">
                    <span className="text-[11px] font-medium uppercase text-muted">{d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</span>
                    <span className="num text-lg font-medium text-fg">{d.getUTCDate()}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="truncate text-sm font-medium text-fg">{e.title}</span>
                    <span className="text-xs text-muted">
                      {e.venue} · {e.city}
                    </span>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={e.sold} max={e.capacity} tone="info" className="h-1.5" label="Tickets sold" />
                      <span className="num shrink-0 text-xs text-muted">
                        {e.sold}/{e.capacity}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Button asChild variant="secondary" size="sm" className="mt-auto">
            <Link to="/creator/events/new">
              <CalendarDays /> Create event
            </Link>
          </Button>
        </Card>

        {/* Tier progress */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Path to Established</h2>
              <p className="text-sm text-muted">You're on Rising. Here's how close you are to the next tier.</p>
            </div>
            <Badge tone="gold" icon={<BadgeCheck />}>
              Rising
            </Badge>
          </div>
          <ul className="flex flex-col gap-4">
            {establishedCriteria.map((k) => {
              const met = k.current >= k.target;
              return (
                <li key={k.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className={met ? "text-fg" : "text-muted"}>{k.label}</span>
                    <span className="num text-xs text-muted">
                      {met ? <span className="text-success">Met</span> : `${formatNumber(k.current, k.target >= 10000)} / ${formatNumber(k.target, k.target >= 10000)}`}
                    </span>
                  </div>
                  <ProgressBar value={k.current} max={k.target} tone={met ? "success" : "gold"} label={k.label} />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </Container>
  );
}

function NewCreator() {
  const steps = [
    { icon: <BadgeCheck />, t: "Finish your profile", d: "Add a photo, bio and a released track so fans know who they're backing.", to: "/artist-onboarding/basic", cta: "Edit profile" },
    { icon: <Megaphone />, t: "Launch your first campaign", d: "Set a goal, a deadline and the perks you'll deliver. Starter campaigns go up to $10K.", to: "/creator/campaigns/new/basics", cta: "Create campaign" },
    { icon: <Gift />, t: "Share it with your fans", d: "Post your link everywhere your fans already are. The first week sets the pace.", to: "/creator/campaigns", cta: "Get your link" },
  ];
  return (
    <Container size="lg" className="py-8 sm:py-10">
      <PageHeader eyebrow="Creator dashboard · Starter tier" title={`Welcome to FanZuP, ${ME.name.split(" ")[0]}`} description="Three steps to your first backers. Your numbers show up here as soon as fans find you." />
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <Card key={s.t} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <IconChip>{s.icon}</IconChip>
              <span className="num text-xs text-muted">0{i + 1}</span>
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{s.t}</h2>
              <p className="text-sm text-muted">{s.d}</p>
            </div>
            <Button asChild variant={i === 1 ? "primary" : "secondary"} size="sm" className="mt-auto self-start">
              <Link to={s.to}>{s.cta}</Link>
            </Button>
          </Card>
        ))}
      </ol>
      <SectionHeading className="mt-12" title="Your numbers" />
      <EmptyState icon={<Users />} title="No backers or subscribers yet">
        Once your first campaign is live you'll see money raised, backers, subscribers and listeners here.
      </EmptyState>
    </Container>
  );
}
