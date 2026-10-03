import { Link } from "react-router";
import { ArrowRight, BadgeCheck, CalendarClock, Check, Gift, Lock, Megaphone, Milestone, RotateCcw, ShieldCheck, Sparkles, Target, Users } from "lucide-react";
import { Badge, Button, Callout, Card, Container, IconChip, SectionHeading } from "@/components/brand";
import { cn } from "@/lib/utils";
import { TIERS, tier, type TierName } from "@/config/tiers";
import { formatMoney } from "@/lib/format";

/**
 * Source: (new) artist value prop + creator tier table from PRD 01 §6.3 (via docs/CONSOLIDATION.md).
 * Doc-driven notes: Layer 1 only — campaigns are perks-for-backing, no securities. Rising+ Reg CF features
 * are marked "Coming later". Established / Pro criteria come from PRD 01 §6.3 via @/config/tiers (council D1); previously
 * they're described qualitatively rather than with invented thresholds. Rising thresholds follow
 * CONSOLIDATION.md (≥1k listeners, 90-day history), not the wireframe's 5,000.
 */

/** Gates and caps come from @/config/tiers (PRD 01 §6.3) — council D1 Blocker 1. Copy below is launch-availability only. */
const LAUNCH: Record<TierName, { available: boolean; cap: string; unlocks: string[]; later: string[] }> = {
  Starter: {
    available: true,
    cap: `Campaign goals up to ${formatMoney(tier("Starter").campaignCapMinor)}`,
    unlocks: ["Reward campaigns with perks", "Escrow-protected backing with auto-refunds", "Subscriptions, merch, tickets and live streams"],
    later: [],
  },
  Rising: {
    available: true,
    cap: `Campaign goals up to ${formatMoney(tier("Rising").campaignCapMinor)}`,
    unlocks: ["Larger reward campaigns", "Milestone-based releases for bigger projects", "Rising badge on your profile"],
    later: [`Revenue-share Pools under Regulation Crowdfunding, up to ${formatMoney(tier("Rising").regCfCapMinor!, { compact: true })} per 12 months`],
  },
  Established: {
    available: false,
    cap: `Reg CF raises up to ${formatMoney(tier("Established").regCfCapMinor!, { compact: true })} per 12 months`,
    unlocks: ["Everything in Rising"],
    later: ["Equity, publishing and sync participation offerings", "Dedicated onboarding manager for your Form C"],
  },
  Pro: {
    available: false,
    cap: `Reg CF raises up to ${formatMoney(tier("Pro").regCfCapMinor!, { compact: true })} per 12 months, across all Reg CF offerings`,
    unlocks: ["Everything in Established"],
    later: ["Hybrid offerings with white-glove compliance support", "Investor-relations tools"],
  },
};

const TIER_CARDS = TIERS.map((t, i) => ({
  name: t.name,
  ...LAUNCH[t.name],
  requires: i === 0 ? t.gates : [`Everything in ${TIERS[i - 1].name}`, ...t.gates],
}));

export default function ForArtists() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-[-10%] h-[480px] w-[480px] rounded-full bg-gold/10 blur-[120px]" />
        <Container size="xl" className="relative grid gap-12 py-16 sm:py-24 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div className="flex flex-col gap-6">
            <span className="eyebrow text-gold">For artists</span>
            <h1 className="text-4xl font-bold leading-[1.05] sm:text-6xl">
              Own your art.
              <br />
              <span className="text-gold">Fund your future.</span>
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Raise money for the album, the tour, the video — from the fans who already believe in you. Keep your masters, keep your
              rights, and give back with perks they actually want.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to="/signup?role=artist">
                  Start your artist account <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <a href="#tiers">See creator tiers</a>
              </Button>
            </div>
          </div>
          <Card className="flex flex-col gap-5 p-8">
            {[
              { icon: <ShieldCheck />, t: "Escrow-backed", d: "Fans' money is held by our escrow partner until you hit your goal." },
              { icon: <Gift />, t: "Perks, not paperwork", d: "You choose what backers get. No equity, no revenue split in a reward campaign." },
              { icon: <Users />, t: "Your fans, direct", d: "Subscriptions, merch, tickets and streams in the same place as your campaigns." },
            ].map((x) => (
              <div key={x.t} className="flex gap-4">
                <IconChip>{x.icon}</IconChip>
                <div>
                  <h2 className="font-semibold">{x.t}</h2>
                  <p className="text-sm text-muted">{x.d}</p>
                </div>
              </div>
            ))}
          </Card>
        </Container>
      </section>

      {/* How campaigns work */}
      <section className="py-16 sm:py-24">
        <Container size="xl">
          <SectionHeading eyebrow="How campaigns work" title="All-or-nothing, with a safety net for your fans" />
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: <Target />, t: "Set a goal and a deadline", d: "Pick the amount the project needs and how long you'll run. Add the perks you'll deliver, with limits if supply is tight." },
              { icon: <Megaphone />, t: "Share it with your fans", d: "Fans back you by choosing a perk. Their payment goes straight into escrow — not to you, not to us." },
              { icon: <CalendarClock />, t: "Hit the goal by the deadline", d: "Reach it and the funds are released for your project. Miss it and every backer is refunded automatically." },
              { icon: <Sparkles />, t: "Deliver and post updates", d: "Ship perks, post progress, and keep backers in the loop. Fulfillment is tracked on both sides." },
            ].map((s, i) => (
              <li key={s.t}>
                <Card className="flex h-full flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <IconChip>{s.icon}</IconChip>
                    <span className="num text-sm text-muted">0{i + 1}</span>
                  </div>
                  <h3 className="text-lg font-semibold">{s.t}</h3>
                  <p className="text-sm text-muted">{s.d}</p>
                </Card>
              </li>
            ))}
          </ol>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Callout tone="info" icon={<Milestone />} title="Bigger project? Use milestone release">
              Funds can be released in stages as you hit milestones you define up front — it gives backers confidence on larger raises.
            </Callout>
            <Callout tone="gold" icon={<RotateCcw />} title="What a reward campaign is not">
              Backers receive perks. They don't get a share of your earnings, ownership, or any say over your music.
            </Callout>
          </div>
        </Container>
      </section>

      {/* Tiers */}
      <section id="tiers" className="scroll-mt-20 border-y border-line bg-surface/40 py-16 sm:py-24">
        <Container size="xl">
          <SectionHeading eyebrow="Creator tiers" title="Grow your tier as your fanbase grows" />
          <p className="mb-10 max-w-2xl text-muted">
            Every artist starts at Starter. Each tier unlocks bigger campaigns once you meet its requirements. At launch, FanZuP supports
            reward campaigns only — securities features are marked <em>Coming later</em>.
          </p>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {TIER_CARDS.map((t) => (
              <Card key={t.name} className={cn("flex flex-col gap-5", t.name === "Starter" && "border-gold/40")}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">{t.name}</h3>
                  {t.name === "Starter" ? <Badge tone="gold">Start here</Badge> : t.available ? <Badge tone="neutral">Upgrade</Badge> : <Badge tone="neutral">Coming later</Badge>}
                </div>
                <p className="num text-sm text-gold">{t.cap}</p>
                <div className="flex flex-col gap-2">
                  <p className="eyebrow">Requirements</p>
                  <ul className="flex flex-col gap-2 text-sm text-muted">
                    {t.requires.map((r) => (
                      <li key={r} className="flex gap-2">
                        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-muted" /> {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="eyebrow">Unlocks at launch</p>
                  <ul className="flex flex-col gap-2 text-sm">
                    {t.unlocks.map((r) => (
                      <li key={r} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" /> {r}
                      </li>
                    ))}
                  </ul>
                </div>
                {t.later.length > 0 && (
                  <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
                    <p className="eyebrow">Coming later</p>
                    <ul className="flex flex-col gap-2 text-sm text-muted">
                      {t.later.map((r) => (
                        <li key={r} className="flex gap-2">
                          <Lock className="mt-0.5 size-4 shrink-0" /> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted">
            Pools are not available yet. When they launch they'll be offered through a registered intermediary under Regulation
            Crowdfunding, with their own disclosures and limits.
          </p>
        </Container>
      </section>

      {/* Fees + CTA */}
      <section className="py-16 sm:py-24">
        <Container size="lg" className="grid gap-6 md:grid-cols-2">
          <Card className="flex flex-col gap-3 p-8">
            <h2 className="text-2xl font-bold">What it costs</h2>
            <p className="text-muted">
              Card processing is passed through at cost. Our platform fees are being finalized and will be shown to you before you launch —
              never added after the fact.
            </p>
            <Link to="/fees" className="mt-auto text-sm font-medium text-gold hover:underline">
              See the fee breakdown →
            </Link>
          </Card>
          <Card className="flex flex-col gap-3 p-8">
            <h2 className="text-2xl font-bold">Ready when you are</h2>
            <p className="text-muted">Verify your identity, link a released track and you can launch a Starter campaign.</p>
            <Button asChild className="mt-auto w-fit">
              <Link to="/signup?role=artist">Create your artist account</Link>
            </Button>
          </Card>
        </Container>
      </section>
    </>
  );
}
