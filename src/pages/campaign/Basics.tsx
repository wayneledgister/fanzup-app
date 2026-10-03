import { useState } from "react";
import { Bus, Clapperboard, Disc3, Film, Mic2, ShieldCheck, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { Badge, Callout, ChoiceCard, Field, IconChip, TextInput } from "@/components/brand";
import { FormSection, MoneyInput, Segmented, WizardFooter, WizardHeader } from "@/components/campaign/WizardFrame";
import { CREATOR, MIN_GOAL, deadlineOf, goalGuidance, tierLimit, toInt, updateDraft, useDraft, validateBasics, digits } from "@/components/campaign/draft";
import type { CampaignType } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

/**
 * Source: FPS src/pages/campaign/CampaignBasics.tsx
 * Doc-driven changes: the wireframe's Revenue Share / Equity / Event Certificate types are removed —
 * the first product is a reward campaign only (Mechanism 05 "Fund My Show"). Reg CF $5M copy removed;
 * the goal is capped at the creator's tier limit (Starter $10K / Rising $100K) with realistic-goal guidance.
 * Duration capped at 60 days (90 removed) and "open for investments" copy rewritten.
 */

const TYPES: { value: CampaignType; label: string; blurb: string; icon: React.ReactNode }[] = [
  { value: "Show", label: "Fund My Show", blurb: "A headline night, hometown show or release party.", icon: <Mic2 /> },
  { value: "Tour", label: "Tour", blurb: "Travel, crew and production for a run of dates.", icon: <Bus /> },
  { value: "Album", label: "Album or EP", blurb: "Recording, mixing, mastering, pressing.", icon: <Disc3 /> },
  { value: "Music Video", label: "Music video", blurb: "Crew, locations and post-production.", icon: <Clapperboard /> },
  { value: "Documentary", label: "Documentary", blurb: "A film about the music and the people behind it.", icon: <Film /> },
];

export default function Basics() {
  const d = useDraft();
  const [show, setShow] = useState(false);
  const errors = show ? validateBasics(d) : {};
  const cap = tierLimit(CREATOR.tier);
  const guide = goalGuidance(CREATOR.subscribers, cap);
  const goal = toInt(d.goal);
  const presets = ["30", "45", "60"];
  const custom = !presets.includes(d.duration);
  const aboveGuide = Number.isFinite(goal) && goal > guide.high && goal <= cap;

  return (
    <>
      <WizardHeader step={1} title="Start your campaign" description="Set what you're raising for, how much you need and how long fans have to back it." />

      <FormSection title="What are you raising for?" description="Backers choose a perk you'll deliver. You'll set those up in step 3.">
        <div role="radiogroup" aria-label="Campaign type" data-error={!!errors.type || undefined} tabIndex={errors.type ? -1 : undefined} className="grid gap-3 sm:grid-cols-2">
          {TYPES.map((t) => (
            <ChoiceCard key={t.value} selected={d.type === t.value} onSelect={() => updateDraft({ type: t.value })} className="flex items-start gap-4 p-4">
              <IconChip tone={d.type === t.value ? "gold" : "muted"}>{t.icon}</IconChip>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-semibold text-fg">
                  {t.label}
                  {t.value === "Show" && <Badge tone="gold">Popular start</Badge>}
                </span>
                <span className="text-sm text-muted">{t.blurb}</span>
              </span>
            </ChoiceCard>
          ))}
        </div>
        {errors.type && <p className="text-sm text-error">{errors.type}</p>}
      </FormSection>

      <FormSection title="Name it">
        <Field label="Campaign title" htmlFor="title" error={errors.title} hint={<><span className="num">{d.title.length}</span>/70 · Say what fans are making happen, e.g. “Take the band on the road”.</>}>
          <TextInput id="title" value={d.title} maxLength={80} onChange={(e) => updateDraft({ title: e.target.value })} aria-invalid={!!errors.title || undefined} placeholder="Hometown headline night with the full band" />
        </Field>
      </FormSection>

      <FormSection
        title="Funding goal"
        description="All-or-nothing. If you don't reach your goal by the deadline, every backer is refunded automatically and no money is released."
      >
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconChip>
                <TrendingUp />
              </IconChip>
              <div>
                <p className="text-sm text-muted">Your tier</p>
                <p className="font-semibold">
                  {CREATOR.tier} <span className="font-normal text-muted">· campaign limit</span> <span className="num text-gold">${cap.toLocaleString()}</span>
                </p>
              </div>
            </div>
            <Link to="/for-artists#tiers" className="text-sm text-gold hover:underline">
              How tiers work
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {(["Starter", "Rising"] as const).map((t) => (
              <li key={t} className={cn("flex flex-wrap items-center justify-between gap-x-2 rounded-md border px-3 py-2", t === CREATOR.tier ? "border-gold/40 bg-gold/5" : "border-line")}>
                <span className={t === CREATOR.tier ? "text-fg" : "text-muted"}>{t}</span>
                <span className="num whitespace-nowrap text-muted">up to ${tierLimit(t).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>

        <Field label="Goal" htmlFor="goal" error={errors.goal} hint={`Between $${MIN_GOAL.toLocaleString()} and $${cap.toLocaleString()}. Set what the project actually costs, including perks and shipping.`}>
          <MoneyInput id="goal" value={d.goal} onChange={(v) => updateDraft({ goal: v })} invalid={!!errors.goal} placeholder="18,000" className="max-w-xs" />
        </Field>

        <GoalGauge goal={goal} low={guide.low} high={guide.high} cap={cap} />

        {aboveGuide ? (
          <Callout tone="warning" title="This goal is above our guidance">
            You can still submit it. Reviewers will look for a clear plan to reach it — a bigger fan list, a confirmed venue or press lined up. A
            missed goal means no money is released.
          </Callout>
        ) : (
          <Callout tone="info" title="Set a goal your fans can reach">
            With <span className="num">{CREATOR.subscribers.toLocaleString()}</span> subscribers, a goal around{" "}
            <span className="num text-fg">${guide.low.toLocaleString()}–${guide.high.toLocaleString()}</span> is a realistic place to start. This is guidance,
            not a rule.
          </Callout>
        )}
      </FormSection>

      <FormSection title="Timing" description="Shorter campaigns create urgency. Most artists pick 30–45 days.">
        <Field label="Campaign length" htmlFor="duration-custom" error={errors.duration}>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Campaign length"
              value={custom ? "custom" : d.duration}
              onChange={(v) => updateDraft({ duration: v === "custom" ? "" : v })}
              options={[...presets.map((p) => ({ value: p, label: <span className="num">{p} days</span> })), { value: "custom", label: "Custom" }]}
            />
            {custom && (
              <div className="flex items-center gap-2">
                <TextInput id="duration-custom" inputMode="numeric" className="num w-20" value={d.duration} onChange={(e) => updateDraft({ duration: digits(e.target.value).slice(0, 2) })} aria-invalid={!!errors.duration || undefined} placeholder="21" />
                <span className="text-sm text-muted">days (7–60)</span>
              </div>
            )}
          </div>
        </Field>

        <Field label="Launch" htmlFor="launch-date" error={errors.launchDate}>
          <Segmented
            label="Launch"
            value={d.launch}
            onChange={(v) => updateDraft({ launch: v })}
            options={[
              { value: "on-approval", label: "As soon as it's approved" },
              { value: "scheduled", label: "On a date I choose" },
            ]}
          />
          {d.launch === "scheduled" && (
            <TextInput id="launch-date" type="date" className="num mt-2 max-w-xs" value={d.launchDate} onChange={(e) => updateDraft({ launchDate: e.target.value })} aria-invalid={!!errors.launchDate || undefined} />
          )}
        </Field>

        {Number.isFinite(toInt(d.duration)) && (
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold" />
            <p className="text-muted">
              {d.launch === "scheduled" && d.launchDate ? "Your campaign would end on " : "If approved in about 2 business days, your campaign would end around "}
              <span className="num text-fg">{formatDate(deadlineOf(d).toISOString())}</span>. Backers' money stays in escrow until then.
            </p>
          </div>
        )}
      </FormSection>

      <WizardFooter
        step={1}
        onContinue={() => {
          setShow(true);
          return Object.keys(validateBasics(d)).length === 0;
        }}
      />
    </>
  );
}

/** Where the goal sits against guidance and the tier limit. */
function GoalGauge({ goal, low, high, cap }: { goal: number; low: number; high: number; cap: number }) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / cap) * 100));
  const has = Number.isFinite(goal) && goal > 0;
  const over = has && goal > cap;
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="relative h-2 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 rounded-full bg-info/30" style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }} />
        {has && (
          <div
            className={cn("absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-canvas", over ? "bg-error" : goal > high ? "bg-warning" : "bg-gold")}
            style={{ left: `${pct(goal)}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span className="num">$0</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-info/50" /> Suggested range
        </span>
        <span className="num">${cap.toLocaleString()} limit</span>
      </div>
    </div>
  );
}
