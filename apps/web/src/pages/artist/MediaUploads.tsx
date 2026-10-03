import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, ImagePlus, Trash2, Upload } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card } from "@/components/brand";
import { ArtistStepLayout, WizardFooter, updateDraft, useArtistDraft, useSavedFlash } from "@/components/artist";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistMediaUploads.tsx
 * Doc-driven changes: photo + banner still skippable, but flagged as needed for a 100% profile
 * (Starter gate, PRD 01 §6.3); added file type/size validation and a live profile preview.
 */
const MAX_MB = 10;

export default function MediaUploads() {
  const navigate = useNavigate();
  const d = useArtistDraft();
  const saved = useSavedFlash([d.avatarUrl, d.bannerUrl]);
  const name = d.displayName || "Your artist name";
  const missing = [!d.avatarUrl && "profile photo", !d.bannerUrl && "banner"].filter(Boolean) as string[];

  return (
    <ArtistStepLayout
      step="Media"
      saved={saved}
      title="Show fans who you are"
      description="Your photo and banner are the first thing fans and promoters see. Use your own artwork or press shots."
      footer={
        <WizardFooter backTo="/artist-onboarding/basic" note={missing.length ? `You can add your ${missing.join(" and ")} later, but Starter needs a complete profile.` : undefined}>
          <Button size="lg" onClick={() => navigate("/artist-onboarding/social")}>
            {missing.length ? "Skip for now" : "Continue"} <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      {/* Live preview */}
      <Card padded={false} className="overflow-hidden">
        <div className="relative">
          {d.bannerUrl ? (
            <img src={d.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" />
          ) : (
            <ArtistArt seed={name + "-banner"} className="aspect-[3/1] w-full rounded-none" />
          )}
          <div className="absolute -bottom-10 left-4 sm:left-6">
            {d.avatarUrl ? (
              <img src={d.avatarUrl} alt="" className="size-20 rounded-full border-4 border-surface object-cover sm:size-24" />
            ) : (
              <ArtistArt seed={name} label={name} rounded="full" className="size-20 border-4 border-surface sm:size-24" />
            )}
          </div>
        </div>
        <div className="flex items-end justify-between gap-3 px-4 pb-5 pt-12 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{name}</p>
            <p className="truncate text-sm text-muted">{[d.genres.join(" · "), d.city].filter(Boolean).join(" · ") || "Genre · City"}</p>
          </div>
          <Badge tone="neutral">Preview</Badge>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0 sm:grid-cols-[1fr_1.6fr]">
        <Uploader
          label="Profile photo"
          hint="Square, at least 400 × 400 px. JPG or PNG."
          value={d.avatarUrl}
          onChange={(url) => updateDraft({ avatarUrl: url })}
          shape="square"
        />
        <Uploader
          label="Banner image"
          hint="At least 1500 × 500 px. Keep faces and text centered."
          value={d.bannerUrl}
          onChange={(url) => updateDraft({ bannerUrl: url })}
          shape="wide"
        />
      </div>

      <Callout tone="info" title="Use art you own or have permission to use">
        Don't upload other artists' artwork, label logos or photos you don't have rights to. Profiles that do are hidden until fixed.
      </Callout>
    </ArtistStepLayout>
  );
}

function Uploader({ label, hint, value, onChange, shape }: { label: string; hint: string; value: string | null; onChange: (url: string | null) => void; shape: "square" | "wide" }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const accept = (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError("That file type isn't supported. Use a JPG, PNG or WebP image.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`That image is over ${MAX_MB} MB. Export a smaller version and try again.`);
    setError(null);
    if (value) URL.revokeObjectURL(value);
    onChange(URL.createObjectURL(file));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-fg" id={`${id}-label`}>
        {label}
      </span>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed bg-surface p-6 text-center transition-colors focus-within:border-gold",
          shape === "square" ? "aspect-square" : "aspect-[3/1] min-h-40 sm:aspect-auto sm:h-full",
          drag ? "border-gold bg-gold/8" : error ? "border-error/60" : "border-line hover:border-muted/50",
        )}
      >
        {value ? (
          <>
            <img src={value} alt={`${label} preview`} className="absolute inset-0 size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/60 py-2 text-sm text-fg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Upload className="size-4" /> Replace
            </span>
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-md bg-surface-2 text-gold">
              <ImagePlus className="size-6" />
            </span>
            <span className="text-sm font-medium text-fg">Drop an image or browse</span>
            <span className="text-xs text-muted">Max {MAX_MB} MB</span>
          </>
        )}
        <input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-describedby={`${id}-hint`} onChange={(e) => accept(e.target.files?.[0])} />
      </label>
      <div className="flex items-start justify-between gap-3">
        <p id={`${id}-hint`} className={cn("text-sm", error ? "text-error" : "text-muted")}>
          {error ?? hint}
        </p>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)} aria-label={`Remove ${label.toLowerCase()}`}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
