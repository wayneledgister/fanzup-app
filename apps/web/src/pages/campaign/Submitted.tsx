import { Link } from "react-router";
import { BellRing, CheckCircle2, Clock, Megaphone, PencilLine, Rocket, Share2 } from "lucide-react";
import { Badge, Button, Card, IconChip, KeyValue } from "@/components/brand";
import { useMemo } from "react";
import { exampleDraft, useDraft, toInt } from "@/components/campaign/draft";
import { cn } from "@/lib/utils";

/**
 * Source: FPS src/pages/campaign/CampaignSuccess.tsx
 * Doc-driven changes: "Review Process (1-2 days)" → compliance review "usually within 2 business days",
 * labelled as an estimate. "Applicable regulations" wording replaced with what reviewers actually check
 * for a reward campaign. Quick actions point to real routes (campaigns list, dashboard).
 */
export default function Submitted() {
  const live = useDraft();
  // Opened directly (no submission this session): show the example draft so the screen still reads true.
  const example = useMemo(() => exampleDraft(), []);
  const d = live.submittedAt ? live : example;
  const submittedAt = live.submittedAt ? new Date(live.submittedAt) : new Date();
  const id = live.submissionId ?? "CMP-26-0421";
  const title = d.title || "Your campaign";
  const goal = toInt(d.goal);
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(submittedAt);

  const steps = [
    { icon: <CheckCircle2 />, title: "Submitted", body: <>Received <span className="num">{when}</span></>, state: "done" as const },
    {
      icon: <Clock />,
      title: "Compliance review",
      body: "We review every campaign before it goes live, usually within 2 business days. That's an estimate — busy weeks can take longer.",
      state: "active" as const,
    },
    {
      icon: <Rocket />,
      title: d.launch === "scheduled" ? "Goes live on your launch date" : "Goes live when approved",
      body: "You'll get an email the moment it's approved. If we need changes, we'll tell you exactly what to fix.",
      state: "next" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-4 pt-4 text-center">
        <div className="relative flex size-16 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
          <CheckCircle2 className="size-8" />
        </div>
        <div className="flex flex-col gap-2">
          <Badge tone="warning" className="mx-auto">
            In review
          </Badge>
          <h1 className="text-3xl font-bold sm:text-4xl">Submitted for review</h1>
          <p className="mx-auto max-w-md text-muted">
            “{title}” is with our compliance team. Nothing is public yet, and no one can back it until it's approved.
          </p>
        </div>
      </div>

      <Card className="flex flex-col divide-y divide-line py-2">
        <KeyValue k="Reference" v={<span className="num">{id}</span>} />
        <KeyValue k="Goal" v={<span className="num">{Number.isFinite(goal) ? `$${goal.toLocaleString()}` : "—"}</span>} />
        <KeyValue k="Perks" v={<span className="num">{d.perks.length}</span>} />
        <KeyValue k="Funds release" v={d.release === "milestones" ? `${d.tranches.length} stages` : "All at once"} />
        <KeyValue k="Review estimate" v="About 2 business days" />
      </Card>

      <section aria-labelledby="next-h" className="flex flex-col gap-4">
        <h2 id="next-h" className="text-xl font-semibold">
          What happens next
        </h2>
        <ol className="flex flex-col">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
              {i < steps.length - 1 && <span className="absolute left-5 top-11 h-[calc(100%-2.75rem)] w-px bg-line" aria-hidden />}
              <IconChip tone={s.state === "done" ? "success" : s.state === "active" ? "warning" : "muted"} className={cn(s.state === "active" && "border-warning/40")}>
                {s.icon}
              </IconChip>
              <div className="flex flex-col gap-1 pt-1.5">
                <p className="flex items-center gap-2 font-semibold">
                  {s.title}
                  {s.state === "active" && <Badge tone="warning">Now</Badge>}
                </p>
                <p className="text-sm text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="meantime-h" className="flex flex-col gap-4">
        <h2 id="meantime-h" className="text-xl font-semibold">
          While you wait
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Megaphone />, t: "Plan your launch", d: "Line up posts for launch day. The first 48 hours matter most." },
            { icon: <Share2 />, t: "Warm up your list", d: "Tell subscribers a campaign is coming so they're ready." },
            { icon: <BellRing />, t: "Watch your email", d: "Reviewer questions go to the address on your account." },
          ].map((x) => (
            <Card key={x.t} className="flex flex-col gap-3 p-5">
              <IconChip>{x.icon}</IconChip>
              <p className="font-semibold">{x.t}</p>
              <p className="text-sm text-muted">{x.d}</p>
            </Card>
          ))}
        </div>
        <p className="flex items-start gap-2 text-sm text-muted">
          <PencilLine className="mt-0.5 size-4 shrink-0" />
          Need to change something? You can withdraw and edit from your campaigns list. Edits restart the review.
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button asChild size="lg">
          <Link to="/creator/campaigns">Go to my campaigns</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link to="/creator">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
