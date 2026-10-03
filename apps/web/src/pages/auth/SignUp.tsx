import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, CircleAlert, Headphones, Mic2 } from "lucide-react";
import { Button, Callout, Checkbox, ChoiceCard, Field, IconChip, TextInput } from "@/components/brand";
import { AuthCard, EMAIL_RE, PasswordInput, PasswordStrength, SocialButtons, passwordScore } from "@/components/public/auth";

/**
 * Source: FPS SignUpFlows.tsx (choice → credentials → profile, artist variant, email-taken error).
 * Doc-driven changes: fan copy "Discover and invest in artists" / "Start investing" → backing language (Layer 1);
 * the fan profile step (name + DOB age gate) moves to /onboarding/account, and artist details move to
 * /artist-onboarding/basic, so this screen only creates credentials. "Email taken" is reachable with ?state=email-taken
 * or by using taken@example.com.
 */

type Role = "fan" | "artist";

export default function SignUp() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialRole: Role | null = params.get("role") === "artist" ? "artist" : params.get("role") === "fan" || params.get("state") ? "fan" : null;
  const [role, setRole] = useState<Role | null>(initialRole);
  const [step, setStep] = useState<"choose" | "form">(initialRole ? "form" : "choose");
  const [email, setEmail] = useState(params.get("state") === "email-taken" ? "jordan@example.com" : "");
  const [pwd, setPwd] = useState("");
  const [terms, setTerms] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [taken, setTaken] = useState(params.get("state") === "email-taken");
  const [loading, setLoading] = useState(false);

  const errors = {
    email: !email ? "Enter your email address." : !EMAIL_RE.test(email) ? "That doesn't look like an email address." : taken ? "This email already has an account." : undefined,
    pwd: !pwd ? "Create a password." : passwordScore(pwd) < 3 ? "Use at least 8 characters with upper and lower case letters and a number." : undefined,
    terms: !terms ? "You'll need to agree to continue." : undefined,
  };
  const show = (k: keyof typeof errors) => (submitted || (k === "email" && taken) ? errors[k] : undefined);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (email.toLowerCase() === "taken@example.com") {
      setTaken(true);
      return;
    }
    if (errors.email || errors.pwd || errors.terms) return;
    setLoading(true);
    setTimeout(() => navigate(`/verify-email?email=${encodeURIComponent(email)}&role=${role}`), 600);
  };

  if (step === "choose") {
    return (
      <AuthCard
        title="Join FanZuP"
        subtitle="How do you want to get started? You can add the other side later."
        footer={
          <>
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-gold hover:underline">
              Log in
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Account type">
          <ChoiceCard selected={role === "fan"} onSelect={() => setRole("fan")}>
            <div className="flex items-start gap-4">
              <IconChip tone={role === "fan" ? "gold" : "muted"}>
                <Headphones />
              </IconChip>
              <div>
                <p className="font-semibold">I'm a fan</p>
                <p className="text-sm text-muted">Back campaigns, subscribe, and get perks from artists you love.</p>
              </div>
            </div>
          </ChoiceCard>
          <ChoiceCard selected={role === "artist"} onSelect={() => setRole("artist")}>
            <div className="flex items-start gap-4">
              <IconChip tone={role === "artist" ? "gold" : "muted"}>
                <Mic2 />
              </IconChip>
              <div>
                <p className="font-semibold">I'm an artist</p>
                <p className="text-sm text-muted">Raise money for your music from the fans who already believe in you.</p>
              </div>
            </div>
          </ChoiceCard>
        </div>
        <Button size="lg" block disabled={!role} onClick={() => setStep("form")}>
          Continue
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={role === "artist" ? "Create your artist account" : "Create your fan account"}
      subtitle={role === "artist" ? "Start with your login. You'll add your artist details next." : "Start backing the artists you love."}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-gold hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <button type="button" onClick={() => setStep("choose")} className="-mt-2 flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> {role === "artist" ? "Signing up as an artist" : "Signing up as a fan"} · change
      </button>

      {taken && (
        <Callout tone="error" icon={<CircleAlert />} title="That email is already registered">
          <Link to="/login" className="font-medium text-gold hover:underline">
            Log in instead
          </Link>{" "}
          or use a different email.
        </Callout>
      )}

      <SocialButtons onPick={() => navigate(role === "artist" ? "/artist-onboarding/basic" : "/onboarding/account")} />

      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <Field label="Email address" htmlFor="email" error={show("email")}>
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setTaken(false);
            }}
            aria-invalid={!!show("email") || undefined}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password" htmlFor="password" error={show("pwd")}>
          <PasswordInput id="password" value={pwd} onChange={setPwd} invalid={!!show("pwd")} autoComplete="new-password" />
          {!show("pwd") && <PasswordStrength value={pwd} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Checkbox id="terms" checked={terms} onChange={setTerms}>
            I agree to the{" "}
            <Link to="/legal/terms" className="text-gold hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/legal/privacy" className="text-gold hover:underline">
              Privacy Policy
            </Link>
            .
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
