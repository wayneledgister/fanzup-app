import { Link } from "react-router";
import { ArrowRight, Bell, CheckCircle2, Clock, LineChart } from "lucide-react";
import { Badge, Button, Card, IconChip } from "@/components/brand";
import { KycFrame } from "@/components/invest/ui";

/**
 * Source: Fan Profile Setup src/pages/onboarding/StepKYCPending.tsx (wireframe).
 * Changes: completes the shared KYC stepper; adds the optional next step of certifying a Reg CF
 * investment limit. No back navigation — verification is already submitted.
 */
export default function KycPending() {
  return (
    <KycFrame step={6} title="You're all set — we're checking your ID" description="You don't need to wait here. Keep setting up your account and we'll let you know.">
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="relative flex size-16 items-center justify-center rounded-full border border-warning/30 bg-warning/12 text-warning">
          <Clock className="size-7" aria-hidden />
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full border border-warning/30 [animation-duration:2.4s]" />
        </div>
        <Badge tone="warning">Pending review</Badge>
        <p className="max-w-sm text-sm text-muted">Our identity partner is reviewing your submission. Most results arrive within minutes; a few take up to 2 business days.</p>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">What happens next</h2>
        <ol className="flex flex-col gap-4">
          {[
            { i: <Clock />, t: "We verify your identity", d: "Usually within a few minutes." },
            { i: <Bell />, t: "We'll notify you", d: "By email and in the app, as soon as there's a result." },
            { i: <CheckCircle2 />, t: "Investing unlocks", d: "Once you're verified, you can invest in Pools — up to your Reg CF limit." },
          ].map((s) => (
            <li key={s.t} className="flex gap-4">
              <IconChip tone="muted">{s.i}</IconChip>
              <div>
                <p className="font-medium text-fg">{s.t}</p>
                <p className="text-sm text-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Card elevated className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <IconChip>
          <LineChart />
        </IconChip>
        <div className="flex flex-1 flex-col gap-1">
          <p className="font-semibold text-fg">Set your investment limit while you wait</p>
          <p className="text-sm text-muted">Federal rules cap how much you can invest through Reg CF each year. It takes two minutes.</p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/investor/certification">Set my limit</Link>
        </Button>
      </Card>

      <div className="flex justify-end border-t border-line pt-6">
        <Button asChild>
          <Link to="/onboarding/profile">
            Continue to your profile <ArrowRight />
          </Link>
        </Button>
      </div>
    </KycFrame>
  );
}
