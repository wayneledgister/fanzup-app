/**
 * My service requests (CR-005, FR-MKT-012, parity FR-MKT-010): status, the provider's note, and the provider's
 * contact once they accept (NFR-MKT-04). An open request can be withdrawn.
 */
import { useCallback, useEffect, useState } from "react";
import { Linking, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { formatDate, formatMoney } from "@fanzup/shared/format";
import { MKT_OFF_PLATFORM_NOTICE, categoryLabel, requestStatusCopy, type ServiceRequestView } from "@fanzup/shared/marketplace";
import { Badge, Body, Button, Callout, Card, EmptyState, Loading, Screen } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { space } from "@/theme";

const tone = (s: ServiceRequestView["status"]) => {
  const t = requestStatusCopy(s).tone;
  return t === "muted" ? "neutral" : t;
};

export default function MyServiceRequests() {
  const session = useSession();
  const [items, setItems] = useState<ServiceRequestView[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      setItems((await api.myServiceRequests()).items);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    if (session.session) void load();
  }, [session.session, load]);

  if (!session.loading && !session.session) return <Screen><SignInPrompt next="/services/requests" text="Log in to see the service requests you've sent." /></Screen>;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <Body muted small>{MKT_OFF_PLATFORM_NOTICE}</Body>
      {error && <Callout tone="error" icon="cloud-offline-outline" title="We couldn't load your requests"><Button variant="secondary" icon="refresh" onPress={load}>Retry</Button></Callout>}
      {items === null && !error && <Loading label="Loading your requests" />}
      {items?.length === 0 && (
        <EmptyState icon="document-text-outline" title="No requests yet" action={<Button onPress={() => router.push("/services")}>Find services</Button>}>
          When you ask a provider for help, the request and their answer show up here.
        </EmptyState>
      )}
      {items?.map((r) => (
        <Card key={r.id}>
          <View style={{ gap: space(1) }}>
            <Body style={{ fontFamily: "Inter_600SemiBold" }}>{r.listing.title}</Body>
            <Body muted small>{r.provider.displayName} · {categoryLabel(r.listing.category)} · sent {formatDate(r.createdAt.slice(0, 10))}{r.campaign ? ` · for ${r.campaign.title}` : ""}</Body>
          </View>
          <Badge tone={tone(r.status)}>{requestStatusCopy(r.status).label}</Badge>
          <Body small numberOfLines={4}>{r.brief}</Body>
          {r.budgetMinor != null ? <Body muted small>Budget {formatMoney(r.budgetMinor)}</Body> : null}
          {r.providerNote ? <Callout tone={r.status === "accepted" ? "success" : "info"} title={`${r.provider.displayName} wrote`}><Body muted small>{r.providerNote}</Body></Callout> : null}
          {r.providerContactEmail ? <Button variant="secondary" icon="mail-outline" onPress={() => Linking.openURL(`mailto:${r.providerContactEmail}`)}>{r.providerContactEmail}</Button> : null}
          {r.status === "sent" && (
            <Button variant="ghost" onPress={async () => {
              const x = await api.withdrawServiceRequest(r.id).catch(() => null);
              if (x) setItems((xs) => xs?.map((y) => (y.id === x.id ? x : y)) ?? null);
            }}>Withdraw request</Button>
          )}
        </Card>
      ))}
    </Screen>
  );
}
