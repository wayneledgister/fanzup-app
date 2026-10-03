import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Camera, CheckCircle2, RotateCcw, ScanFace } from "lucide-react";
import { Button, Callout } from "@/components/brand";
import { ArtistStepper, PartnerFrame, WizardFooter, idTypeFrom } from "@/components/artist";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/kyc/ArtistKYCSelfie.tsx
 * Doc-driven changes: vendor branding removed (PRD 01 §9.7); "Verification complete!" after the
 * selfie changed to "Selfie captured" — the decision comes after review, not here.
 */
type Step = "ready" | "capturing" | "captured";

const PROMPTS = ["Look straight at the camera", "Turn your head slowly to the left", "Now to the right", "Blink twice"];

export default function KycSelfie() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const idType = idTypeFrom(params);
  const [step, setStep] = useState<Step>("ready");
  const [prompt, setPrompt] = useState(0);

  const start = () => {
    setStep("capturing");
    setPrompt(0);
    PROMPTS.forEach((_, i) => setTimeout(() => setPrompt(i), i * 700));
    setTimeout(() => setStep("captured"), PROMPTS.length * 700 + 300);
  };

  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <PartnerFrame step={3} title="Take a quick selfie" description="A short live check that matches your face to your ID photo.">
        <div className="flex flex-col items-center gap-4 py-2" aria-live="polite">
          <div
            className={cn(
              "relative flex size-56 items-center justify-center rounded-full border-4 bg-canvas transition-colors sm:size-64",
              step === "captured" ? "border-success" : step === "capturing" ? "border-gold" : "border-line border-dashed",
            )}
          >
            {step === "captured" ? <CheckCircle2 className="size-16 text-success" /> : <ScanFace className={cn("size-20", step === "capturing" ? "animate-pulse text-gold" : "text-muted")} />}
            {step === "capturing" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full border-2 border-gold/30" />}
          </div>
          <p className={cn("min-h-6 text-center font-medium", step === "captured" ? "text-success" : "text-fg")}>
            {step === "ready" && "Center your face in the circle"}
            {step === "capturing" && PROMPTS[prompt]}
            {step === "captured" && "Selfie captured"}
          </p>
        </div>

        {step === "ready" && (
          <>
            <Button size="lg" variant="secondary" onClick={start}>
              <Camera /> Start selfie check
            </Button>
            <Callout tone="info" title="Before you start">
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>Take off glasses, hats and masks</li>
                <li>Face a light source so your face is evenly lit</li>
                <li>You'll be asked to turn your head and blink</li>
              </ul>
            </Callout>
          </>
        )}
        {step === "captured" && (
          <Button variant="ghost" className="self-center" onClick={() => setStep("ready")}>
            <RotateCcw /> Retake
          </Button>
        )}
      </PartnerFrame>
      <WizardFooter backTo={`/artist-onboarding/verify/document?type=${idType.id}`}>
        <Button size="lg" disabled={step !== "captured"} onClick={() => navigate(`/artist-onboarding/verify/review?type=${idType.id}`)}>
          Continue <ArrowRight />
        </Button>
      </WizardFooter>
    </div>
  );
}
