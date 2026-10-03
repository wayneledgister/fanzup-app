import { Link } from "react-router";
import { ArrowRight, Building2, ChartPie, Music2, Users } from "lucide-react";
import { Badge, Button, Card, IconChip } from "@/components/brand";
import { PoolsAvailabilityNotice, RISING_STEPS, RequirementsChecklist, WizardFooter, risingRequirements, useRising } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-tier2/Tier2Intro.tsx
 * Doc-driven changes: "Tier 2 – Professional" → Rising (Brand §7.5). Gates replaced with PRD 01 §6.3
 * (EIN/LLC, streaming linked, ≥1,000 monthly listeners, 90 days history) — the wireframe's 5,000
 * listeners and 1,000 social followers are not doc gates. "Equity crowdfunding", "institutional investor
 * network" and "priority support" unlocks removed (not in PRD); Pools availability note added.
 */
const STEP_ICONS = [<Building2 key="b" />, <Music2 key="m" />, <Users key="u" />];
const STEP_COPY = ["EIN and legal name", "Listeners and release history", "Optional socials, then submit"];

export default function RisingIntro() {
  const rising = useRising();
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow text-gold">Tier upgrade</span>
        <h1 className="text-3xl font-bold sm:text-4xl">Level up to Rising</h1>
        <p className="text-base text-muted">
          You've built a real audience. Rising lets you offer fans a share of your revenue through Pools, on top of everything Starter gives you.
        </p>
      </header>

      <Card className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Current</span>
          <span className="text-lg font-semibold">Starter</span>
          <span className="text-xs text-muted">Tier 1</span>
        </div>
        <ArrowRight className="size-5 text-muted" aria-label="upgrading to" />
        <div className="flex flex-col gap-1 text-right">
          <span className="eyebrow text-gold">Upgrading to</span>
          <span className="text-lg font-semibold text-gold">Rising</span>
          <span className="text-xs text-muted">Tier 2</span>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">What Rising adds</h2>
        <Card className="flex gap-4">
          <IconChip>
            <ChartPie />
          </IconChip>
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Revenue-share Pools</h3>
              <Badge tone="info">Coming soon</Badge>
            </div>
            <p className="text-sm text-muted">Offer fans Units in a Pool tied to a project or your catalog, with terms you set and a return cap and maturity date fans can see up front.</p>
          </div>
        </Card>
        <p className="text-sm text-muted">You keep reward campaigns, subscriptions, merch, tickets and live streams.</p>
        <PoolsAvailabilityNotice />
      </section>

      <RequirementsChecklist tier="Rising" title="Requirements" items={risingRequirements(rising)} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Three quick steps</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {RISING_STEPS.map((s, i) => (
            <li key={s}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <IconChip tone="muted">{STEP_ICONS[i]}</IconChip>
                  <span className="num text-xs text-muted">0{i + 1}</span>
                </div>
                <div>
                  <h3 className="font-semibold">{s}</h3>
                  <p className="text-sm text-muted">{STEP_COPY[i]}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <WizardFooter backTo="/creator" backLabel="Maybe later">
        <Button asChild size="lg">
          <Link to="/tier/rising/business">
            Start upgrade <ArrowRight />
          </Link>
        </Button>
      </WizardFooter>
    </div>
  );
}
