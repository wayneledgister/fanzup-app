import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BadgeCheck } from "lucide-react";
import { Button, Callout, Checkbox, Field, Select, TextInput } from "@/components/brand";
import { EMAIL_RE, PasswordInput, PasswordStrength, passwordScore } from "@/components/public/auth";
import { OnboardingFooter, OnboardingHeader } from "@/components/public/onboarding";
import { Link } from "react-router";

/**
 * Source: routes.tsx stub AC notes — email + password, DOB age gate, terms consent.
 * Notes: when arriving from /verify-email (?email=…) the email is shown as verified and the password
 * (already set at sign-up) is skipped; social sign-ins and direct visits see both fields.
 * Age gate is 18+ for all accounts (FPS SignUpFlows "You must be 18+"); copy no longer says "to invest".
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function age(y: number, m: number, d: number) {
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() < m || (now.getMonth() === m && now.getDate() < d)) a--;
  return a;
}

export default function Account() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const verifiedEmail = params.get("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [terms, setTerms] = useState(false);
  const [news, setNews] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const dobComplete = month !== "" && day !== "" && year.length === 4;
  const userAge = dobComplete ? age(+year, +month, +day) : null;
  const errs = {
    name: !name.trim() ? "Enter your name." : undefined,
    email: verifiedEmail ? undefined : !EMAIL_RE.test(email) ? "Enter a valid email address." : undefined,
    pwd: verifiedEmail ? undefined : passwordScore(pwd) < 3 ? "Use at least 8 characters with upper and lower case letters and a number." : undefined,
    dob: !dobComplete ? "Enter your full date of birth." : userAge !== null && (userAge > 120 || +day > 31) ? "Check your date of birth." : undefined,
    terms: !terms ? "You'll need to agree to continue." : undefined,
  };
  const underage = userAge !== null && userAge < 18;
  const e = (k: keyof typeof errs) => (submitted ? errs[k] : undefined);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitted(true);
    if (Object.values(errs).some(Boolean) || underage) return;
    navigate("/onboarding/path");
  };

  return (
    <form onSubmit={submit} noValidate>
      <OnboardingHeader step={1} title="Set up your account" description="A few basics so artists know who's backing them — and so we can keep your account secure." />

      <div className="flex flex-col gap-6">
        <Field label="Full name" htmlFor="name" hint="Shown on receipts and perk shipping labels. You'll pick a public display name next." error={e("name")}>
          <TextInput id="name" autoComplete="name" value={name} onChange={(x) => setName(x.target.value)} aria-invalid={!!e("name") || undefined} placeholder="Jordan Pierce" />
        </Field>

        {verifiedEmail ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <div className="flex h-11 items-center justify-between rounded-md border border-line bg-surface px-3.5 text-sm">
              <span className="truncate">{verifiedEmail}</span>
              <span className="flex items-center gap-1 text-xs text-success">
                <BadgeCheck className="size-4" /> Verified
              </span>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Email address" htmlFor="email" error={e("email")}>
              <TextInput id="email" type="email" autoComplete="email" value={email} onChange={(x) => setEmail(x.target.value)} aria-invalid={!!e("email") || undefined} placeholder="you@example.com" />
            </Field>
            <Field label="Password" htmlFor="password" error={e("pwd")}>
              <PasswordInput id="password" value={pwd} onChange={setPwd} invalid={!!e("pwd")} autoComplete="new-password" />
              {!e("pwd") && pwd && <PasswordStrength value={pwd} />}
            </Field>
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Date of birth</legend>
          <div className="grid grid-cols-[1.4fr_1fr_1.2fr] gap-3">
            <label className="sr-only" htmlFor="dob-month">Month</label>
            <Select id="dob-month" value={month} onChange={(x) => setMonth(x.target.value)} aria-invalid={!!e("dob") || undefined}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </Select>
            <label className="sr-only" htmlFor="dob-day">Day</label>
            <TextInput id="dob-day" inputMode="numeric" maxLength={2} placeholder="Day" value={day} onChange={(x) => setDay(x.target.value.replace(/\D/g, ""))} aria-invalid={!!e("dob") || undefined} className="num" />
            <label className="sr-only" htmlFor="dob-year">Year</label>
            <TextInput id="dob-year" inputMode="numeric" maxLength={4} placeholder="Year" value={year} onChange={(x) => setYear(x.target.value.replace(/\D/g, ""))} aria-invalid={!!e("dob") || undefined} className="num" />
          </div>
          {e("dob") ? <p className="text-sm text-error">{e("dob")}</p> : <p className="text-sm text-muted">You need to be 18 or older to use FanZuP. We don't show your birthday to anyone.</p>}
        </fieldset>

        {underage && (
          <Callout tone="warning" title="FanZuP is for people 18 and over">
            We can't create an account for you yet. We haven't saved any of the details you entered.
          </Callout>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <Checkbox id="terms" checked={terms} onChange={setTerms}>
            I agree to the{" "}
            <Link to="/legal/terms" className="text-gold hover:underline">Terms of Service</Link> and{" "}
            <Link to="/legal/privacy" className="text-gold hover:underline">Privacy Policy</Link>, and I understand that backing a campaign gets me
            perks — not an investment.
          </Checkbox>
          {e("terms") && <p className="pl-7 text-sm text-error">{e("terms")}</p>}
          <Checkbox id="news" checked={news} onChange={setNews}>
            Email me when artists I follow launch campaigns or drop tickets. <span className="text-muted/70">(optional)</span>
          </Checkbox>
        </div>
      </div>

      <OnboardingFooter
        primary={
          <Button type="submit" size="lg" disabled={underage}>
            Continue
          </Button>
        }
      />
    </form>
  );
}
