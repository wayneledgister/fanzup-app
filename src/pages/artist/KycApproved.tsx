import { Link } from "react-router";
import { ArrowRight, BadgeCheck, CheckCircle2 } from "lucide-react";
import { Badge, Button, Card, KeyValue } from "@/components/brand";
import { ArtistStepper, OutcomeHero, useDisplayDraft } from "@/components/artist";
import { formatDate } from "@/lib/format";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistKYCApproved.tsx
 * Doc-driven changes: removed "receive payments from investors" and "create investment opportunities
 * under Reg CF" — Layer 1 only (Brand §7.4, CONSOLIDATION); primary CTA goes to the Starter unlock
 * screen (flow: verify → starter-unlocked → complete).
 */
export default function KycApproved() {
  const { draft } = useDisplayDraft();
  const today = new Date().toISOString();

  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <OutcomeHero icon={<CheckCircle2 />} tone="success" eyebrow="Identity verified" title="You're verified">
        Your identity checks out. The Verified badge now sits on your profile, and payouts can be switched on.
      </OutcomeHero>

      <Card className="flex flex-col gap-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Verification</h2>
          <Badge tone="success" icon={<BadgeCheck />}>
            Verified
          </Badge>
        </div>
        <div className="divide-y divide-line">
          <KeyValue k="Artist" v={draft.displayName} />
          <KeyValue k="Approved on" v={<span className="num">{formatDate(today)}</span>} />
          <KeyValue k="Checked by" v="FanZuP identity partner" />
        </div>
      </Card>

      <Card className="flex flex-col gap-2 border-gold/30">
        <h2 className="text-lg font-semibold">One more look before you go live</h2>
        <p className="text-sm text-muted">See which Starter tools you've unlocked and anything left to finish, then publish your profile.</p>
      </Card>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="secondary" size="lg">
          <Link to="/artist-onboarding/review">Review profile</Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/artist-onboarding/starter-unlocked">
            See what you've unlocked <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
