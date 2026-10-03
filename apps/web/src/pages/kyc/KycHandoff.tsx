import { Link, useNavigate } from "react-router";
import { ArrowRight, Clock, EyeOff, FileText, Landmark, Lock, ScanFace, ShieldCheck, UserRound } from "lucide-react";
import { Button, Card, IconChip } from "@/components/brand";
import { KycFrame, PartnerBanner, WizardFooter } from "@/components/invest/ui";

/**
 * Source: Fan Profile Setup src/pages/onboarding/StepKYCHandoff.tsx (wireframe).
 * Changes: shown as step 1 of the vendor-hosted identity flow (PRD 01 §9.7) with the shared KYC
 * stepper; adds why verification is required (Reg CF + AML), what's collected and how it's protected.
 */
export default function KycHandoff() {
  const navigate = useNavigate();
  return (
    <KycFrame
      step={1}
      title="Verify your identity to invest"
      description="Before you can invest in a Pool, we need to confirm you are who you say you are. It takes about 5–10 minutes."
      footer={
        <WizardFooter backTo="/onboarding/path">
          <Button asChild variant="ghost">
            <Link to="/onboarding/profile">Do this later</Link>
          </Button>
          <Button onClick={() => navigate("/onboarding/kyc/id-type")}>
            Begin verification <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <PartnerBanner />

      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <IconChip>
            <Landmark />
          </IconChip>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Why this is required</h2>
            <p className="text-sm text-muted">
              Pools are securities offered under Regulation Crowdfunding (Reg CF). Federal anti-money-laundering (AML) rules require our
              intermediary to verify the identity of every investor before accepting money. Backing campaigns doesn't need this — only
              investing does.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">What you'll share</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              { icon: <FileText />, t: "A government-issued photo ID", d: "Passport, driver's license, or state ID card" },
              { icon: <ScanFace />, t: "A quick selfie", d: "A short liveness check to match you to your ID" },
              { icon: <UserRound />, t: "Your legal details", d: "Name, date of birth and home address, as shown on your ID" },
            ].map((i) => (
              <li key={i.t} className="flex gap-3">
                <IconChip tone="muted" className="size-9">
                  {i.icon}
                </IconChip>
                <div>
                  <p className="font-medium text-fg">{i.t}</p>
                  <p className="text-muted">{i.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">How it's protected</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              { icon: <Lock />, t: "Encrypted in transit and at rest", d: "Captured inside our partner's secure flow" },
              { icon: <EyeOff />, t: "FanZuP never sees your ID images", d: "We only receive the result and the details required for regulatory records" },
              { icon: <ShieldCheck />, t: "Used only for verification", d: "Not for marketing, and never sold" },
            ].map((i) => (
              <li key={i.t} className="flex gap-3">
                <IconChip tone="muted" className="size-9">
                  {i.icon}
                </IconChip>
                <div>
                  <p className="font-medium text-fg">{i.t}</p>
                  <p className="text-muted">{i.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted">
        <Clock className="size-4 shrink-0 text-gold" aria-hidden /> Most people finish in under 10 minutes. Results usually arrive within minutes.
      </div>

      <p className="text-xs leading-relaxed text-muted">
        By continuing, you agree that your information will be shared with our identity partner and our intermediary solely to verify your
        identity and meet legal requirements. See our{" "}
        <Link to="/legal/privacy" className="text-fg underline underline-offset-4 hover:text-gold">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link to="/legal/terms" className="text-fg underline underline-offset-4 hover:text-gold">
          Terms
        </Link>
        .
      </p>
    </KycFrame>
  );
}
