/** Tabs: Explore, Services (only when the server's `flags.marketplace` is on; CR-005 FR-MKT-012), Backed, Account. Gold marks the active tab only. */
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { color, font } from "@/theme";
import { useConfig } from "@/lib/config";

export default function TabsLayout() {
  const marketplace = !!useConfig()?.flags?.marketplace;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.gold,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.line },
        tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Explore", tabBarIcon: ({ color: c, size }) => <Ionicons name="compass-outline" size={size} color={c as string} /> }} />
      <Tabs.Screen name="services" options={{ title: "Services", href: marketplace ? undefined : null, tabBarIcon: ({ color: c, size }) => <Ionicons name="construct-outline" size={size} color={c as string} /> }} />
      <Tabs.Screen name="backed" options={{ title: "Backed", tabBarIcon: ({ color: c, size }) => <Ionicons name="heart-outline" size={size} color={c as string} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color: c, size }) => <Ionicons name="person-circle-outline" size={size} color={c as string} /> }} />
    </Tabs>
  );
}
