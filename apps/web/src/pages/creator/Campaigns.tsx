import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Megaphone, Plus, RefreshCw, UserPlus, WifiOff } from "lucide-react";
import { RequireAccount } from "@/components/RequireAccount";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, FundingProgress, Money, PageHeader } from "@/components/brand";
import { CampaignStatusChip, Segmented, formatDay } from "@/components/creator/ui";
import { useMyArtist } from "@/components/creator/live";
import { daysLeft } from "@/components/campaign/LiveCampaignCard";
import { isInProgress } from "@fanzup/shared/artist-home";
import { POLICY } from "@fanzup/shared/policy";
import type { MyCampaignSummary } from "@fanzup/shared/schemas";

/**
 * Source: new screen (no wireframe): the creator's reward campaigns.
 * CR-006 (FR-CMP-009, ADR-011): reads `GET /artist`; statuses are the database's (draft → in review → approved →
 * live → funded / goal missed → closed). FR-PLT-006: no "escrow" wording.
 */
type Filter = "all" | "active" | "closed";

/** FR-ID-005: signed in with a confirmed email; the API enforces the same (verified + owner). */
export default function CampaignsPage() {
  return (
    <RequireAccount>
      <Campaigns />
    </RequireAccount>
  );
}

function Campaigns() {
  const [state, reload] = useMyArtist();
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMemo(() => (state.status === "ready" ? state.data.campaigns.filter((c) => c.status !== "withdrawn") : []), [state]);
  const shown = useMemo(
    () => list.filter((c) => (filter === "all" ? true : filter === "active" ? isInProgress(c.status) : !isInProgress(c.status))),
    [filter, list],
  );

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Campaigns"
        title="Your campaigns"
        description="Reward campaigns are all-or-nothing. If a goal isn't met by the deadline, every backer is refunded in full automatically."
        actions={
          state.status === "ready" && (
            <Button asChild>
              <Link to="/creator/campaigns/new/basics">
                <Plus /> New campaign
              </Link>
            </Button>
          )
        }
      />

      {state.status === "loading" && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your campaigns">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-36 animate-pulse rounded-lg border border-line bg-surface" />)}
        </div>
      )}

      {state.status === "error" && (
        <Callout tone="error" icon={<WifiOff />} title="We couldn't load your campaigns">
          Check your connection and try again.{" "}
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCw /> Retry
          </Button>
        </Callout>
      )}

      {state.status === "missing" && (
        <EmptyState
          icon={<UserPlus />}
          title="Create your artist profile first"
          action={
            <Button asChild>
              <Link to="/artist-onboarding/basic">Create profile</Link>
            </Button>
          }
        >
          Campaigns belong to an artist profile, so fans know who they're backing.
        </EmptyState>
      )}

      {state.status === "ready" && list.length === 0 && (
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
          Pick a goal, a deadline and the perks you'll deliver. Our team reviews every campaign before it goes live.
        </EmptyState>
      )}

      {list.length > 0 && (
        <>
          <Segmented
            label="Filter campaigns"
            className="mb-6"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: list.length },
              { value: "active", label: "In progress", count: list.filter((c) => isInProgress(c.status)).length },
              { value: "closed", label: "Closed", count: list.filter((c) => !isInProgress(c.status)).length },
            ]}
          />
          <ul className="flex flex-col gap-4" data-testid="campaign-list">
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

function statusLine(c: MyCampaignSummary) {
  switch (c.status) {
    case "draft":
      return <>Last edited {formatDay(c.updatedAt)}</>;
    case "in_review":
      return <>Submitted {formatDay(c.updatedAt)} · our team is reviewing it, {POLICY.campaign.reviewEstimate}</>;
    case "revisions_requested":
      return <>Our reviewers asked for changes</>;
    case "approved":
      return <>Approved · publish it to start the clock</>;
    case "live": {
      const d = daysLeft(c.endsAt);
      return c.endsAt ? <>Ends {formatDay(c.endsAt)} · <span className="num">{d}</span> {d === 1 ? "day" : "days"} left</> : <>Live</>;
    }
    case "funded":
    case "released":
      return <>Goal met{c.endsAt ? ` ${formatDay(c.endsAt)}` : ""} · perks being delivered</>;
    case "failed":
    case "refunded":
      return <>Goal missed{c.endsAt ? ` ${formatDay(c.endsAt)}` : ""} · every backer refunded in full automatically</>;
    default:
      return <>Closed{c.endsAt ? ` ${formatDay(c.endsAt)}` : ""}</>;
  }
}

function CampaignRow({ c }: { c: MyCampaignSummary }) {
  const hasMoney = c.raisedMinor > 0;
  return (
    <Card padded={false} interactive className="overflow-hidden">
      <Link to={`/creator/campaigns/${c.id}`} className="grid gap-0 sm:grid-cols-[160px_1fr]">
        <ArtistArt seed={c.slug} label={c.title} className="hidden h-full min-h-32 w-full rounded-none sm:flex" />
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
              {c.status === "live" ? "Manage campaign" : "View details"} <ArrowRight className="size-4" />
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
