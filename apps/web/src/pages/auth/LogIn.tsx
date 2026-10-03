import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CircleAlert, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { Button, Callout, Checkbox, Field, TextInput } from "@/components/brand";
import { AuthCard, EMAIL_RE, OtpInput, PasswordInput, SocialButtons } from "@/components/public/auth";

/**
 * Source: FPS LoginAndPasswordFlow.tsx (default login, wrong password, locked account).
 * Doc-driven changes: adds the MFA code step required by PRD 01 FR-IDENTITY. States reachable via
 * ?state=wrong-password | locked | mfa. Demo: password "wrong" shows the error; code 000000 is rejected.
 */

type Stage = "credentials" | "mfa";

export default function LogIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const forced = params.get("state");
  const [stage, setStage] = useState<Stage>(forced === "mfa" ? "mfa" : "credentials");
  const [email, setEmail] = useState(forced ? "jordan@example.com" : "");
  const [pwd, setPwd] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [attempts, setAttempts] = useState(forced === "wrong-password" ? 1 : 0);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const next = params.get("next") ?? "/home";

  const locked = forced === "locked" || attempts >= 5;
  const emailErr = submitted && (!email ? "Enter your email address." : !EMAIL_RE.test(email) ? "That doesn't look like an email address." : undefined);
  const pwdErr = submitted && !pwd ? "Enter your password." : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!email || !EMAIL_RE.test(email) || !pwd) return;
    if (pwd === "wrong") {
      setAttempts((a) => a + 1);
      setPwd("");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStage("mfa");
    }, 500);
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) return setCodeError("Enter all 6 digits.");
    if (code === "000000") return setCodeError("That code didn't work. Check your authenticator app and try again.");
    setCodeError(undefined);
    navigate(next);
  };

  if (locked) {
    return (
      <AuthCard
        icon={<Lock />}
        iconTone="error"
        title="Your account is temporarily locked"
        subtitle="We noticed several incorrect passwords in a row, so we paused sign-ins to keep your account safe."
        footer={
          <Link to="/login" className="text-muted hover:text-fg" reloadDocument>
            Back to log in
          </Link>
        }
      >
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2 p-4 text-sm">
          <div>
            <p className="font-medium">Wait 30 minutes</p>
            <p className="text-muted">Your account unlocks automatically.</p>
          </div>
          <div>
            <p className="font-medium">Or reset your password</p>
            <p className="text-muted">Resetting unlocks your account straight away.</p>
          </div>
        </div>
        <Button asChild size="lg" block>
          <Link to="/reset-password">Reset password</Link>
        </Button>
        <p className="text-center text-sm text-muted">
          Didn't try to log in? Reset your password now — it signs out every other session.
        </p>
      </AuthCard>
    );
  }

  if (stage === "mfa") {
    return (
      <AuthCard
        icon={<Smartphone />}
        title="Enter your verification code"
        subtitle="Open your authenticator app and enter the 6-digit code for FanZuP."
        footer={
          <button type="button" onClick={() => setStage("credentials")} className="text-muted hover:text-fg">
            Back to log in
          </button>
        }
      >
        <form className="flex flex-col gap-5" onSubmit={verify} noValidate>
          <div className="flex flex-col gap-2">
            <OtpInput value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} invalid={!!codeError} />
            {codeError && <p className="text-sm text-error">{codeError}</p>}
          </div>
          <Checkbox id="trust-device" checked={remember} onChange={setRemember}>
            Trust this device for 30 days
          </Checkbox>
          <Button type="submit" size="lg" block>
            Verify and log in
          </Button>
        </form>
        <div className="flex flex-col gap-1 border-t border-line pt-4 text-sm text-muted">
          <p>Can't use your app?</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" className="text-gold hover:underline">
              Text a code instead
            </button>
            <button type="button" className="text-gold hover:underline">
              Use a recovery code
            </button>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to see your campaigns, perks and artists."
      footer={
        <>
          New to FanZuP?{" "}
          <Link to="/signup" className="font-medium text-gold hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {attempts > 0 && (
        <Callout tone="error" icon={<CircleAlert />} title="That password isn't right">
          Try again or <Link to="/reset-password" className="font-medium text-gold hover:underline">reset your password</Link>. After{" "}
          <span className="num">{5 - attempts}</span> more {5 - attempts === 1 ? "try" : "tries"} we'll lock sign-ins for 30 minutes.
        </Callout>
      )}
      <SocialButtons onPick={() => setStage("mfa")} />
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <Field label="Email address" htmlFor="email" error={emailErr || undefined}>
          <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!emailErr || undefined} placeholder="you@example.com" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Link to="/reset-password" className="text-sm text-gold hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="password" value={pwd} onChange={setPwd} invalid={!!pwdErr || attempts > 0} />
          {pwdErr && <p className="text-sm text-error">{pwdErr}</p>}
        </div>
        <Checkbox id="remember" checked={remember} onChange={setRemember}>
          Keep me logged in for 30 days
        </Checkbox>
        <Button type="submit" size="lg" block disabled={loading}>
          {loading ? "Checking…" : "Log in"}
        </Button>
      </form>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5" /> Two-step verification protects every account.
      </p>
    </AuthCard>
  );
}
