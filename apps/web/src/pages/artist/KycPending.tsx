import { Link } from "react-router";
import { Check, Clock, Hourglass, Mail } from "lucide-react";
import { Button, Card } from "@/components/brand";
import { ArtistStepper, OutcomeHero } from "@/components/artist";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistKYCPending.tsx
 * Doc-driven changes: "Manual review / Our team" reworded — the identity partner reviews (PRD 01 §9.7);
 * "Explore FanZuP" goes to /home (no /dashboard for unverified artists); "Check status" leads to the result.
 */
const TIMELINE = [
  { t: "Submitted", d: "ID and selfie received", state: "done" },
  { t: "In review", d: "Our identity partner is checking your documents", state: "active" },
  { t: "Decision", d: "We'll email you as soon as it's in", state: "next" },
] as const;

export default function KycPending() {
  return (
    <div className="flex flex-col gap-8">
      <ArtistStepper step="Verify" />
      <OutcomeHero icon={<Hourglass />} tone="warning" eyebrow="Verification in review" title="You're in the queue">
        Thanks for submitting. Most checks clear in a few minutes; some take up to 24 hours.
      </OutcomeHero>

      <Card>
        <ol className="flex flex-col">
          {TIMELINE.map((s, i) => (
            <li key={s.t} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border",
                    s.state === "done" && "border-success/30 bg-success/12 text-success",
                    s.state === "active" && "border-warning/40 bg-warning/12 text-warning",
                    s.state === "next" && "border-line bg-surface-2 text-muted",
                  )}
                  aria-hidden
                >
                  {s.state === "done" ? <Check className="size-4" /> : s.state === "active" ? <Clock className="size-4 animate-pulse" /> : <span className="num text-xs">{i + 1}</span>}
                </span>
                {i < TIMELINE.length - 1 && <span className={cn("my-1 w-px flex-1", s.state === "done" ? "bg-success/40" : "bg-line")} />}
              </div>
              <div className={cn("flex flex-col gap-0.5", i < TIMELINE.length - 1 && "pb-6")}>
                <p className={cn("font-medium", s.state === "next" ? "text-muted" : "text-fg")}>
                  {s.t}
                  <span className="sr-only">{s.state === "done" ? " (complete)" : s.state === "active" ? " (in progress)" : " (up next)"}</span>
                </p>
                <p className="text-sm text-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex gap-3 p-5">
          <Mail className="mt-0.5 size-5 shrink-0 text-muted" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">You don't need to wait here</p>
            <p className="text-sm text-muted">We'll email the address on your account when there's a decision.</p>
          </div>
        </Card>
        <Card className="flex gap-3 p-5">
          <Clock className="mt-0.5 size-5 shrink-0 text-muted" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Until then</p>
            <p className="text-sm text-muted">You can explore FanZuP, but your profile stays private and payouts stay off until you're verified.</p>
          </div>
        </Card>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="secondary" size="lg">
          <Link to="/home">Explore FanZuP</Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/artist-onboarding/verify/approved">Check status</Link>
        </Button>
      </div>
      <p className="text-center text-sm text-muted">
        Questions about your verification?{" "}
        <Link to="/trust" className="text-gold hover:underline">
          Contact support
        </Link>
      </p>
    </div>
  );
}
