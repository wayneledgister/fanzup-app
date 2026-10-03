import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Bell, CheckCircle2, Clock, FileText, Search } from "lucide-react";
import { Badge, Button, Card, Container, IconChip } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/kyc/KYCOutcomePending.tsx + KYCOutcomeShell.tsx (wireframe).
 * Changes: rendered inside the fan app shell (entry from notifications or Settings); "Fan Subscriber"
 * wording replaced with plain Layer 1 features; notify toggle is a real switch.
 */
const TIMELINE = [
  { icon: <FileText />, label: "ID and selfie submitted", sub: "Oct 2, 2026 · 10:14 AM", state: "done" as const },
  { icon: <Search />, label: "Under review by our identity partner", sub: "Usually minutes, up to 2 business days", state: "active" as const },
  { icon: <Bell />, label: "You'll get the result", sub: "By email and in the app", state: "todo" as const },
];

export default function KycOutcomePending() {
  const [notify, setNotify] = useState(true);
  return (
    <Container size="md" className="flex flex-col gap-8 py-10">
      <Link to="/settings" className="text-sm text-muted hover:text-fg">
        ← Settings
      </Link>

      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="relative flex size-16 items-center justify-center rounded-full border border-warning/30 bg-warning/12 text-warning">
          <Clock className="size-7" aria-hidden />
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full border border-warning/30 [animation-duration:2.4s]" />
        </div>
        <Badge tone="warning">Under review</Badge>
        <h1 className="text-3xl font-bold">We're verifying your identity</h1>
        <p className="max-w-md text-muted">Our identity partner is checking your documents. You don't need to do anything right now.</p>
        <div className="mt-2 flex items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-2 text-sm">
          <FileText className="size-4 text-muted" aria-hidden />
          <span className="text-fg">Driver's license</span>
          <span className="text-muted">· United States</span>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Where things stand</h2>
        <ol className="flex flex-col">
          {TIMELINE.map((t, i) => (
            <li key={t.label} className="flex gap-4">
              <div className="flex flex-col items-center">
                <IconChip tone={t.state === "done" ? "success" : t.state === "active" ? "warning" : "muted"}>
                  {t.state === "done" ? <CheckCircle2 /> : t.icon}
                </IconChip>
                {i < TIMELINE.length - 1 && <span className={cn("my-1 w-px flex-1", t.state === "done" ? "bg-success/40" : "bg-line")} />}
              </div>
              <div className="pb-6">
                <p className={cn("font-medium", t.state === "todo" ? "text-muted" : "text-fg")}>{t.label}</p>
                <p className="text-sm text-muted">{t.sub}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Card className="flex items-center justify-between gap-4">
        <div>
          <p id="notify-label" className="font-medium text-fg">
            Notify me when it's done
          </p>
          <p className="text-sm text-muted">Email and push notification</p>
        </div>
        <button
          role="switch"
          aria-checked={notify}
          aria-labelledby="notify-label"
          onClick={() => setNotify((n) => !n)}
          className={cn("relative h-7 w-12 shrink-0 rounded-full border transition-colors", notify ? "border-gold bg-gold" : "border-line bg-surface-2")}
        >
          <span className={cn("absolute top-0.5 size-5 rounded-full transition-all", notify ? "left-6 bg-on-gold" : "left-0.5 bg-muted")} />
        </button>
      </Card>

      <Card elevated className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-1">
          <p className="font-semibold text-fg">In the meantime</p>
          <p className="text-sm text-muted">Everything else on FanZuP works as usual — back campaigns, subscribe, and grab tickets and merch. Investing unlocks automatically once you're verified.</p>
        </div>
        <Button asChild>
          <Link to="/home">
            Go to your feed <ArrowRight />
          </Link>
        </Button>
      </Card>
    </Container>
  );
}
