import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CircleAlert, CircleCheck, Mail, MailCheck, TimerOff } from "lucide-react";
import { Button, Callout } from "@/components/brand";
import { AuthCard, StepsList } from "@/components/public/auth";
import { safeNext, supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";

/**
 * Source: FPS EmailVerification.tsx (pending with resend cooldown, resent, verified, expired).
 * M1 (FR-ID-001, FR-BCK-002; card G1-B option 3): the confirmation link from Supabase lands here signed in;
 * once the email is confirmed the fan is forwarded to `next` (checkout with the same campaign and perk).
 * Cross-device (G2 condition 13): opening the link on another device signs that device in and forwards it;
 * the first device can continue with "I've verified — continue", which re-checks the session.
 */

const COOLDOWN = 60;
/** How often a signed-in, not-yet-verified device re-checks `GET /me` (design §11). */
const VERIFY_POLL_MS = 5_000;

function linkError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return hash.get("error_description") ?? query.get("error_description");
}

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const s = useSession();
  const next = safeNext(params.get("next"), "/explore");
  const email = params.get("email") ?? s.email ?? "";
  const [expired] = useState(() => !!linkError());
  const [wait, setWait] = useState(COOLDOWN);
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);

  // Verified (the link signed this device in) → straight back to where the fan was going.
  useEffect(() => {
    if (!s.loading && s.session && s.emailVerified) navigate(next, { replace: true });
  }, [s.loading, s.session, s.emailVerified, next, navigate]);

  // Cross-device (design §11): while this device holds a session whose email isn't verified yet, check `GET /me`
  // every few seconds; once the link has been opened anywhere, refresh the session and carry on to `next`.
  // Without a session there is nothing to poll — "I've verified — continue" leads to log in instead.
  const polling = !s.loading && !!s.session && !s.emailVerified && !expired;
  const refresh = s.refresh;
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const me = await api.me();
        if (!alive || !me.emailVerified) return;
        clearInterval(t);
        await refresh();
        if (alive) navigate(next, { replace: true });
      } catch { /* offline or signed out: keep the button */ }
    }, VERIFY_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [polling, refresh, navigate, next]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const resend = async () => {
    if (!supabase || !email) return;
    await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/verify-email?next=${encodeURIComponent(next)}` } });
    setResent(true);
    setWait(COOLDOWN);
  };

  const continueNow = async () => {
    setChecking(true);
    setNotYet(false);
    if (!s.session) {
      setChecking(false);
      return navigate(`/login?next=${encodeURIComponent(next)}`);
    }
    const verified = await api.me().then((m) => m.emailVerified).catch(() => false);
    await s.refresh();
    setChecking(false);
    if (verified) return navigate(next, { replace: true });
    setNotYet(true);
  };

  if (s.session && s.emailVerified) {
    return <AuthCard icon={<CircleCheck />} iconTone="success" title="Email verified" subtitle="Taking you back…" />;
  }

  if (expired) {
    return (
      <AuthCard
        icon={<TimerOff />}
        iconTone="warning"
        title="This verification link has expired"
        subtitle="Links work for 24 hours. You may also have already verified, or requested a newer link."
        footer={<>Already verified? <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-gold hover:underline">Log in</Link></>}
      >
        {email ? (
          <Button size="lg" block onClick={resend} disabled={wait > 0 && resent}>Send a new link</Button>
        ) : (
          <Button asChild size="lg" block><Link to={`/login?next=${encodeURIComponent(next)}`}>Log in to get a new link</Link></Button>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={resent ? <MailCheck /> : <Mail />}
      title="Check your email"
      subtitle={email ? <>We sent a verification link to <span className="font-medium text-fg">{email}</span>. Open it to continue.</> : "Open the verification link we emailed you to continue."}
      footer={<>Wrong address? <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-gold hover:underline">Start again</Link></>}
    >
      {resent && (
        <Callout tone="success" icon={<MailCheck />} title="New link sent">Earlier links no longer work — use the newest email.</Callout>
      )}
      {notYet && (
        <Callout tone="warning" icon={<CircleAlert />} title="Not verified yet">Open the link in the email first, then try again.</Callout>
      )}
      <StepsList steps={["Open the email from FanZuP", "Select the verification link", "You'll come right back to where you were"]} />
      <Button size="lg" block onClick={continueNow} disabled={checking}>
        {checking ? "Checking…" : "I've verified — continue"}
      </Button>
      {email && (
        <Button variant="secondary" block disabled={wait > 0} onClick={resend}>
          {wait > 0 ? <>Resend available in <span className="num">0:{String(wait).padStart(2, "0")}</span></> : "Resend verification email"}
        </Button>
      )}
    </AuthCard>
  );
}
