/**
 * Shared chrome for the artist onboarding wizard (renders inside WizardShell).
 * One stepper for every screen: Basics → Media → Socials → Streaming → Review → Verify.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { Button, Stepper } from "@/components/brand";
import { cn } from "@/lib/utils";

export const ARTIST_STEPS = ["Basics", "Media", "Socials", "Streaming", "Review", "Verify"] as const;
export type ArtistStep = (typeof ARTIST_STEPS)[number];

/** Progress bar + "Step n of 6" line. `saved` flashes an autosave confirmation. */
export function ArtistStepper({ step, saved, className }: { step: ArtistStep; saved?: boolean; className?: string }) {
  return <FlowStepper label="Artist setup" steps={ARTIST_STEPS} step={step} saved={saved} className={className} />;
}

export const RISING_STEPS = ["Business", "Streaming", "Audience"] as const;
export type RisingStep = (typeof RISING_STEPS)[number];

/** Same visual language for the Rising tier upgrade. */
export function RisingStepper({ step, className }: { step: RisingStep; className?: string }) {
  return <FlowStepper label="Upgrade to Rising" steps={RISING_STEPS} step={step} className={className} />;
}

function FlowStepper<T extends string>({ label, steps, step, saved, className }: { label: string; steps: readonly T[]; step: T; saved?: boolean; className?: string }) {
  const n = steps.indexOf(step) + 1;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">
          <span className="eyebrow text-gold">{label}</span>
          <span className="mx-2 text-line">/</span>
          <span className="num">
            Step {n} of {steps.length}
          </span>
          {label.length <= 14 && <span className="sm:hidden"> · {step}</span>}
        </span>
        <span aria-live="polite" className={cn("flex items-center gap-1 text-success transition-opacity duration-300", saved ? "opacity-100" : "opacity-0")}>
          <Check className="size-3.5" /> Draft saved
        </span>
      </div>
      <Stepper steps={[...steps]} current={n} />
    </div>
  );
}

/** Flashes true for ~2s after `deps` change (ignores first render). Mirrors the wireframe's autosave cue. */
export function useSavedFlash(deps: unknown[]): boolean {
  const [saved, setSaved] = useState(false);
  const key = JSON.stringify(deps);
  // Compare against the value on mount (StrictMode runs effects twice, so a "first run" flag isn't enough).
  const initial = useRef(key);
  useEffect(() => {
    if (key === initial.current) return;
    const t1 = setTimeout(() => setSaved(true), 700);
    const t2 = setTimeout(() => setSaved(false), 2700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [key]);
  return saved;
}

/** Standard page frame: stepper, heading, body, sticky-feeling footer. */
export function ArtistStepLayout({
  step,
  stepper,
  saved,
  title,
  description,
  children,
  footer,
}: {
  step?: ArtistStep;
  /** Custom stepper (e.g. RisingStepper) instead of the onboarding one. */
  stepper?: ReactNode;
  saved?: boolean;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      {stepper ?? (step && <ArtistStepper step={step} saved={saved} />)}
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="text-base text-muted">{description}</p>}
      </header>
      {children}
      {footer}
    </div>
  );
}

/** Back link + primary action. Primary is passed in so pages control disabled/loading states. */
export function WizardFooter({ backTo, backLabel = "Back", children, note }: { backTo?: string; backLabel?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-6">
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {backTo ? (
          <Button asChild variant="ghost" className="sm:-ml-3">
            <Link to={backTo}>
              <ArrowLeft /> {backLabel}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col gap-3 sm:flex-row">{children}</div>
      </div>
    </div>
  );
}

/**
 * Frame for the identity-partner capture steps. In production these screens are rendered by
 * the partner's hosted SDK (PRD 01 §9.7); this frame marks the hand-off so artists know who they're dealing with.
 */
export function PartnerFrame({ step, total = 3, title, description, children }: { step?: number; total?: number; title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm" aria-label="Secure identity verification">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3 sm:px-6">
        <span className="flex items-center gap-2 text-xs text-muted">
          <Lock className="size-3.5 text-success" /> Secure session · hosted by our identity partner
        </span>
        {step && (
          <span className="num text-xs text-muted">
            {step} / {total}
          </span>
        )}
      </div>
      {step && (
        <div className="flex gap-1 px-4 pt-4 sm:px-6" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <div key={i} className={cn("h-1 flex-1 rounded-full", i < step ? "bg-success" : "bg-surface-2")} />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Platform initial chip — stands in for third-party logos we don't ship. */
export function PlatformMark({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 font-display text-base font-bold text-fg", className)}>
      {name[0]}
    </span>
  );
}
