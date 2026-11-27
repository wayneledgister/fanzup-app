/** Forgot password (FR-MOB-003, parity FR-ID-001 M1): sends the reset email; the reset itself happens on the web. */
import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { EMAIL_RE } from "@fanzup/shared/auth-rules";
import { Body, Button, Callout, Field, H1, Screen, TextField } from "@/components/ui";
import { webUrl } from "@/lib/links";
import { isTransportError, supabase } from "@/lib/supabase";

export default function Forgot() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [err, setErr] = useState<string>();
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) return setErr(email ? "That doesn't look like an email address." : "Enter your email address.");
    setErr(undefined);
    if (!supabase) return setErr("Sign-in isn't configured in this build.");
    setLoading(true);
    try {
      // Same outcome for any server answer, account or not (no account enumeration); only a request that never got an
      // answer (offline, 5xx) asks the fan to try again.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: webUrl("/reset-password?state=reset") ?? undefined });
      if (error && isTransportError(error)) return setErr("We couldn't reach FanZuP. Check your connection and try again.");
      setSent(true);
    } catch {
      setErr("We couldn't reach FanZuP. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen edges={[]}>
      <H1>Reset your password</H1>
      <Body muted>We'll email you a link. It opens FanZuP in your browser, where you choose a new password. Then log in here with it.</Body>
      {sent ? (
        <Callout tone="success" icon="mail-outline" title="Check your email">If an account uses that address, a reset link is on its way.</Callout>
      ) : (
        <>
          <Field label="Email address" error={err}>
            <TextField value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" invalid={!!err} accessibilityLabel="Email address" />
          </Field>
          <Button onPress={send} loading={loading}>Send reset link</Button>
        </>
      )}
    </Screen>
  );
}
