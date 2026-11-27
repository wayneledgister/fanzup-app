/**
 * Sign up (FR-MOB-003; parity FR-ID-001, FR-ID-006 bullet 1, FR-PRV-001, FR-BCK-002): a real Supabase account with
 * name, email, password, 18+ attestation and the server's current Terms/Privacy versions — the same metadata the web
 * sends, so the new-user trigger treats both clients alike. The verification link opens the web app.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { signUpErrors, signUpFailure, signUpMetadata, passwordScore } from "@fanzup/shared/auth-rules";
import { Body, Button, Callout, Checkbox, Field, H1, Screen, TextField } from "@/components/ui";
import { loadConfig } from "@/lib/config";
import { anonId } from "@/lib/ids";
import { openWeb, safeAppNext, webUrl } from "@/lib/links";
import { supabase } from "@/lib/supabase";
import { color, font, space } from "@/theme";

export default function SignUp() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = safeAppNext(params.next, "/");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string>();

  const errors = signUpErrors({ name, email, password, adult, terms });
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);
  const backing = /^\/checkout\//.test(next);

  const submit = async () => {
    setSubmitted(true);
    setFailure(undefined);
    if (Object.values(errors).some(Boolean)) return;
    if (!supabase) return setFailure("Sign-up isn't configured in this build.");
    setLoading(true);
    // Current Terms/Privacy versions come from the API (`GET /config.legal`), never from the app build.
    const cfg = await loadConfig();
    if (!cfg) {
      setLoading(false);
      return setFailure("We couldn't create your account just now. Please try again in a moment.");
    }
    const redirect = webUrl(`/verify-email?next=${encodeURIComponent("/explore")}`) ?? undefined;
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirect, data: signUpMetadata(name, cfg.legal, anonId()) },
    });
    setLoading(false);
    if (error) return setFailure(signUpFailure(error.message));
    if (data.session?.user.email_confirmed_at) return router.dismissTo(next as never); // confirmations off (local dev)
    router.replace(`/auth/verify?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`);
  };

  const strength = passwordScore(password);
  return (
    <Screen edges={[]}>
      <H1>{backing ? "Create your account to back this campaign" : "Join FanZuP"}</H1>
      <Body muted>Free. You'll verify your email once, then you're straight back {backing ? "to checkout" : "in the app"}.</Body>
      {failure && <Callout tone="error" icon="alert-circle-outline" title="Couldn't create your account" testID="signup-failure">{failure}</Callout>}
      <Field label="Your name" error={show("name")}>
        <TextField value={name} onChangeText={setName} autoComplete="name" textContentType="name" invalid={!!show("name")} accessibilityLabel="Your name" />
      </Field>
      <Field label="Email address" error={show("email")}>
        <TextField value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" invalid={!!show("email")} accessibilityLabel="Email address" />
      </Field>
      <Field label="Password" error={show("password")} hint={password ? `Strength: ${["very weak", "weak", "fair", "good", "strong"][strength]}` : "At least 8 characters, with a mix of letters, numbers and symbols."}>
        <TextField value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" invalid={!!show("password")} accessibilityLabel="Password" />
      </Field>
      <View style={{ gap: space(1) }}>
        <Checkbox checked={adult} onChange={setAdult} testID="adult">I'm 18 or older.</Checkbox>
        {show("adult") && <Text style={{ color: color.error, fontFamily: font.body, fontSize: 13 }}>{show("adult")}</Text>}
        <Checkbox checked={terms} onChange={setTerms} testID="terms">
          <Body>
            I agree to the{" "}
            <Text style={{ color: color.gold }} accessibilityRole="link" onPress={() => openWeb("/legal/terms")}>Terms</Text> and{" "}
            <Text style={{ color: color.gold }} accessibilityRole="link" onPress={() => openWeb("/legal/privacy")}>Privacy Policy</Text>.
          </Body>
        </Checkbox>
        {show("terms") && <Text style={{ color: color.error, fontFamily: font.body, fontSize: 13 }}>{show("terms")}</Text>}
      </View>
      <Button onPress={submit} loading={loading} testID="signup-submit">Create account</Button>
      <Button variant="ghost" onPress={() => router.replace(`/auth/login?next=${encodeURIComponent(next)}`)}>Have an account? Log in</Button>
    </Screen>
  );
}
