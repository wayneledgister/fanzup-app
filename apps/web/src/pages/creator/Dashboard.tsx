import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, BadgeCheck, CalendarClock, Gift, HandCoins, Landmark, Megaphone, Plus, RefreshCw, Share2, Users, WifiOff } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, FundingProgress, IconChip, Money, PageHeader, ProgressBar } from "@/components/brand";
import { CampaignStatusChip, KpiCard, formatDay } from "@/components/creator/ui";
import { useMyArtist } from "@/components/creator/live";
import { daysLeft } from "@/components/campaign/LiveCampaignCard";
import { RequireAccount } from "@/components/RequireAccount";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { isInProgress, nextSteps, pickCurrentCampaign, type NextStep } from "@fanzup/shared/artist-home";
import type { MyArtist, MyCampaignSummary } from "@fanzup/shared/schemas";

/**
 * Source: Fan Profile Setup CreatorDashboardLanding + CreatorDashboardShowcase (active + new-creator states).
 * CR-006 (FR-CMP-009, ADR-011): reads only `GET /artist`. The dashboard leads with the current campaign
 * (`pickCurrentCampaign`) and next steps derived from real state (`nextSteps`); both rules live in @fanzup/shared.
 * Widgets with no backend yet (subscribers, listeners, revenue trend, activity, events, tier progress) are left
 * out rather than shown with sample numbers (FR-PLT-002). FR-PLT-006: no "escrow" wording.
 * Payout onboarding (FR-ID-004) starts here and Stripe's hosted flow returns here (`?payout=done|retry`).
 */
/** FR-ID-005: signed in with a confirmed email; the API enforces the same (verified + owner). */
export default function DashboardPage() {
  return (
    <RequireAccount>
      <Dashboard />
    </RequireAccount>
  );
}

function Dashboard() {
  const [state, reload] = useMyArtist();
  const payout = usePayoutReturn(reload);

  if (state.status === "loading") return <DashboardSkeleton />;
  if (state.status === "error") {
    return (
      <Container size="lg" className="py-10">
        <Callout tone="error" icon={<WifiOff />} title="We couldn't load your dashboard">
          Check your connection and try again.{" "}
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCw /> Retry
          </Button>
        </Callout>
      </Container>
    );
  }
  if (state.status === "missing") return <NewCreator artist={null} payout={payout} />;
  const artist = state.data;
  const current = pickCurrentCampaign(artist.campaigns);
  if (!current) return <NewCreator artist={artist} payout={payout} />;
  return <ActiveDashboard artist={artist} current={current} payout={payout} />;
}

/* ── Payout onboarding (FR-ID-004) ─────────────────────── */

type Payout = { busy: boolean; error: string | null; start: () => void };

function usePayoutReturn(reload: () => void): Payout {
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flag = params.get("payout");

  const run = async (redirect: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.connectPayoutAccount();
      if (redirect && r.onboardingUrl) {
        window.location.assign(r.onboardingUrl);
        return;
      }
      reload();
    } catch {
      setError("We couldn't reach the payout setup. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  // Back from the hosted onboarding: ask the API once for the account's new status, then drop the parameter.
  useEffect(() => {
    if (flag !== "done" && flag !== "retry") return;
    const p = new URLSearchParams(params);
    p.delete("payout");
    setParams(p, { replace: true });
    void run(flag === "retry");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);

  return { busy, error, start: () => void run(true) };
}

/* ── Active dashboard ──────────────────────────────────── */

function headline(c: MyCampaignSummary) {
  const d = daysLeft(c.endsAt);
  switch (c.status) {
    case "live":
      return d === 0 ? `"${c.title}" closes today.` : `"${c.title}" has ${d} ${d === 1 ? "day" : "days"} left to reach its goal.`;
    case "in_review":
      return `"${c.title}" is with our reviewers.`;
    case "approved":
      return `"${c.title}" passed review. Publish it when you're ready.`;
    case "revisions_requested":
      return `Our reviewers asked for changes to "${c.title}".`;
    case "draft":
      return `"${c.title}" is a draft. Finish it and send it for review.`;
    case "funded":
    case "released":
      return `"${c.title}" reached its goal.`;
    default:
      return `Your last campaign was "${c.title}".`;
  }
}

function ActiveDashboard({ artist, current: c, payout }: { artist: MyArtist; current: MyCampaignSummary; payout: Payout }) {
  const isLive = c.status === "live";
  const d = daysLeft(c.endsAt);
  const toGo = Math.max(0, c.goalMinor - c.raisedMinor);
  const inProgress = artist.campaigns.filter((x) => isInProgress(x.status)).length;
  const steps = nextSteps(artist);
  const others = artist.campaigns.filter((x) => x.id !== c.id && x.status !== "withdrawn").slice(0, 4);
  const page = `/creator/campaigns/${c.id}`;

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Creator dashboard · <span className="text-gold">{artist.tier} tier</span>
          </span>
        }
        title={`Welcome back, ${artist.name.split(" ")[0]}`}
        description={headline(c)}
        actions={
          <Button asChild>
            <Link to="/creator/campaigns/new/basics">
              <Plus /> New campaign
            </Link>
          </Button>
        }
      />

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="dashboard-kpis">
        <KpiCard label="Raised" icon={<HandCoins />} value={<Money minor={c.raisedMinor} />} hint={<>of <Money minor={c.goalMinor} /> goal</>}>
          <ProgressBar value={c.raisedMinor} max={c.goalMinor} label="Campaign progress" />
        </KpiCard>
        <KpiCard label="Backers" icon={<Users />} value={formatNumber(c.backers)} hint={c.title} />
        <KpiCard
          label={isLive ? "Days left" : "Deadline"}
          icon={<CalendarClock />}
          value={isLive ? String(d ?? "—") : c.endsAt ? formatDay(c.endsAt) : "Not set"}
          hint={c.endsAt ? (isLive ? `Ends ${formatDay(c.endsAt)}` : "") : "Set when you publish"}
        />
        <KpiCard label="Campaigns in progress" icon={<Megaphone />} value={String(inProgress)} hint={`${artist.campaigns.length} in total`} />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        <Card padded={false} className="overflow-hidden" data-testid="current-campaign">
          <div className="grid sm:grid-cols-[200px_1fr]">
            <ArtistArt seed={artist.slug} label={artist.name} className="aspect-[16/9] w-full rounded-none sm:aspect-auto sm:h-full" />
            <div className="flex flex-col gap-5 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <CampaignStatusChip status={c.status} />
                <Badge>{c.type}</Badge>
                {c.milestoneRelease && <Badge>Milestone release</Badge>}
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">{c.title}</h2>
                {c.blurb && <p className="text-sm text-muted">{c.blurb}</p>}
              </div>
              <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={isLive ? d : undefined} />
              {isLive && c.endsAt && (
                <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-4">
                  <span className="eyebrow">Next milestone</span>
                  {toGo > 0 ? (
                    <p className="text-sm text-fg">
                      Reach the <Money minor={c.goalMinor} /> goal: <Money minor={toGo} className="text-gold" /> to go by <span className="num">{formatDay(c.endsAt)}</span>.
                    </p>
                  ) : (
                    <p className="text-sm text-fg">The goal is met. It's confirmed at the deadline, <span className="num">{formatDay(c.endsAt)}</span>.</p>
                  )}
                  <p className="text-xs text-muted">
                    {c.milestoneRelease
                      ? "When it's met, the first milestone payment is released and the rest follow as each milestone is verified."
                      : "When it's met, the money is released to your payout account."}{" "}
                    If it isn't, every backer is refunded in full automatically.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button asChild size="sm">
                  <Link to={page}>
                    {isLive ? "Manage campaign" : "View campaign"} <ArrowRight />
                  </Link>
                </Button>
                {isLive && (
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`${page}#share`}>
                      <Share2 /> Share link
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        <NextSteps steps={steps} payout={payout} />
      </div>

      {others.length > 0 && (
        <Card className="mt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your other campaigns</h2>
            <Link to="/creator/campaigns" className="text-sm font-medium text-gold hover:underline">
              All campaigns
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {others.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-1">
                  <Link to={`/creator/campaigns/${o.id}`} className="truncate text-sm font-medium text-fg hover:text-gold">
                    {o.title}
                  </Link>
                  <span className="num text-xs text-muted">
                    <Money minor={o.raisedMinor} /> of <Money minor={o.goalMinor} /> · {formatNumber(o.backers)} backers
                  </span>
                </div>
                <CampaignStatusChip status={o.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Container>
  );
}

function NextSteps({ steps, payout }: { steps: NextStep[]; payout: Payout }) {
  return (
    <Card className="flex flex-col gap-4" data-testid="next-steps">
      <h2 className="text-lg font-semibold">Next steps</h2>
      {payout.error && <p className="text-sm text-error" role="alert">{payout.error}</p>}
      {steps.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs you right now. We'll show what's next here as your campaigns move along.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {steps.map((t) => (
            <li key={t.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              {t.id === "payout" ? (
                <>
                  <span className="text-sm font-medium text-fg">{t.label}</span>
                  <p className="text-xs text-muted">{t.detail}</p>
                  <Button size="sm" className="mt-2 self-start" onClick={payout.start} disabled={payout.busy}>
                    <Landmark /> {payout.busy ? "Opening…" : "Set up payouts"}
                  </Button>
                </>
              ) : (
                <>
                  <Link to={t.to} className="text-sm font-medium text-fg hover:text-gold">
                    {t.label}
                  </Link>
                  <p className="text-xs text-muted">{t.detail}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Getting started ───────────────────────────────────── */

function NewCreator({ artist, payout }: { artist: MyArtist | null; payout: Payout }) {
  const hasProfile = !!artist;
  const cards = [
    {
      icon: <BadgeCheck />, t: "Create your artist profile", d: "Your name, city and genre, so fans know who they're backing.",
      to: "/artist-onboarding/basic", cta: hasProfile ? "Edit profile" : "Create profile", done: hasProfile,
    },
    { icon: <Megaphone />, t: "Launch your first campaign", d: "Set a goal, a deadline and the perks you'll deliver. Starter campaigns go up to $10K.", to: "/creator/campaigns/new/basics", cta: "Create campaign", done: false },
    { icon: <Gift />, t: "Share it with your fans", d: "Post your link everywhere your fans already are. The first week sets the pace.", to: "/creator/campaigns", cta: "Your campaigns", done: false },
  ];
  const steps = nextSteps(artist);
  return (
    <Container size="lg" className="py-8 sm:py-10" data-testid="dashboard-new">
      <PageHeader
        eyebrow={`Creator dashboard${artist ? ` · ${artist.tier} tier` : ""}`}
        title={artist ? `Welcome to FanZuP, ${artist.name.split(" ")[0]}` : "Welcome to FanZuP"}
        description="Three steps to your first backers. Your numbers show up here as soon as your first campaign is live."
      />
      <ol className="grid gap-4 md:grid-cols-3">
        {cards.map((s, i) => (
          <Card key={s.t} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <IconChip>{s.icon}</IconChip>
              <span className="num text-xs text-muted">{s.done ? "Done" : `0${i + 1}`}</span>
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{s.t}</h2>
              <p className="text-sm text-muted">{s.d}</p>
            </div>
            <Button asChild variant={i === (hasProfile ? 1 : 0) ? "primary" : "secondary"} size="sm" className="mt-auto self-start">
              <Link to={s.to}>{s.cta}</Link>
            </Button>
          </Card>
        ))}
      </ol>
      {artist && steps.some((s) => s.id === "payout") && (
        <div className="mt-6">
          <NextSteps steps={steps.filter((s) => s.id === "payout")} payout={payout} />
        </div>
      )}
      <div className="mt-12">
        <EmptyState icon={<Users />} title="No backers yet">
          Once your first campaign is live you'll see money raised, backers and time left here.
        </EmptyState>
      </div>
    </Container>
  );
}

function DashboardSkeleton() {
  return (
    <Container size="xl" className="py-8 sm:py-10" aria-busy="true" aria-label="Loading your dashboard">
      <div className="mb-8 h-16 w-2/3 animate-pulse rounded-md bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-lg border border-line bg-surface" />)}
      </div>
      <div className="mt-6 h-72 animate-pulse rounded-lg border border-line bg-surface" />
    </Container>
  );
}
