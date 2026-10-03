import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Check, Pencil, X } from "lucide-react";
import { Button, Card, TextInput } from "@/components/brand";
import { ArtistStepLayout, PlatformMark, SOCIAL_PLATFORMS, WizardFooter, updateDraft, useArtistDraft, useSavedFlash, type SocialPlatform } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistSocialLinks.tsx
 * Doc-driven changes: handles are entered and validated inline instead of a simulated OAuth
 * connect (no follower data is needed for Starter, PRD 01 §6.3); added YouTube; all optional.
 */
const HINT: Record<SocialPlatform, string> = {
  Instagram: "instagram.com/",
  TikTok: "tiktok.com/@",
  X: "x.com/",
  YouTube: "youtube.com/@",
};

export default function SocialLinks() {
  const navigate = useNavigate();
  const d = useArtistDraft();
  const saved = useSavedFlash([JSON.stringify(d.socials)]);
  const count = Object.values(d.socials).filter(Boolean).length;

  const set = (p: SocialPlatform, handle: string | null) => {
    const next = { ...d.socials };
    if (handle) next[p] = handle;
    else delete next[p];
    updateDraft({ socials: next });
  };

  return (
    <ArtistStepLayout
      step="Socials"
      saved={saved}
      title="Where do your fans already follow you?"
      description="Add your handles so fans can find you everywhere. They show as links on your FanZuP profile."
      footer={
        <WizardFooter backTo="/artist-onboarding/media" note="All optional. You can add or change these anytime from your profile settings.">
          <Button size="lg" onClick={() => navigate("/artist-onboarding/streaming")}>
            {count ? "Continue" : "Skip for now"} <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {SOCIAL_PLATFORMS.map((p) => (
            <SocialRow key={p} platform={p} handle={d.socials[p]} onSave={(h) => set(p, h)} onRemove={() => set(p, null)} />
          ))}
        </ul>
      </Card>
      <p className="num text-sm text-muted">
        {count} of {SOCIAL_PLATFORMS.length} added
      </p>
    </ArtistStepLayout>
  );
}

function SocialRow({ platform, handle, onSave, onRemove }: { platform: SocialPlatform; handle?: string; onSave: (h: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(handle?.replace(/^@/, "") ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputId = `social-${platform}`;

  const save = () => {
    const clean = value.trim().replace(/^@/, "").replace(/^https?:\/\/\S+\//, "");
    if (!/^[A-Za-z0-9._]{2,30}$/.test(clean)) {
      setError("Use 2–30 letters, numbers, periods or underscores.");
      return;
    }
    setError(null);
    onSave(`@${clean}`);
    setEditing(false);
  };

  return (
    <li className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <PlatformMark name={platform} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{platform}</p>
          {handle && !editing ? (
            <p className="flex items-center gap-1 truncate text-sm text-success">
              <Check className="size-3.5 shrink-0" /> {handle}
            </p>
          ) : (
            <p className="text-sm text-muted">{editing ? `${HINT[platform]}…` : "Not added"}</p>
          )}
        </div>
        {!editing &&
          (handle ? (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Edit ${platform} handle`} onClick={() => setEditing(true)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${platform}`} onClick={onRemove}>
                <X />
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" className="h-11" onClick={() => setEditing(true)}>
              Add
            </Button>
          ))}
      </div>
      {editing && (
        <div className="flex flex-col gap-2 sm:pl-15">
          <label htmlFor={inputId} className="sr-only">
            {platform} handle
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">@</span>
              <TextInput
                id={inputId}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="yourhandle"
                className="pl-8"
                aria-invalid={!!error}
              />
            </div>
            <Button variant="secondary" onClick={save}>Save</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setError(null); }}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}
    </li>
  );
}
