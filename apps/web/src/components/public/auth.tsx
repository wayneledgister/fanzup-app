/**
 * Auth-screen building blocks shared by SignUp / LogIn / ResetPassword / VerifyEmail / AuthError.
 * The AuthShell already provides the logo header and a max-w-md column.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Card, IconChip, TextInput } from "@/components/brand";
import { cn } from "@/lib/utils";

export function AuthCard({ icon, iconTone = "gold", title, subtitle, children, footer }: {
  icon?: ReactNode; iconTone?: "gold" | "success" | "error" | "warning" | "info" | "muted"; title: ReactNode; subtitle?: ReactNode; children?: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-3">
          {icon && <IconChip tone={iconTone} className="size-12 [&_svg]:size-6">{icon}</IconChip>}
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </Card>
      {footer && <div className="text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z" />
    </svg>
  );
}
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.1-3 .9-3.7.9-.8 0-2-.9-3.2-.9a4.8 4.8 0 0 0-4 2.5c-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4a10 10 0 0 0 1.3-2.7 4.2 4.2 0 0 1-2.3-3.8ZM14 5.2A4.2 4.2 0 0 0 15 2a4.3 4.3 0 0 0-2.8 1.5 4 4 0 0 0-1 3.1c1.1 0 2.1-.5 2.8-1.4Z" />
    </svg>
  );
}

export function SocialButtons({ verb = "Continue", onPick }: { verb?: string; onPick?: (p: "google" | "apple") => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="secondary" type="button" onClick={() => onPick?.("google")}>
          <GoogleMark /> {verb} with Google
        </Button>
        <Button variant="secondary" type="button" onClick={() => onPick?.("apple")}>
          <AppleMark /> {verb} with Apple
        </Button>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or use email <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

export function PasswordInput({ id, value, onChange, invalid, autoComplete = "current-password", placeholder }: {
  id: string; value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete?: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <TextInput
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-gold"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function passwordScore(pwd: string): number {
  let s = 0;
  if (pwd.length >= 8) s++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++;
  if (/\d/.test(pwd)) s++;
  if (/[^a-zA-Z0-9]/.test(pwd)) s++;
  return s;
}

export function PasswordStrength({ value }: { value: string }) {
  if (!value) return <p className="text-sm text-muted">At least 8 characters, with a mix of letters, numbers and symbols.</p>;
  const s = passwordScore(value);
  const label = ["Too weak", "Weak", "Fair", "Good", "Strong"][s];
  const tone = s <= 1 ? "bg-error" : s === 2 ? "bg-warning" : "bg-success";
  const text = s <= 1 ? "text-error" : s === 2 ? "text-warning" : "text-success";
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full", i < s ? tone : "bg-surface-2")} />
        ))}
      </div>
      <span className={cn("text-xs font-medium", text)}>{label}</span>
    </div>
  );
}

/** 6-digit one-time code input (MFA, email codes). */
export function OtpInput({ value, onChange, invalid, length = 6 }: { value: string; onChange: (v: string) => void; invalid?: boolean; length?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const base = useId();
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const set = (i: number, d: string) => {
    const arr = digits.slice();
    arr[i] = d;
    onChange(arr.join("").slice(0, length));
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          id={`${base}-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (!v) return set(i, "");
            set(i, v[v.length - 1]);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const v = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (v) {
              e.preventDefault();
              onChange(v);
              refs.current[Math.min(v.length, length - 1)]?.focus();
            }
          }}
          className="num h-12 w-full min-w-0 rounded-md border border-line bg-surface-2 text-center text-lg text-fg focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 aria-[invalid=true]:border-error sm:h-14"
        />
      ))}
    </div>
  );
}

/** Numbered "what to do next" list used on check-your-email screens. */
export function StepsList({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <span className="num flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-xs text-gold">{i + 1}</span>
          <span className="pt-0.5 text-muted">{s}</span>
        </li>
      ))}
    </ol>
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
