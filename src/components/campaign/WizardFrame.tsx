/**
 * Shared chrome for the campaign-creation wizard: step header (Stepper) and the
 * sticky Back / Save draft / Continue footer. Lives inside WizardShell (max-w-2xl).
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { Button, Stepper } from "@/components/brand";
import { cn } from "@/lib/utils";
import { STEP_PATH, WIZARD_STEPS, updateDraft, useDraft } from "./draft";

export function WizardHeader({ step, title, description }: { step: number; title: ReactNode; description?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <span className="eyebrow text-gold">New campaign</span>
          <span className="text-xs text-muted">
            Step <span className="num">{step}</span> of <span className="num">{WIZARD_STEPS.length}</span> · {WIZARD_STEPS[step - 1]}
          </span>
        </div>
        <Stepper steps={WIZARD_STEPS} current={step} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="text-muted">{description}</p>}
      </div>
    </header>
  );
}

/** Section block used on every step. */
export function FormSection({ title, description, children, className, aside }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-5 border-t border-line py-8 first-of-type:border-t-0 first-of-type:pt-0", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Sticky footer. `onContinue` returns true when the step is valid; the footer then navigates.
 * Back goes to the previous step (or the campaigns list from step 1).
 */
export function WizardFooter({ step, onContinue, continueLabel, continueIcon, busy, nextPath }: {
  step: number;
  nextPath?: string;
  onContinue: () => boolean;
  continueLabel?: string;
  continueIcon?: ReactNode;
  busy?: boolean;
}) {
  const navigate = useNavigate();
  const draft = useDraft();
  const [justSaved, setJustSaved] = useState(false);
  const back = step > 1 ? STEP_PATH[step - 2] : "/creator/campaigns";
  const next = nextPath ?? STEP_PATH[step] ?? null;

  const save = () => {
    updateDraft({ savedAt: new Date().toISOString() });
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 2500);
  };
  const go = () => {
    if (!onContinue()) {
      // Move focus to the first error so keyboard and screen-reader users land on it.
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[aria-invalid='true'], [data-error='true']");
        el?.focus();
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    if (next) navigate(next);
  };

  const savedTime = draft.savedAt ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(draft.savedAt)) : null;

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-10 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur-md sm:mx-0 sm:rounded-lg sm:border sm:px-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" className="px-3">
          <Link to={back} aria-label={step > 1 ? `Back to ${WIZARD_STEPS[step - 2]}` : "Back to campaigns"}>
            <ArrowLeft />
            <span className="hidden sm:inline">Back</span>
          </Link>
        </Button>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-muted md:inline" aria-live="polite">
            {justSaved ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Check className="size-3.5" /> Draft saved
              </span>
            ) : savedTime ? (
              <>
                Saved <span className="num">{savedTime}</span>
              </>
            ) : null}
          </span>
          <Button variant="secondary" onClick={save} aria-label="Save draft">
            {justSaved ? <Check className="text-success" /> : <Save />}
            <span className="hidden sm:inline">Save draft</span>
          </Button>
          <Button onClick={go} disabled={busy}>
            {continueLabel ?? "Continue"}
            {continueIcon ?? <ArrowRight />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Dollar-prefixed numeric input. */
export function MoneyInput({ id, value, onChange, invalid, placeholder, className, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string; className?: string; describedBy?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value ? Number(value).toLocaleString("en-US") : ""}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="num h-11 w-full rounded-md border border-line bg-surface-2 pl-7 pr-3.5 text-sm text-fg placeholder:text-muted/70 transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 aria-[invalid=true]:border-error"
      />
    </div>
  );
}

/** Small segmented control (radio group) for short option sets. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex flex-wrap gap-1 self-start rounded-md border border-line bg-surface p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 rounded-sm px-3 text-sm transition-colors",
            value === o.value ? "bg-surface-2 font-medium text-fg ring-1 ring-gold/50" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
