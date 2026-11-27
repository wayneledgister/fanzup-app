/** Guard for signed-in screens (FR-ID-005 parity): log in or sign up, then come back to `next`. */
import { View } from "react-native";
import { router } from "expo-router";
import { Body, Button, Card } from "./ui";
import { space } from "@/theme";

export function SignInPrompt({ next, text }: { next: string; text: string }) {
  const q = `?next=${encodeURIComponent(next)}`;
  return (
    <Card>
      <Body muted>{text}</Body>
      <View style={{ gap: space(2) }}>
        <Button onPress={() => router.push(`/auth/login${q}`)}>Log in</Button>
        <Button variant="secondary" onPress={() => router.push(`/auth/signup${q}`)}>Create an account</Button>
      </View>
    </Card>
  );
}
