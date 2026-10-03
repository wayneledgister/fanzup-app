import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, CheckCircle2, Loader2, RotateCcw, ScanFace } from "lucide-react";
import { Button, Card, Checkbox, IconChip } from "@/components/brand";
import { KycFrame, PartnerBanner, WizardFooter } from "@/components/invest/ui";
import { DOCS, parseDoc } from "@/components/invest/kyc";

/**
 * Source: Fan Profile Setup src/pages/onboarding/kyc/KYCReview.tsx (wireframe).
 * Changes: consent names the identity partner and intermediary (Reg CF / AML purpose); submit shows a
 * loading state, then hands off to /onboarding/kyc/pending.
 */
export default function KycReview() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const docId = parseDoc(params.get("doc"));
  const doc = DOCS[docId];
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const items = [
    { label: `${doc.label} — front`, sub: "Captured", icon: doc.icon, to: `/onboarding/kyc/document?doc=${docId}` },
    ...(doc.sides === 2 ? [{ label: `${doc.label} — back`, sub: "Captured", icon: doc.icon, to: `/onboarding/kyc/document?doc=${docId}` }] : []),
    { label: "Selfie", sub: "Liveness confirmed", icon: <ScanFace />, to: `/onboarding/kyc/selfie?doc=${docId}` },
  ];

  const submit = () => {
    setTouched(true);
    if (!consent) return;
    setSubmitting(true);
    window.setTimeout(() => navigate("/onboarding/kyc/pending"), 1200);
  };

  return (
    <KycFrame
      step={5}
      title="Review and submit"
      description="Check everything looks right. You can retake anything before you submit."
      footer={
        <WizardFooter backTo={`/onboarding/kyc/selfie?doc=${docId}`}>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="animate-spin" /> Submitting…
              </>
            ) : (
              <>
                Submit for verification <ArrowRight />
              </>
            )}
          </Button>
        </WizardFooter>
      }
    >
      <PartnerBanner />

      <Card padded={false} className="divide-y divide-line">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-4 p-4 sm:p-5">
            <IconChip tone="muted">{i.icon}</IconChip>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-fg">{i.label}</span>
              <span className="flex items-center gap-1 text-sm text-success">
                <CheckCircle2 className="size-3.5" aria-hidden /> {i.sub}
              </span>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to={i.to}>
                <RotateCcw /> Retake
              </Link>
            </Button>
          </div>
        ))}
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Before you submit</h2>
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
          {["All four corners of the ID are visible", "Text is sharp, with no blur or glare", "Your selfie matches the photo on your ID", "Your ID is valid and not expired"].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <Checkbox id="kyc-consent" checked={consent} onChange={setConsent}>
          I confirm this ID and selfie are genuine and belong to me, and I consent to our identity partner and intermediary processing them to
          verify my identity under Regulation Crowdfunding and anti-money-laundering rules. See the{" "}
          <Link to="/legal/privacy" className="text-fg underline underline-offset-4 hover:text-gold">
            Privacy Policy
          </Link>
          .
        </Checkbox>
        {touched && !consent && <p className="pl-7 text-sm text-error">Please confirm to submit.</p>}
      </div>

      <p className="text-sm text-muted">Most results come back within a few minutes. We'll email you and notify you in the app.</p>
    </KycFrame>
  );
}
