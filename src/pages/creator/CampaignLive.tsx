import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, CalendarCheck, CheckCircle2, Download, ExternalLink, Lock, Megaphone, PencilLine, RotateCcw, Search, Send, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  EmptyState,
  Field,
  FundingProgress,
  KeyValue,
  Money,
  PageHeader,
  ProgressBar,
  Select,
  Stat,
  TextArea,
  TextInput,
} from "@/components/brand";
import { CampaignStatusChip, CopyField, TableShell, type DotStatus, formatDay } from "@/components/creator/ui";
import {
  campaignUpdates,
  creatorCampaignById,
  liveBackers,
  liveFulfillment,
  milestoneSchedule,
  perkById,
  type CreatorCampaign,
  type FulfillmentStatus,
} from "@/components/creator/data";
import { daysUntil, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup CampaignLive.tsx (post-launch confirmation) → full live campaign management.
 * Doc-driven changes: "Invest in my music career", "Revenue Share" type, "Ready for investments" and
 * "first investment" copy replaced with reward-campaign language (Mechanism 05, Brand §7.4). Escrow status,
 * milestone release schedule and per-perk fulfillment added per Mechanism 05 §2. Non-live statuses render
 * a read-only view of the same campaign.
 */
export default function CampaignLive() {
  const { id } = useParams();
  const c = creatorCampaignById(id);
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [hash]);

  if (!c) {
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

  const isLive = c.status === "live";
  const publicUrl = `https://fanzup.com/c/${c.id}`;

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
        description={c.blurb}
        actions={
          c.status === "draft" || c.status === "review" ? (
            <Button asChild variant="secondary">
              <Link to="/creator/campaigns/new/preview">
                <PencilLine /> {c.status === "draft" ? "Continue editing" : "View submission"}
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to={`/campaigns/${c.id}`}>
                <ExternalLink /> View public page
              </Link>
            </Button>
          )
        }
      />

      <StatusBanner c={c} />
      <div className="mb-6 lg:hidden">
        <EscrowCard c={c} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-6">
            <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={isLive ? daysUntil(c.endsOn) : undefined} />
            <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-4">
              <Stat label="Raised" value={<Money minor={c.raisedMinor} />} />
              <Stat label="Backers" value={c.backers.toLocaleString()} />
              <Stat label="Avg. pledge" value={<Money minor={c.backers ? Math.round(c.raisedMinor / c.backers) : 0} />} />
              <Stat label={isLive ? "Days left" : "Deadline"} value={isLive ? daysUntil(c.endsOn) : <span className="text-lg">{formatDay(c.endsOn)}</span>} />
            </div>
          </Card>

          <PerkInventory c={c} />
          {c.perks.length > 0 && c.status !== "refunded" && c.status !== "draft" && c.status !== "review" && <Fulfillment c={c} />}
          {isLive && <UpdateComposer />}
          {c.backers > 0 && <Backers c={c} />}
        </div>

        {/* Side column */}
        <aside className="flex flex-col gap-6">
          <div className="hidden lg:block">
            <EscrowCard c={c} />
          </div>
          {c.milestoneRelease && isLive && <MilestoneCard />}
          {(isLive || c.status === "funded") && (
            <Card id="share" className="flex scroll-mt-24 flex-col gap-4">
              <h2 className="text-lg font-semibold">Share your campaign</h2>
              <CopyField label="Campaign link" value={publicUrl} />
              <p className="text-sm text-muted">Post it in your bio, your stories and your next show. Thank early backers publicly — it brings in the next ones.</p>
            </Card>
          )}
        </aside>
      </div>
    </Container>
  );
}

function StatusBanner({ c }: { c: CreatorCampaign }) {
  switch (c.status) {
    case "draft":
      return (
        <Callout tone="info" icon={<PencilLine />} title="This campaign is a draft" className="mb-6">
          Only you can see it. Finish the perks and submit it for review when you're ready.
        </Callout>
      );
    case "review":
      return (
        <Callout tone="warning" icon={<CalendarCheck />} title={`Submitted for review on ${formatDay(c.statusDate)}`} className="mb-6">
          Our compliance team checks every campaign before it goes live. We'll email you when it's approved or if anything needs changes.
        </Callout>
      );
    case "refunded":
      return (
        <Callout tone="error" icon={<RotateCcw />} title="Goal not met — backers were refunded" className="mb-6">
          This campaign closed on {formatDay(c.statusDate)} at <Money minor={c.raisedMinor} /> of <Money minor={c.goalMinor} />. Our escrow partner
          returned every backer's money automatically. No perks are owed.
        </Callout>
      );
    case "ended":
      return (
        <Callout tone="success" icon={<CheckCircle2 />} title="Campaign complete" className="mb-6">
          Funds were released and every perk has been delivered. Nice work.
        </Callout>
      );
    default:
      return null;
  }
}

function EscrowCard({ c }: { c: CreatorCampaign }) {
  const rows: Record<CreatorCampaign["status"], { tone: "info" | "success" | "error" | "neutral"; title: string; body: React.ReactNode }> = {
    live: {
      tone: "info",
      title: "Held by escrow partner",
      body: (
        <>
          Released when the goal is met by <span className="num text-fg">{formatDay(c.endsOn)}</span>. If it isn't, every backer is refunded automatically and
          nothing is paid out.
        </>
      ),
    },
    funded: { tone: "success", title: "Released to you", body: <>The goal was met. <Money minor={c.releasedMinor ?? c.raisedMinor} className="text-fg" /> was released to your payout account.</> },
    ended: { tone: "success", title: "Released to you", body: <>The goal was met. <Money minor={c.releasedMinor ?? c.raisedMinor} className="text-fg" /> was released to your payout account.</> },
    refunded: { tone: "error", title: "Refunded to backers", body: "The goal wasn't met by the deadline, so the escrow partner returned every pledge." },
    draft: { tone: "neutral", title: "Not collecting yet", body: "Pledges are held by our escrow partner once the campaign is live." },
    review: { tone: "neutral", title: "Not collecting yet", body: "Pledges are held by our escrow partner once the campaign is live." },
  };
  const r = rows[c.status];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Escrow status</h2>
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
          <KeyValue k="In escrow now" v={<Money minor={c.raisedMinor} />} />
          <KeyValue k="Still needed" v={<Money minor={Math.max(0, c.goalMinor - c.raisedMinor)} className="text-gold" />} />
          <KeyValue k="Deadline" v={<span className="num">{formatDay(c.endsOn)}</span>} />
        </div>
      )}
    </Card>
  );
}

function MilestoneCard() {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Milestone release</h2>
        <p className="text-sm text-muted">Once the goal is met, funds are released in stages as you hit each milestone — so backers see the work happen.</p>
      </div>
      <ol className="flex flex-col gap-4">
        {milestoneSchedule.map((m, i) => (
          <li key={m.id} className="flex gap-3">
            <span className={cn("num flex size-7 shrink-0 items-center justify-center rounded-full border text-xs", i === 0 ? "border-gold text-gold" : "border-line text-muted")}>{i + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-fg">{m.label}</span>
                <span className="num text-sm text-fg">{m.sharePct}%</span>
              </div>
              <span className="text-xs text-muted">
                {m.when} · {m.status}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PerkInventory({ c }: { c: CreatorCampaign }) {
  if (!c.perks.length) {
    return (
      <Card>
        <EmptyState icon={<PencilLine />} title="No perks yet" action={<Button asChild size="sm"><Link to="/creator/campaigns/new/perks">Add perks</Link></Button>}>
          Every campaign needs at least one perk before it can be submitted.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Perk inventory</h2>
      <ul className="flex flex-col gap-4">
        {c.perks.map((p) => {
          const remaining = p.limit !== undefined ? p.limit - p.claimed : undefined;
          const low = remaining !== undefined && p.limit !== undefined && remaining / p.limit <= 0.15;
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-3">
                  <Money minor={p.priceMinor} className="text-sm text-fg" />
                  <span className="text-sm font-medium text-fg">{p.title}</span>
                </div>
                {remaining !== undefined ? (
                  <span className={cn("num text-xs", low ? "text-warning" : "text-muted")}>
                    {remaining === 0 ? "Sold out" : `${remaining} of ${p.limit} left`}
                  </span>
                ) : (
                  <span className="text-xs text-muted">Unlimited</span>
                )}
              </div>
              {p.limit !== undefined && <ProgressBar value={p.claimed} max={p.limit} tone="info" className="h-1.5" label={`${p.title} claimed`} />}
              <span className="num text-xs text-muted">{p.claimed.toLocaleString()} claimed</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const FULFILL_TONE: Record<FulfillmentStatus, Parameters<typeof DotStatus>[0]["tone"]> = {
  "Not started": "muted",
  "Date needed": "warning",
  Scheduled: "info",
  "In progress": "info",
  Delivered: "success",
};

function Fulfillment({ c }: { c: CreatorCampaign }) {
  const initial = useMemo(() => {
    if (c.status === "live") return liveFulfillment;
    return Object.fromEntries(
      c.perks.map((p) => [p.id, { status: (p.delivery.startsWith("Delivered") ? "Delivered" : p.delivery.startsWith("Ships") ? "In progress" : "Scheduled") as FulfillmentStatus, note: p.delivery }]),
    );
  }, [c]);
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [err, setErr] = useState("");

  const confirm = (perkId: string) => {
    if (!date) return setErr("Pick a delivery date.");
    if (date <= c.endsOn) return setErr("Delivery has to be after the campaign deadline.");
    setState((s) => ({ ...s, [perkId]: { status: "Scheduled", note: `Delivery confirmed for ${formatDay(date)}` } }));
    setEditing(null);
    setDate("");
    setErr("");
  };

  const needDates = Object.values(state).filter((s) => s.status === "Date needed").length;

  return (
    <Card id="fulfillment" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Fulfillment</h2>
        {needDates > 0 ? <Badge tone="warning">{needDates} need a date</Badge> : <Badge tone="success">All scheduled</Badge>}
      </div>
      <p className="text-sm text-muted">Backers see these dates on their perks. Keep them realistic — backers plan around them.</p>
      <ul className="flex flex-col divide-y divide-line">
        {c.perks.map((p) => {
          const s = state[p.id];
          const statusTone = FULFILL_TONE[s.status];
          const dot = { success: "bg-success", warning: "bg-warning", error: "bg-error", info: "bg-info", muted: "bg-muted" }[statusTone];
          return (
            <li key={p.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{p.title}</span>
                  <span className="text-xs text-muted">
                    <span className="num">{p.claimed}</span> to deliver · {p.kind} · {s.note}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-sm text-fg">
                    <span className={cn("size-2 rounded-full", dot)} aria-hidden />
                    {s.status}
                  </span>
                  {s.status === "Date needed" && editing !== p.id && (
                    <Button size="sm" variant="secondary" onClick={() => { setEditing(p.id); setErr(""); }}>
                      Confirm date
                    </Button>
                  )}
                </div>
              </div>
              {editing === p.id && (
                <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4 sm:flex-row sm:items-end">
                  <Field label="Delivery date" htmlFor={`d-${p.id}`} error={err} className="flex-1">
                    <TextInput id={`d-${p.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!err} />
                  </Field>
                  <div className="flex gap-2">
                    <Button size="md" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button size="md" onClick={() => confirm(p.id)}>
                      Save date
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function UpdateComposer() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("All backers");
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  const [posted, setPosted] = useState(campaignUpdates);
  const [justPosted, setJustPosted] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = "Give your update a title.";
    if (body.trim().length < 20) next.body = "Write at least a couple of sentences so backers know what changed.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setPosted((p) => [{ id: `u${p.length + 1}`, title: title.trim(), body: body.trim(), on: "2026-10-02", audience }, ...p]);
    setTitle("");
    setBody("");
    setJustPosted(true);
  };

  return (
    <Card id="update" className="flex scroll-mt-24 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Post an update</h2>
        <p className="text-sm text-muted">Updates go to backers by email and appear on your campaign page.</p>
      </div>
      {justPosted && (
        <Callout tone="success" icon={<CheckCircle2 />} title="Update posted">
          Backers will get it in their inbox within a few minutes.
        </Callout>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Title" htmlFor="u-title" error={errors.title}>
          <TextInput id="u-title" value={title} onChange={(e) => { setTitle(e.target.value); setJustPosted(false); }} placeholder="Rehearsals start Monday" aria-invalid={!!errors.title} />
        </Field>
        <Field label="Message" htmlFor="u-body" error={errors.body} hint={<span className="num">{body.length}/2000</span>}>
          <TextArea id="u-body" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="Tell backers what happened this week and what's next." aria-invalid={!!errors.body} />
        </Field>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <Field label="Who can see it" htmlFor="u-aud" className="sm:w-64">
            <Select id="u-aud" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option>All backers</option>
              <option>Public</option>
              <option>Backers of Two tickets + soundcheck</option>
              <option>Backers of Signed tour poster</option>
            </Select>
          </Field>
          <Button type="submit">
            <Send /> Post update
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <span className="eyebrow">Previous updates</span>
        <ul className="flex flex-col gap-3">
          {posted.map((u) => (
            <li key={u.id} className="flex flex-col gap-1 rounded-md bg-surface-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-fg">{u.title}</span>
                <span className="text-xs text-muted">
                  <span className="num">{formatDay(u.on)}</span> · {u.audience}
                </span>
              </div>
              <p className="text-sm text-muted">{u.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Backers({ c }: { c: CreatorCampaign }) {
  const [q, setQ] = useState("");
  const rows = c.status === "live" ? liveBackers : [];
  const shown = rows.filter((b) => (b.name + b.city).toLowerCase().includes(q.toLowerCase()));
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Backers</h2>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <TextInput aria-label="Search backers" placeholder="Search backers" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Button variant="secondary" aria-label="Export backers as CSV">
            <Download /> <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          <span className="num">{c.backers}</span> backers. Export the full list as CSV for shipping and guest lists.
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No backers match "{q}".</p>
      ) : (
        <>
          <div className="hidden sm:block">
            <TableShell>
              <thead>
                <tr>
                  <th>Backer</th>
                  <th>Perk</th>
                  <th className="text-right">Pledge</th>
                  <th className="text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <span className="block text-fg">{b.name}</span>
                      <span className="text-xs text-muted">{b.city}</span>
                    </td>
                    <td className="text-muted">{perkById(c, b.perk)?.title}</td>
                    <td className="num text-right text-fg">{formatMoney(b.amountMinor)}</td>
                    <td className="num text-right text-muted">{formatDay(b.on)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
          <ul className="flex flex-col divide-y divide-line sm:hidden">
            {shown.map((b, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-fg">{b.name}</span>
                  <span className="truncate text-xs text-muted">{perkById(c, b.perk)?.title}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="num text-sm text-fg">{formatMoney(b.amountMinor)}</span>
                  <span className="num text-xs text-muted">{formatDay(b.on)}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Showing <span className="num">{shown.length}</span> most recent of <span className="num">{c.backers.toLocaleString()}</span> backers. Pledges above a
            perk's price are extra support.
          </p>
        </>
      )}
    </Card>
  );
}
