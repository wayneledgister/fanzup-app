import { Link } from "react-router";
import { IdCard, RefreshCw, UserPen, XCircle } from "lucide-react";
import { Button, Callout, Card, IconChip } from "@/components/brand";
import { ArtistStepper, OutcomeHero } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistKYCRejected.tsx
 * Doc-driven changes: tone made direct and human (Brand §7.2); "comply with financial regulations"
 * shortened; "Back to Dashboard" → "Edit account details" since unverified artists have no dashboard.
 */
const REASONS = ["The photo of your ID was blurry or partly covered", "The name or date of birth didn't match your FanZuP account", "The ID looks expired"];

const FIXES = [
  { icon: <RefreshCw />, t: "Retake your photos", d: "Most rejections are photo quality. Use bright, even light, keep all four corners in frame, and avoid glare." },
  { icon: <UserPen />, t: "Fix your account details", d: "If your legal name or date of birth on FanZuP doesn't match your ID, update it first, then try again." },
  { icon: <IdCard />, t: "Use a different ID", d: "If your driver's license didn't work, try a passport or state ID card." },
];

export default function KycRejected() {
  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <OutcomeHero icon={<XCircle />} tone="error" eyebrow="Verification not approved" title="We couldn't verify you this time">
        This happens, and it's usually quick to fix. Nothing on your profile has been lost.
      </OutcomeHero>

      <Callout tone="error" title="What our identity partner flagged">
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {REASONS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Callout>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How to fix it</h2>
        {FIXES.map((f) => (
          <Card key={f.t} className="flex gap-4 p-5">
            <IconChip tone="muted">{f.icon}</IconChip>
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold">{f.t}</h3>
              <p className="text-sm text-muted">{f.d}</p>
            </div>
          </Card>
        ))}
      </section>

      <p className="text-sm text-muted">Until you're verified, your profile stays private and you can't take payouts or launch a campaign.</p>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="secondary" size="lg">
          <Link to="/artist-onboarding/basic">Edit account details</Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/artist-onboarding/verify/id-type">
            <RefreshCw /> Try again
          </Link>
        </Button>
      </div>
      <p className="text-center text-sm text-muted">
        Still stuck?{" "}
        <Link to="/trust" className="text-gold hover:underline">
          Contact support
        </Link>
      </p>
    </div>
  );
}
