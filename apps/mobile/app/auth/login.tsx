/** Log in (FR-MOB-003, parity FR-ID-001): email + password; returns to `next` (FR-BCK-002). */
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { EMAIL_RE } from "@fanzup/shared/auth-rules";
import { Body, Button, Callout, Field, H1, Screen, TextField } from "@/components/ui";
import { safeAppNext } from "@/lib/links";
import { isTransportError, supabase } from "@/lib/supabase";

export default function LogIn() {
  const params = useLocalSearchParams<{ next?: string; email?: string }>();
  const next = safeAppNext(params.next, "/");
  const [email, setEmail] = useState(params.email ?? "");
  const [pwd, setPwd] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ title: string; body: string; verify?: boolean }>();

  const emailErr = submitted ? (!email ? "Enter your email address." : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address." : undefined) : undefined;
  const pwdErr = submitted && !pwd ? "Enter your password." : undefined;

  const submit = async () => {
    setSubmitted(true);
    setFailure(undefined);
    if (!email || !EMAIL_RE.test(email.trim()) || !pwd) return;
    if (!supabase) return setFailure({ title: "Sign-in isn't configured here", body: "This build has no Supabase project connected." });
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
    setLoading(false);
    if (error) {
      if (/confirm/i.test(error.message)) return setFailure({ title: "Verify your email first", body: "Open the link we emailed you, then log in again.", verify: true });
      // Only a credentials answer from the server means a wrong password; offline / 5xx keeps what the fan typed.
      if (isTransportError(error)) return setFailure({ title: "We couldn't reach FanZuP", body: "Check your connection and try again." });
      setPwd("");
      return setFailure({ title: "That email and password don't match", body: "Try again, or reset your password." });
    }
    if (!data.user?.email_confirmed_at) return router.replace(`/auth/verify?next=${encodeURIComponent(next)}`);
    router.dismissTo(next as never);
  };

  return (
    <Screen edges={[]}>
      <H1>Welcome back</H1>
      {failure && (
        <Callout tone="error" icon="alert-circle-outline" title={failure.title} testID="login-failure">
          {failure.body}
        </Callout>
      )}
      {failure?.verify && <Button variant="secondary" onPress={() => router.push(`/auth/verify?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`)}>Send a new link</Button>}
      <Field label="Email address" error={emailErr}>
        <TextField value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" invalid={!!emailErr} accessibilityLabel="Email address" />
      </Field>
      <Field label="Password" error={pwdErr}>
        <TextField value={pwd} onChangeText={setPwd} secureTextEntry autoComplete="current-password" textContentType="password" invalid={!!pwdErr} onSubmitEditing={submit} accessibilityLabel="Password" />
      </Field>
      <Button onPress={submit} loading={loading} testID="login-submit">Log in</Button>
      <Button variant="ghost" onPress={() => router.push(`/auth/forgot?email=${encodeURIComponent(email.trim())}`)}>Forgot your password?</Button>
      <Body muted small style={{ textAlign: "center" }}>New to FanZuP?</Body>
      <Button variant="secondary" onPress={() => router.replace(`/auth/signup?next=${encodeURIComponent(next)}`)}>Create an account</Button>
    </Screen>
  );
}
