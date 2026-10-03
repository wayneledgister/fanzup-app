import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Camera, CheckCircle2, Loader2, RotateCcw, TriangleAlert, Upload } from "lucide-react";
import { Button, Callout } from "@/components/brand";
import { ArtistStepper, PartnerFrame, WizardFooter, idTypeFrom } from "@/components/artist";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/kyc/ArtistKYCDocumentCapture.tsx
 * Doc-driven changes: vendor branding removed (PRD 01 §9.7); front + back for two-sided IDs;
 * added the "couldn't read it" error state (preview with ?state=error); emoji placeholder replaced.
 */
type SideState = "idle" | "capturing" | "captured" | "error";

export default function KycDocument() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const idType = idTypeFrom(params);
  const sides = idType.sides === 2 ? (["Front", "Back"] as const) : (["Photo page"] as const);
  const [state, setState] = useState<SideState[]>(sides.map(() => "idle"));
  const [failOnce, setFailOnce] = useState(params.get("state") === "error");
  const active = Math.max(0, state.findIndex((s) => s !== "captured"));
  const allDone = state.every((s) => s === "captured");

  const capture = (i: number) => {
    setState((s) => s.map((v, j) => (j === i ? "capturing" : v)));
    setTimeout(() => {
      const next: SideState = failOnce ? "error" : "captured";
      if (failOnce) setFailOnce(false);
      setState((s) => s.map((v, j) => (j === i ? next : v)));
    }, 1200);
  };

  const current = state[active];
  const sideLabel = sides[active];

  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <PartnerFrame
        step={2}
        title={`Photograph your ${idType.label.toLowerCase()}`}
        description={idType.sides === 2 ? "We need the front and the back. Lay it flat on a dark surface." : "Open to the photo page and lay it flat on a dark surface."}
      >
        {sides.length > 1 && (
          <ol className="flex gap-2" aria-label="Sides">
            {sides.map((s, i) => (
              <li key={s} className={cn("flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm", state[i] === "captured" ? "border-success/30 text-success" : i === active ? "border-gold/50 text-fg" : "border-line text-muted")}>
                {state[i] === "captured" ? <CheckCircle2 className="size-4" /> : <span className="num text-xs">{i + 1}</span>}
                {s}
              </li>
            ))}
          </ol>
        )}

        {/* Capture area */}
        <div
          className={cn(
            "relative flex aspect-[1.586] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border bg-canvas",
            allDone || current === "captured" ? "border-success/40" : current === "error" ? "border-error/50" : "border-line",
          )}
          aria-live="polite"
        >
          <CornerGuides tone={allDone ? "success" : current === "error" ? "error" : "gold"} />
          {allDone ? (
            <>
              <IdGraphic />
              <p className="flex items-center gap-2 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" /> {sides.length > 1 ? "Front and back captured" : "Photo page captured"}
              </p>
            </>
          ) : current === "capturing" ? (
            <>
              <Loader2 className="size-8 animate-spin text-gold" />
              <p className="text-sm text-muted">Checking the image…</p>
            </>
          ) : current === "error" ? (
            <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
              <TriangleAlert className="size-8 text-error" />
              <p className="font-medium text-fg">We couldn't read your ID</p>
              <p className="text-sm text-muted">There's glare over the text. Tilt the ID away from the light and try again.</p>
            </div>
          ) : (
            <>
              <Camera className="size-8 text-muted" />
              <p className="px-6 text-center text-sm text-muted">Fit the {sideLabel.toLowerCase()} of your ID inside the frame</p>
            </>
          )}
        </div>

        {!allDone && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" variant={current === "error" ? "primary" : "secondary"} disabled={current === "capturing"} onClick={() => capture(active)}>
              {current === "error" ? <RotateCcw /> : <Camera />} {current === "error" ? "Retake photo" : `Take photo of ${sideLabel.toLowerCase()}`}
            </Button>
            <label className={cn("inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-line px-6 text-base font-semibold text-fg transition-colors hover:bg-surface-2 focus-within:outline-2 focus-within:outline-gold", current === "capturing" && "pointer-events-none opacity-40")}>
              <Upload className="size-4" /> Upload a file
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => e.target.files?.length && capture(active)} />
            </label>
          </div>
        )}
        {allDone && (
          <Button variant="ghost" className="self-start" onClick={() => setState(sides.map(() => "idle"))}>
            <RotateCcw /> Retake
          </Button>
        )}

        <Callout tone="info" title="For a clean read">
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>All four corners in frame, text sharp and readable</li>
            <li>No glare, shadows or fingers over the ID</li>
            <li>The ID must be current, not expired</li>
          </ul>
        </Callout>
      </PartnerFrame>
      <WizardFooter backTo="/artist-onboarding/verify/id-type">
        <Button size="lg" disabled={!allDone} onClick={() => navigate(`/artist-onboarding/verify/selfie?type=${idType.id}`)}>
          Continue <ArrowRight />
        </Button>
      </WizardFooter>
    </div>
  );
}

function CornerGuides({ tone }: { tone: "gold" | "success" | "error" }) {
  const c = { gold: "border-gold/70", success: "border-success/70", error: "border-error/70" }[tone];
  const base = cn("pointer-events-none absolute size-6", c);
  return (
    <>
      <span aria-hidden className={cn(base, "left-3 top-3 rounded-tl-md border-l-2 border-t-2")} />
      <span aria-hidden className={cn(base, "right-3 top-3 rounded-tr-md border-r-2 border-t-2")} />
      <span aria-hidden className={cn(base, "bottom-3 left-3 rounded-bl-md border-b-2 border-l-2")} />
      <span aria-hidden className={cn(base, "bottom-3 right-3 rounded-br-md border-b-2 border-r-2")} />
    </>
  );
}

/** Abstract ID card stand-in (no real document imagery). */
function IdGraphic() {
  return (
    <div aria-hidden className="flex aspect-[1.586] w-44 gap-3 rounded-md border border-line bg-surface-2 p-3">
      <div className="h-full w-1/3 rounded-sm bg-surface" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <div className="h-2 w-4/5 rounded-full bg-muted/40" />
        <div className="h-2 w-3/5 rounded-full bg-muted/30" />
        <div className="h-2 w-2/3 rounded-full bg-muted/30" />
        <div className="mt-auto h-2 w-1/2 rounded-full bg-muted/20" />
      </div>
    </div>
  );
}
