import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CircleCheck, Mail, MailCheck, TimerOff } from "lucide-react";
import { Button, Callout } from "@/components/brand";
import { AuthCard, StepsList } from "@/components/public/auth";

/**
 * Source: FPS EmailVerification.tsx (pending with resend cooldown, resent, verified, expired).
 * States reachable via ?state=pending | resent | verified | expired.
 * Doc-driven changes: verified next step "Make your first investment" → continue onboarding (Layer 1);
 * auto-redirect countdown replaced by an explicit continue button.
 */

type State = "pending" | "resent" | "verified" | "expired";
const COOLDOWN = 60;

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const email = params.get("email") ?? "jordan@example.com";
  const role = params.get("role") === "artist" ? "artist" : "fan";
  const s = params.get("state");
  const [state, setState] = useState<State>(s === "resent" || s === "verified" || s === "expired" ? s : "pending");
  const [wait, setWait] = useState(COOLDOWN);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const resend = () => {
    setState("resent");
    setWait(COOLDOWN);
  };
  const nextRoute = role === "artist" ? "/artist-onboarding/basic" : `/onboarding/account?email=${encodeURIComponent(email)}`;

  if (state === "verified") {
    return (
      <AuthCard icon={<CircleCheck />} iconTone="success" title="Email verified" subtitle={<>Thanks — <span className="text-fg">{email}</span> is confirmed.</>}>
        <StepsList
          steps={
            role === "artist"
              ? ["Add your artist details", "Link your music and socials", "Verify your identity to unlock Starter"]
              : ["Finish your account", "Pick the artists and genres you're into", "Add a payment method for when you back something"]
          }
        />
        <Button size="lg" block onClick={() => navigate(nextRoute)}>
          Continue setup
        </Button>
      </AuthCard>
    );
  }

  if (state === "expired") {
    return (
      <AuthCard
        icon={<TimerOff />}
        iconTone="warning"
        title="This verification link has expired"
        subtitle="Links work for 24 hours. You may also have already verified, or requested a newer link."
        footer={
          <>
            Already verified?{" "}
            <Link to="/login" className="font-medium text-gold hover:underline">
              Log in
            </Link>
          </>
        }
      >
        <Button size="lg" block onClick={resend}>
          Send a new link
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={state === "resent" ? <MailCheck /> : <Mail />}
      title="Check your email"
      subtitle={
        <>
          We sent a verification link to <span className="font-medium text-fg">{email}</span>. Open it on this device to continue.
        </>
      }
      footer={
        <>
          Wrong address?{" "}
          <Link to={`/signup?role=${role}`} className="font-medium text-gold hover:underline">
            Start again
          </Link>
        </>
      }
    >
      {state === "resent" && (
        <Callout tone="success" icon={<MailCheck />} title="New link sent">
          Earlier links no longer work — use the newest email.
        </Callout>
      )}
      <StepsList steps={["Open the email from FanZuP", "Select “Verify email”", "You'll come right back here to keep going"]} />
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">
        <p className="font-medium text-fg">Can't find it?</p>
        <p>Check spam or promotions, and add noreply@fanzup.com to your contacts.</p>
      </div>
      <Button variant="secondary" block disabled={wait > 0} onClick={resend}>
        {wait > 0 ? (
          <>
            Resend available in <span className="num">0:{String(wait).padStart(2, "0")}</span>
          </>
        ) : (
          "Resend verification email"
        )}
      </Button>
      <button type="button" onClick={() => setState("verified")} className="text-center text-xs text-muted underline-offset-4 hover:text-fg hover:underline">
        I've clicked the link
      </button>
    </AuthCard>
  );
}
