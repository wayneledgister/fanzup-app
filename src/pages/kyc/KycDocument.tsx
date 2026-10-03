import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Camera, CheckCircle2, Maximize, RotateCcw, Sun, Upload, ZapOff } from "lucide-react";
import { Badge, Button } from "@/components/brand";
import { KycFrame, PartnerBanner, WizardFooter } from "@/components/invest/ui";
import { DOCS, parseDoc } from "@/components/invest/kyc";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/onboarding/kyc/KYCDocumentCapture.tsx (wireframe).
 * Changes: reference rendering of the identity partner's capture step — camera is simulated here;
 * the SDK owns permissions, image-quality and fraud checks in production. Passport skips the back side.
 */
type Side = "front" | "back";

const TIPS = [
  { icon: <Sun />, text: "Even light, no shadows" },
  { icon: <Maximize />, text: "All four corners in frame" },
  { icon: <ZapOff />, text: "No glare or flash reflections" },
];

export default function KycDocument() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const docId = parseDoc(params.get("doc"));
  const doc = DOCS[docId];
  const sides: Side[] = doc.sides === 2 ? ["front", "back"] : ["front"];

  const [method, setMethod] = useState<"camera" | "upload">("camera");
  const [active, setActive] = useState<Side>("front");
  const [captured, setCaptured] = useState<Record<Side, boolean>>({ front: false, back: false });
  const [files, setFiles] = useState<Record<Side, string | null>>({ front: null, back: null });
  const [error, setError] = useState<string | null>(null);

  const done = method === "camera" ? sides.every((s) => captured[s]) : sides.every((s) => files[s]);

  const capture = () => {
    setCaptured((c) => ({ ...c, [active]: true }));
    const nextSide = sides.find((s) => s !== active && !captured[s]);
    if (nextSide) setActive(nextSide);
  };

  const next = () => {
    if (!done) {
      setError(sides.length === 2 ? "Capture both the front and the back of your ID to continue." : "Capture the photo page of your passport to continue.");
      return;
    }
    navigate(`/onboarding/kyc/selfie?doc=${docId}`);
  };

  return (
    <KycFrame
      step={3}
      title={`Capture your ${doc.label.toLowerCase()}`}
      description={sides.length === 2 ? "We need a clear photo of the front and the back." : "We need a clear photo of the photo page."}
      footer={
        <WizardFooter backTo="/onboarding/kyc/id-type">
          <Button onClick={next}>
            Continue <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <PartnerBanner />

      <div role="tablist" aria-label="Capture method" className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-1">
        {(["camera", "upload"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={method === m}
            onClick={() => {
              setMethod(m);
              setError(null);
            }}
            className={cn(
              "flex h-11 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
              method === m ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
            )}
          >
            {m === "camera" ? <Camera className="size-4" /> : <Upload className="size-4" />}
            {m === "camera" ? "Use camera" : "Upload a photo"}
          </button>
        ))}
      </div>

      {method === "camera" ? (
        <div className="flex flex-col gap-4">
          {sides.length === 2 && (
            <div className="flex gap-2">
              {sides.map((s) => (
                <button
                  key={s}
                  onClick={() => setActive(s)}
                  className={cn(
                    "flex h-11 flex-1 items-center justify-center gap-2 rounded-md border text-sm capitalize transition-colors",
                    active === s ? "border-gold text-fg" : "border-line text-muted hover:text-fg",
                  )}
                  aria-pressed={active === s}
                >
                  {captured[s] && <CheckCircle2 className="size-4 text-success" aria-hidden />}
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,rgb(212_175_55/0.06),transparent)]" />
            <div className="relative aspect-[1.586] w-[78%] rounded-lg border-2 border-dashed border-muted/40">
              {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((c) => (
                <span key={c} className={cn("absolute -m-0.5 size-6 rounded-sm border-gold", c)} />
              ))}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                {captured[active] ? (
                  <>
                    <CheckCircle2 className="size-10 text-success" aria-hidden />
                    <span className="text-sm font-medium text-fg">Looks good</span>
                  </>
                ) : (
                  <span className="px-4 text-sm text-muted">
                    Fit the <span className="text-fg">{active}</span> of your ID inside the frame
                  </span>
                )}
              </div>
            </div>
            <Badge tone="neutral" className="absolute left-3 top-3">
              Camera preview
            </Badge>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {captured[active] ? (
              <Button variant="secondary" block onClick={() => setCaptured((c) => ({ ...c, [active]: false }))}>
                <RotateCcw /> Retake {active}
              </Button>
            ) : (
              <Button variant="secondary" block onClick={capture}>
                <Camera /> Capture {active}
              </Button>
            )}
          </div>

          <ul className="grid gap-2 text-sm text-muted sm:grid-cols-3">
            {TIPS.map((t) => (
              <li key={t.text} className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-gold">
                {t.icon}
                {t.text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={cn("grid gap-4", sides.length === 2 && "sm:grid-cols-2")}>
          {sides.map((s) => (
            <label
              key={s}
              htmlFor={`upload-${s}`}
              className={cn(
                "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors focus-within:border-gold",
                files[s] ? "border-success/50 bg-success/8" : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              <input
                id={`upload-${s}`}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="sr-only"
                onChange={(e) => setFiles((f) => ({ ...f, [s]: e.target.files?.[0]?.name ?? null }))}
              />
              {files[s] ? <CheckCircle2 className="size-7 text-success" aria-hidden /> : <Upload className="size-7 text-gold" aria-hidden />}
              <span className="text-sm font-medium capitalize text-fg">{files[s] ? `${s} added` : `Upload ${s}`}</span>
              <span className="max-w-full truncate text-xs text-muted">{files[s] ?? "JPG, PNG or PDF · up to 10 MB"}</span>
            </label>
          ))}
        </div>
      )}

      {error && !done && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </KycFrame>
  );
}
