import { Link, useSearchParams } from "react-router";
import { ArrowRight, Gift, Megaphone, Radio, Shirt, Ticket, Users, Zap } from "lucide-react";
import { Badge, Button, Card, EscrowNotice, IconChip } from "@/components/brand";
import { OutcomeHero, RequirementsChecklist, STARTER_UNLOCKS, starterRequirements, useDisplayDraft } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/Tier1Unlock.tsx
 * Doc-driven changes: "TIER 1 UNLOCKED / You're Official!" → "Starter unlocked" (Brand §7.5; Tier 1 only as a
 * secondary label). Unlock list replaced with PRD 01 §6.3 Starter unlocks (reward campaigns up to $10K,
 * subscriptions, merch, tickets, live streams). Added the gate checklist and an "almost there" state
 * when a requirement is still open (preview with ?state=incomplete). Confetti/emoji dropped.
 */
const ICONS: Record<string, React.ReactNode> = {
  campaigns: <Megaphone />,
  subs: <Users />,
  merch: <Shirt />,
  tickets: <Ticket />,
  live: <Radio />,
};

export default function StarterUnlocked() {
  const [params] = useSearchParams();
  const { draft } = useDisplayDraft();
  const forceIncomplete = params.get("state") === "incomplete";
  const d = forceIncomplete ? { ...draft, trackUrl: "" } : draft;
  const items = starterRequirements(d, { identity: "met" });
  const unlocked = items.every((i) => i.status === "met");

  return (
    <div className="flex flex-col gap-10">
      {unlocked ? (
        <OutcomeHero icon={<Zap />} tone="gold" eyebrow={<>Starter unlocked <span className="text-muted">· Tier 1</span></>} title={<>Your business is <span className="text-gold">open.</span></>}>
          You've cleared every Starter requirement, {d.displayName}. Here's what you can run on FanZuP from today.
        </OutcomeHero>
      ) : (
        <OutcomeHero icon={<Gift />} tone="warning" eyebrow={<>Almost at Starter <span className="text-muted">· Tier 1</span></>} title="One step from Starter">
          You're verified. Finish the item below to unlock campaigns, subscriptions, merch, tickets and live streams.
        </OutcomeHero>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="unlocks">
        <div className="flex items-center justify-between gap-3">
          <h2 id="unlocks" className="text-xl font-semibold">
            {unlocked ? "What you've unlocked" : "What Starter unlocks"}
          </h2>
          <Badge tone={unlocked ? "success" : "neutral"}>{unlocked ? "Active" : "Locked"}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {STARTER_UNLOCKS.map((u, i) => (
            <Card key={u.key} className={i === 0 ? "flex gap-4 p-5 sm:col-span-2" : "flex gap-4 p-5"}>
              <IconChip tone={unlocked ? "gold" : "muted"}>{ICONS[u.key]}</IconChip>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold">{u.title}</h3>
                <p className="text-sm text-muted">{u.body}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <RequirementsChecklist tier="Starter" title={unlocked ? "Requirements" : "Finish to unlock"} items={items} />

      {unlocked && <EscrowNotice compact />}

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">Next: publish your profile so fans can find and follow you.</p>
        {unlocked ? (
          <Button asChild size="lg">
            <Link to="/artist-onboarding/complete">
              Publish my profile <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link to={items.find((i) => i.status !== "met")?.action?.to ?? "/artist-onboarding/review"}>
              Finish setup <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
