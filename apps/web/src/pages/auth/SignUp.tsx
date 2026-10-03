import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, CircleAlert, Gift, Headphones, Mic2 } from "lucide-react";
import { POLICY } from "@fanzup/shared/policy";
import { Button, Callout, Checkbox, ChoiceCard, Field, IconChip, TextInput } from "@/components/brand";
import { AuthCard, EMAIL_RE, PasswordInput, PasswordStrength, passwordScore } from "@/components/public/auth";
import { safeNext, supabase } from "@/lib/supabase";
import { anonId } from "@/lib/attribution";

/**
 * Source: FPS SignUpFlows.tsx (choice → credentials, artist variant).
 * M1 (card G1-B option 3, "full account first"; FR-BCK-002, FR-ID-001, FR-ID-006, FR-PRV-001): a real Supabase
 * account with email + password, an 18+ attestation and acceptance of the current terms. A verification link is
 * emailed; opening it lands the fan back on `next` (e.g. checkout with the same campaign and perk).
 * Social sign-in buttons are removed until a provider is configured (FR-PLT-002: nothing that doesn't work).
 */

type Role = "fan" | "artist";

/** "/checkout/<slug>?perk=…" → "<slug>" so we can tell the fan what they're about to back. */
const checkoutSlug = (next: string) => /^\/checkout\/([a-z0-9-]+)/i.exec(next)?.[1] ?? null;

export default function SignUp() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"), "");
  const backing = next ? checkoutSlug(next) : null;
  const initialRole: Role | null = params.get("role") === "artist" ? "artist" : params.get("role") === "fan" || next ? "fan" : null;
  const [role, setRole] = useState<Role | null>(initialRole);
  const [step, setStep] = useState<"choose" | "form">(initialRole ? "form" : "choose");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string>();

  const errors = {
    name: !name.trim() ? "Tell us what to call you." : name.length > 60 ? "Keep it under 60 characters." : undefined,
    email: !email ? "Enter your email address." : !EMAIL_RE.test(email) ? "That doesn't look like an email address." : undefined,
    pwd: !pwd ? "Create a password." : passwordScore(pwd) < 3 ? "Use at least 8 characters with upper and lower case letters and a number." : undefined,
    adult: !adult ? "You need to be 18 or older to use FanZuP." : undefined,
    terms: !terms ? "You'll need to agree to continue." : undefined,
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);
  const afterVerify = next || (role === "artist" ? "/artist-onboarding/basic" : "/explore");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure(undefined);
    if (Object.values(errors).some(Boolean)) return;
    if (!supabase) return setFailure("Sign-up isn't configured in this environment.");
    setLoading(true);
    const redirect = `${window.location.origin}/verify-email?next=${encodeURIComponent(afterVerify)}`;
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: pwd,
      options: {
        emailRedirectTo: redirect,
        data: {
          display_name: name.trim(),
          adult_attested: true,
          terms_version: POLICY.legal.termsVersion,
          privacy_version: POLICY.legal.privacyVersion,
          anon_id: anonId(),
        },
      },
    });
    setLoading(false);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already registered")) return setFailure("This email already has an account. Log in instead.");
      if (msg.includes("password")) return setFailure(error.message);
      return setFailure("We couldn't create your account just now. Please try again in a moment.");
    }
    if (data.session) return navigate(afterVerify, { replace: true }); // confirmations off (local dev only)
    navigate(`/verify-email?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(afterVerify)}`, { replace: true });
  };

  const loginLink = `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  if (step === "choose") {
    return (
      <AuthCard
        title="Join FanZuP"
        subtitle="How do you want to get started? You can add the other side later."
        footer={<>Already have an account? <Link to={loginLink} className="font-medium text-gold hover:underline">Log in</Link></>}
      >
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Account type">
          <ChoiceCard selected={role === "fan"} onSelect={() => setRole("fan")}>
            <div className="flex items-start gap-4">
              <IconChip tone={role === "fan" ? "gold" : "muted"}><Headphones /></IconChip>
              <div>
                <p className="font-semibold">I'm a fan</p>
                <p className="text-sm text-muted">Back campaigns and get perks from artists you love.</p>
              </div>
            </div>
          </ChoiceCard>
          <ChoiceCard selected={role === "artist"} onSelect={() => setRole("artist")}>
            <div className="flex items-start gap-4">
              <IconChip tone={role === "artist" ? "gold" : "muted"}><Mic2 /></IconChip>
              <div>
                <p className="font-semibold">I'm an artist</p>
                <p className="text-sm text-muted">Raise money for your music from the fans who already believe in you.</p>
              </div>
            </div>
          </ChoiceCard>
        </div>
        <Button size="lg" block disabled={!role} onClick={() => setStep("form")}>Continue</Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={role === "artist" ? "Create your artist account" : "Create your fan account"}
      subtitle={backing ? "Create your account, verify your email, and you'll land right back at checkout with your perk." : role === "artist" ? "Start with your login. You'll add your artist details next." : "Start backing the artists you love."}
      footer={<>Already have an account? <Link to={loginLink} className="font-medium text-gold hover:underline">Log in</Link></>}
    >
      {!next && (
        <button type="button" onClick={() => setStep("choose")} className="-mt-2 flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {role === "artist" ? "Signing up as an artist" : "Signing up as a fan"} · change
        </button>
      )}
      {backing && (
        <Callout tone="gold" icon={<Gift />} title="Your perk is saved">
          We'll keep the campaign and perk you picked. You'll be back at checkout as soon as your email is verified.
        </Callout>
      )}
      {failure && (
        <Callout tone="error" icon={<CircleAlert />} title="That didn't work">
          {failure}{" "}
          {failure.includes("Log in") && <Link to={loginLink} className="font-medium text-gold hover:underline">Log in</Link>}
        </Callout>
      )}

      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <Field label="Your name" htmlFor="name" error={show("name")}>
          <TextInput id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!show("name") || undefined} />
        </Field>
        <Field label="Email address" htmlFor="email" error={show("email")}>
          <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!show("email") || undefined} placeholder="you@example.com" />
        </Field>
        <Field label="Password" htmlFor="password" error={show("pwd")}>
          <PasswordInput id="password" value={pwd} onChange={setPwd} invalid={!!show("pwd")} autoComplete="new-password" />
          {!show("pwd") && <PasswordStrength value={pwd} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Checkbox id="adult" checked={adult} onChange={setAdult}>I'm 18 or older.</Checkbox>
          {show("adult") && <p className="pl-7 text-sm text-error">{show("adult")}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Checkbox id="terms" checked={terms} onChange={setTerms}>
            I agree to the <Link to="/legal/terms" className="text-gold hover:underline">Terms of Service</Link> and{" "}
            <Link to="/legal/privacy" className="text-gold hover:underline">Privacy Policy</Link> (beta versions).
          </Checkbox>
          {show("terms") && <p className="pl-7 text-sm text-error">{show("terms")}</p>}
        </div>
        <Button type="submit" size="lg" block disabled={loading}>
          {loading ? "Creating your account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
