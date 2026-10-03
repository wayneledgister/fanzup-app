import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button, ChoiceCard, IconChip } from "@/components/brand";
import { ArtistStepper, ID_TYPES, PartnerFrame, WizardFooter, type IdTypeId } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/kyc/ArtistKYCIdType.tsx
 * Doc-driven changes: vendor branding replaced by a neutral partner frame (PRD 01 §9.7); selection
 * is passed to the capture step so two-sided IDs ask for front and back.
 */
export default function KycIdType() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<IdTypeId | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <PartnerFrame step={1} title="Which ID will you use?" description="Pick a current, unexpired photo ID. The name on it needs to match your FanZuP account.">
        <div role="radiogroup" aria-label="ID type" className="flex flex-col gap-3">
          {ID_TYPES.map((t) => {
            const Icon = t.icon;
            const on = selected === t.id;
            return (
              <ChoiceCard key={t.id} selected={on} onSelect={() => setSelected(t.id)} className="flex items-center gap-4 p-4">
                <IconChip tone={on ? "gold" : "muted"} className="size-12">
                  <Icon />
                </IconChip>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-fg">{t.label}</span>
                  <span className="text-sm text-muted">{t.detail}</span>
                </span>
              </ChoiceCard>
            );
          })}
        </div>
        <p className="text-sm text-muted">Next you can take a photo or upload one you already have.</p>
      </PartnerFrame>
      <WizardFooter backTo="/artist-onboarding/verify">
        <Button size="lg" disabled={!selected} onClick={() => navigate(`/artist-onboarding/verify/document?type=${selected}`)}>
          Continue <ArrowRight />
        </Button>
      </WizardFooter>
    </div>
  );
}
