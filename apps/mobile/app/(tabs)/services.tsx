/**
 * Services (CR-005, FR-MKT-012, parity FR-MKT-005): vetted providers' services, searchable by text and category.
 * Ordered by the API (most recently listed; never by money). Prices are "starting at" guides: FanZuP takes no payment
 * for services in MKT-1 (ADR-010). Hidden from the tab bar unless the server's `flags.marketplace` is on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MARKETPLACE_CATEGORIES, MKT_VETTING_NOTE, categoryLabel, priceFromLabel, turnaroundLabel, type ServiceResult } from "@fanzup/shared/marketplace";
import { Badge, Body, Button, Callout, Card, EmptyState, Eyebrow, H1, Loading, Num, TextField } from "@/components/ui";
import { api } from "@/lib/api";
import { color, GUTTER, radius, space, TOUCH } from "@/theme";

export default function Services() {
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ServiceResult[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const req = useRef(0);

  const load = useCallback(async (mode: "first" | "refresh") => {
    const id = ++req.current;
    setError(false);
    if (mode === "refresh") setRefreshing(true);
    else { setItems(null); setCursor(null); }
    try {
      const r = await api.services({ category: category ?? undefined, q: query || undefined });
      if (id !== req.current) return;
      setItems(r.items);
      setCursor(r.nextCursor);
    } catch {
      if (id === req.current) setError(true);
    } finally {
      if (id === req.current) setRefreshing(false);
    }
  }, [category, query]);
  useEffect(() => { void load("first"); }, [load]);

  const loadMore = async () => {
    if (!cursor || more || items === null) return;
    const id = req.current;
    setMore(true);
    try {
      const r = await api.services({ category: category ?? undefined, q: query || undefined, cursor });
      if (id !== req.current) return;
      setItems((xs) => [...(xs ?? []), ...r.items.filter((c) => !xs?.some((x) => x.id === c.id))]);
      setCursor(r.nextCursor);
    } catch { /* the next scroll retries */ } finally {
      setMore(false);
    }
  };

  const chip = (key: string | null, label: string) => {
    const on = category === key;
    return (
      <Pressable key={key ?? "all"} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCategory(key)}
        style={{ minHeight: TOUCH, paddingHorizontal: space(3), justifyContent: "center", borderRadius: radius.full, borderWidth: 1, borderColor: on ? color.gold : color.line, backgroundColor: on ? color.surface2 : "transparent" }}>
        <Body small style={{ color: on ? color.fg : color.muted }}>{label}</Body>
      </Pressable>
    );
  };

  const header = (
    <View style={{ gap: space(4), marginBottom: space(4) }}>
      <Eyebrow>Services for artists</Eyebrow>
      <H1>Find the people who help you finish the work</H1>
      <Body muted>{MKT_VETTING_NOTE}</Body>
      <TextField value={q} onChangeText={setQ} placeholder="Mixing, music video, cover art…" returnKeyType="search" onSubmitEditing={() => setQuery(q.trim())} accessibilityLabel="Search services" maxLength={80} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
        {chip(null, "All")}
        {MARKETPLACE_CATEGORIES.map((c) => chip(c.key, c.label))}
      </ScrollView>
      <Button variant="ghost" icon="document-text-outline" onPress={() => router.push("/services/requests")}>My service requests</Button>
      {error && (
        <Callout tone="error" icon="cloud-offline-outline" title="We couldn't load services">
          <Button variant="secondary" icon="refresh" onPress={() => load("first")}>Retry</Button>
        </Callout>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <FlatList
        data={items ?? []}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <ServiceCard s={item} />}
        ItemSeparatorComponent={() => <View style={{ height: space(3) }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={error ? undefined : items === null ? <Loading label="Loading services" /> : (
          <EmptyState icon="construct-outline" title="No services match yet">Try another category or search. New providers are added after review.</EmptyState>
        )}
        ListFooterComponent={more ? <Loading label="Loading more services" /> : undefined}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ padding: GUTTER, paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={color.gold} />}
      />
    </SafeAreaView>
  );
}

function ServiceCard({ s }: { s: ServiceResult }) {
  const where = s.provider.remoteOk ? (s.provider.city ? `${s.provider.city} or remote` : "Remote") : s.provider.city ?? "In person";
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/services/${s.provider.slug}`)} style={({ pressed }) => pressed && { opacity: 0.8 }}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
          <View style={{ flex: 1, gap: space(1) }}>
            <Body style={{ fontFamily: "Inter_600SemiBold" }}>{s.title}</Body>
            <Body muted small>{s.provider.displayName} · {s.provider.headline}</Body>
          </View>
          <Badge>{categoryLabel(s.category)}</Badge>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), alignItems: "center" }}>
          <Num>{priceFromLabel(s.priceFromMinor, s.priceUnit)}</Num>
          {turnaroundLabel(s.turnaroundDays) ? <Body muted small>{turnaroundLabel(s.turnaroundDays)}</Body> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
            <Ionicons name="location-outline" size={14} color={color.muted} />
            <Body muted small>{where}</Body>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
