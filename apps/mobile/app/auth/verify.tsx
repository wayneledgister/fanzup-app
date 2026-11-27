/**
 * Verify email (FR-MOB-003, FR-BCK-002). The emailed link opens the web app, which confirms the address. Back here,
 * "I've verified" refreshes the session and continues to `next` (e.g. checkout with the same perk).
 */
import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, Callout, H1, Num, Screen } from "@/components/ui";
import { safeAppNext, webUrl } from "@/lib/links";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const COOLDOWN = 60;

export default function Verify() {
  const params = useLocalSearchParams<{ email?: string; next?: string }>();
  const next = safeAppNext(params.next, "/");
  const session = useSession();
  const email = params.email ?? session.email ?? "";
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [wait, setWait] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const check = async () => {
    setChecking(true);
    setNotYet(false);
    const s = session.session ? await session.refresh() : null;
    setChecking(false);
    if (s?.user.email_confirmed_at) return router.dismissTo(next as never);
    if (!s) return router.replace(`/auth/login?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`); // verified elsewhere, no session here yet
    setNotYet(true);
  };

  const resend = async () => {
    if (!supabase || !email) return;
    await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: webUrl(`/verify-email?next=${encodeURIComponent("/explore")}`) ?? undefined } });
    setResent(true);
    setWait(COOLDOWN);
  };

  return (
    <Screen edges={[]}>
      <H1>Check your email</H1>
      <Body muted>
        We sent a verification link{email ? <> to <Num>{email}</Num></> : null}. Open it on this phone or any device, then come back and tap "I've verified".
      </Body>
      {notYet && <Callout tone="warning" icon="time-outline" title="Not verified yet">Open the link in the email first. It can take a minute to arrive; check spam too.</Callout>}
      {resent && <Callout tone="success" icon="mail-outline" title="New link sent">Use the newest email; older links stop working.</Callout>}
      <Button onPress={check} loading={checking} testID="verified">I've verified</Button>
      <Button variant="secondary" onPress={resend} disabled={!email || wait > 0}>{wait > 0 ? `Send a new link (${wait}s)` : "Send a new link"}</Button>
    </Screen>
  );
}
