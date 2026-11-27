/** Root: fonts, session, and the stack (tabs + campaign, checkout, auth screens). */
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { SessionProvider } from "@/lib/session";
import { color, font } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold, JetBrainsMono_400Regular, JetBrainsMono_500Medium });
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: color.canvas },
            headerTintColor: color.fg,
            headerTitleStyle: { fontFamily: font.headingMedium },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: color.canvas },
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="campaigns/[slug]" options={{ title: "" }} />
          <Stack.Screen name="checkout/[slug]" options={{ title: "Checkout" }} />
          <Stack.Screen name="auth/login" options={{ title: "Log in" }} />
          <Stack.Screen name="auth/signup" options={{ title: "Create your account" }} />
          <Stack.Screen name="auth/verify" options={{ title: "Verify your email" }} />
          <Stack.Screen name="auth/forgot" options={{ title: "Reset password" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
