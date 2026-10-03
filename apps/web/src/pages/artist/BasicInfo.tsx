import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, BadgeCheck, Loader2 } from "lucide-react";
import { Badge, Button, Card, Field, TextArea, TextInput } from "@/components/brand";
import { ArtistStepLayout, WizardFooter, updateDraft, useArtistDraft, useSavedFlash } from "@/components/artist";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/artist-onboarding/ArtistBasicInfo.tsx
 * Doc-driven changes: added home city and mobile-number confirmation because the Starter tier
 * requires email + phone and a 100% profile (PRD 01 §6.3); 6-step artist stepper replaces "Step 1 of 5".
 */
const GENRES = ["Hip-Hop", "R&B", "Pop", "Rock", "Indie", "Alternative", "Electronic", "Country", "Folk / Americana", "Jazz", "Latin", "Afrobeats", "Gospel", "Classical"];
const BIO_MAX = 500;

export default function BasicInfo() {
  const navigate = useNavigate();
  const d = useArtistDraft();
  const [errors, setErrors] = useState<{ name?: string; genres?: string; city?: string; phone?: string; code?: string }>({});
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const saved = useSavedFlash([d.displayName, d.genres.length, d.city, d.bio]);

  const toggleGenre = (g: string) => {
    const next = d.genres.includes(g) ? d.genres.filter((x) => x !== g) : d.genres.length < 3 ? [...d.genres, g] : d.genres;
    updateDraft({ genres: next });
    if (next.length) setErrors((e) => ({ ...e, genres: undefined }));
  };

  const phoneDigits = d.phone.replace(/\D/g, "");
  const sendCode = () => {
    if (phoneDigits.length !== 10) {
      setErrors((e) => ({ ...e, phone: "Enter a 10-digit US mobile number." }));
      return;
    }
    setErrors((e) => ({ ...e, phone: undefined }));
    setCodeSent(true);
  };
  const confirmCode = () => {
    if (!/^\d{6}$/.test(code)) {
      setErrors((e) => ({ ...e, code: "Enter the 6-digit code from the text we sent." }));
      return;
    }
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      setErrors((e) => ({ ...e, code: undefined }));
      updateDraft({ phoneVerified: true });
    }, 900);
  };

  const handleContinue = () => {
    const next: typeof errors = {};
    if (d.displayName.trim().length < 2) next.name = "Your artist name needs at least 2 characters.";
    if (!d.genres.length) next.genres = "Pick at least one genre so fans can find you.";
    if (d.city.trim().length < 2) next.city = "Add the city you rep.";
    if (!d.phoneVerified) next.phone = "Confirm your mobile number to continue. We need it for payout and security alerts.";
    setErrors(next);
    if (Object.keys(next).length) return;
    navigate("/artist-onboarding/media");
  };

  return (
    <ArtistStepLayout
      step="Basics"
      saved={saved}
      title="Set up your artist profile"
      description="This is the front door to your business on FanZuP. Tell fans who you are and how to reach you."
      footer={
        <WizardFooter backTo="/home" backLabel="Cancel">
          <Button size="lg" onClick={handleContinue}>
            Continue <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <Card className="flex flex-col gap-6">
        <Field label="Artist or band name" htmlFor="name" error={errors.name} hint="This is how you'll appear on your profile and campaigns.">
          <TextInput
            id="name"
            value={d.displayName}
            onChange={(e) => {
              updateDraft({ displayName: e.target.value });
              if (e.target.value.trim().length >= 2) setErrors((x) => ({ ...x, name: undefined }));
            }}
            placeholder="e.g. Rhea Kline"
            autoComplete="nickname"
            aria-invalid={!!errors.name}
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-fg">
            Genres <span className="font-normal text-muted">· pick up to 3</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => {
              const on = d.genres.includes(g);
              const full = !on && d.genres.length >= 3;
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleGenre(g)}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    on ? "border-gold bg-gold/12 text-gold" : "border-line text-muted hover:border-muted/50 hover:text-fg",
                  )}
                >
                  {g}
                </button>
              );
            })}
          </div>
          {errors.genres ? <p className="text-sm text-error">{errors.genres}</p> : <p className="num text-sm text-muted">{d.genres.length} / 3 selected</p>}
        </fieldset>

        <Field label="Home city" htmlFor="city" error={errors.city} hint="Fans and promoters search by scene.">
          <TextInput
            id="city"
            value={d.city}
            onChange={(e) => {
              updateDraft({ city: e.target.value });
              if (e.target.value.trim().length >= 2) setErrors((x) => ({ ...x, city: undefined }));
            }}
            placeholder="e.g. Philadelphia, PA"
            autoComplete="address-level2"
            aria-invalid={!!errors.city}
          />
        </Field>

        <Field
          label="Bio"
          htmlFor="bio"
          hint={
            <span className="flex justify-between gap-4">
              <span>Your sound, your story, what you're building next. A full profile needs at least 40 characters.</span>
              <span className="num shrink-0">
                {d.bio.length} / {BIO_MAX}
              </span>
            </span>
          }
        >
          <TextArea id="bio" value={d.bio} maxLength={BIO_MAX} rows={5} onChange={(e) => updateDraft({ bio: e.target.value })} placeholder="Four-piece from South Philly. Loud guitars, louder crowds. Debut LP out this fall." />
        </Field>
      </Card>

      <Card className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Confirm your mobile number</h2>
            <p className="text-sm text-muted">Required for Starter. We use it for payout and sign-in alerts. It's never shown on your profile.</p>
          </div>
          {d.phoneVerified && (
            <Badge tone="success" icon={<BadgeCheck />}>
              Confirmed
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field label="Mobile number" htmlFor="phone" error={errors.phone} className="flex-1">
            <TextInput
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={d.phone}
              disabled={d.phoneVerified}
              onChange={(e) => updateDraft({ phone: e.target.value, phoneVerified: false })}
              placeholder="(215) 555-0123"
              className="num"
              aria-invalid={!!errors.phone}
            />
          </Field>
          {!d.phoneVerified && (
            <Button variant="secondary" className="sm:mt-7" onClick={sendCode}>
              {codeSent ? "Resend code" : "Send code"}
            </Button>
          )}
          {d.phoneVerified && (
            <Button variant="ghost" className="sm:mt-7" onClick={() => { updateDraft({ phoneVerified: false }); setCodeSent(false); setCode(""); }}>
              Change number
            </Button>
          )}
        </div>
        {codeSent && !d.phoneVerified && (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4 sm:flex-row sm:items-start">
            <Field label="6-digit code" htmlFor="code" error={errors.code} hint={<>Sent to <span className="num">{d.phone}</span>. It expires in 10 minutes.</>} className="flex-1">
              <TextInput id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" className="num tracking-[0.3em]" aria-invalid={!!errors.code} />
            </Field>
            <Button variant="secondary" className="sm:mt-7" onClick={confirmCode} disabled={checking}>
              {checking ? <><Loader2 className="animate-spin" /> Checking</> : "Confirm"}
            </Button>
          </div>
        )}
      </Card>
    </ArtistStepLayout>
  );
}
