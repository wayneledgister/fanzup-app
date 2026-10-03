import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { Badge, Button, Card, Checkbox } from "@/components/brand";
import {
  ArtistStepLayout, DEMO_RISING, PlatformMark, RequirementsChecklist, RisingStepper, SOCIAL_PLATFORMS, WizardFooter, risingRequirements, updateRising, useArtistDraft, useRising,
} from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-tier2/Tier2Social.tsx
 * Doc-driven changes: the 1,000-follower gate is not in PRD 01 §6.3, so social accounts are optional
 * here (shown on future Pool pages as audience context) and this step becomes "Audience & submit"
 * with the full Rising checklist. Random follower counts removed.
 */
export default function RisingSocial() {
  const navigate = useNavigate();
  const draft = useArtistDraft();
  const rising = useRising();
  // Opened directly (design review): fill earlier steps with the sample so the checklist reads true.
  const effective = rising.business || rising.streaming ? rising : DEMO_RISING;
  const items = risingRequirements(effective);
  const ready = items.every((i) => i.status === "met");
  const [shown, setShown] = useState<Record<string, boolean>>(() => Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, !!draft.socials[p] || p === "Instagram"])));
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = () => {
    setSubmitting(true);
    if (effective === DEMO_RISING) updateRising(DEMO_RISING);
    setTimeout(() => navigate("/tier/rising/complete"), 1200);
  };

  return (
    <ArtistStepLayout
      stepper={<RisingStepper step="Audience" />}
      title="Show your audience, then submit"
      description="Choose which social accounts appear on your future Pool pages, check your requirements, and submit."
      footer={
        <WizardFooter backTo="/tier/rising/streaming">
          <Button size="lg" disabled={!ready || !confirm || submitting} onClick={submit}>
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Submitting
              </>
            ) : (
              <>
                Submit for Rising <ArrowRight />
              </>
            )}
          </Button>
        </WizardFooter>
      }
    >
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Social accounts</h2>
          <Badge tone="neutral">Optional</Badge>
        </div>
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {SOCIAL_PLATFORMS.map((p) => {
              const handle = draft.socials[p] ?? (p === "Instagram" ? "@rheakline" : undefined);
              return (
                <li key={p} className="flex items-center gap-4 p-4 sm:p-5">
                  <PlatformMark name={p} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p}</p>
                    <p className="truncate text-sm text-muted">{handle ?? "Not added to your profile"}</p>
                  </div>
                  {handle ? (
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
                      <input type="checkbox" className="size-4 accent-gold" checked={!!shown[p]} onChange={(e) => setShown((s) => ({ ...s, [p]: e.target.checked }))} />
                      Show
                    </label>
                  ) : (
                    <span className="text-sm text-muted/70">—</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="text-sm text-muted">Socials aren't a Rising requirement. Add or edit handles from your profile settings.</p>
      </section>

      <RequirementsChecklist tier="Rising" title="Ready to submit?" items={items} />

      <Checkbox id="confirm" checked={confirm} onChange={setConfirm}>
        The business and streaming details above are accurate. I understand Pools open only after FanZuP's funding-portal partner is live and each one is reviewed before launch.
      </Checkbox>
      {ready ? null : (
        <p className="text-sm text-warning">
          Finish the open requirements above to submit.
        </p>
      )}
    </ArtistStepLayout>
  );
}
