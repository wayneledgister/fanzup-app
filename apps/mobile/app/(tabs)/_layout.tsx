/** Tabs: Explore, Services (only when the server's `flags.marketplace` is on and the caller is in the beta; CR-005 FR-MKT-012, CR-007), Backed, Account. Gold marks the active tab only. */
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { color, font } from "@/theme";
import { useMarketplaceBrowse } from "@/lib/marketplace";

export default function TabsLayout() {
  // CR-007: in the closed beta the tab follows the per-user access check, not just the server flag.
  const marketplace = useMarketplaceBrowse();
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
