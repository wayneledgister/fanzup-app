import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Check, Disc3, Pencil, X } from "lucide-react";
import { Badge, Button, Card, Field, TextInput } from "@/components/brand";
import { ArtistStepLayout, PlatformMark, STREAMING_PLATFORMS, WizardFooter, updateDraft, useArtistDraft, useSavedFlash, type StreamingPlatform } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistStreamingLinks.tsx
 * Doc-driven changes: added the "released track" link that Starter requires (PRD 01 §6.3);
 * profile links are pasted URLs (no listener data needed until Rising); DistroKid dropped (a
 * distributor, not a listening platform).
 */
const DOMAIN: Record<StreamingPlatform, RegExp> = {
  Spotify: /(^|\.)spotify\.com\//i,
  "Apple Music": /music\.apple\.com\//i,
  "YouTube Music": /(music\.)?youtube\.com\/|youtu\.be\//i,
  SoundCloud: /soundcloud\.com\//i,
};
const EXAMPLE: Record<StreamingPlatform, string> = {
  Spotify: "open.spotify.com/artist/…",
  "Apple Music": "music.apple.com/us/artist/…",
  "YouTube Music": "music.youtube.com/channel/…",
  SoundCloud: "soundcloud.com/…",
};
const TRACK_RE = /(spotify\.com\/(track|album)\/|music\.apple\.com\/.+\/(album|song)\/|youtube\.com\/watch|music\.youtube\.com\/watch|youtu\.be\/|soundcloud\.com\/[^/]+\/[^/]+)/i;
const strip = (u: string) => u.trim().replace(/^https?:\/\//, "").replace(/^www\./, "");

export default function StreamingLinks() {
  const navigate = useNavigate();
  const d = useArtistDraft();
  const saved = useSavedFlash([JSON.stringify(d.streaming), d.trackUrl]);
  const [track, setTrack] = useState(d.trackUrl);
  const [trackError, setTrackError] = useState<string | null>(null);

  const saveTrack = (v: string) => {
    if (!v.trim()) {
      setTrackError(null);
      updateDraft({ trackUrl: "" });
      return;
    }
    if (!TRACK_RE.test(v)) {
      setTrackError("That doesn't look like a track link. Open the song on Spotify, Apple Music, YouTube or SoundCloud and copy its share link.");
      return;
    }
    setTrackError(null);
    updateDraft({ trackUrl: strip(v) });
  };

  const setProfile = (p: StreamingPlatform, url: string | null) => {
    const next = { ...d.streaming };
    if (url) next[p] = url;
    else delete next[p];
    updateDraft({ streaming: next });
  };

  const onContinue = () => {
    if (track.trim() && !TRACK_RE.test(track)) return saveTrack(track);
    if (track.trim()) saveTrack(track);
    navigate("/artist-onboarding/review");
  };

  return (
    <ArtistStepLayout
      step="Streaming"
      saved={saved}
      title="Link your music"
      description="Point fans to where they can listen. A released track is how we confirm you're putting music out."
      footer={
        <WizardFooter backTo="/artist-onboarding/social">
          <Button size="lg" onClick={onContinue}>
            Continue <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <Card className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-gold">
              <Disc3 className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Your released track</h2>
              <p className="text-sm text-muted">Required for Starter. Any song of yours that's live on a streaming service.</p>
            </div>
          </div>
          {d.trackUrl ? <Badge tone="success">Linked</Badge> : <Badge tone="gold">Starter</Badge>}
        </div>
        <Field label="Track link" htmlFor="track" error={trackError}>
          <TextInput
            id="track"
            type="url"
            inputMode="url"
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            onBlur={(e) => saveTrack(e.target.value)}
            placeholder="https://open.spotify.com/track/…"
            aria-invalid={!!trackError}
          />
        </Field>
        {d.trackUrl && !trackError && (
          <p className="flex items-center gap-2 truncate text-sm text-success">
            <Check className="size-4 shrink-0" /> <span className="truncate">{d.trackUrl}</span>
          </p>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Artist profiles</h2>
          <p className="text-sm text-muted">Optional. Fans get a listen button on your FanZuP profile for each one.</p>
        </div>
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {STREAMING_PLATFORMS.map((p) => (
              <ProfileRow key={p} platform={p} url={d.streaming[p]} onSave={(u) => setProfile(p, u)} onRemove={() => setProfile(p, null)} />
            ))}
          </ul>
        </Card>
      </section>
    </ArtistStepLayout>
  );
}

function ProfileRow({ platform, url, onSave, onRemove }: { platform: StreamingPlatform; url?: string; onSave: (u: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(url ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `stream-${platform.replace(/\s/g, "")}`;

  const save = () => {
    if (!DOMAIN[platform].test(value)) {
      setError(`Paste your ${platform} artist page link, like ${EXAMPLE[platform]}`);
      return;
    }
    setError(null);
    onSave(strip(value));
    setEditing(false);
  };

  return (
    <li className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <PlatformMark name={platform} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{platform}</p>
          {url && !editing ? (
            <p className="flex items-center gap-1 truncate text-sm text-success">
              <Check className="size-3.5 shrink-0" /> <span className="truncate">{url}</span>
            </p>
          ) : (
            <p className="text-sm text-muted">Not linked</p>
          )}
        </div>
        {!editing &&
          (url ? (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Edit ${platform} link`} onClick={() => setEditing(true)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${platform}`} onClick={onRemove}>
                <X />
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" className="h-11" onClick={() => setEditing(true)}>
              Link
            </Button>
          ))}
      </div>
      {editing && (
        <div className="flex flex-col gap-2 sm:pl-15">
          <label htmlFor={id} className="sr-only">
            {platform} artist page link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput id={id} autoFocus type="url" inputMode="url" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder={`https://${EXAMPLE[platform]}`} aria-invalid={!!error} />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={save} className="flex-1 sm:flex-none">
                Save
              </Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}
    </li>
  );
}
