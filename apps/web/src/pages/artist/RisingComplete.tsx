import { Link } from "react-router";
import { ArrowRight, TrendingUp } from "lucide-react";
import { Badge, Button, Card, KeyValue } from "@/components/brand";
import { DEMO_RISING, OutcomeHero, PoolsAvailabilityNotice, useRising } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-tier2/Tier2Complete.tsx
 * Doc-driven changes: "TIER 2 UNLOCKED / Welcome to Pro!" → Rising (Brand §7.5; Pro is a separate,
 * higher tier). Removed equity crowdfunding, institutional network and labels intro (not in PRD 01).
 * Pools availability note and campaign-time reassessment added (PRD 01 §6.3).
 */
export default function RisingComplete() {
  const r = useRising();
  const business = r.business ?? DEMO_RISING.business;
  const streaming = r.streaming ?? DEMO_RISING.streaming;

  return (
    <div className="flex flex-col gap-8">
      <OutcomeHero icon={<TrendingUp />} tone="gold" eyebrow={<>Rising unlocked <span className="text-muted">· Tier 2</span></>} title={<>You're <span className="text-gold">Rising.</span></>}>
        You've met every Rising requirement. Your business is set up for revenue-share Pools.
      </OutcomeHero>

      <Card className="flex flex-col gap-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">What we confirmed</h2>
          <Badge tone="success">All met</Badge>
        </div>
        <div className="divide-y divide-line">
          <KeyValue k="Business" v={<>{business.legalName} · <span className="num">EIN ••{business.einLast4}</span></>} />
          <KeyValue k="Monthly listeners" v={<span className="num">{streaming.monthlyListeners.toLocaleString()}</span>} />
          <KeyValue k="Release history" v={<span className="num">{streaming.historyDays} days</span>} />
          <KeyValue k="Source" v={streaming.platform} />
        </div>
      </Card>

      <PoolsAvailabilityNotice />

      <Card elevated className="flex flex-col gap-2 p-5">
        <h2 className="font-semibold">Keep your numbers up</h2>
        <p className="text-sm text-muted">
          Tier requirements are checked again each time you create a campaign or Pool. If your listeners dip below the threshold, you can still run
          Starter campaigns while you build back.
        </p>
      </Card>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="secondary" size="lg">
          <Link to="/creator/campaigns/new/basics">Start a reward campaign</Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/creator">
            Go to your dashboard <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
