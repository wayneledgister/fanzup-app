/**
 * Expo app config (CR-004, mobile design §6). Public values only — never a secret here (NFR-MOB-02).
 * Per-environment values come from EXPO_PUBLIC_* (eas.json profiles or EAS environment variables).
 */
import type { ExpoConfig } from "expo/config";

const BUNDLE_ID = process.env.FANZUP_BUNDLE_ID ?? "com.fanzup.app";
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID; // set by `eas init` (or here) — design §9 step 1

const config: ExpoConfig = {
  name: "FanZuP",
  slug: "fanzup",
  scheme: "fanzup",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  backgroundColor: "#0b0b0d",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: { backgroundColor: "#0b0b0d" },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ["expo-splash-screen", { backgroundColor: "#0b0b0d" }],
    ["@stripe/stripe-react-native", { merchantIdentifier: "", enableGooglePay: false }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
};

export default config;
