import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Ban, Clock, CloudOff, KeyRound, Lock, MailWarning, ServerCrash, ShieldX, TimerReset, Wrench, XCircle } from "lucide-react";
import { Button } from "@/components/brand";
import { AuthCard } from "@/components/public/auth";

/**
 * Source: FPS AuthErrorStates.tsx — all 11 states, selectable via ?state=<id> (default invalid-credentials).
 * Changes: wireframe showcase grid replaced by one real screen per state; copy rewritten to Brand §7.2
 * ("direct, human, reassuring"); live countdowns for lock / rate-limit.
 */

type Tone = "error" | "warning" | "info" | "muted";
interface Spec {
  icon: ReactNode;
  tone: Tone;
  title: string;
  body: ReactNode;
  primary: { label: string; to: string };
  secondary?: { label: string; to: string };
  countdown?: number; // seconds
}

const STATES: Record<string, Spec> = {
  "invalid-credentials": {
    icon: <XCircle />, tone: "error", title: "Email or password is incorrect",
    body: "Check for typos and try again. Passwords are case-sensitive.",
    primary: { label: "Try again", to: "/login" }, secondary: { label: "Forgot password?", to: "/reset-password" },
  },
  "unverified-email": {
    icon: <MailWarning />, tone: "warning", title: "Verify your email to continue",
    body: "We sent a link to jordan@example.com when you signed up. Open it to finish setting up your account.",
    primary: { label: "Resend verification email", to: "/verify-email?state=resent" }, secondary: { label: "Back to log in", to: "/login" },
  },
  "social-auth-google-failed": {
    icon: <ShieldX />, tone: "error", title: "Google sign-in didn't work",
    body: "Google didn't give us access to your account. Try again, or log in with your email and password instead.",
    primary: { label: "Try Google again", to: "/login" }, secondary: { label: "Use email instead", to: "/login" },
  },
  "social-auth-cancelled": {
    icon: <XCircle />, tone: "muted", title: "Sign-in cancelled",
    body: "No problem — nothing was changed. Pick another way to log in whenever you're ready.",
    primary: { label: "Back to log in", to: "/login" },
  },
  "network-error": {
    icon: <CloudOff />, tone: "warning", title: "You seem to be offline",
    body: "We couldn't reach FanZuP. Check your connection and try again.",
    primary: { label: "Retry", to: "/login" },
  },
  "account-locked": {
    icon: <Lock />, tone: "error", title: "Your account is temporarily locked",
    body: "Too many incorrect passwords in a row. Sign-ins unlock automatically, or reset your password to unlock now.",
    primary: { label: "Reset password", to: "/reset-password" }, secondary: { label: "Back to log in", to: "/login" }, countdown: 29 * 60 + 12,
  },
  "server-error": {
    icon: <ServerCrash />, tone: "error", title: "Something went wrong on our end",
    body: "It's not you. We've been alerted and are looking into it. Please try again in a few minutes.",
    primary: { label: "Try again", to: "/login" }, secondary: { label: "Go to homepage", to: "/" },
  },
  "rate-limit": {
    icon: <TimerReset />, tone: "warning", title: "Too many attempts",
    body: "To protect your account we've paused attempts for a few minutes. You can try again when the timer runs out.",
    primary: { label: "Back to log in", to: "/login" }, countdown: 3 * 60 + 45,
  },
  "maintenance-mode": {
    icon: <Wrench />, tone: "info", title: "Scheduled maintenance",
    body: "We're making improvements and expect to be back in about an hour and 15 minutes. Campaign deadlines and escrow are not affected.",
    primary: { label: "Go to homepage", to: "/" },
  },
  "account-suspended": {
    icon: <Ban />, tone: "error", title: "This account is suspended",
    body: (
      <>
        Your account was suspended for a possible violation of our Terms. Reference <span className="num text-fg">SUSP-5891</span>. If you
        think this is a mistake, you can appeal and a person will review it.
      </>
    ),
    primary: { label: "Appeal this decision", to: "/trust" }, secondary: { label: "Read the Terms", to: "/legal/terms" },
  },
  "session-expired": {
    icon: <Clock />, tone: "muted", title: "Your session expired",
    body: "For your security we log you out after a period of inactivity. Log in again to pick up where you left off.",
    primary: { label: "Log in", to: "/login" },
  },
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function AuthError() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const key = params.get("state") ?? "invalid-credentials";
  const spec = STATES[key] ?? STATES["invalid-credentials"];
  const [left, setLeft] = useState(spec.countdown ?? 0);

  useEffect(() => setLeft(spec.countdown ?? 0), [spec]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const waiting = key === "rate-limit" && left > 0;

  return (
    <AuthCard icon={spec.icon} iconTone={spec.tone} title={spec.title} subtitle={spec.body}>
      {spec.countdown !== undefined && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-4 py-3" aria-live="polite">
          <span className="text-sm text-muted">{key === "account-locked" ? "Unlocks in" : "Try again in"}</span>
          <span className="num text-xl font-medium">{left > 0 ? fmt(left) : "Now"}</span>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <Button size="lg" block disabled={waiting} onClick={() => (spec.primary.to === "/login" && key === "network-error" ? window.location.reload() : navigate(spec.primary.to))}>
          {waiting ? "Please wait" : spec.primary.label}
        </Button>
        {spec.secondary && (
          <Button asChild variant="secondary" block>
            <Link to={spec.secondary.to}>{spec.secondary.label}</Link>
          </Button>
        )}
      </div>
      {key === "invalid-credentials" && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <KeyRound className="size-3.5" /> After 5 incorrect tries, sign-ins pause for 30 minutes.
        </p>
      )}
    </AuthCard>
  );
}
