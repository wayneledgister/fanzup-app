/** Shared header + footer nav for the fan onboarding wizard (WizardShell provides the outer frame). */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Stepper } from "@/components/brand";

export const ONBOARDING_STEPS = ["Account", "Path", "Profile", "Discover", "Payment", "Done"];

export function OnboardingHeader({ step, title, description }: { step: number; title?: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 pb-8">
      <div className="flex flex-col gap-3">
        <Stepper steps={ONBOARDING_STEPS} current={step} />
        <span className="num text-xs text-muted sm:hidden">
          Step {step} of {ONBOARDING_STEPS.length} · {ONBOARDING_STEPS[step - 1]}
        </span>
      </div>
      {title && (
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          {description && <p className="text-muted">{description}</p>}
        </div>
      )}
    </div>
  );
}

/** Back link on the left, skip + primary action on the right. Stacks on mobile with primary on top. */
export function OnboardingFooter({ back, skip, primary }: { back?: string; skip?: ReactNode; primary: ReactNode }) {
  return (
    <div className="mt-10 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      {back ? (
        <Link to={back} className="flex h-11 items-center justify-center gap-2 rounded-md text-sm text-muted hover:text-fg sm:justify-start">
          <ArrowLeft className="size-4" /> Back
        </Link>
      ) : (
        <span />
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        {skip}
        {primary}
      </div>
    </div>
  );
}
