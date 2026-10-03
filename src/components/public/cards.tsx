/**
 * Shared discovery cards for the public area (Explore, Artist profile, onboarding Discover).
 * Layer 1 campaign card and artist card; Pool card is only ever rendered behind `layer2`.
 */
import { Link } from "react-router";
import { BadgeCheck, MapPin, Users } from "lucide-react";
import { ArtistArt, Badge, Card, FundingProgress, ProgressBar } from "@/components/brand";
import { artistById, type Artist, type Campaign, type CreatorTier, type Pool } from "@/lib/mock";
import { daysUntil, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TierBadge({ tier, className }: { tier: CreatorTier; className?: string }) {
  return (
    <Badge tone={tier === "Starter" ? "neutral" : "gold"} className={className}>
      {tier}
    </Badge>
  );
}

export function VerifiedBadge() {
  return (
    <Badge tone="success" icon={<BadgeCheck />}>
      Verified
    </Badge>
  );
}

export function CampaignCard({ campaign: c, className }: { campaign: Campaign; className?: string }) {
  const a = artistById(c.artistId);
  return (
    <Card padded={false} interactive className={cn("overflow-hidden", className)}>
      <Link to={`/campaigns/${c.id}`} className="flex h-full flex-col focus:outline-none">
        <ArtistArt seed={a.id} label={a.name} className="aspect-[16/10] w-full rounded-none" />
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{c.type}</Badge>
            {c.status === "funded" && <Badge tone="success">Funded</Badge>}
            {c.milestoneRelease && <Badge tone="info">Milestone release</Badge>}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold leading-snug">{c.title}</h3>
            <p className="text-sm text-muted">
              {a.name} · {a.city}
            </p>
          </div>
          <FundingProgress className="mt-auto" raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={daysUntil(c.endsOn)} />
        </div>
      </Link>
    </Card>
  );
}

export function ArtistCard({ artist: a, action, className }: { artist: Artist; action?: React.ReactNode; className?: string }) {
  return (
    <Card padded={false} interactive className={cn("flex flex-col overflow-hidden", className)}>
      <Link to={`/artist/${a.id}`} className="flex flex-1 flex-col focus:outline-none">
        <ArtistArt seed={a.id} label={a.name} className="aspect-square w-full rounded-none" />
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-base font-semibold">{a.name}</h3>
            {a.verified && <BadgeCheck className="size-4 shrink-0 text-success" aria-label="Verified" />}
          </div>
          <p className="text-sm text-muted">{a.genre}</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            <MapPin className="size-3" /> {a.city}
          </p>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <TierBadge tier={a.tier} />
            <span className="flex items-center gap-1 text-xs text-muted" title="Subscribers">
              <Users className="size-3" aria-hidden />
              <span className="num text-fg">{formatNumber(a.subscribers, true)}</span>
              <span className="sr-only">subscribers</span>
            </span>
          </div>
        </div>
      </Link>
      {action && <div className="px-4 pb-4">{action}</div>}
    </Card>
  );
}

/** Layer 2 only. Shows funding progress — never expected payouts, never ranked by them. */
export function PoolCard({ pool: p }: { pool: Pool }) {
  const a = artistById(p.artistId);
  const pct = Math.round((p.raisedMinor / p.targetMinor) * 100);
  return (
    <Card padded={false} interactive className="overflow-hidden">
      <Link to={`/pools/${p.id}`} className="flex h-full flex-col gap-4 p-5 focus:outline-none">
        <div className="flex items-center gap-3">
          <ArtistArt seed={a.id} label={a.name} rounded="md" className="size-12" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{p.title}</p>
            <p className="text-sm text-muted">{a.name}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="info">{p.kind} Pool</Badge>
          <Badge tone="warning">Reg CF · 12-month lock-up</Badge>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="num font-medium">{formatMoney(p.raisedMinor)}</span>
            <span className="num text-muted">{pct}%</span>
          </div>
          <ProgressBar value={p.raisedMinor} max={p.targetMinor} tone="info" label="Pool funding progress" />
          <p className="text-xs text-muted">
            of <span className="num">{formatMoney(p.targetMinor)}</span> target · <span className="num">{formatMoney(p.unitPriceMinor)}</span> per Unit
          </p>
        </div>
      </Link>
    </Card>
  );
}
