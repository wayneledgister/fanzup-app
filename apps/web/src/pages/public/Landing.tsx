import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Compass, Gift, HandCoins, Megaphone, RotateCcw, ShieldCheck, Sparkles, Users } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, FundingProgress, IconChip, SectionHeading } from "@/components/brand";
import { LiveCampaignCard, daysLeft } from "@/components/campaign/LiveCampaignCard";
import { api, type CampaignCard } from "@/lib/api";
import { REFUND_PROMISE } from "@fanzup/shared/backing-copy";

/**
 * Source: Fan Profile Setup LandingPage.tsx (wireframe) → Brand §9 web platform.
 * Changes: Pools → reward campaigns for Layer 1 launch (Mechanism 05); "SEC Registered" /
 * "Contract Verified" trust badges removed (Brand §7.4) and replaced with the refund promise;
 * stats row removed until live figures exist (Brand §10).
 * CR-006 (FR-CMP-009, FR-PLT-002, ADR-011): the featured campaign and the "Live now" rail read the public
 * `GET /campaigns?tab=live` (ending soonest, never by money; FR-CMP-008). No live campaign → a call to action.
 * FR-PLT-006: no screen names a custodian or says "escrow" while none is live.
 */
type LiveState = { status: "loading" } | { status: "ready"; items: CampaignCard[] } | { status: "error" };

export default function Landing() {
  const [live, setLive] = useState<LiveState>({ status: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    api.campaigns({ tab: "live" }, ctl.signal)
      .then((r) => !ctl.signal.aborted && setLive({ status: "ready", items: r.campaigns }))
      .catch(() => !ctl.signal.aborted && setLive({ status: "error" }));
    return () => ctl.abort();
  }, []);
  const items = live.status === "ready" ? live.items : [];
  const hero = items[0];

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-gold/10 blur-[120px]" />
        <Container size="xl" className="relative grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col gap-6">
            <span className="eyebrow text-gold">Direct-to-fan funding for independent artists</span>
            <h1 className="font-display text-5xl font-bold leading-[1.02] sm:text-6xl lg:text-7xl">
              <span className="block text-fg">FUND THE CULTURE.</span>
              <span className="block text-gold">OWN THE FUTURE.</span>
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Back the artists you believe in and get real perks: tickets, vinyl, access, your name in the credits. Artists raise money for
              the work without signing their rights away.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to="/explore">
                  Find artists to back <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/for-artists">Start a campaign</Link>
              </Button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <li className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-gold" /> All-or-nothing campaigns
              </li>
              <li className="flex items-center gap-2">
                <RotateCcw className="size-4 text-gold" /> Automatic refunds if a goal is missed
              </li>
              <li className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-gold" /> Identity-verified artists
              </li>
            </ul>
          </div>

          {/* Featured campaign: the live campaign ending soonest */}
          {live.status === "loading" && <div className="aspect-[4/3] w-full animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading the featured campaign" />}
          {hero && <FeaturedCampaign c={hero} />}
          {live.status !== "loading" && !hero && (
            <Card className="flex flex-col items-start gap-4 p-8" data-testid="featured-empty">
              <IconChip><Compass /></IconChip>
              <h2 className="text-2xl font-bold">{live.status === "error" ? "Live campaigns are a click away" : "New campaigns are on the way"}</h2>
              <p className="text-sm text-muted">
                {live.status === "error"
                  ? "We couldn't load the featured campaign just now. Browse every live campaign instead."
                  : "Every campaign is reviewed before it goes live. Browse recently funded ones, or start your own."}
              </p>
              <Button asChild variant="secondary">
                <Link to={live.status === "error" ? "/explore" : "/explore?tab=funded"}>Browse campaigns <ArrowRight /></Link>
              </Button>
            </Card>
          )}
        </Container>
      </section>

      {/* ── Live campaigns ── */}
      {items.length > 1 && (
        <section className="py-16 sm:py-24">
          <Container size="xl">
            <SectionHeading
              eyebrow="Live now"
              title="Campaigns you can back today"
              action={
                <Link to="/explore" className="hidden items-center gap-1 text-sm font-medium text-gold hover:underline sm:flex">
                  See all <ArrowRight className="size-4" />
                </Link>
              }
            />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {items.slice(1, 4).map((c) => <LiveCampaignCard key={c.id} campaign={c} />)}
            </div>
          </Container>
        </section>
      )}

      {/* ── How it works ── */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-line bg-surface/40 py-16 sm:py-24">
        <Container size="xl" className="grid gap-12 lg:grid-cols-2">
          <HowColumn
            eyebrow="For fans"
            title="Back the come-up."
            steps={[
              { icon: <Users />, t: "Follow artists you love", d: "Discover independent artists by sound, city and scene." },
              { icon: <HandCoins />, t: "Back a campaign", d: "Pick a perk. If the goal isn't met by the deadline, you're refunded in full." },
              { icon: <Gift />, t: "Get your perks", d: "Tickets, vinyl, access, credits. Track every one from your account." },
            ]}
            cta={{ to: "/signup", label: "Join as a fan" }}
          />
          <HowColumn
            eyebrow="For artists"
            title="Own your art. Fund your future."
            steps={[
              { icon: <BadgeCheck />, t: "Get verified", d: "Confirm your identity and link a released track to unlock Starter." },
              { icon: <Megaphone />, t: "Launch a campaign", d: "Set a goal, a deadline and the perks you'll deliver." },
              { icon: <Sparkles />, t: "Fund the work", d: "Hit your goal and the money is released to you, in stages if you set milestones." },
            ]}
            cta={{ to: "/for-artists", label: "See how it works for artists" }}
          />
        </Container>
      </section>

      {/* ── Refund promise (FR-PLT-006) ── */}
      <section className="py-16 sm:py-24">
        <Container size="lg">
          <Card className="grid gap-8 p-8 sm:p-12 md:grid-cols-[auto_1fr] md:items-center">
            <IconChip className="size-16 [&_svg]:size-8">
              <ShieldCheck />
            </IconChip>
            <div className="flex flex-col gap-3">
              <h2 className="text-3xl font-bold">{REFUND_PROMISE.title}.</h2>
              <p className="text-muted">
                Every campaign is all-or-nothing. {REFUND_PROMISE.compact} If it is, the artist receives the money, in stages when the
                campaign has milestones.
              </p>
              <Link to="/trust" className="text-sm font-medium text-gold hover:underline">
                How money moves on FanZuP →
              </Link>
            </div>
          </Card>
        </Container>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-line py-20">
        <Container size="md" className="flex flex-col items-center gap-6 text-center">
          <h2 className="text-4xl font-bold sm:text-5xl">
            Your fans are ready. <span className="text-gold">Are you?</span>
          </h2>
          <p className="max-w-lg text-muted">Start with a Starter tier campaign up to $10K. Grow your tier as your fanbase grows.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/signup">Create your account</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/explore">Browse campaigns</Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}

function HowColumn({ eyebrow, title, steps, cta }: { eyebrow: string; title: string; steps: { icon: React.ReactNode; t: string; d: string }[]; cta: { to: string; label: string } }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="eyebrow text-gold">{eyebrow}</span>
        <h2 className="text-3xl font-bold sm:text-4xl">{title}</h2>
      </div>
      <ol className="flex flex-col gap-6">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-4">
            <IconChip>{s.icon}</IconChip>
            <div className="flex flex-col gap-1">
              <span className="num text-xs text-muted">0{i + 1}</span>
              <h3 className="text-lg font-semibold">{s.t}</h3>
              <p className="text-sm text-muted">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link to={cta.to} className="flex items-center gap-1 text-sm font-medium text-gold hover:underline">
        {cta.label} <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

function FeaturedCampaign({ c }: { c: CampaignCard }) {
  return (
    <Card padded={false} interactive className="overflow-hidden">
      <Link to={`/campaigns/${c.slug}`} className="block focus:outline-none" data-testid="featured-campaign">
        <div className="relative">
          <ArtistArt seed={c.artist.slug} label={c.artist.name} rounded="md" className="aspect-[4/3] w-full rounded-none" />
          <div className="absolute inset-0 bg-scrim" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-6">
            <div className="flex gap-2">
              <Badge tone="gold">{c.type}</Badge>
              {c.milestoneRelease && <Badge tone="info">Milestone release</Badge>}
            </div>
            <h2 className="text-2xl font-bold">{c.title}</h2>
            <p className="text-sm text-muted">{[c.artist.name, c.artist.genre, c.artist.city].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="p-6">
          <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={daysLeft(c.endsAt)} />
        </div>
      </Link>
    </Card>
  );
}
