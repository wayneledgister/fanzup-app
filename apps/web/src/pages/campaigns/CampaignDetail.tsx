import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, BadgeCheck, CalendarClock, ChevronDown, Flag, Gift, MapPin, Milestone, Package, Share2, Sparkles, Ticket, Users } from "lucide-react";
import {
  ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, EscrowNotice, FundingProgress, IconChip, KeyValue, SectionHeading,
} from "@/components/brand";
import { TierBadge } from "@/components/public/cards";
import { artistById, campaignById, type Perk } from "@/lib/mock";
import { daysUntil, formatDate, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FPS campaign/CampaignDetailPage.tsx.
 * Doc-driven changes: rebuilt as a Layer 1 reward campaign (Mechanism 05). "Invest Now", "Investment Perks",
 * "pool unit certificate", revenue-share deal terms and the securities risk block are removed; perks only,
 * with escrow + auto-refund disclosure (Brand §7.3) and an optional milestone-release note.
 */

const KIND_ICON = { digital: Sparkles, physical: Package, experience: Ticket } as const;

const FAQ = [
  {
    q: "When am I charged?",
    a: "Your card is authorized when you back, and the money is held by our escrow partner until the campaign ends. FanZuP and the artist can't touch it before then.",
  },
  {
    q: "What if the goal isn't reached?",
    a: "Every backer is refunded automatically, in full, to the original payment method. You don't need to do anything.",
  },
  {
    q: "Is backing an investment?",
    a: "No. Backing gets you the perk you choose. It doesn't give you any share of the artist's earnings or ownership of the project.",
  },
  {
    q: "What if my perk doesn't arrive?",
    a: "Every perk has a delivery estimate and tracking in Backed & perks. If something goes wrong, open a dispute from there and our team will step in.",
  },
];

export default function CampaignDetail() {
  const { id = "" } = useParams();
  const campaign = campaignById(id);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"story" | "updates" | "faq">("story");

  if (!campaign) {
    return (
      <Container size="md" className="py-20">
        <EmptyState
          icon={<Flag />}
          title="We couldn't find that campaign"
          action={
            <Button asChild>
              <Link to="/explore">Browse live campaigns</Link>
            </Button>
          }
        >
          The link may be wrong, or the artist may have taken the campaign down before launch.
        </EmptyState>
      </Container>
    );
  }

  const a = artistById(campaign.artistId);
  const days = daysUntil(campaign.endsOn);
  const ended = days <= 0 || campaign.status === "ended";
  const funded = campaign.raisedMinor >= campaign.goalMinor;
  const perk = campaign.perks.find((p) => p.id === selected);
  const back = () => navigate(`/signup?next=${encodeURIComponent(`/campaigns/${campaign.id}`)}${selected ? `&perk=${selected}` : ""}`);

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative border-b border-line">
        <div aria-hidden className="pointer-events-none absolute -top-32 left-[-10%] h-[420px] w-[420px] rounded-full bg-gold/8 blur-[120px]" />
        <Container size="xl" className="relative flex flex-col gap-8 py-8 sm:py-12">
          <Link to="/explore" className="flex w-fit items-center gap-2 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Back to Discover
          </Link>
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <div className="flex flex-col gap-6">
              <div className="relative overflow-hidden rounded-lg border border-line">
                <ArtistArt seed={a.id} label={`${a.name} — ${campaign.title}`} rounded="lg" className="aspect-video w-full rounded-none" />
                <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                  <Badge tone="gold">{campaign.type}</Badge>
                  {funded && <Badge tone="success">Goal reached</Badge>}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{campaign.title}</h1>
                <p className="text-lg text-muted">{campaign.blurb}</p>
              </div>
              <Link to={`/artist/${a.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:bg-surface-2">
                <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-12" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{a.name}</span>
                    {a.verified && <BadgeCheck className="size-4 text-success" aria-label="Identity verified" />}
                  </div>
                  <p className="flex items-center gap-1 text-sm text-muted">
                    {a.genre} · <MapPin className="size-3" /> {a.city}
                  </p>
                </div>
                <TierBadge tier={a.tier} />
              </Link>
              <Card className="flex flex-col gap-5">
                <FundingProgress raisedMinor={campaign.raisedMinor} goalMinor={campaign.goalMinor} backers={campaign.backers} daysLeft={days} />
                <div className="grid grid-cols-3 gap-4 border-t border-line pt-4 text-center">
                  <MiniStat icon={<Users />} value={formatNumber(campaign.backers)} label="backers" />
                  <MiniStat icon={<CalendarClock />} value={ended ? "Ended" : `${days}`} label={ended ? formatDate(campaign.endsOn) : "days left"} />
                  <MiniStat icon={<Gift />} value={`${campaign.perks.length}`} label="perks" />
                </div>
                <div className="flex gap-3">
                  <Button size="lg" block onClick={() => (selected ? back() : document.getElementById("perks")?.scrollIntoView({ behavior: "smooth" }))} disabled={ended}>
                    {ended ? "Campaign ended" : "Back this campaign"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-12 shrink-0"
                    aria-label="Share campaign"
                    onClick={() => navigator.clipboard?.writeText(window.location.href)}
                  >
                    <Share2 />
                  </Button>
                </div>
                <p className="text-center text-xs text-muted">
                  All-or-nothing · ends <span className="num">{formatDate(campaign.endsOn)}</span>
                </p>
              </Card>
            </div>
          </div>
        </Container>
      </section>

      {/* ── Body ── */}
      <Container size="xl" className="grid gap-10 py-12 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-10">
          <EscrowNotice />
          {campaign.milestoneRelease && (
            <Callout tone="info" icon={<Milestone />} title="Funds are released in milestones">
              If this campaign hits its goal, our escrow partner releases the money to {a.name} in stages as each milestone below is
              confirmed — not all at once. You'll get an update each time a milestone is reached.
            </Callout>
          )}

          <div>
            <div role="tablist" aria-label="Campaign sections" className="mb-6 flex gap-1 border-b border-line">
              {(["story", "updates", "faq"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn("-mb-px h-11 border-b-2 px-4 text-sm font-medium capitalize", tab === t ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg")}
                >
                  {t === "faq" ? "FAQ" : t}
                </button>
              ))}
            </div>
            {tab === "story" && <Story artistName={a.name} bio={a.bio} milestone={!!campaign.milestoneRelease} goalMinor={campaign.goalMinor} />}
            {tab === "updates" && <Updates artistName={a.name} />}
            {tab === "faq" && <Faq />}
          </div>
        </div>

        {/* Perks */}
        <aside id="perks" className="scroll-mt-24 lg:sticky lg:top-20 lg:self-start">
          <SectionHeading eyebrow="Choose a perk" title="Back this campaign" />
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="Perks">
            {campaign.perks.map((p) => (
              <PerkOption key={p.id} perk={p} selected={selected === p.id} onSelect={() => setSelected(p.id)} disabled={ended} />
            ))}
          </div>
          <Card elevated className="mt-4 flex flex-col gap-3 p-5">
            {perk ? (
              <>
                <KeyValue k="Your perk" v={perk.title} className="py-0" />
                <KeyValue k="Amount" v={<span className="num">{formatMoney(perk.priceMinor)}</span>} className="py-0" />
                <p className="text-xs text-muted">No fees added at checkout. Refunded in full if the goal isn't met.</p>
              </>
            ) : (
              <p className="text-sm text-muted">Pick a perk above to continue.</p>
            )}
            <Button block disabled={!perk || ended} onClick={back}>
              {perk ? `Back with ${formatMoney(perk.priceMinor)}` : "Back this campaign"}
            </Button>
            <p className="text-center text-xs text-muted">
              You'll create a free account first.{" "}
              <Link to="/login" className="text-gold hover:underline">
                Have one? Log in
              </Link>
            </p>
          </Card>
          <p className="mt-4 text-xs text-muted">
            Questions about how this works? Read <Link to="/trust" className="text-gold hover:underline">how money moves</Link> and our{" "}
            <Link to="/fees" className="text-gold hover:underline">fees</Link>.
          </p>
        </aside>
      </Container>
    </>
  );
}

function MiniStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-muted [&_svg]:size-4">{icon}</span>
      <span className="num text-lg font-medium">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function PerkOption({ perk: p, selected, onSelect, disabled }: { perk: Perk; selected: boolean; onSelect: () => void; disabled?: boolean }) {
  const remaining = p.limit !== undefined ? Math.max(0, p.limit - p.claimed) : undefined;
  const soldOut = remaining === 0;
  const low = remaining !== undefined && remaining > 0 && remaining <= Math.max(10, (p.limit ?? 0) * 0.15);
  const Icon = KIND_ICON[p.kind];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={soldOut || disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-3 rounded-lg border bg-surface p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-gold shadow-gold" : "border-line hover:border-muted/50 hover:bg-surface-2",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconChip tone={selected ? "gold" : "muted"} className="size-9 [&_svg]:size-4">
            <Icon />
          </IconChip>
          <div>
            <p className="font-semibold">{p.title}</p>
            <p className="text-sm text-muted">{p.description}</p>
          </div>
        </div>
        <span className="num shrink-0 text-lg font-medium">{formatMoney(p.priceMinor)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-xs text-muted">
        <span>{p.delivery}</span>
        <span>
          <span className="num">{formatNumber(p.claimed)}</span> backers
        </span>
        {soldOut ? (
          <Badge tone="neutral">Sold out</Badge>
        ) : remaining !== undefined ? (
          <span className={cn(low && "text-warning")}>
            <span className="num">{remaining}</span> of <span className="num">{p.limit}</span> left
          </span>
        ) : (
          <span>Unlimited</span>
        )}
      </div>
    </button>
  );
}

function Story({ artistName, bio, milestone, goalMinor }: { artistName: string; bio: string; milestone: boolean; goalMinor: number }) {
  const plan = [
    { pct: 50, label: "Making the work" },
    { pct: 25, label: "Musicians & crew" },
    { pct: 15, label: "Promotion" },
    { pct: 10, label: "Perk fulfillment" },
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 text-muted">
        <p>{bio}</p>
        <p>
          This campaign pays for the work directly — no label advance, no rights signed away. Every dollar sits in escrow until the goal
          is met, and {artistName} posts progress updates here as the project moves.
        </p>
      </div>
      <div>
        <h3 className="mb-4 text-lg font-semibold">Where the money goes</h3>
        <ul className="flex flex-col gap-3">
          {plan.map((p) => (
            <li key={p.label} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span>{p.label}</span>
                <span className="num text-muted">
                  {p.pct}% · {formatMoney((goalMinor * p.pct) / 100)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent-teal" style={{ width: `${p.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      {milestone && (
        <div>
          <h3 className="mb-4 text-lg font-semibold">Release milestones</h3>
          <ol className="flex flex-col gap-4 border-l border-line pl-6">
            {[
              ["Goal reached", "First release so the artist can book the people and places the project needs."],
              ["Production underway", "Second release once the artist shows proof of progress."],
              ["Project delivered", "Final release when the work is out and perks start shipping."],
            ].map(([t, d], i) => (
              <li key={t} className="relative">
                <span className="num absolute -left-[33px] flex size-5 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] text-muted">{i + 1}</span>
                <p className="font-medium">{t}</p>
                <p className="text-sm text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Updates({ artistName }: { artistName: string }) {
  const items = [
    { date: "2026-09-24", title: "Horn section locked in", body: "All three players confirmed for every date. Rehearsals start the week the campaign closes." },
    { date: "2026-09-10", title: "We're live", body: `Thank you for showing up on day one. ${artistName} will post here every time something moves.` },
  ];
  return (
    <ol className="flex flex-col gap-4">
      {items.map((u) => (
        <li key={u.title}>
          <Card className="flex flex-col gap-2 p-5">
            <span className="num text-xs text-muted">{formatDate(u.date)}</span>
            <h3 className="font-semibold">{u.title}</h3>
            <p className="text-sm text-muted">{u.body}</p>
          </Card>
        </li>
      ))}
    </ol>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
      {FAQ.map((f, i) => (
        <div key={f.q}>
          <button
            type="button"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left font-medium"
          >
            {f.q}
            <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i && <p className="px-5 pb-5 text-sm text-muted">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}
