import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, CircleCheck, KeyRound, Mail, TimerOff } from "lucide-react";
import { Button, Field, TextInput } from "@/components/brand";
import { AuthCard, EMAIL_RE, PasswordInput, PasswordStrength, StepsList, passwordScore } from "@/components/public/auth";
import { supabase } from "@/lib/supabase";

/**
 * Source: FPS LoginAndPasswordFlow.tsx (forgot request → email sent → reset → success, expired link).
 * States reachable via ?state=request | sent | reset | success | expired (a real reset link lands on ?state=reset&token=…).
 * Changes: auto-redirect countdown dropped in favor of an explicit button (no surprise navigation).
 * M1 (FR-ID-001): real Supabase password reset — the request sends the email; the link signs the browser in for
 * recovery and lands on ?state=reset; an expired link shows the expired state.
 */
const sendReset = (email: string) =>
  supabase?.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password?state=reset` });

type State = "request" | "sent" | "reset" | "success" | "expired";
const STATES: State[] = ["request", "sent", "reset", "success", "expired"];

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const linkFailed = /error_description=/.test(window.location.hash);
  const initial = linkFailed ? "expired" : (STATES as string[]).includes(params.get("state") ?? "") ? (params.get("state") as State) : "request";
  const [failure, setFailure] = useState<string>();
  const [state, setState] = useState<State>(initial);
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState<string>();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [resent, setResent] = useState(false);

  const back = (
    <Link to="/login" className="inline-flex items-center gap-1.5 text-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Back to log in
    </Link>
  );

  if (state === "request") {
    return (
      <AuthCard icon={<KeyRound />} title="Forgot your password?" subtitle="Enter the email you signed up with and we'll send you a link to reset it." footer={back}>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!EMAIL_RE.test(email)) return setEmailErr(email ? "That doesn't look like an email address." : "Enter your email address.");
            void sendReset(email);
            setState("sent");
          }}
        >
          <Field label="Email address" htmlFor="email" error={emailErr}>
            <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailErr(undefined); }} aria-invalid={!!emailErr || undefined} placeholder="you@example.com" />
          </Field>
          <Button type="submit" size="lg" block>
            Send reset link
          </Button>
        </form>
      </AuthCard>
    );
  }

  if (state === "sent") {
    return (
      <AuthCard
        icon={<Mail />}
        title="Check your email"
        subtitle={
          <>
            If an account exists for <span className="font-medium text-fg">{email || "your email"}</span>, a reset link is on its way. It
            works for 1 hour.
          </>
        }
        footer={back}
      >
        <StepsList steps={["Open the email from FanZuP", "Select “Reset password”", "Choose a new password"]} />
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">
          <p className="font-medium text-fg">Can't find it?</p>
          <p>Check spam or promotions, and make sure the address above is the one you signed up with.</p>
        </div>
        <Button variant="secondary" block disabled={resent} onClick={() => { void sendReset(email); setResent(true); }}>
          {resent ? "Sent again — check your inbox" : "Resend email"}
        </Button>
      </AuthCard>
    );
  }

  if (state === "reset") {
    const pwdErr = submitted && passwordScore(pwd) < 3 ? "Use at least 8 characters with upper and lower case letters and a number." : undefined;
    const confirmErr = submitted && confirm !== pwd ? "Passwords don't match." : undefined;
    return (
      <AuthCard icon={<KeyRound />} title="Choose a new password" subtitle="Make it something you don't use anywhere else." footer={back}>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitted(true);
            if (passwordScore(pwd) < 3 || pwd !== confirm) return;
            const r = await supabase?.auth.updateUser({ password: pwd });
            if (!r || r.error) return setFailure(r?.error?.message ?? "Password reset isn't configured here.");
            await supabase?.auth.signOut({ scope: "others" });
            setState("success");
          }}
        >
          {failure && <p className="text-sm text-error">{failure}</p>}
          <Field label="New password" htmlFor="new-password" error={pwdErr}>
            <PasswordInput id="new-password" value={pwd} onChange={setPwd} invalid={!!pwdErr} autoComplete="new-password" />
            {!pwdErr && <PasswordStrength value={pwd} />}
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password" error={confirmErr}>
            <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} invalid={!!confirmErr} autoComplete="new-password" />
          </Field>
          <Button type="submit" size="lg" block>
            Reset password
          </Button>
        </form>
      </AuthCard>
    );
  }

  if (state === "expired") {
    return (
      <AuthCard
        icon={<TimerOff />}
        iconTone="warning"
        title="This reset link has expired"
        subtitle="Reset links work for 1 hour and only once. A newer link may also have replaced this one."
        footer={back}
      >
        <Button size="lg" block onClick={() => setState("request")}>
          Request a new link
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<CircleCheck />} iconTone="success" title="Password updated" subtitle="You can log in with your new password now. We've signed you out on other devices.">
      <Button size="lg" block onClick={() => navigate("/login")}>
        Log in
      </Button>
    </AuthCard>
  );
}
