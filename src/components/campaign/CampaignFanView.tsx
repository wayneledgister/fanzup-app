/**
 * The public reward-campaign page as fans see it. Used by the wizard Preview step and by the
 * compliance reviewer so both look at exactly what will go live. Layout adapts to its container
 * (narrow inside the wizard, two columns in the admin workspace).
 */
import { BadgeCheck, CalendarClock, Check, Flag, Gift, MapPin, Package, Sparkles, Truck, Wallet } from "lucide-react";
import { ArtistArt, Badge, Button, EscrowNotice, FundingProgress, IconChip } from "@/components/brand";
import type { Artist } from "@/lib/mock";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CREATOR, deadlineOf, formatMonth, toInt, type CampaignDraft, type PerkKind, type ShipsTo } from "./draft";

export interface CampaignView {
  title: string;
  type: string;
  blurb: string;
  story: string;
  risks: string;
  city: string;
  artist: Artist;
  coverSeed: string;
  goalMinor: number;
  raisedMinor: number;
  backers: number;
  durationDays: number;
  deadline: string; // ISO
  useOfFunds: { label: string; amountMinor: number }[];
  release: { kind: "single" | "milestones"; tranches: { pct: number; milestone?: string; targetDate?: string; evidence?: string }[] };
  perks: { id: string; title: string; priceMinor: number; description: string; kind: PerkKind; items: string[]; limit?: number; claimed?: number; fulfillBy: string; shipsTo?: ShipsTo }[];
}

const SHIPS: Record<ShipsTo, string> = { us: "Ships within the US", na: "Ships to the US and Canada", world: "Ships worldwide" };
const KIND_ICON: Record<PerkKind, React.ReactNode> = { digital: <Sparkles />, physical: <Package />, experience: <Gift /> };

export function viewFromDraft(d: CampaignDraft): CampaignView {
  const dollars = (s: string) => (toInt(s) || 0) * 100;
  return {
    title: d.title || "Untitled campaign",
    type: d.type === "Show" ? "Fund My Show" : d.type || "Campaign",
    blurb: d.blurb,
    story: d.story,
    risks: d.risks,
    city: d.city,
    artist: CREATOR,
    coverSeed: CREATOR.id + d.coverName,
    goalMinor: dollars(d.goal),
    raisedMinor: 0,
    backers: 0,
    durationDays: toInt(d.duration) || 0,
    deadline: deadlineOf(d).toISOString(),
    useOfFunds: d.useOfFunds.filter((l) => l.label.trim()).map((l) => ({ label: l.label, amountMinor: dollars(l.amount) })),
    release: {
      kind: d.release,
      tranches: d.tranches.map((t) => ({ pct: toInt(t.pct) || 0, milestone: t.milestone, targetDate: t.targetDate, evidence: t.evidence })),
    },
    perks: d.perks.map((p) => ({
      id: p.id,
      title: p.title || "Untitled perk",
      priceMinor: dollars(p.price),
      description: p.description,
      kind: p.kind,
      items: p.items.filter((i) => i.trim()),
      limit: toInt(p.limit) || undefined,
      fulfillBy: p.fulfillBy,
      shipsTo: p.kind === "physical" ? p.shipsTo : undefined,
    })),
  };
}

export function CampaignFanView({ v, className }: { v: CampaignView; className?: string }) {
  const goal = v.goalMinor || 1;
  return (
    <article className={cn("@container", className)}>
      {/* Cover */}
      <div className="relative overflow-hidden rounded-lg">
        <ArtistArt seed={v.coverSeed} label={v.title} className="aspect-[16/9] w-full rounded-none" />
        <div className="absolute inset-0 bg-scrim" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 @lg:p-6">
          <div className="flex flex-wrap gap-2">
            <Badge tone="gold">{v.type}</Badge>
            <Badge tone="neutral" icon={<MapPin />}>
              {v.city}
            </Badge>
          </div>
          <h2 className="text-2xl font-bold @lg:text-3xl">{v.title}</h2>
        </div>
      </div>

      <div className="mt-6 grid gap-8 @4xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {v.blurb && <p className="text-lg text-fg">{v.blurb}</p>}

          {/* Artist */}
          <div className="flex items-center gap-3">
            <ArtistArt seed={v.artist.id} label={v.artist.name} rounded="full" className="size-11 shrink-0" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-semibold">
                {v.artist.name}
                {v.artist.verified && <BadgeCheck className="size-4 text-success" aria-label="Identity verified" />}
              </p>
              <p className="text-sm text-muted">
                {v.artist.genre} · {v.artist.tier} artist
              </p>
            </div>
          </div>

          {/* Funding box inline on narrow containers */}
          <div className="@4xl:hidden">
            <FundingBox v={v} />
          </div>

          <Section title="The story">
            <div className="flex flex-col gap-3 text-muted">
              {(v.story || "No story yet.").split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </Section>

          {v.useOfFunds.length > 0 && (
            <Section title="Where the money goes">
              <ul className="flex flex-col gap-3">
                {v.useOfFunds.map((l) => (
                  <li key={l.label} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg">{l.label}</span>
                      <span className="num text-muted">${(l.amountMinor / 100).toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent-teal" style={{ width: `${Math.min(100, (l.amountMinor / goal) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="When the artist gets paid">
            {v.release.kind === "single" ? (
              <div className="flex items-start gap-3 text-sm text-muted">
                <IconChip>
                  <Wallet />
                </IconChip>
                <p>
                  Funds are released to the artist in one payment once the goal is met and the campaign closes on{" "}
                  <span className="num text-fg">{formatDate(v.deadline)}</span>.
                </p>
              </div>
            ) : (
              <ol className="relative flex flex-col gap-5 border-l border-line pl-6">
                {v.release.tranches.map((t, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[31px] top-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-canvas bg-gold" aria-hidden />
                    <p className="text-sm font-semibold text-fg">
                      <span className="num">{t.pct}%</span> · {i === 0 ? "When the campaign is funded" : t.milestone || `Milestone ${i}`}
                    </p>
                    <p className="text-sm text-muted">
                      {i === 0 ? (
                        <>
                          <span className="num">${Math.round((v.goalMinor * t.pct) / 10000).toLocaleString()}</span> after the deadline
                        </>
                      ) : (
                        <>
                          Held in escrow until FanZuP verifies {t.evidence ? t.evidence.toLowerCase() : "proof"}
                          {t.targetDate ? (
                            <>
                              {" "}
                              · target <span className="num">{formatDate(t.targetDate)}</span>
                            </>
                          ) : null}
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Perks" id="perks">
            {v.perks.length === 0 ? (
              <p className="text-sm text-muted">No perks yet.</p>
            ) : (
              <ul className="grid gap-4 @2xl:grid-cols-2">
                {v.perks.map((p) => {
                  const left = p.limit !== undefined ? p.limit - (p.claimed ?? 0) : undefined;
                  return (
                    <li key={p.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-muted [&_svg]:size-3.5">
                          {KIND_ICON[p.kind]}
                          <span className="capitalize">{p.kind}</span>
                        </div>
                        {left !== undefined && (
                          <Badge tone={left > 0 ? "neutral" : "error"}>
                            <span className="num">{left.toLocaleString()}</span>&nbsp;left
                          </Badge>
                        )}
                      </div>
                      <div>
                        <p className="num text-2xl font-medium text-fg">${(p.priceMinor / 100).toLocaleString()}</p>
                        <h4 className="mt-1 text-base font-semibold">{p.title}</h4>
                      </div>
                      {p.description && <p className="text-sm text-muted">{p.description}</p>}
                      {p.items.length > 0 && (
                        <ul className="flex flex-col gap-1.5 text-sm">
                          {p.items.map((it) => (
                            <li key={it} className="flex items-start gap-2 text-fg">
                              <Check className="mt-0.5 size-4 shrink-0 text-gold" />
                              {it}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
                        <span className="flex items-center gap-1.5">
                          <CalendarClock className="size-3.5" /> Estimated delivery <span className="text-fg">{formatMonth(p.fulfillBy)}</span>
                        </span>
                        {p.shipsTo && (
                          <span className="flex items-center gap-1.5">
                            <Truck className="size-3.5" /> {SHIPS[p.shipsTo]}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {v.risks && (
            <Section title="Risks and challenges">
              <div className="flex items-start gap-3 text-sm text-muted">
                <Flag className="mt-0.5 size-4 shrink-0" />
                <p>{v.risks}</p>
              </div>
            </Section>
          )}
        </div>

        <aside className="hidden @4xl:block">
          <div className="sticky top-20">
            <FundingBox v={v} />
          </div>
        </aside>
      </div>
    </article>
  );
}

function FundingBox({ v }: { v: CampaignView }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <FundingProgress raisedMinor={v.raisedMinor} goalMinor={v.goalMinor} backers={v.backers} daysLeft={v.durationDays} />
      <Button block size="lg" disabled aria-disabled title="Backing opens when the campaign goes live">
        Back this campaign
      </Button>
      <p className="text-center text-xs text-muted">
        Ends <span className="num">{formatDate(v.deadline)}</span> · All-or-nothing
      </p>
      <EscrowNotice />
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">{title}</h3>
      {children}
    </section>
  );
}
