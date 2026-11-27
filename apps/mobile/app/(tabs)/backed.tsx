/**
 * My backings (FR-MOB-005, parity FR-BCK-005 / FR-PAY-009 fan view): every backing from the API with campaign status,
 * where the money is (shared copy), perk status, next event, refund details. Nothing here is mock data.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { MyBacking } from "@fanzup/shared/schemas";
import { campaignStatusLabel, MONEY_STATE_COPY } from "@fanzup/shared/backing-copy";
import { formatDate, formatMoney } from "@fanzup/shared/format";
import { ArtistArt, Badge, Body, Button, Callout, Card, EmptyState, Eyebrow, H1, Loading, Num, ProgressBar, Row, Screen, TestModeNotice } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { color, space } from "@/theme";

export default function Backed() {
  const session = useSession();
  const [items, setItems] = useState<MyBacking[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setError(false);
    if (refresh) setRefreshing(true);
    try {
      setItems((await api.myBackings()).backings);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const signedIn = !!session.session;
  useEffect(() => {
    if (!signedIn) setItems(null);
  }, [signedIn]);
  // Loads on first view and every time the tab regains focus (e.g. back from checkout), so a new backing shows at once.
  useFocusEffect(useCallback(() => {
    if (signedIn) void load();
  }, [signedIn, load]));

  if (session.loading) return <Screen><Loading label="Loading" /></Screen>;
  if (!signedIn) {
    return (
      <Screen>
        <Eyebrow>Your backings</Eyebrow>
        <H1>Backed</H1>
        <SignInPrompt next="/backed" text="Log in to see every campaign you've backed, where your money is, and what happens next." />
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={color.gold} />}>
      <Eyebrow>Your backings</Eyebrow>
      <H1>Backed</H1>
      <Body muted>Every campaign you've backed, where your money is, and what happens next.</Body>
      <TestModeNotice />
      {error && (
        <Callout tone="error" icon="alert-circle-outline" title="We couldn't load your backings">
          <View style={{ gap: space(2) }}>
            <Body muted small>This is a display problem; your backings haven't changed.</Body>
            <Button variant="secondary" icon="refresh" onPress={() => load()}>Retry</Button>
          </View>
        </Callout>
      )}
      {!items && !error && <Loading label="Loading your backings" />}
      {items && items.length === 0 && (
        <EmptyState icon="heart-outline" title="You haven't backed anything yet" action={<Button onPress={() => router.navigate("/")}>Find a campaign</Button>}>
          When you back a campaign, it shows up here with its status and your perk.
        </EmptyState>
      )}
      {items?.map((b) => <BackingRow key={b.id} b={b} />)}
    </Screen>
  );
}

function BackingRow({ b }: { b: MyBacking }) {
  const m = MONEY_STATE_COPY[b.moneyState];
  return (
    <Card testID="backing-row">
      <Row style={{ alignItems: "flex-start" }}>
        <ArtistArt seed={b.campaign.slug} label={b.campaign.title} size={48} />
        <View style={{ flex: 1, gap: space(1) }}>
          <Body style={{ fontFamily: "Inter_600SemiBold" }} numberOfLines={2} >{b.campaign.title}</Body>
          <Body muted small>
            {b.perk.title}{b.quantity > 1 ? <> × <Num style={{ fontSize: 13 }}>{b.quantity}</Num></> : null} · <Num style={{ fontSize: 13 }}>{formatMoney(b.amountMinor, { cents: true })}</Num> · backed <Num style={{ fontSize: 13 }}>{formatDate(b.createdAt.slice(0, 10))}</Num>
          </Body>
        </View>
      </Row>
      <Badge tone={m.tone}>{m.label}</Badge>
      <Detail k="Campaign" v={campaignStatusLabel(b.campaign.status)} />
      <Detail k="Your perk" v={<>{b.perk.status} · due by <Num style={{ fontSize: 13 }}>{formatDate(b.perk.fulfillBy)}</Num></>} />
      <Detail k="Next" v={b.next ? <>{b.next.label}{b.next.at ? <> · <Num style={{ fontSize: 13 }}>{formatDate(b.next.at.slice(0, 10))}</Num></> : null}</> : "Nothing pending"} />
      {b.moneyState === "with_artist" && (
        <View style={{ gap: space(1.5) }}>
          <ProgressBar value={b.releasedPct} max={100} tone="info" label="Share of the campaign released to the artist" />
          <Body muted small><Num style={{ fontSize: 13 }}>{b.releasedPct}%</Num> of the campaign's funds released to the artist so far.</Body>
        </View>
      )}
      {b.refund && (
        <Body muted small>
          Refunded <Num style={{ fontSize: 13 }}>{formatMoney(b.refund.amountMinor, { cents: true })}</Num> on <Num style={{ fontSize: 13 }}>{formatDate(b.refund.at.slice(0, 10))}</Num>
          {b.refund.ref ? <> · reference <Num style={{ fontSize: 13 }}>{b.refund.ref}</Num></> : null}
        </Body>
      )}
      <Body muted small>{m.help}</Body>
      <Button variant="ghost" onPress={() => router.push(`/campaigns/${b.campaign.slug}`)}>View campaign</Button>
    </Card>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <View style={{ gap: space(0.5) }}>
      <Body muted small style={{ textTransform: "uppercase", letterSpacing: 0.8, fontSize: 11 }}>{k}</Body>
      <Body small>{v}</Body>
    </View>
  );
}
