import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Camera, CheckCircle2, Eye, RotateCcw, Smile, Sun } from "lucide-react";
import { Badge, Button } from "@/components/brand";
import { KycFrame, PartnerBanner, WizardFooter } from "@/components/invest/ui";
import { parseDoc } from "@/components/invest/kyc";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/onboarding/kyc/KYCSelfie.tsx (wireframe).
 * Changes: reference rendering of the identity partner's liveness step. The "simulate next prompt"
 * control stays as the demo driver; in production the SDK runs the prompts.
 */
type Live = "idle" | "face" | "blink" | "turn" | "done";
const SEQ: Live[] = ["idle", "face", "blink", "turn", "done"];
const PROMPT: Record<Live, { label: string; sub: string }> = {
  idle: { label: "Center your face in the oval", sub: "Hold your phone at eye level" },
  face: { label: "Face found — hold still", sub: "Checking alignment" },
  blink: { label: "Blink naturally", sub: "Liveness check 1 of 2" },
  turn: { label: "Slowly turn your head to the right", sub: "Liveness check 2 of 2" },
  done: { label: "Selfie captured", sub: "Liveness confirmed" },
};

export default function KycSelfie() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const doc = parseDoc(params.get("doc"));
  const [step, setStep] = useState<Live>("idle");
  const [error, setError] = useState(false);
  const done = step === "done";
  const idx = SEQ.indexOf(step);

  const next = () => {
    if (!done) {
      setError(true);
      return;
    }
    navigate(`/onboarding/kyc/review?doc=${doc}`);
  };

  return (
    <KycFrame
      step={4}
      title="Take a quick selfie"
      description="This confirms the person on the ID is you, and that you're here in person."
      footer={
        <WizardFooter backTo={`/onboarding/kyc/document?doc=${doc}`}>
          <Button onClick={next}>
            Continue <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <PartnerBanner />

      <div className="flex flex-col items-center gap-5 rounded-lg border border-line bg-surface-2 px-4 py-8">
        <div className="relative flex aspect-[3/4] w-48 items-center justify-center sm:w-56">
          <div
            className={cn(
              "absolute inset-0 rounded-[50%] border-2 transition-colors duration-300",
              done ? "border-success" : idx > 0 ? "border-gold" : "border-dashed border-muted/50",
            )}
          />
          {done ? <CheckCircle2 className="size-12 text-success" aria-hidden /> : <Camera className="size-10 text-muted/60" aria-hidden />}
          <Badge tone="neutral" className="absolute -top-3">
            Front camera
          </Badge>
        </div>
        <div className="flex flex-col items-center gap-1 text-center" aria-live="polite">
          <p className="font-semibold text-fg">{PROMPT[step].label}</p>
          <p className="text-sm text-muted">{PROMPT[step].sub}</p>
        </div>
        {idx > 0 && (
          <div className="flex gap-2" aria-hidden>
            {SEQ.slice(1).map((s, i) => (
              <span key={s} className={cn("h-1.5 w-8 rounded-full", i < idx ? (done ? "bg-success" : "bg-gold") : "bg-line")} />
            ))}
          </div>
        )}
        {done ? (
          <Button variant="secondary" onClick={() => setStep("idle")}>
            <RotateCcw /> Retake selfie
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setStep(SEQ[idx + 1])}>
            <Camera /> {step === "idle" ? "Start selfie check" : "Next prompt (demo)"}
          </Button>
        )}
      </div>

      <ul className="grid gap-2 text-sm text-muted sm:grid-cols-3">
        {[
          { i: <Eye />, t: "Look straight at the camera" },
          { i: <Smile />, t: "No sunglasses, hats or masks" },
          { i: <Sun />, t: "Light on your face, not behind you" },
        ].map((x) => (
          <li key={x.t} className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-gold">
            {x.i}
            {x.t}
          </li>
        ))}
      </ul>

      {error && !done && (
        <p className="text-sm text-error" role="alert">
          Finish the selfie check to continue.
        </p>
      )}
    </KycFrame>
  );
}
