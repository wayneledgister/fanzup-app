import { Link, useNavigate } from "react-router";
import { ArrowRight, Camera, Clock, IdCard, Lock, ShieldCheck } from "lucide-react";
import { Button, Card, IconChip } from "@/components/brand";
import { ArtistStepLayout, WizardFooter } from "@/components/artist";

/**
 * Source: Fan Profile Setup ArtistKYCIntro.tsx + ArtistKYCHandoff.tsx (merged).
 * Doc-driven changes: "launch investment opportunities" and Reg CF claims removed from the why
 * (Layer 1, Brand §7.4); vendor name ("Persona") and "bank-level encryption" removed — the partner
 * is unnamed until contracted, and verification runs in the partner's hosted SDK (PRD 01 §9.7).
 */
const NEEDS = [
  { icon: <IdCard />, t: "A government-issued photo ID", d: "Driver's license, passport or state ID. Not expired." },
  { icon: <Camera />, t: "Your phone or webcam", d: "For a photo of your ID and a quick selfie." },
  { icon: <Clock />, t: "About 5 minutes", d: "Most checks clear in minutes. Some take up to 24 hours." },
];

const STEPS = [
  "Choose the ID you'll use",
  "Photograph your ID",
  "Take a short selfie so we know it's you",
  "Come back here to see your result",
];

export default function KycIntro() {
  const navigate = useNavigate();
  return (
    <ArtistStepLayout
      step="Verify"
      title="Verify your identity"
      description="One check, once. It's what lets you take payouts and launch campaigns, and it tells fans the profile is really you."
      footer={
        <WizardFooter backTo="/artist-onboarding/review" note="By continuing you agree to share your ID and selfie with our identity partner for this check.">
          <Button size="lg" onClick={() => navigate("/artist-onboarding/verify/id-type")}>
            Start verification <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Why we ask</h2>
        <p className="text-sm text-muted">
          You're about to accept money from fans. Payment and anti-fraud rules require us to know who's on the other end of every payout, and
          fans back with more confidence when they see the Verified badge on your profile.
        </p>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What you'll need</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {NEEDS.map((n) => (
            <Card key={n.t} className="flex flex-col gap-3 p-5">
              <IconChip>{n.icon}</IconChip>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold">{n.t}</h3>
                <p className="text-sm text-muted">{n.d}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <IconChip tone="success">
            <ShieldCheck />
          </IconChip>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">How it works</h2>
            <p className="text-sm text-muted">The check runs in a secure window hosted by our identity partner. FanZuP gets the result, not your documents.</p>
          </div>
        </div>
        <ol className="flex flex-col gap-3">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className="num flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-xs text-muted">{i + 1}</span>
              <span className="text-fg">{s}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex gap-3 rounded-lg border border-line p-4 text-sm text-muted">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
        <p>
          Your ID is never shown on your profile and never sold. Your name and date of birth need to match your FanZuP account.{" "}
          <Link to="/trust" className="text-gold hover:underline">
            How we handle your data
          </Link>
        </p>
      </div>
    </ArtistStepLayout>
  );
}
