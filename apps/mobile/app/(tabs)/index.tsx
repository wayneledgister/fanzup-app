/** Explore (FR-MOB-001, parity FR-CMP-008): live / funded campaigns in the API's order, paged by cursor. */
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CampaignCard as Campaign } from "@fanzup/shared/schemas";
import { CampaignCard } from "@/components/CampaignCard";
import { Body, Button, Callout, EmptyState, Eyebrow, H1, Loading, Segmented, TestModeNotice } from "@/components/ui";
import { api } from "@/lib/api";
import { apiConfigured } from "@/lib/env";
import { color, GUTTER, space } from "@/theme";

type Tab = "live" | "funded";

export default function Explore() {
  const [tab, setTab] = useState<Tab>("live");
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const req = useRef(0);

  const load = useCallback(async (t: Tab, mode: "first" | "refresh") => {
    const id = ++req.current;
    setError(false);
    if (mode === "refresh") setRefreshing(true);
    else {
      setItems(null);
      setCursor(null); // never page the new tab with the previous tab's cursor
    }
    try {
      const r = await api.campaigns({ tab: t });
      if (id !== req.current) return;
      setItems(r.campaigns);
      setCursor(r.nextCursor);
    } catch {
      if (id === req.current) setError(true);
    } finally {
      if (id === req.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, "first");
  }, [tab, load]);

  const loadMore = async () => {
    if (!cursor || more || items === null) return;
    const id = req.current;
    setMore(true);
    try {
      const r = await api.campaigns({ tab, cursor });
      if (id !== req.current) return;
      setItems((xs) => [...(xs ?? []), ...r.campaigns.filter((c) => !xs?.some((x) => x.id === c.id))]);
      setCursor(r.nextCursor);
    } catch { /* the next scroll retries */ } finally {
      setMore(false);
    }
  };

  const header = (
    <View style={{ gap: space(4), marginBottom: space(4) }}>
      <Eyebrow>Fund My Show</Eyebrow>
      <H1>Back the shows you want to see</H1>
      <Body muted>Pick a campaign, choose a perk, and you're in. If the goal isn't reached by the deadline, you're refunded in full.</Body>
      <TestModeNotice />
      <Segmented value={tab} onChange={setTab} options={[{ value: "live", label: "Live" }, { value: "funded", label: "Funded" }]} />
      {!apiConfigured && <Callout tone="warning" icon="construct-outline" title="No API configured">Set EXPO_PUBLIC_API_URL for this build (docs/MOBILE.md).</Callout>}
      {error && (
        <Callout tone="error" icon="cloud-offline-outline" title="We couldn't load campaigns">
          <View style={{ gap: space(2) }}>
            <Body muted small>Check your connection and try again.</Body>
            <Button variant="secondary" icon="refresh" onPress={() => load(tab, "first")}>Retry</Button>
          </View>
        </Callout>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <FlatList
        data={items ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <CampaignCard c={item} />}
        ItemSeparatorComponent={() => <View style={{ height: space(3) }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          error ? undefined : items === null ? <Loading label="Loading campaigns" /> : (
            <EmptyState icon="musical-notes-outline" title={tab === "live" ? "No live campaigns right now" : "No funded campaigns yet"}>
              New campaigns appear here as soon as they launch.
            </EmptyState>
          )
        }
        ListFooterComponent={more ? <Loading label="Loading more campaigns" /> : undefined}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ padding: GUTTER, paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(tab, "refresh")} tintColor={color.gold} />}
      />
    </SafeAreaView>
  );
}
