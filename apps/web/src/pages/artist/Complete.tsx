import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Landmark, Megaphone, PenSquare, TrendingUp } from "lucide-react";
import { ArtistArt, Badge, Button, Card, IconChip, WhenFlag } from "@/components/brand";
import { OutcomeHero, useDisplayDraft } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistComplete.tsx
 * Doc-driven changes: "Launch your first drop" → first reward campaign (Mechanism 05 first build);
 * added payouts step and a Rising teaser. The Rising link only shows with `layer2` because Rising
 * unlocks Layer 2 only (PRD 01 §6.3); otherwise the teaser avoids any investment language.
 */
const NEXT = [
  { icon: <Megaphone />, t: "Launch your first campaign", d: "Set a goal up to $10K, a deadline and the perks you'll deliver.", to: "/creator/campaigns/new/basics", cta: "Start a campaign" },
  { icon: <PenSquare />, t: "Post your first update", d: "Tell fans what you're working on. Profiles with a recent post get more follows.", to: "/creator/content/upload", cta: "Write a post" },
  { icon: <Landmark />, t: "Set up payouts", d: "Add the bank account where campaign funds and sales land.", to: "/creator/payouts", cta: "Add payout account" },
];

export default function Complete() {
  const { draft: d } = useDisplayDraft();
  return (
    <div className="flex flex-col gap-10">
      <OutcomeHero icon={<BadgeCheck />} tone="success" eyebrow="Profile published" title="You're live on FanZuP">
        Fans can now find, follow and back you. Own your art. Fund your future.
      </OutcomeHero>

      <Card padded={false} className="overflow-hidden">
        {d.bannerUrl ? <img src={d.bannerUrl} alt="" className="aspect-[4/1] w-full object-cover" /> : <ArtistArt seed={d.displayName + "-banner"} className="aspect-[4/1] w-full rounded-none" />}
        <div className="flex items-center gap-4 p-4 sm:p-6">
          {d.avatarUrl ? <img src={d.avatarUrl} alt="" className="size-14 shrink-0 rounded-full object-cover" /> : <ArtistArt seed={d.displayName} label={d.displayName} rounded="full" className="size-14 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{d.displayName}</p>
            <p className="truncate text-sm text-muted">{[d.genres.join(" · "), d.city].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge tone="success" icon={<BadgeCheck />}>
              Verified
            </Badge>
            <Badge tone="gold">Starter</Badge>
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Your next moves</h2>
        <ol className="flex flex-col gap-3">
          {NEXT.map((n, i) => (
            <li key={n.t}>
              <Card interactive padded={false}>
                <Link to={n.to} className="flex items-center gap-4 p-5">
                  <IconChip>{n.icon}</IconChip>
                  <div className="min-w-0 flex-1">
                    <span className="num text-xs text-muted">0{i + 1}</span>
                    <h3 className="font-semibold">{n.t}</h3>
                    <p className="text-sm text-muted">{n.d}</p>
                  </div>
                  <ArrowRight className="size-5 shrink-0 text-muted" aria-hidden />
                  <span className="sr-only">{n.cta}</span>
                </Link>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <Card elevated className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <IconChip tone="info">
          <TrendingUp />
        </IconChip>
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="font-semibold">Next tier: Rising</h2>
          <WhenFlag flag="layer2" fallback={<p className="text-sm text-muted">Grow to 1,000 monthly listeners and set up an LLC or EIN. We'll let you know when Rising opens.</p>}>
            <p className="text-sm text-muted">Rising adds revenue-share Pools. You'll need a business entity, a linked streaming profile, 1,000+ monthly listeners and 90 days of history.</p>
          </WhenFlag>
        </div>
        <WhenFlag flag="layer2">
          <Button asChild variant="secondary">
            <Link to="/tier/rising">See Rising requirements</Link>
          </Button>
        </WhenFlag>
      </Card>

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
        <Button asChild size="lg">
          <Link to="/creator">
            Go to your dashboard <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
