/** Account (FR-MOB-007): who's signed in, help and legal pages on the web, sign out, version and environment. */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Application from "expo-application";
import { Ionicons } from "@expo/vector-icons";
import { ArtistArt, Body, Button, Callout, Card, Divider, Eyebrow, H1, Loading, Num, Screen } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";
import { apiHost, env } from "@/lib/env";
import { openWeb } from "@/lib/links";
import { useSession } from "@/lib/session";
import { color, space, TOUCH } from "@/theme";

const LINKS: { label: string; path: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { label: "How money moves", path: "/trust", icon: "shield-checkmark-outline" },
  { label: "Fees", path: "/fees", icon: "receipt-outline" },
  { label: "Help & support", path: "/support", icon: "help-circle-outline" },
  { label: "Terms", path: "/legal/terms", icon: "document-text-outline" },
  { label: "Privacy Policy", path: "/legal/privacy", icon: "lock-closed-outline" },
];

export default function Account() {
  const session = useSession();
  return (
    <Screen>
      <Eyebrow>Account</Eyebrow>
      <H1>{session.displayName || "Your account"}</H1>
      {session.loading ? <Loading label="Loading your account" /> : session.session ? (
        <Card>
          <View style={{ flexDirection: "row", gap: space(3), alignItems: "center" }}>
            <ArtistArt seed={session.email ?? "me"} label={session.displayName || session.email || "Me"} round size={48} />
            <View style={{ flex: 1 }}>
              {session.displayName ? <Body style={{ fontFamily: "Inter_600SemiBold" }}>{session.displayName}</Body> : null}
              <Body muted small>{session.email}</Body>
            </View>
          </View>
          {!session.emailVerified && (
            <Callout tone="warning" icon="mail-unread-outline" title="Verify your email">
              <View style={{ gap: space(2) }}>
                <Body muted small>Open the link we emailed you, then come back here.</Body>
                <Button variant="secondary" onPress={() => router.push("/auth/verify")}>I've verified</Button>
              </View>
            </Callout>
          )}
          <Button variant="secondary" icon="log-out-outline" onPress={() => session.signOut()}>Log out</Button>
        </Card>
      ) : !session.configured ? (
        <Callout tone="warning" icon="construct-outline" title="Sign-in isn't configured in this build">Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (docs/MOBILE.md).</Callout>
      ) : (
        <SignInPrompt next="/account" text="Back campaigns, keep track of your perks, and get refunded automatically if a goal isn't met." />
      )}

      <Card style={{ gap: 0, paddingVertical: space(1) }}>
        {LINKS.map((l, i) => (
          <View key={l.path}>
            {i > 0 && <Divider />}
            <Pressable accessibilityRole="link" accessibilityHint="Opens in the browser" onPress={() => openWeb(l.path)} disabled={!env.webUrl}
              style={({ pressed }) => [{ minHeight: TOUCH + 8, flexDirection: "row", alignItems: "center", gap: space(3) }, pressed && { opacity: 0.7 }]}>
              <Ionicons name={l.icon} size={20} color={color.muted} />
              <Body style={{ flex: 1 }}>{l.label}</Body>
              <Ionicons name="open-outline" size={16} color={color.muted} />
            </Pressable>
          </View>
        ))}
      </Card>
      <Body muted small style={{ textAlign: "center" }}>
        FanZuP <Num style={{ fontSize: 13 }}>{Application.nativeApplicationVersion ?? "dev"}</Num> · {env.appEnv} · <Num style={{ fontSize: 13 }}>{apiHost}</Num>
      </Body>
    </Screen>
  );
}
