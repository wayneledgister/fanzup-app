import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CheckCircle2, Loader2, ScanFace } from "lucide-react";
import { Button, Card, Checkbox, IconChip } from "@/components/brand";
import { ArtistStepper, PartnerFrame, WizardFooter, idTypeFrom } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/kyc/ArtistKYCReview.tsx
 * Doc-driven changes: vendor branding removed (PRD 01 §9.7); explicit accuracy attestation
 * checkbox required before submit; submitting state added.
 */
export default function KycReview() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const idType = idTypeFrom(params);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const IdIcon = idType.icon;

  const submit = () => {
    setSubmitting(true);
    setTimeout(() => navigate("/artist-onboarding/verify/pending"), 1200);
  };

  const rows = [
    { icon: <IdIcon />, t: "Government ID", d: `${idType.label} · ${idType.sides === 2 ? "front and back" : "photo page"}`, edit: `/artist-onboarding/verify/document?type=${idType.id}` },
    { icon: <ScanFace />, t: "Selfie check", d: "Live check complete", edit: `/artist-onboarding/verify/selfie?type=${idType.id}` },
  ];

  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <PartnerFrame title="Ready to submit" description="Check both items, then send them for review.">
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.t} elevated className="flex items-center gap-4 p-4">
              <IconChip tone="success">{r.icon}</IconChip>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.t}</p>
                <p className="text-sm text-muted">{r.d}</p>
              </div>
              <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Captured" />
              <Link to={r.edit} className="flex min-h-11 items-center text-sm text-muted hover:text-fg">
                Redo
              </Link>
            </Card>
          ))}
        </div>
        <Checkbox id="attest" checked={agree} onChange={setAgree}>
          I confirm this ID is mine, it's current, and the details match my FanZuP account.
        </Checkbox>
        <p className="text-sm text-muted">Most reviews finish in a few minutes. Some take up to 24 hours. We'll email you either way.</p>
      </PartnerFrame>
      <WizardFooter backTo={`/artist-onboarding/verify/selfie?type=${idType.id}`}>
        <Button size="lg" disabled={!agree || submitting} onClick={submit}>
          {submitting ? (
            <>
              <Loader2 className="animate-spin" /> Submitting
            </>
          ) : (
            "Submit for review"
          )}
        </Button>
      </WizardFooter>
    </div>
  );
}
