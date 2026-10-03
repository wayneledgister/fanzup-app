import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Check, ExternalLink, Loader2, Lock } from "lucide-react";
import { Button, Callout, Card, ChoiceCard, Stat } from "@/components/brand";
import {
  ArtistStepLayout, PlatformMark, RISING_MIN_HISTORY_DAYS, RISING_MIN_MONTHLY_LISTENERS, RequirementsChecklist, RisingStepper, WizardFooter, risingRequirements, updateRising, useRising,
} from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-tier2/Tier2Streaming.tsx
 * Doc-driven changes: threshold 5,000 → 1,000 monthly listeners and added 90 days of history
 * (PRD 01 §6.3); Apple Music for Artists offered alongside Spotify; random demo numbers replaced with
 * fixed sample data. Below-threshold state previews with ?state=blocked.
 */
const PLATFORMS = [
  { id: "Spotify for Artists", note: "Monthly listeners, last 28 days" },
  { id: "Apple Music for Artists", note: "Monthly listeners, last 28 days" },
];
const LOADING = ["Authorized read-only access", "Reading your artist profile", "Pulling listener and release history"];

export default function RisingStreaming() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rising = useRising();
  const [platform, setPlatform] = useState(rising.streaming?.platform ?? PLATFORMS[0].id);
  const [phase, setPhase] = useState<"idle" | "connecting" | "done">(rising.streaming ? "done" : "idle");
  const [progress, setProgress] = useState(0);

  const connect = () => {
    setPhase("connecting");
    setProgress(0);
    LOADING.forEach((_, i) => setTimeout(() => setProgress(i + 1), (i + 1) * 650));
    setTimeout(() => {
      const blocked = params.get("state") === "blocked";
      updateRising({ streaming: { platform, monthlyListeners: blocked ? 640 : 4820, historyDays: blocked ? 52 : 431 } });
      setPhase("done");
    }, LOADING.length * 650 + 400);
  };

  const s = rising.streaming;
  const meets = !!s && s.monthlyListeners >= RISING_MIN_MONTHLY_LISTENERS && s.historyDays >= RISING_MIN_HISTORY_DAYS;
  const items = risingRequirements(rising).filter((r) => r.id === "listeners" || r.id === "history");

  return (
    <ArtistStepLayout
      stepper={<RisingStepper step="Streaming" />}
      title="Connect your streaming analytics"
      description={`Rising needs ${RISING_MIN_MONTHLY_LISTENERS.toLocaleString()}+ monthly listeners and at least ${RISING_MIN_HISTORY_DAYS} days since your first release.`}
      footer={
        <WizardFooter backTo="/tier/rising/business" note={phase === "done" && !meets ? "Your progress is saved. Come back when your numbers grow." : undefined}>
          {phase === "done" && !meets ? (
            <Button asChild size="lg" variant="secondary">
              <Link to="/creator">Back to dashboard</Link>
            </Button>
          ) : (
            <Button size="lg" disabled={!meets} onClick={() => navigate("/tier/rising/social")}>
              Continue <ArrowRight />
            </Button>
          )}
        </WizardFooter>
      }
    >
      {phase === "idle" && (
        <>
          <div role="radiogroup" aria-label="Streaming platform" className="grid gap-3 sm:grid-cols-2">
            {PLATFORMS.map((p) => (
              <ChoiceCard key={p.id} selected={platform === p.id} onSelect={() => setPlatform(p.id)} className="flex items-center gap-4 p-4">
                <PlatformMark name={p.id} />
                <span className="flex flex-col">
                  <span className="font-semibold text-fg">{p.id}</span>
                  <span className="text-sm text-muted">{p.note}</span>
                </span>
              </ChoiceCard>
            ))}
          </div>
          <Button size="lg" variant="secondary" onClick={connect}>
            Connect {platform} <ExternalLink />
          </Button>
          <div className="flex gap-3 rounded-lg border border-line p-4 text-sm text-muted">
            <Lock className="mt-0.5 size-4 shrink-0" />
            <p>You'll sign in on {platform.replace(" for Artists", "")}'s site and grant read-only access to your stats. We can't post, change your music or see your payouts.</p>
          </div>
        </>
      )}

      {phase === "connecting" && (
        <Card className="flex flex-col gap-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-gold" />
            <h2 className="text-lg font-semibold">Connecting to {platform}</h2>
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {LOADING.map((l, i) => (
              <li key={l} className={i < progress ? "flex items-center gap-2 text-fg" : "flex items-center gap-2 text-muted"}>
                {i < progress ? <Check className="size-4 text-success" /> : <span className="size-4 rounded-full border border-line" />}
                {l}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {phase === "done" && s && (
        <>
          <Card className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <PlatformMark name={s.platform} />
                <div>
                  <p className="font-semibold">{s.platform}</p>
                  <p className="flex items-center gap-1 text-sm text-success">
                    <Check className="size-3.5" /> Connected
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { updateRising({ streaming: null }); setPhase("idle"); }}>
                Disconnect
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <Stat label="Monthly listeners" value={s.monthlyListeners.toLocaleString()} hint={`Need ${RISING_MIN_MONTHLY_LISTENERS.toLocaleString()}+`} />
              <Stat label="Release history" value={`${s.historyDays} days`} hint={`Need ${RISING_MIN_HISTORY_DAYS}+`} />
            </div>
          </Card>
          <RequirementsChecklist tier="Rising" title="Streaming requirements" items={items} footnote={null} />
          {!meets && (
            <Callout tone="warning" title="Not there yet, and that's fine">
              <p>Keep building and reconnect anytime. What tends to move the numbers:</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>Release consistently, and pitch each release to editorial playlists before it drops</li>
                <li>Run a Starter reward campaign to rally your core fans around a release</li>
                <li>Collaborate with artists whose listeners overlap with yours</li>
              </ul>
            </Callout>
          )}
        </>
      )}
    </ArtistStepLayout>
  );
}
