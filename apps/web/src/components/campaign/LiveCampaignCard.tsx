/** Campaign card for API data (FR-CMP-008). Renders only what the campaign actually has. */
import { Link } from "react-router";
import { ArtistArt, Badge, Card, FundingProgress } from "@/components/brand";
import type { CampaignCard } from "@/lib/api";
import { cn } from "@/lib/utils";

export const daysLeft = (endsAt: string | null) => (endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 86_400_000)) : undefined);

export function LiveCampaignCard({ campaign: c, className }: { campaign: CampaignCard; className?: string }) {
  const live = c.status === "live";
  return (
    <Card padded={false} interactive className={cn("overflow-hidden", className)}>
      <Link to={`/campaigns/${c.slug}`} className="flex h-full flex-col focus:outline-none" data-testid="campaign-card">
        <ArtistArt seed={c.artist.slug} label={c.artist.name} className="aspect-[16/10] w-full rounded-none" />
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{c.type}</Badge>
            {!live && <Badge tone="success">Funded</Badge>}
            {c.milestoneRelease && <Badge tone="info">Milestone release</Badge>}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold leading-snug">{c.title}</h3>
            <p className="text-sm text-muted">
              {c.artist.name}
              {c.artist.city ? ` · ${c.artist.city}` : ""}
            </p>
          </div>
          <FundingProgress className="mt-auto" raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={live ? daysLeft(c.endsAt) : undefined} />
        </div>
      </Link>
    </Card>
  );
}
