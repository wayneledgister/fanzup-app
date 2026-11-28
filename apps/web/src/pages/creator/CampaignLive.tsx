import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, CalendarCheck, CheckCircle2, ExternalLink, Lock, Megaphone, PencilLine, RefreshCw, RotateCcw, Send, ShieldCheck, WifiOff } from "lucide-react";
import { Badge, Button, Callout, Card, Container, EmptyState, FundingProgress, KeyValue, Money, PageHeader, ProgressBar, Stat } from "@/components/brand";
import { CampaignStatusChip, CopyField, formatDay } from "@/components/creator/ui";
import { publicCampaignUrl, useMyCampaign } from "@/components/creator/live";
import { daysLeft } from "@/components/campaign/LiveCampaignCard";
import { RequireAccount } from "@/components/RequireAccount";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { POLICY } from "@fanzup/shared/policy";
import type { MyCampaign, MyTranche } from "@fanzup/shared/schemas";

/**
 * Source: Fan Profile Setup CampaignLive.tsx (post-launch confirmation) → campaign management.
 * CR-006 (FR-CMP-009, ADR-011): reads `GET /artist/campaigns/:id`: status, money, perks with units claimed and
 * milestones. Submit (draft / changes requested) and publish (approved) call the M1 owner routes (FR-CMP-002).
 * Backer list, fulfillment tracking and updates are left out until their requirements are built (FR-FUL-002,
 * FR-COM-001; FR-PLT-002). FR-PLT-006: no "escrow" wording.
 */
const PUBLIC = new Set(["live", "funded", "failed", "released", "refunded", "closed"]);

/** FR-ID-005: signed in with a confirmed email; the API enforces the same (verified + owner). */
export default function CampaignLivePage() {
  return (
    <RequireAccount>
      <CampaignLive />
    </RequireAccount>
  );
}

function CampaignLive() {
  const { id = "" } = useParams();
  const [state, reload] = useMyCampaign(id);
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash || state.status !== "ready") return;
    const el = document.getElementById(hash.slice(1));
    if (el) window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [hash, state.status]);

  if (state.status === "loading") {
    return (
      <Container size="xl" className="py-8 sm:py-10" aria-busy="true" aria-label="Loading the campaign">
        <div className="mb-8 h-20 w-2/3 animate-pulse rounded-md bg-surface" />
        <div className="h-64 animate-pulse rounded-lg border border-line bg-surface" />
      </Container>
    );
  }
  if (state.status === "error") {
    return (
      <Container size="md" className="py-16">
        <Callout tone="error" icon={<WifiOff />} title="We couldn't load this campaign">
          Check your connection and try again.{" "}
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCw /> Retry
          </Button>
        </Callout>
      </Container>
    );
  }
  if (state.status === "missing") {
    return (
      <Container size="md" className="py-16">
        <EmptyState
          icon={<Megaphone />}
          title="We couldn't find that campaign"
          action={
            <Button asChild variant="secondary">
              <Link to="/creator/campaigns">Back to campaigns</Link>
            </Button>
          }
        >
          It may have been deleted, or the link is out of date.
        </EmptyState>
      </Container>
    );
  }

  const c = state.data;
  const isLive = c.status === "live";
  const d = daysLeft(c.endsAt);

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <Link to="/creator/campaigns" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All campaigns
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <CampaignStatusChip status={c.status} /> <span>{c.type} campaign</span>
          </span>
        }
        title={c.title}
        description={c.blurb ?? undefined}
        actions={
          PUBLIC.has(c.status) && (
            <Button asChild variant="secondary">
              <Link to={`/campaigns/${c.slug}`}>
                <ExternalLink /> View public page
              </Link>
            </Button>
          )
        }
      />

      <StatusBanner c={c} onChanged={reload} />
      <div className="mb-6 lg:hidden">
        <MoneyCard c={c} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-6" data-testid="campaign-money">
            <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={isLive ? d : undefined} />
            <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-4">
              <Stat label="Raised" value={<Money minor={c.raisedMinor} />} />
              <Stat label="Backers" value={c.backers.toLocaleString()} />
              <Stat label="Avg. backing" value={<Money minor={c.backers ? Math.round(c.raisedMinor / c.backers) : 0} />} />
              <Stat
                label={isLive ? "Days left" : "Deadline"}
                value={isLive ? String(d ?? "—") : <span className="text-lg">{c.endsAt ? formatDay(c.endsAt) : "Set when you publish"}</span>}
              />
            </div>
          </Card>
          <PerkInventory c={c} />
        </div>

        <aside className="flex flex-col gap-6">
          <div className="hidden lg:block">
            <MoneyCard c={c} />
          </div>
          {c.tranches.length > 0 && <Milestones tranches={c.tranches} goalMet={["funded", "released", "closed"].includes(c.status)} />}
          {(isLive || c.status === "funded") && (
            <Card id="share" className="flex scroll-mt-24 flex-col gap-4">
              <h2 className="text-lg font-semibold">Share your campaign</h2>
              <CopyField label="Campaign link" value={publicCampaignUrl(c.slug)} />
              <p className="text-sm text-muted">Post it in your bio, your stories and your next show. Thank early backers publicly: it brings in the next ones.</p>
            </Card>
          )}
        </aside>
      </div>
    </Container>
  );
}

/** Submit for review (draft, changes requested) or publish (approved). The API enforces every rule; we show its message. */
function WorkflowAction({ c, onChanged }: { c: MyCampaign; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = c.status === "approved";
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await (publish ? api.publishCampaign(c.id) : api.submitCampaign(c.id));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong on our side. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button size="sm" className="self-start" onClick={() => void go()} disabled={busy}>
        <Send /> {busy ? (publish ? "Publishing…" : "Submitting…") : publish ? "Publish now" : "Submit for review"}
      </Button>
      {error && <p className="text-sm text-error" role="alert">{error}</p>}
    </div>
  );
}

function StatusBanner({ c, onChanged }: { c: MyCampaign; onChanged: () => void }) {
  switch (c.status) {
    case "draft":
      return (
        <Callout tone="info" icon={<PencilLine />} title="This campaign is a draft" className="mb-6">
          Only you can see it. It needs at least one perk and its milestones before it can be submitted, and your payout account must be set up.
          <WorkflowAction c={c} onChanged={onChanged} />
        </Callout>
      );
    case "revisions_requested":
      return (
        <Callout tone="warning" icon={<PencilLine />} title="Our reviewers asked for changes" className="mb-6">
          Check the email from our review team, make the changes, then submit it again.
          <WorkflowAction c={c} onChanged={onChanged} />
        </Callout>
      );
    case "in_review":
      return (
        <Callout tone="warning" icon={<CalendarCheck />} title={`In review since ${formatDay(c.updatedAt)}`} className="mb-6">
          Our team checks every campaign before it goes live, {POLICY.campaign.reviewEstimate}. We'll email you when it's approved or if anything needs changes.
        </Callout>
      );
    case "approved":
      return (
        <Callout tone="success" icon={<CheckCircle2 />} title="Approved: ready to publish" className="mb-6">
          Publishing makes it public and starts your deadline.
          <WorkflowAction c={c} onChanged={onChanged} />
        </Callout>
      );
    case "failed":
    case "refunded":
      return (
        <Callout tone="error" icon={<RotateCcw />} title="Goal not met: backers are refunded" className="mb-6">
          This campaign closed{c.endsAt ? ` on ${formatDay(c.endsAt)}` : ""} at <Money minor={c.raisedMinor} /> of <Money minor={c.goalMinor} />. Every backer is refunded in
          full automatically. No perks are owed.
        </Callout>
      );
    case "closed":
      return (
        <Callout tone="info" icon={<CheckCircle2 />} title="Campaign closed" className="mb-6">
          Nothing is left to do here.
        </Callout>
      );
    default:
      return null;
  }
}

function MoneyCard({ c }: { c: MyCampaign }) {
  const released = c.tranches.reduce((s, t) => s + (t.releasedMinor ?? 0), 0);
  const rows: Record<string, { tone: "info" | "success" | "error" | "neutral"; title: string; body: React.ReactNode }> = {
    live: {
      tone: "info",
      title: "Held until the deadline",
      body: (
        <>
          Paid out when the goal is met by <span className="num text-fg">{c.endsAt ? formatDay(c.endsAt) : "the deadline"}</span>. If it isn't, every backer is refunded
          automatically and nothing is paid out.
        </>
      ),
    },
    funded: { tone: "success", title: "Goal met", body: <>{c.milestoneRelease ? "Paid out in stages as each milestone is verified." : "Paid out to your payout account."} <Money minor={released} className="text-fg" /> released so far.</> },
    released: { tone: "success", title: "Paid out", body: <><Money minor={released} className="text-fg" /> was released to your payout account.</> },
    failed: { tone: "error", title: "Refunded to backers", body: "The goal wasn't met by the deadline, so every backing is refunded." },
    refunded: { tone: "error", title: "Refunded to backers", body: "The goal wasn't met by the deadline, so every backing was refunded." },
  };
  const r = rows[c.status] ?? { tone: "neutral" as const, title: "Not collecting yet", body: "Backings are taken once the campaign is live." };
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Money status</h2>
        <ShieldCheck className="size-5 text-gold" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <Badge tone={r.tone} icon={c.status === "live" ? <Lock /> : undefined} className="self-start">
          {r.title}
        </Badge>
        <p className="mt-2 text-sm text-muted">{r.body}</p>
      </div>
      {c.status === "live" && (
        <div className="border-t border-line pt-2">
          <KeyValue k="Raised so far" v={<Money minor={c.raisedMinor} />} />
          <KeyValue k="Still needed" v={<Money minor={Math.max(0, c.goalMinor - c.raisedMinor)} className="text-gold" />} />
          {c.endsAt && <KeyValue k="Deadline" v={<span className="num">{formatDay(c.endsAt)}</span>} />}
        </div>
      )}
    </Card>
  );
}

const TRANCHE_STATUS: Record<string, string> = {
  pending: "Not started",
  evidence_submitted: "Evidence with our team",
  verified: "Verified, payment on its way",
  released: "Paid out",
  rejected: "Evidence needs another look",
};

function Milestones({ tranches, goalMet }: { tranches: MyTranche[]; goalMet: boolean }) {
  return (
    <Card className="flex flex-col gap-4" data-testid="campaign-milestones">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Milestone release</h2>
        <p className="text-sm text-muted">Once the goal is met, the money is released in stages as you hit each milestone, so backers see the work happen.</p>
      </div>
      <ol className="flex flex-col gap-4">
        {tranches.map((t) => (
          <li key={t.id} className="flex gap-3">
            <span className={cn("num flex size-7 shrink-0 items-center justify-center rounded-full border text-xs", t.status === "released" ? "border-success text-success" : "border-line text-muted")}>{t.seq}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-fg">{t.seq === 1 ? "Goal met" : t.milestone ?? `Milestone ${t.seq}`}</span>
                <span className="num text-sm text-fg">{t.pct}%</span>
              </div>
              <span className="text-xs text-muted">
                {t.seq === 1 && !goalMet ? "When the goal is met" : t.targetDate ? `Target ${formatDay(t.targetDate)}` : "No target date"} · {TRANCHE_STATUS[t.status] ?? t.status}
                {t.releasedMinor != null && <> · <Money minor={t.releasedMinor} /></>}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PerkInventory({ c }: { c: MyCampaign }) {
  if (!c.perks.length) {
    return (
      <Card>
        <EmptyState icon={<PencilLine />} title="No perks yet">
          Every campaign needs at least one perk before it can be submitted.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4" data-testid="perk-inventory">
      <h2 className="text-lg font-semibold">Perk inventory</h2>
      <ul className="flex flex-col gap-4">
        {c.perks.map((p) => {
          const remaining = p.limit != null ? Math.max(0, p.limit - p.claimed) : null;
          const low = remaining != null && p.limit != null && remaining / p.limit <= 0.15;
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-3">
                  <Money minor={p.priceMinor} className="text-sm text-fg" />
                  <span className="text-sm font-medium text-fg">{p.title}</span>
                </div>
                {remaining != null ? (
                  <span className={cn("num text-xs", low ? "text-warning" : "text-muted")}>{remaining === 0 ? "Sold out" : `${remaining} of ${p.limit} left`}</span>
                ) : (
                  <span className="text-xs text-muted">Unlimited</span>
                )}
              </div>
              {p.limit != null && <ProgressBar value={p.claimed} max={p.limit} tone="info" className="h-1.5" label={`${p.title} claimed`} />}
              <span className="num text-xs text-muted">
                {p.claimed.toLocaleString()} claimed · deliver by {formatDay(p.fulfillBy)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
