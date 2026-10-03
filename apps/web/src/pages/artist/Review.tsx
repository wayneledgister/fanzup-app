import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Check, Circle, Pencil, ShieldCheck } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, IconChip, KeyValue } from "@/components/brand";
import {
  ArtistStepLayout, RequirementsChecklist, SOCIAL_PLATFORMS, STREAMING_PLATFORMS, WizardFooter, profileChecklist, profileCompletion, starterRequirements, useDisplayDraft,
} from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistReview.tsx
 * Doc-driven changes: added the Starter requirements checklist (PRD 01 §6.3) and profile
 * completeness; "Continue to Verification" links to the merged /artist-onboarding/verify screen.
 */
export default function Review() {
  const navigate = useNavigate();
  const { draft: d, isSample } = useDisplayDraft();
  const pct = profileCompletion(d);
  const checklist = profileChecklist(d);

  return (
    <ArtistStepLayout
      step="Review"
      title="Review your profile"
      description="Check everything reads right. Next you'll verify your identity, then your profile can go live."
      footer={
        <WizardFooter backTo="/artist-onboarding/streaming">
          <Button size="lg" onClick={() => navigate("/artist-onboarding/verify")}>
            Continue to verification <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      {isSample && (
        <Callout tone="info" title="Showing a sample profile">
          You opened this step directly, so we're showing example details. <Link to="/artist-onboarding/basic" className="text-gold hover:underline">Start from the beginning</Link> to build yours.
        </Callout>
      )}

      {/* Profile card */}
      <Card padded={false} className="overflow-hidden">
        {d.bannerUrl ? <img src={d.bannerUrl} alt="" className="aspect-[4/1] w-full object-cover" /> : <ArtistArt seed={d.displayName + "-banner"} className="aspect-[4/1] w-full rounded-none" />}
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
          {d.avatarUrl ? (
            <img src={d.avatarUrl} alt="" className="size-16 shrink-0 rounded-full object-cover" />
          ) : (
            <ArtistArt seed={d.displayName} label={d.displayName} rounded="full" className="size-16 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold">{d.displayName}</p>
            <p className="text-sm text-muted">{[d.genres.join(" · "), d.city].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <span className="eyebrow">Profile</span>
            <span className={pct === 100 ? "num text-2xl font-medium text-success" : "num text-2xl font-medium text-fg"}>{pct}%</span>
          </div>
        </div>
      </Card>

      <Section title="Basics" to="/artist-onboarding/basic">
        <KeyValue k="Artist name" v={d.displayName} />
        <KeyValue k="Genres" v={d.genres.join(", ") || <Missing />} />
        <KeyValue k="Home city" v={d.city || <Missing />} />
        <KeyValue k="Mobile" v={d.phoneVerified ? <span className="num">{d.phone}</span> : <Missing label="Not confirmed" />} />
        <div className="flex flex-col gap-1 py-2 text-sm">
          <span className="text-muted">Bio</span>
          <p className="text-fg">{d.bio || <Missing />}</p>
        </div>
      </Section>

      <Section title="Media" to="/artist-onboarding/media">
        <ul className="grid gap-2 py-1 text-sm sm:grid-cols-2">
          {checklist.filter((c) => c.key === "avatar" || c.key === "banner").map((c) => (
            <Line key={c.key} done={c.done}>{c.label} {c.done ? "added" : "missing"}</Line>
          ))}
        </ul>
      </Section>

      <Section title="Socials" to="/artist-onboarding/social">
        <ul className="grid gap-2 py-1 text-sm sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((p) => (
            <Line key={p} done={!!d.socials[p]}>
              {p}: {d.socials[p] ?? <span className="text-muted">not added</span>}
            </Line>
          ))}
        </ul>
      </Section>

      <Section title="Streaming" to="/artist-onboarding/streaming">
        <ul className="grid gap-2 py-1 text-sm">
          <Line done={!!d.trackUrl}>
            Released track: {d.trackUrl ? <span className="break-all">{d.trackUrl}</span> : <span className="text-muted">not linked</span>}
          </Line>
          {STREAMING_PLATFORMS.map((p) => (
            <Line key={p} done={!!d.streaming[p]}>
              {p}: {d.streaming[p] ? "linked" : <span className="text-muted">not linked</span>}
            </Line>
          ))}
        </ul>
      </Section>

      <RequirementsChecklist tier="Starter" title="Unlock Starter" items={starterRequirements(d, { identity: "todo" })} />

      <Card className="flex gap-4">
        <IconChip>
          <ShieldCheck />
        </IconChip>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Next: verify your identity</h2>
          <p className="text-sm text-muted">Every artist on FanZuP is identity-verified before taking fans' money. It takes about 5 minutes with a government ID and your phone camera.</p>
        </div>
      </Card>
    </ArtistStepLayout>
  );
}

function Section({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button asChild variant="ghost" size="sm" className="h-11 sm:h-9">
          <Link to={to} aria-label={`Edit ${title.toLowerCase()}`}>
            <Pencil /> Edit
          </Link>
        </Button>
      </div>
      <div className="divide-y divide-line">{children}</div>
    </Card>
  );
}

function Line({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted/60" />}
      <span className="min-w-0 text-fg">{children}</span>
    </li>
  );
}

function Missing({ label = "Missing" }: { label?: string }) {
  return <Badge tone="warning">{label}</Badge>;
}
