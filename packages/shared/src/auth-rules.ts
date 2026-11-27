/** Sign-up / log-in form rules, the same on web and mobile (CR-004; FR-ID-001, FR-ID-006). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 0–4: length ≥ 8; upper and lower case; a digit; a symbol. Sign-up needs ≥ 3. */
export function passwordScore(pwd: string): number {
  let s = 0;
  if (pwd.length >= 8) s++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++;
  if (/\d/.test(pwd)) s++;
  if (/[^a-zA-Z0-9]/.test(pwd)) s++;
  return s;
}

export interface SignUpInput { name: string; email: string; password: string; adult: boolean; terms: boolean }

/** Inline errors for the sign-up form (web SignUp.tsx wording). */
export function signUpErrors(v: SignUpInput) {
  return {
    name: !v.name.trim() ? "Tell us what to call you." : v.name.length > 60 ? "Keep it under 60 characters." : undefined,
    email: !v.email ? "Enter your email address." : !EMAIL_RE.test(v.email.trim()) ? "That doesn't look like an email address." : undefined,
    password: !v.password ? "Create a password." : passwordScore(v.password) < 3 ? "Use at least 8 characters with upper and lower case letters and a number." : undefined,
    adult: !v.adult ? "You need to be 18 or older to use FanZuP." : undefined,
    terms: !v.terms ? "You'll need to agree to continue." : undefined,
  };
}

/** Supabase sign-up error → what the fan reads. */
export function signUpFailure(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes("already registered")) return "This email already has an account. Log in instead.";
  if (msg.includes("password")) return message;
  return "We couldn't create your account just now. Please try again in a moment.";
}

/** The `options.data` the new-user trigger requires (design §3.7): attestation and the server's current legal versions. */
export const signUpMetadata = (name: string, legal: { termsVersion: string; privacyVersion: string }, anonId: string) => ({
  display_name: name.trim(),
  adult_attested: true,
  terms_version: legal.termsVersion,
  privacy_version: legal.privacyVersion,
  anon_id: anonId,
});
