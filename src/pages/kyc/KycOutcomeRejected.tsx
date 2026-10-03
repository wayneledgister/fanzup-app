import { Link, useSearchParams } from "react-router";
import { ArrowRight, CalendarX, Camera, CheckCircle2, FileQuestion, LifeBuoy, MessageSquare, RotateCcw, UserRoundX, UserSearch } from "lucide-react";
import { Badge, Button, Callout, Card, Container, IconChip } from "@/components/brand";

/**
 * Source: Fan Profile Setup src/pages/kyc/KYCOutcomeRejected.tsx (wireframe).
 * Changes: the wireframe-only reason switcher becomes `?reason=` (quality | expired | selfie |
 * mismatch | unsupported), mirroring the identity partner's response. Tone softened to direct and
 * human (Brand §7.2); "Fan Subscriber" wording replaced with plain Layer 1 features.
 */
const REASONS = {
  quality: {
    icon: <Camera />,
    label: "We couldn't read your ID clearly",
    description: "The photo was blurry, too dark, or had glare, or a corner of the ID was cut off.",
    fix: ["Use even light and avoid flash", "Lay the ID flat on a dark surface", "Keep all four corners inside the frame"],
  },
  expired: {
    icon: <CalendarX />,
    label: "Your ID has expired",
    description: "The document you used is past its expiry date, so we can't accept it.",
    fix: ["Use a current driver's license, state ID or passport", "Check the expiry date before you start"],
  },
  selfie: {
    icon: <UserRoundX />,
    label: "Your selfie didn't match your ID",
    description: "We couldn't confirm that the person in the selfie is the person on the ID.",
    fix: ["Face the camera straight on with a neutral expression", "Remove glasses, hats or masks", "Make sure your face is well lit"],
  },
  mismatch: {
    icon: <UserSearch />,
    label: "Your details don't match",
    description: "The name or date of birth on your ID doesn't match your FanZuP account.",
    fix: ["Check your legal name and date of birth in Settings", "Make sure they match your ID exactly, then re-submit"],
  },
  unsupported: {
    icon: <FileQuestion />,
    label: "We can't accept this document",
    description: "This type of document or issuing country isn't supported for investor verification.",
    fix: ["Use a US driver's license, state ID card or passport"],
  },
} as const;
type ReasonId = keyof typeof REASONS;

export default function KycOutcomeRejected() {
  const [params] = useSearchParams();
  const raw = params.get("reason");
  const reason = REASONS[(raw && raw in REASONS ? raw : "quality") as ReasonId];

  return (
    <Container size="md" className="flex flex-col gap-8 py-10">
      <Link to="/settings" className="text-sm text-muted hover:text-fg">
        ← Settings
      </Link>

      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex size-16 items-center justify-center rounded-full border border-error/30 bg-error/12 text-error [&_svg]:size-7">
          {reason.icon}
        </div>
        <Badge tone="error">Needs attention</Badge>
        <h1 className="text-3xl font-bold">We couldn't verify you this time</h1>
        <p className="max-w-md text-muted">This happens, and it's usually quick to fix. Here's what went wrong and what to try next.</p>
      </Card>

      <Card className="flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <IconChip tone="error">{reason.icon}</IconChip>
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Reason</span>
            <h2 className="text-lg font-semibold">{reason.label}</h2>
            <p className="text-sm text-muted">{reason.description}</p>
          </div>
        </div>
        <div className="rounded-md border border-line bg-surface-2 p-4">
          <p className="mb-2 text-sm font-medium text-fg">How to fix it</p>
          <ul className="flex flex-col gap-2 text-sm text-muted">
            {reason.fix.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Callout tone="info" title="The rest of your account is unaffected">
        You can still back campaigns, subscribe, and buy tickets and merch. Only investing in Pools waits until you're verified.
      </Callout>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Your options</h2>
        <Card elevated className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <IconChip>
            <RotateCcw />
          </IconChip>
          <div className="flex flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
              Try again <Badge tone="gold">Recommended</Badge>
            </p>
            <p className="text-sm text-muted">Fix the issue above and re-submit. Most re-submissions are reviewed within 24 hours.</p>
          </div>
          <Button asChild>
            <Link to="/onboarding/kyc/id-type">
              Start again <ArrowRight />
            </Link>
          </Button>
        </Card>
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <IconChip tone="muted">
            <MessageSquare />
          </IconChip>
          <div className="flex flex-1 flex-col gap-1">
            <p className="font-semibold text-fg">Think we got it wrong?</p>
            <p className="text-sm text-muted">Ask for a manual review. A person on our compliance team will look within 3–5 business days.</p>
          </div>
          <Button asChild variant="secondary">
            <Link to="/support?topic=identity-review">Request a review</Link>
          </Button>
        </Card>
      </section>

      <p className="flex items-center justify-center gap-2 text-sm text-muted">
        <LifeBuoy className="size-4" aria-hidden /> Still stuck?{" "}
        <Link to="/support" className="font-medium text-gold hover:underline">
          Contact support
        </Link>
      </p>
    </Container>
  );
}
