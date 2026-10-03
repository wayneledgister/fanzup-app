import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, Headphones, Landmark, ShieldCheck } from "lucide-react";
import { Badge, Button, Callout, ChoiceCard, IconChip } from "@/components/brand";
import { useFlag } from "@/lib/flags";
import { OnboardingFooter, OnboardingHeader } from "@/components/public/onboarding";
import { cn } from "@/lib/utils";

/**
 * Source: FPS onboarding/StepPathChoice.tsx.
 * Doc-driven changes: "Fan Subscriber" → "Fan" (Layer 1, always available). "Fan Investor" perks "Earn returns tied to
 * artist success" / "Equity holder perks & voting rights" removed (Brand §7.4, CONSOLIDATION fan-perk rule); Investor is
 * only selectable with `layer2`, otherwise shown disabled as "Coming later". Investor CTA → /onboarding/kyc.
 */

type Path = "fan" | "investor";

const FAN_PERKS = ["Back campaigns and get perks — tickets, vinyl, credits", "Subscribe for exclusive posts and presales", "Buy merch and tickets direct from artists", "No ID verification needed"];
const INVESTOR_PERKS = [
  "Everything a fan gets, plus:",
  "Eligible to invest in Reg CF Pools, subject to annual limits",
  "Every Pool shows its Form C, risks and 12-month lock-up first",
  "Investments are risky — you could lose all of it",
];

export default function PathChoice() {
  const navigate = useNavigate();
  const layer2 = useFlag("layer2");
  const [path, setPath] = useState<Path | null>(null);

  const go = () => navigate(path === "investor" ? "/onboarding/kyc" : "/onboarding/profile");

  return (
    <div>
      <OnboardingHeader step={2} title="How do you want to take part?" description="You can change this anytime from Settings." />

      <div className="grid gap-4 md:grid-cols-2" role="radiogroup" aria-label="Account path">
        <ChoiceCard selected={path === "fan"} onSelect={() => setPath("fan")} className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <IconChip tone={path === "fan" ? "gold" : "muted"}>
              <Headphones />
            </IconChip>
            <Badge tone="success">No verification</Badge>
          </div>
          <div>
            <p className="text-lg font-semibold">Fan</p>
            <p className="text-sm text-muted">Back, subscribe and show up for the artists you love.</p>
          </div>
          <PerkList items={FAN_PERKS} />
        </ChoiceCard>

        <ChoiceCard selected={path === "investor"} onSelect={() => setPath("investor")} disabled={!layer2} className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <IconChip tone={path === "investor" ? "gold" : "muted"}>
              <Landmark />
            </IconChip>
            {layer2 ? <Badge tone="warning">ID verification required</Badge> : <Badge tone="neutral">Coming later</Badge>}
          </div>
          <div>
            <p className="text-lg font-semibold">Investor</p>
            <p className="text-sm text-muted">
              {layer2 ? "Verify your identity to view and invest in regulated Pools." : "Investment Pools aren't open yet. We'll let you know when they are."}
            </p>
          </div>
          <PerkList items={INVESTOR_PERKS} muted={!layer2} />
        </ChoiceCard>
      </div>

      {path === "investor" && (
        <Callout tone="info" icon={<ShieldCheck />} title="You'll verify your identity with our partner" className="mt-6">
          Regulation requires us to confirm who you are before you can invest. You'll be handed to our identity-verification partner — it
          takes about 5–10 minutes and you'll need a government-issued photo ID.
        </Callout>
      )}

      <OnboardingFooter
        back="/onboarding/account"
        skip={
          <Button variant="ghost" size="lg" onClick={() => navigate("/onboarding/profile")}>
            Decide later
          </Button>
        }
        primary={
          <Button size="lg" disabled={!path} onClick={go}>
            {path === "investor" ? "Start verification" : "Continue"}
          </Button>
        }
      />
    </div>
  );
}

function PerkList({ items, muted }: { items: string[]; muted?: boolean }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((p, i) => (
        <li key={p} className={cn("flex gap-2", muted ? "text-muted" : "text-fg", i === 0 && p.endsWith(":") && "font-medium")}>
          {!p.endsWith(":") && <Check className={cn("mt-0.5 size-4 shrink-0", muted ? "text-muted" : "text-success")} />}
          {p}
        </li>
      ))}
    </ul>
  );
}
