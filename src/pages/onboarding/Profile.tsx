import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import { Button, Field, TextArea, TextInput } from "@/components/brand";
import { OnboardingFooter, OnboardingHeader } from "@/components/public/onboarding";
import { fan } from "@/lib/mock";

/**
 * Source: FPS onboarding/StepProfile.tsx (avatar upload + crop modal, display name required, skip).
 * Changes: added @handle and optional bio + city; the crop modal is a simple zoom/position dialog over the
 * selected image (object URL, never uploaded in the prototype).
 */

export default function Profile() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.2);
  const [fileErr, setFileErr] = useState<string>();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const nameErr = submitted && !name.trim() ? "Add a display name to continue." : undefined;
  const handleErr = handle && !/^[a-z0-9_.]{3,20}$/.test(handle) ? "3–20 characters: lowercase letters, numbers, dots or underscores." : undefined;

  const onFile = (f?: File) => {
    if (!f) return;
    if (!/image\/(png|jpe?g|gif|webp)/.test(f.type)) return setFileErr("Use a JPG, PNG, GIF or WebP image.");
    if (f.size > 5 * 1024 * 1024) return setFileErr("That image is over 5 MB. Try a smaller one.");
    setFileErr(undefined);
    setDraft(URL.createObjectURL(f));
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!name.trim() || handleErr) return;
        navigate("/onboarding/discover");
      }}
    >
      <OnboardingHeader step={3} title="Set up your fan profile" description="This is what artists and other fans see when you back, comment or show up." />

      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-full border border-line bg-surface-2">
            {img ? (
              <img src={img} alt="Your avatar" className="size-full object-cover" style={{ transform: `scale(${zoom})` }} />
            ) : (
              <div className="flex size-full items-center justify-center text-muted">
                <Camera className="size-7" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                <ImageUp /> {img ? "Change photo" : "Upload photo"}
              </Button>
              {img && (
                <Button type="button" variant="ghost" size="icon" aria-label="Remove photo" onClick={() => setImg(null)}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <p className={fileErr ? "text-sm text-error" : "text-sm text-muted"}>{fileErr ?? "JPG, PNG, GIF or WebP · up to 5 MB"}</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" aria-label="Upload avatar" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Display name" htmlFor="display" hint="Visible to artists and other fans." error={nameErr}>
            <TextInput id="display" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameErr || undefined} placeholder={fan.name} />
          </Field>
          <Field label="Username" htmlFor="handle" optional error={handleErr} hint="Your profile link: fanzup.com/@username">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">@</span>
              <TextInput id="handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} aria-invalid={!!handleErr || undefined} className="pl-8" placeholder="jordanp" />
            </div>
          </Field>
        </div>
        <Field label="City" htmlFor="city" optional hint="Helps us show you local shows and artists.">
          <TextInput id="city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Little Rock, AR" />
        </Field>
        <Field label="Bio" htmlFor="bio" optional hint={<span className="num">{bio.length}/160</span>}>
          <TextArea id="bio" maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Front row at every show since 2014." />
        </Field>
      </div>

      <OnboardingFooter
        back="/onboarding/path"
        skip={
          <Button type="button" variant="ghost" size="lg" onClick={() => navigate("/onboarding/discover")}>
            Skip for now
          </Button>
        }
        primary={
          <Button type="submit" size="lg">
            Continue
          </Button>
        }
      />

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="crop-title">
          <div className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-line bg-surface p-6">
            <h2 id="crop-title" className="text-lg font-semibold">
              Crop your photo
            </h2>
            <div className="mx-auto size-56 overflow-hidden rounded-full border-2 border-gold">
              <img src={draft} alt="Crop preview" className="size-full object-cover" style={{ transform: `scale(${zoom})` }} />
            </div>
            <label className="flex flex-col gap-2 text-sm">
              <span className="flex justify-between">
                Zoom <span className="num text-muted">{Math.round(zoom * 100)}%</span>
              </span>
              <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="accent-gold" />
            </label>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setImg(draft);
                  setDraft(null);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
