import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CircleAlert, ShieldCheck, Smartphone } from "lucide-react";
import { Button, Callout, Field, TextInput } from "@/components/brand";
import { AuthCard, EMAIL_RE, OtpInput, PasswordInput } from "@/components/public/auth";
import { safeNext, supabase } from "@/lib/supabase";

/**
 * Source: FPS LoginAndPasswordFlow.tsx (login, wrong password, MFA code step).
 * M1 (FR-ID-001, FR-ID-002 staff, FR-BCK-002): real Supabase sign-in with email + password. When the account has
 * an authenticator enrolled (staff — required for every staff action), the code step raises the session to aal2.
 * Returns to `next` (e.g. checkout with the same campaign and perk). The demo "locked account" state is removed:
 * Supabase Auth applies its own rate limits.
 */

type Stage = "credentials" | "mfa";

export default function LogIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"), "/backed");
  const [stage, setStage] = useState<Stage>("credentials");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<{ title: string; body: React.ReactNode }>();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const emailErr = submitted && (!email ? "Enter your email address." : !EMAIL_RE.test(email) ? "That doesn't look like an email address." : undefined);
  const pwdErr = submitted && !pwd ? "Enter your password." : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure(undefined);
    if (!email || !EMAIL_RE.test(email) || !pwd) return;
    if (!supabase) return setFailure({ title: "Sign-in isn't configured here", body: "This build has no Supabase project connected." });
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
    if (error) {
      setLoading(false);
      setPwd("");
      if (/confirm/i.test(error.message)) {
        return setFailure({
          title: "Verify your email first",
          body: <>Open the link we emailed you, or <Link className="font-medium text-gold hover:underline" to={`/verify-email?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`}>send a new one</Link>.</>,
        });
      }
      return setFailure({
        title: "That email and password don't match",
        body: <>Try again or <Link to="/reset-password" className="font-medium text-gold hover:underline">reset your password</Link>.</>,
      });
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setLoading(false);
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") return setStage("mfa");
    navigate(next, { replace: true });
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) return setCodeError("Enter all 6 digits.");
    if (!supabase) return;
    setLoading(true);
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp.find((f) => f.status === "verified");
    if (!totp) {
      setLoading(false);
      return setCodeError("No authenticator is set up for this account.");
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    setLoading(false);
    if (error) return setCodeError("That code didn't work. Check your authenticator app and try again.");
    navigate(next, { replace: true });
  };

  if (stage === "mfa") {
    return (
      <AuthCard
        icon={<Smartphone />}
        title="Enter your verification code"
        subtitle="Open your authenticator app and enter the 6-digit code for FanZuP."
        footer={<button type="button" onClick={() => { void supabase?.auth.signOut(); setStage("credentials"); }} className="text-muted hover:text-fg">Back to log in</button>}
      >
        <form className="flex flex-col gap-5" onSubmit={verify} noValidate>
          <div className="flex flex-col gap-2">
            <OtpInput value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} invalid={!!codeError} />
            {codeError && <p className="text-sm text-error">{codeError}</p>}
          </div>
          <Button type="submit" size="lg" block disabled={loading}>{loading ? "Checking…" : "Verify and log in"}</Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to see your campaigns, perks and artists."
      footer={<>New to FanZuP? <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-gold hover:underline">Create an account</Link></>}
    >
      {failure && <Callout tone="error" icon={<CircleAlert />} title={failure.title}>{failure.body}</Callout>}
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <Field label="Email address" htmlFor="email" error={emailErr || undefined}>
          <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!emailErr || undefined} placeholder="you@example.com" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <Link to="/reset-password" className="text-sm text-gold hover:underline">Forgot password?</Link>
          </div>
          <PasswordInput id="password" value={pwd} onChange={setPwd} invalid={!!pwdErr || !!failure} />
          {pwdErr && <p className="text-sm text-error">{pwdErr}</p>}
        </div>
        <Button type="submit" size="lg" block disabled={loading}>{loading ? "Checking…" : "Log in"}</Button>
      </form>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5" /> Staff accounts confirm every sign-in with an authenticator app.
      </p>
    </AuthCard>
  );
}
