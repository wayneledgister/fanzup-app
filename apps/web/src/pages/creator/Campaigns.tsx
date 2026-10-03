import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, Megaphone, Plus } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, EmptyState, FundingProgress, Money, PageHeader } from "@/components/brand";
import { CampaignStatusChip, Segmented, formatDay } from "@/components/creator/ui";
import { ME, creatorCampaigns, type CreatorCampaign, type CreatorCampaignStatus } from "@/components/creator/data";
import { daysUntil } from "@/lib/format";

/**
 * Source: new screen (no wireframe) — list of the creator's reward campaigns.
 * Statuses follow Mechanism 05: Draft → In review → Live → Funded / Refunded (goal missed, auto-refund) → Ended.
 * Empty state reachable via `?state=empty`.
 */
type Filter = "all" | "active" | "closed";
const ACTIVE: CreatorCampaignStatus[] = ["draft", "review", "live"];

export default function Campaigns() {
  const [params] = useSearchParams();
  const list = params.get("state") === "empty" ? [] : creatorCampaigns;
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(
    () => list.filter((c) => (filter === "all" ? true : filter === "active" ? ACTIVE.includes(c.status) : !ACTIVE.includes(c.status))),
    [filter, list],
  );

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Campaigns"
        title="Your campaigns"
        description="Reward campaigns are all-or-nothing. Backers' money waits with our escrow partner until you hit your goal."
        actions={
          <Button asChild>
            <Link to="/creator/campaigns/new/basics">
              <Plus /> New campaign
            </Link>
          </Button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="You haven't started a campaign yet"
          action={
            <Button asChild>
              <Link to="/creator/campaigns/new/basics">
                <Plus /> Start your first campaign
              </Link>
            </Button>
          }
        >
          Pick a goal, a deadline and the perks you'll deliver. Our compliance team reviews every campaign before it goes live.
        </EmptyState>
      ) : (
        <>
          <Segmented
            label="Filter campaigns"
            className="mb-6"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: list.length },
              { value: "active", label: "In progress", count: list.filter((c) => ACTIVE.includes(c.status)).length },
              { value: "closed", label: "Closed", count: list.filter((c) => !ACTIVE.includes(c.status)).length },
            ]}
          />
          <ul className="flex flex-col gap-4">
            {shown.map((c) => (
              <li key={c.id}>
                <CampaignRow c={c} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Container>
  );
}

function statusLine(c: CreatorCampaign) {
  switch (c.status) {
    case "draft":
      return <>Last edited {formatDay(c.statusDate)}</>;
    case "review":
      return <>Submitted {formatDay(c.statusDate)} · our compliance team is reviewing it</>;
    case "live":
      return <>Ends {formatDay(c.endsOn)} · <span className="num">{daysUntil(c.endsOn)}</span> days left</>;
    case "funded":
      return <>Funded {formatDay(c.statusDate)} · perks being delivered</>;
    case "ended":
      return <>Closed {formatDay(c.statusDate)} · all perks delivered</>;
    case "refunded":
      return <>Goal missed {formatDay(c.statusDate)} · every backer refunded automatically</>;
  }
}

function CampaignRow({ c }: { c: CreatorCampaign }) {
  const to = c.status === "draft" ? "/creator/campaigns/new/basics" : `/creator/campaigns/${c.id}`;
  const hasMoney = c.raisedMinor > 0;
  return (
    <Card padded={false} interactive className="overflow-hidden">
      <Link to={to} className="grid gap-0 sm:grid-cols-[160px_1fr]">
        <ArtistArt seed={`${ME.id}-${c.id}`} label={c.title} className="hidden h-full min-h-32 w-full rounded-none sm:flex" />
        <div className="grid gap-5 p-5 md:grid-cols-[1fr_280px] md:items-center md:gap-8">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CampaignStatusChip status={c.status} />
              <Badge>{c.type}</Badge>
            </div>
            <h2 className="text-lg font-semibold">{c.title}</h2>
            <p className="text-sm text-muted">{statusLine(c)}</p>
          </div>
          <div className="flex flex-col gap-3">
            {hasMoney ? (
              <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} />
            ) : (
              <div className="flex flex-col gap-1 text-sm">
                <span className="eyebrow">Goal</span>
                <Money minor={c.goalMinor} className="text-lg text-fg" />
              </div>
            )}
            <span className="flex items-center gap-1 text-sm font-medium text-gold">
              {c.status === "draft" ? "Continue editing" : c.status === "live" ? "Manage campaign" : "View details"} <ArrowRight className="size-4" />
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
