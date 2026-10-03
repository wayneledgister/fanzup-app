import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, CalendarClock, ChevronDown, Flag, Gift, MapPin, Milestone, Package, RefreshCw, Share2, Sparkles, Ticket, Users, WifiOff } from "lucide-react";
import {
  ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, EscrowNotice, FundingProgress, IconChip, KeyValue, SectionHeading, TestModeNotice,
} from "@/components/brand";
import { TierBadge } from "@/components/public/cards";
import type { CreatorTier } from "@/lib/mock";
import { api, ApiError, type PerkView, type TrancheView } from "@/lib/api";
import type { CampaignDetail as Detail } from "@fanzup/shared/schemas";
import { anonId, rememberSource } from "@/lib/attribution";
import { useSession } from "@/lib/session";
import { formatDate, formatInstant, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FPS campaign/CampaignDetailPage.tsx, rebuilt as a Layer 1 reward campaign (Mechanism 05).
 * M1 (FR-CMP-003, FR-BCK-002, FR-BCK-004, FR-PLT-006): reads the campaign from the API and renders only what the
 * artist wrote — story, risks, perks, milestones with dates. Empty sections are hidden, never filled in; updates
 * appear once FR-COM-001 ships. The deadline is one instant shown in the viewer's time zone. "Back" goes through
 * a full account first: sign up / log in → verify email → checkout with the same perk.
 */

const KIND_ICON = { digital: Sparkles, physical: Package, experience: Ticket } as const;

const FAQ = [
  { q: "When am I charged?", a: "Your card is charged when you back. If the campaign doesn't reach its goal by the deadline, you're refunded in full automatically — you don't need to do anything." },
  { q: "What if the goal is reached?", a: "The artist receives the money in stages: part when the campaign is funded, the rest as each milestone below is verified." },
  { q: "Is backing an investment?", a: "No. Backing gets you the perk you choose. It doesn't give you any share of the artist's earnings or ownership of the project." },
  { q: "Why do I need an account?", a: "So your backing, your refund if it fails, and your perk are tied to you. You verify your email once, then you're straight back here." },
];

const localDeadline = (iso: string) => formatInstant(iso);

function timeLeft(iso: string | null): { label: string; value: string; ended: boolean } {
  if (!iso) return { label: "", value: "—", ended: true };
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return { label: "ended", value: "Ended", ended: true };
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return { label: "left", value: `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`, ended: false }; // FR-BCK-004
  return { label: "days left", value: String(Math.ceil(ms / 86_400_000)), ended: false };
}

export default function CampaignDetail() {
  const { id: slug = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(params.get("perk"));
  const [tab, setTab] = useState<"story" | "faq">("story");
  const [, tick] = useState(0);

  useEffect(() => {
    rememberSource(slug, params.get("ref"));
    let alive = true;
    setState("loading");
    api.campaign(slug)
      .then((d) => alive && (setData(d), setState("ready")))
      .catch((e) => alive && setState(e instanceof ApiError && e.status === 404 ? "missing" : "error"));
    return () => {
      alive = false;
    };
  }, [slug, params]);

  // Keep the countdown honest near the deadline (closes on every surface within a minute — FR-BCK-004).
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (state === "loading") {
    return <Container size="xl" className="py-16"><div className="h-96 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading campaign" /></Container>;
  }
  if (state === "missing" || (state === "ready" && !data)) {
    return (
      <Container size="md" className="py-20">
        <EmptyState icon={<Flag />} title="We couldn't find that campaign" action={<Button asChild><Link to="/explore">Browse live campaigns</Link></Button>}>
          The link may be wrong, or the campaign may not be public yet.
        </EmptyState>
      </Container>
    );
  }
  if (state === "error" || !data) {
    return (
      <Container size="md" className="py-20">
        <Callout tone="error" icon={<WifiOff />} title="We couldn't load this campaign">
          Check your connection and try again. <Button variant="ghost" size="sm" onClick={() => window.location.reload()}><RefreshCw /> Retry</Button>
        </Callout>
      </Container>
    );
  }

  const { campaign: c, perks, tranches } = data;
  const t = timeLeft(c.endsAt);
  const accepting = c.status === "live" && !t.ended;
  const funded = c.raisedMinor >= c.goalMinor;
  const perk = perks.find((p) => p.id === selected);

  const pick = (p: PerkView) => {
    setSelected(p.id);
    void api.event({ name: "perk_selected", campaignId: c.id, perkId: p.id, anonId: anonId() });
  };

  const back = () => {
    if (!perk) return document.getElementById("perks")?.scrollIntoView({ behavior: "smooth" });
    const checkout = `/checkout/${c.slug}?perk=${perk.id}`;
    if (!session.session) return navigate(`/signup?next=${encodeURIComponent(checkout)}`);
    if (!session.emailVerified) return navigate(`/verify-email?next=${encodeURIComponent(checkout)}${session.email ? `&email=${encodeURIComponent(session.email)}` : ""}`);
    navigate(checkout);
  };

  return (
    <>
      <section className="relative border-b border-line">
        <div aria-hidden className="pointer-events-none absolute -top-32 left-[-10%] h-[420px] w-[420px] rounded-full bg-gold/8 blur-[120px]" />
        <Container size="xl" className="relative flex flex-col gap-8 py-8 sm:py-12">
          <Link to="/explore" className="flex w-fit items-center gap-2 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Back to Discover</Link>
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <div className="relative overflow-hidden rounded-lg border border-line">
              <ArtistArt seed={c.artist.slug} label={`${c.artist.name} — ${c.title}`} rounded="lg" className="aspect-video w-full rounded-none" />
              <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                <Badge tone="gold">{c.type}</Badge>
                {funded && <Badge tone="success">Goal reached</Badge>}
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{c.title}</h1>
                {c.blurb && <p className="text-lg text-muted">{c.blurb}</p>}
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                <ArtistArt seed={c.artist.slug} label={c.artist.name} rounded="full" className="size-12" />
                <div className="min-w-0 flex-1">
                  <span className="font-semibold">{c.artist.name}</span>
                  {(c.artist.genre || c.artist.city) && (
                    <p className="flex items-center gap-1 text-sm text-muted">
                      {c.artist.genre}
                      {c.artist.genre && c.artist.city && " · "}
                      {c.artist.city && <><MapPin className="size-3" /> {c.artist.city}</>}
                    </p>
                  )}
                </div>
                <TierBadge tier={c.artist.tier as CreatorTier} />
              </div>
              <Card className="flex flex-col gap-5">
                <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={t.ended ? undefined : Math.ceil((Date.parse(c.endsAt!) - Date.now()) / 86_400_000)} />
                <div className="grid grid-cols-3 gap-4 border-t border-line pt-4 text-center">
                  <MiniStat icon={<Users />} value={formatNumber(c.backers)} label="backers" />
                  <MiniStat icon={<CalendarClock />} value={t.value} label={t.label} />
                  <MiniStat icon={<Gift />} value={`${perks.length}`} label="perks" />
                </div>
                <div className="flex gap-3">
                  <Button size="lg" block onClick={back} disabled={!accepting} data-testid="back-cta">
                    {!accepting ? (c.status === "live" ? "Campaign ended" : "Not accepting backers") : perk ? `Back with ${formatMoney(perk.priceMinor)}` : "Back this campaign"}
                  </Button>
                  <Button variant="secondary" size="icon" className="size-12 shrink-0" aria-label="Share campaign" onClick={() => void share(c.title)}>
                    <Share2 />
                  </Button>
                </div>
                {c.endsAt && (
                  <p className="text-center text-xs text-muted">
                    All-or-nothing · {t.ended ? "ended" : "ends"} <span className="num">{localDeadline(c.endsAt)}</span>
                  </p>
                )}
              </Card>
            </div>
          </div>
        </Container>
      </section>

      <Container size="xl" className="grid gap-10 py-12 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-8">
          <TestModeNotice />
          <EscrowNotice />
          {c.milestoneRelease && tranches.length > 1 && (
            <Callout tone="info" icon={<Milestone />} title="Funds are released in milestones">
              If this campaign hits its goal, {c.artist.name} receives the money in stages as each milestone below is verified — not all at once.
            </Callout>
          )}
          <div>
            <div role="tablist" aria-label="Campaign sections" className="mb-6 flex gap-1 border-b border-line">
              {(["story", "faq"] as const).map((x) => (
                <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}
                  className={cn("-mb-px h-11 border-b-2 px-4 text-sm font-medium capitalize", tab === x ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg")}>
                  {x === "faq" ? "FAQ" : x}
                </button>
              ))}
            </div>
            {tab === "story" ? <Story story={c.story} risks={c.risks} tranches={tranches} goalMinor={c.goalMinor} /> : <Faq />}
          </div>
        </div>

        <aside id="perks" className="scroll-mt-24 lg:sticky lg:top-20 lg:self-start">
          <SectionHeading eyebrow="Choose a perk" title="Back this campaign" />
          {perks.length === 0 ? (
            <p className="text-sm text-muted">This campaign has no perks yet.</p>
          ) : (
            <div className="flex flex-col gap-3" role="radiogroup" aria-label="Perks">
              {perks.map((p) => <PerkOption key={p.id} perk={p} selected={selected === p.id} onSelect={() => pick(p)} disabled={!accepting} />)}
            </div>
          )}
          <Card elevated className="mt-4 flex flex-col gap-3 p-5">
            {perk ? (
              <>
                <KeyValue k="Your perk" v={perk.title} className="py-0" />
                <KeyValue k="Amount" v={<span className="num">{formatMoney(perk.priceMinor)}</span>} className="py-0" />
                <p className="text-xs text-muted">Charged when you back. No fees added at checkout. Refunded in full if the goal isn't met.</p>
              </>
            ) : (
              <p className="text-sm text-muted">Pick a perk above to continue.</p>
            )}
            <Button block disabled={!perk || !accepting} onClick={back}>{perk ? `Back with ${formatMoney(perk.priceMinor)}` : "Back this campaign"}</Button>
            {!session.session && (
              <p className="text-center text-xs text-muted">
                You'll create a free account and verify your email first.{" "}
                <Link to={`/login?next=${encodeURIComponent(perk ? `/checkout/${c.slug}?perk=${perk.id}` : `/campaigns/${c.slug}`)}`} className="text-gold hover:underline">Have one? Log in</Link>
              </p>
            )}
          </Card>
          <p className="mt-4 text-xs text-muted">
            Questions about how this works? Read <Link to="/trust" className="text-gold hover:underline">how money moves</Link> and our <Link to="/fees" className="text-gold hover:underline">fees</Link>.
          </p>
        </aside>
      </Container>
    </>
  );
}

async function share(title: string) {
  const url = window.location.href.split("?")[0];
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch { /* cancelled */ }
  }
  await navigator.clipboard?.writeText(url);
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

function PerkOption({ perk: p, selected, onSelect, disabled }: { perk: PerkView; selected: boolean; onSelect: () => void; disabled?: boolean }) {
  const soldOut = p.remaining === 0;
  const low = p.remaining !== null && p.remaining > 0 && p.limit !== null && p.remaining <= Math.max(10, p.limit * 0.15);
  const Icon = KIND_ICON[p.kind];
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={soldOut || disabled} onClick={onSelect} data-testid="perk-option"
      className={cn("flex w-full flex-col gap-3 rounded-lg border bg-surface p-5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-gold shadow-gold" : "border-line hover:border-muted/50 hover:bg-surface-2")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconChip tone={selected ? "gold" : "muted"} className="size-9 [&_svg]:size-4"><Icon /></IconChip>
          <div>
            <p className="font-semibold">{p.title}</p>
            {p.description && <p className="text-sm text-muted">{p.description}</p>}
          </div>
        </div>
        <span className="num shrink-0 text-lg font-medium">{formatMoney(p.priceMinor)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-xs text-muted">
        <span>Delivery by <span className="num">{formatDate(p.fulfillBy)}</span></span>
        {soldOut ? <Badge tone="neutral">Sold out</Badge> : p.remaining !== null ? (
          <span className={cn(low && "text-warning")}><span className="num">{p.remaining}</span> of <span className="num">{p.limit}</span> left</span>
        ) : <span>Unlimited</span>}
      </div>
    </button>
  );
}

const TRANCHE_STATUS: Record<string, string> = {
  pending: "Waiting", evidence_submitted: "Evidence submitted", verified: "Verified", released: "Released", rejected: "Not accepted",
};

function Story({ story, risks, tranches, goalMinor }: { story: string | null; risks: string | null; tranches: TrancheView[]; goalMinor: number }) {
  const hasMilestones = tranches.length > 1;
  if (!story && !risks && !hasMilestones) return <p className="text-sm text-muted">The artist hasn't added a story yet.</p>;
  return (
    <div className="flex flex-col gap-8">
      {story && <div className="whitespace-pre-line text-muted">{story}</div>}
      {risks && (
        <div>
          <h3 className="mb-2 text-lg font-semibold">Risks and challenges</h3>
          <p className="whitespace-pre-line text-muted">{risks}</p>
        </div>
      )}
      {hasMilestones && (
        <div>
          <h3 className="mb-4 text-lg font-semibold">Release milestones</h3>
          <ol className="flex flex-col gap-4 border-l border-line pl-6" data-testid="milestones">
            {tranches.map((t) => (
              <li key={t.seq} className="relative">
                <span className="num absolute -left-[33px] flex size-5 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] text-muted">{t.seq}</span>
                <p className="font-medium">{t.seq === 1 ? "Goal reached" : t.milestone} <span className="num text-sm text-muted">· {t.pct}% · {formatMoney((goalMinor * t.pct) / 100)} of the goal</span></p>
                <p className="text-sm text-muted">
                  {TRANCHE_STATUS[t.status] ?? t.status}
                  {t.releasedAt ? <> · released <span className="num">{formatDate(t.releasedAt.slice(0, 10))}</span></> : t.verifiedAt ? <> · verified <span className="num">{formatDate(t.verifiedAt.slice(0, 10))}</span></> : t.targetDate ? <> · target <span className="num">{formatDate(t.targetDate)}</span></> : null}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
      {FAQ.map((f, i) => (
        <div key={f.q}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left font-medium">
            {f.q}
            <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i && <p className="px-5 pb-5 text-sm text-muted">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}
