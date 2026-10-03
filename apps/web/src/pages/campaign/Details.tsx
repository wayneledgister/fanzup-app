import { useState } from "react";
import { Flag, ImagePlus, Layers, Plus, Trash2, Wallet as WalletIcon, X } from "lucide-react";
import { Link } from "react-router";
import { ArtistArt, Button, Callout, ChoiceCard, Field, IconChip, ProgressBar, Select, TextArea, TextInput } from "@/components/brand";
import { FormSection, MoneyInput, WizardFooter, WizardHeader } from "@/components/campaign/WizardFrame";
import { CREATOR, deadlineOf, toInt, uid, updateDraft, useDraft, validateDetails, digits, type Tranche } from "@/components/campaign/draft";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

/**
 * Source: FPS src/pages/campaign/CampaignDetails.tsx
 * Doc-driven changes: the wireframe's cost-per-unit, payout cap, equity %, valuation and "minimum units for
 * perks" fields are removed — reward campaigns have no units or financial terms (Mechanism 05). Its invented
 * fees (5% fan fee, 3.5% pool fee, 10% platform cut) are dropped: platform fees are TBD (docs/brand/fees.html).
 * Replaced with what a reward campaign needs: pitch, cover, story, risks, use of funds, and an optional
 * milestone (tranche) release schedule.
 */

const EVIDENCE = ["Signed venue or vendor contract", "Receipts or invoices", "Studio or rehearsal booking", "Published release link", "Photos or video of the work"];

export default function Details() {
  const d = useDraft();
  const [show, setShow] = useState(false);
  const errors = show ? validateDetails(d) : {};
  const goal = toInt(d.goal);
  const hasGoal = Number.isFinite(goal) && goal > 0;
  const fundsTotal = d.useOfFunds.reduce((s, l) => s + (toInt(l.amount) || 0), 0);
  const deadline = deadlineOf(d);

  const setLine = (id: string, patch: Partial<{ label: string; amount: string }>) =>
    updateDraft((s) => ({ useOfFunds: s.useOfFunds.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setTranche = (id: string, patch: Partial<Tranche>) => updateDraft((s) => ({ tranches: s.tranches.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const trancheTotal = d.tranches.reduce((s, t) => s + (toInt(t.pct) || 0), 0);

  return (
    <>
      <WizardHeader step={2} title="Tell fans the story" description="What you're making, why it matters and exactly where the money goes." />

      <FormSection title="The pitch">
        <Field label="One-line pitch" htmlFor="blurb" error={errors.blurb} hint={<><span className="num">{d.blurb.length}</span>/140 · Shown on campaign cards in Discover.</>}>
          <TextInput id="blurb" value={d.blurb} maxLength={160} onChange={(e) => updateDraft({ blurb: e.target.value })} aria-invalid={!!errors.blurb || undefined} placeholder="One night with the full horn section. No backing tracks." />
        </Field>

        <Field label="Cover image" htmlFor="cover" error={errors.cover} hint="JPG or PNG, at least 1600×1000. Your own photography or artwork only.">
          {d.coverName ? (
            <div className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3">
              <ArtistArt seed={CREATOR.id + d.coverName} label={d.title || CREATOR.name} className="aspect-[16/10] w-28 shrink-0" rounded="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{d.coverName}</p>
                <p className="text-xs text-muted">Ready</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Remove cover image" onClick={() => updateDraft({ coverName: "" })}>
                <X />
              </Button>
            </div>
          ) : (
            <label
              htmlFor="cover"
              data-error={!!errors.cover || undefined}
              tabIndex={-1}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed bg-surface px-6 py-8 text-center transition-colors hover:border-gold/60 focus-within:border-gold",
                errors.cover ? "border-error" : "border-line",
              )}
            >
              <ImagePlus className="size-6 text-gold" />
              <span className="text-sm font-medium text-fg">Upload a cover image</span>
              <span className="text-xs text-muted">Drag a file here or choose one</span>
              <input id="cover" type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => updateDraft({ coverName: e.target.files?.[0]?.name ?? "" })} />
            </label>
          )}
        </Field>

        <Field label="City" htmlFor="city" error={errors.city} hint="Where the project happens.">
          <TextInput id="city" value={d.city} onChange={(e) => updateDraft({ city: e.target.value })} aria-invalid={!!errors.city || undefined} className="max-w-sm" />
        </Field>
      </FormSection>

      <FormSection title="Your story" description="Write it like you'd tell a fan after a show. Be specific about what you're making and when.">
        <Field label="Story" htmlFor="story" error={errors.story} hint={<><span className="num">{d.story.length}</span> characters · At least 150.</>}>
          <TextArea id="story" rows={8} value={d.story} onChange={(e) => updateDraft({ story: e.target.value })} aria-invalid={!!errors.story || undefined} placeholder="I've opened for other artists in this room a dozen times. This is the first night that's ours…" />
        </Field>
        <Field label="Risks and challenges" htmlFor="risks" error={errors.risks} hint="What could delay delivery, and what you'll do if it happens. Backers see this on your page.">
          <TextArea id="risks" rows={4} value={d.risks} onChange={(e) => updateDraft({ risks: e.target.value })} aria-invalid={!!errors.risks || undefined} placeholder="If the venue reschedules, ticket perks carry over to the new date…" />
        </Field>
      </FormSection>

      <FormSection title="Where the money goes" description="Break your goal into real costs. Include perk production, shipping and payment processing.">
        <div className="flex flex-col gap-3" data-error={!!errors.useOfFunds || undefined} tabIndex={errors.useOfFunds ? -1 : undefined}>
          <div className="hidden grid-cols-[1fr_9rem_2.75rem] gap-3 text-xs text-muted sm:grid">
            <span>Cost</span>
            <span>Amount</span>
          </div>
          {d.useOfFunds.map((l, i) => (
            <div key={l.id} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_9rem_2.75rem] sm:gap-3">
              <div className="col-span-2 sm:col-span-1">
                <TextInput aria-label={`Cost ${i + 1}`} value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} placeholder={i === 0 ? "Venue hire + production" : "Band and crew"} aria-invalid={!!errors[`fund-${l.id}-label`] || undefined} />
                {errors[`fund-${l.id}-label`] && <p className="mt-1 text-sm text-error">{errors[`fund-${l.id}-label`]}</p>}
              </div>
              <div>
                <MoneyInput id={`fund-${l.id}`} value={l.amount} onChange={(v) => setLine(l.id, { amount: v })} invalid={!!errors[`fund-${l.id}-amount`]} placeholder="0" />
                {errors[`fund-${l.id}-amount`] && <p className="mt-1 text-sm text-error">{errors[`fund-${l.id}-amount`]}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove cost ${i + 1}`}
                disabled={d.useOfFunds.length <= 2}
                onClick={() => updateDraft((s) => ({ useOfFunds: s.useOfFunds.filter((x) => x.id !== l.id) }))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm" disabled={d.useOfFunds.length >= 8} onClick={() => updateDraft((s) => ({ useOfFunds: [...s.useOfFunds, { id: uid("f"), label: "", amount: "" }] }))}>
              <Plus /> Add a cost
            </Button>
          </div>

          <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">Breakdown total</span>
              <span>
                <span className={cn("num", hasGoal && fundsTotal === goal ? "text-success" : "text-fg")}>${fundsTotal.toLocaleString()}</span>
                <span className="text-muted"> of </span>
                <span className="num text-muted">{hasGoal ? `$${goal.toLocaleString()}` : "—"}</span>
              </span>
            </div>
            <ProgressBar value={fundsTotal} max={hasGoal ? goal : 1} tone={hasGoal && fundsTotal === goal ? "success" : "gold"} label="Use of funds against goal" />
            {!hasGoal && (
              <p className="text-xs text-muted">
                Set your goal in{" "}
                <Link to="/creator/campaigns/new/basics" className="text-gold hover:underline">
                  Basics
                </Link>{" "}
                first.
              </p>
            )}
          </div>
          {errors.useOfFunds && <p className="text-sm text-error">{errors.useOfFunds}</p>}
          <p className="text-xs text-muted">
            Card payments carry a processing fee of <span className="num">2.9% + $0.30</span> per backing. FanZuP's platform fee is on the{" "}
            <Link to="/fees" className="text-gold hover:underline">
              Fees page
            </Link>
            .
          </p>
        </div>
      </FormSection>

      <FormSection title="When funds are released" description="Money stays in escrow until your goal is met. You can also release it in stages as you hit milestones.">
        <div role="radiogroup" aria-label="Release schedule" className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard selected={d.release === "single"} onSelect={() => updateDraft({ release: "single" })} className="flex gap-4 p-4">
            <IconChip tone={d.release === "single" ? "gold" : "muted"}>
              <WalletIcon />
            </IconChip>
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-fg">All at once</span>
              <span className="text-sm text-muted">Released when the campaign is funded and the deadline passes.</span>
            </span>
          </ChoiceCard>
          <ChoiceCard selected={d.release === "milestones"} onSelect={() => updateDraft({ release: "milestones" })} className="flex gap-4 p-4">
            <IconChip tone={d.release === "milestones" ? "gold" : "muted"}>
              <Layers />
            </IconChip>
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-fg">In milestones</span>
              <span className="text-sm text-muted">Part on funding, the rest after a milestone we verify. Builds backer trust.</span>
            </span>
          </ChoiceCard>
        </div>

        {d.release === "milestones" && (
          <div className="flex flex-col gap-4">
            <TrancheBar tranches={d.tranches} goal={hasGoal ? goal : 0} />
            <ol className="flex flex-col gap-4">
              {d.tranches.map((t, i) => (
                <li key={t.id} className="rounded-lg border border-line bg-surface p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="num flex size-7 items-center justify-center rounded-full border border-line bg-surface-2 text-xs text-gold">{i + 1}</span>
                      <h3 className="text-base font-semibold">{i === 0 ? "On funding" : `Milestone ${i}`}</h3>
                    </div>
                    {i > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => updateDraft((s) => ({ tranches: s.tranches.filter((x) => x.id !== t.id) }))}>
                        <Trash2 /> Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                    <Field label="Release" htmlFor={`tr-${t.id}-pct`} error={errors[`tr-${t.id}-pct`]}>
                      <div className="relative">
                        <TextInput id={`tr-${t.id}-pct`} inputMode="numeric" className="num pr-8" value={t.pct} onChange={(e) => setTranche(t.id, { pct: digits(e.target.value).slice(0, 2) })} aria-invalid={!!errors[`tr-${t.id}-pct`] || undefined} />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
                      </div>
                    </Field>
                    {i === 0 ? (
                      <p className="self-end pb-3 text-sm text-muted">
                        Released after the campaign is funded and closes
                        {hasGoal && toInt(t.pct) ? (
                          <>
                            {" "}
                            — <span className="num text-fg">${Math.round((goal * toInt(t.pct)) / 100).toLocaleString()}</span>
                          </>
                        ) : null}
                        .
                      </p>
                    ) : (
                      <Field label="Milestone" htmlFor={`tr-${t.id}-milestone`} error={errors[`tr-${t.id}-milestone`]}>
                        <TextInput id={`tr-${t.id}-milestone`} value={t.milestone} onChange={(e) => setTranche(t.id, { milestone: e.target.value })} aria-invalid={!!errors[`tr-${t.id}-milestone`] || undefined} placeholder="Venue contract signed and show date announced" />
                      </Field>
                    )}
                    {i > 0 && (
                      <>
                        <Field label="Target date" htmlFor={`tr-${t.id}-date`} error={errors[`tr-${t.id}-date`]} className="sm:col-start-1">
                          <TextInput id={`tr-${t.id}-date`} type="date" className="num" value={t.targetDate} onChange={(e) => setTranche(t.id, { targetDate: e.target.value })} aria-invalid={!!errors[`tr-${t.id}-date`] || undefined} />
                        </Field>
                        <Field label="Proof you'll upload" htmlFor={`tr-${t.id}-evidence`} error={errors[`tr-${t.id}-evidence`]}>
                          <Select id={`tr-${t.id}-evidence`} value={t.evidence} onChange={(e) => setTranche(t.id, { evidence: e.target.value })} aria-invalid={!!errors[`tr-${t.id}-evidence`] || undefined}>
                            <option value="">Choose…</option>
                            {EVIDENCE.map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </Select>
                        </Field>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={d.tranches.length >= 3}
                onClick={() => updateDraft((s) => ({ tranches: [...s.tranches, { id: uid("tr"), pct: "", milestone: "", targetDate: "", evidence: "" }] }))}
              >
                <Plus /> Add a milestone
              </Button>
              <span className={cn("text-sm", trancheTotal === 100 ? "text-success" : "text-muted")}>
                Total <span className="num">{trancheTotal}%</span> of <span className="num">100%</span>
              </span>
            </div>
            {errors.tranches && (
              <p className="text-sm text-error" data-error="true" tabIndex={-1}>
                {errors.tranches}
              </p>
            )}
            <Callout tone="info" icon={<Flag />} title="How milestone release works">
              Unreleased funds stay with our escrow partner. When you upload proof, a reviewer checks it — usually within 2 business days (estimate) — and
              releases the next stage. Milestones must fall after your deadline of <span className="num text-fg">{formatDate(deadline.toISOString())}</span>.
            </Callout>
          </div>
        )}
      </FormSection>

      <WizardFooter
        step={2}
        onContinue={() => {
          setShow(true);
          return Object.keys(validateDetails(d)).length === 0;
        }}
      />
    </>
  );
}

function TrancheBar({ tranches, goal }: { tranches: Tranche[]; goal: number }) {
  const tones = ["bg-gold", "bg-accent-teal", "bg-accent-cyan"];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {tranches.map((t, i) => (
          <div key={t.id} className={cn("h-full border-r-2 border-canvas last:border-r-0", tones[i])} style={{ width: `${Math.min(100, toInt(t.pct) || 0)}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {tranches.map((t, i) => (
          <li key={t.id} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-2 rounded-full", tones[i])} />
            {i === 0 ? "On funding" : `Milestone ${i}`} · <span className="num text-fg">{toInt(t.pct) || 0}%</span>
            {goal > 0 && toInt(t.pct) ? <span className="num">(${Math.round((goal * toInt(t.pct)) / 100).toLocaleString()})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
