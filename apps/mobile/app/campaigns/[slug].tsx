/**
 * Campaign page (FR-MOB-002; parity FR-CMP-003, FR-BCK-004, FR-PLT-006). Renders only what the artist wrote; empty
 * sections hidden. Deadline in the fan's time zone, hours and minutes under 24 h. "Back" goes through a full account
 * first and returns to checkout with the same perk (FR-BCK-002). Deep link: fanzup://campaigns/<slug>.
 */
import { useEffect, useState } from "react";
import { Pressable, Share, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { CampaignDetail, PerkView } from "@fanzup/shared/schemas";
import { timeLeft } from "@fanzup/shared/campaign";
import { acceptingBackers, CAMPAIGN_FAQ, perkStock, TRANCHE_STATUS_COPY } from "@fanzup/shared/backing-copy";
import { formatDate, formatInstant, formatMoney, formatNumber } from "@fanzup/shared/format";
import { ArtistArt, Badge, Body, Button, Callout, Card, EmptyState, EscrowNotice, H1, H2, Loading, Num, ProgressBar, Row, Screen, TestModeNotice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { anonId } from "@/lib/ids";
import { campaignShareUrl } from "@/lib/links";
import { useSession } from "@/lib/session";
import { color, radius, space } from "@/theme";

const KIND_ICON = { digital: "sparkles-outline", physical: "cube-outline", experience: "ticket-outline" } as const;

export default function CampaignScreen() {
  const { slug = "", perk: perkParam } = useLocalSearchParams<{ slug: string; perk?: string }>();
  const session = useSession();
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(perkParam ?? null);
  const [, tick] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    api.campaign(slug)
      .then((d) => alive && (setData(d), setState("ready")))
      .catch((e) => alive && setState(e instanceof ApiError && e.status === 404 ? "missing" : "error"));
    return () => {
      alive = false;
    };
  }, [slug, attempt]);

  // Keep the countdown honest (FR-BCK-004): re-render every 30 s and once at the deadline instant.
  const endsAt = data?.campaign.endsAt ?? null;
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    const left = endsAt ? Date.parse(endsAt) - Date.now() : 0;
    const at = left > 0 && left < 2_147_000_000 ? setTimeout(() => tick((n) => n + 1), left + 50) : undefined;
    return () => {
      clearInterval(t);
      if (at) clearTimeout(at);
    };
  }, [endsAt]);

  if (state === "loading") return <Screen edges={[]}><Loading label="Loading campaign" /></Screen>;
  if (state === "missing" || (state === "ready" && !data)) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="flag-outline" title="We couldn't find that campaign" action={<Button onPress={() => router.navigate("/")}>Browse live campaigns</Button>}>
          The link may be wrong, or the campaign may not be public yet.
        </EmptyState>
      </Screen>
    );
  }
  if (state === "error" || !data) {
    return (
      <Screen edges={[]}>
        <Callout tone="error" icon="cloud-offline-outline" title="We couldn't load this campaign">
          <View style={{ gap: space(2) }}>
            <Body muted small>Check your connection and try again.</Body>
            <Button variant="secondary" icon="refresh" onPress={() => setAttempt((n) => n + 1)}>Retry</Button>
          </View>
        </Callout>
      </Screen>
    );
  }

  const { campaign: c, perks, tranches } = data;
  const t = timeLeft(c.endsAt);
  const accepting = acceptingBackers(c);
  const funded = c.raisedMinor >= c.goalMinor;
  const perk = perks.find((p) => p.id === selected);

  const pick = (p: PerkView) => {
    setSelected(p.id);
    void api.event({ name: "perk_selected", campaignId: c.id, perkId: p.id, anonId: anonId() });
  };

  const back = () => {
    if (!perk) return;
    const checkout = `/checkout/${c.slug}?perk=${perk.id}`;
    if (!session.session) return router.push(`/auth/signup?next=${encodeURIComponent(checkout)}`);
    if (!session.emailVerified) return router.push(`/auth/verify?next=${encodeURIComponent(checkout)}`);
    router.push(checkout as never);
  };

  const share = () => Share.share({ title: c.title, message: `${c.title} — ${campaignShareUrl(c.slug)}` }).catch(() => {});

  return (
    <>
      <Stack.Screen options={{ title: c.artist.name, headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Share campaign" onPress={share} hitSlop={10} style={{ padding: space(2) }}>
          <Ionicons name="share-outline" size={22} color={color.fg} />
        </Pressable>
      ) }} />
      <Screen edges={["bottom"]}>
        <Row style={{ alignItems: "flex-start" }}>
          <ArtistArt seed={c.artist.slug} label={`${c.artist.name} — ${c.title}`} size={72} />
          <View style={{ flex: 1, gap: space(1.5) }}>
            <Row style={{ gap: space(2), flexWrap: "wrap" }}>
              <Badge tone="gold">{c.type}</Badge>
              {funded && <Badge tone="success">Goal reached</Badge>}
            </Row>
            <Body muted small>{[c.artist.name, c.artist.genre, c.artist.city].filter(Boolean).join(" · ")}</Body>
          </View>
        </Row>
        <H1>{c.title}</H1>
        {c.blurb ? <Body muted>{c.blurb}</Body> : null}

        <Card>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <View>
              <Num style={{ fontSize: 24, color: color.gold }}>{formatMoney(c.raisedMinor)}</Num>
              <Body muted small>raised of <Num style={{ fontSize: 13 }}>{formatMoney(c.goalMinor)}</Num> goal</Body>
            </View>
            <Num style={{ fontSize: 15 }}>{c.goalMinor > 0 ? Math.floor((c.raisedMinor / c.goalMinor) * 100) : 0}%</Num>
          </Row>
          <ProgressBar value={c.raisedMinor} max={c.goalMinor} label="Funding progress" />
          <Row style={{ justifyContent: "space-around", paddingTop: space(1) }}>
            <Stat value={formatNumber(c.backers)} label="backers" />
            <Stat value={t.value} label={t.label || "deadline"} />
            <Stat value={String(perks.length)} label="perks" />
          </Row>
          {c.endsAt && <Body muted small style={{ textAlign: "center" }}>All-or-nothing · {t.ended ? "ended" : "ends"} <Num style={{ fontSize: 13 }}>{formatInstant(c.endsAt)}</Num></Body>}
        </Card>

        <TestModeNotice />
        <EscrowNotice />
        {c.milestoneRelease && tranches.length > 1 && (
          <Callout tone="info" icon="git-commit-outline" title="Funds are released in milestones">
            {`If this campaign hits its goal, ${c.artist.name} receives the money in stages as each milestone below is verified — not all at once.`}
          </Callout>
        )}

        <View style={{ gap: space(3) }}>
          <H2>Choose a perk</H2>
          {perks.length === 0 ? <Body muted small>This campaign has no perks yet.</Body> : (
            <View accessibilityRole="radiogroup" accessibilityLabel="Perks" style={{ gap: space(3) }}>
              {perks.map((p) => <PerkOption key={p.id} perk={p} selected={selected === p.id} onSelect={() => pick(p)} disabled={!accepting} />)}
            </View>
          )}
          <Button onPress={back} disabled={!perk || !accepting} testID="back-cta">
            {!accepting ? (t.ended && c.endsAt ? "Campaign ended" : "Not accepting backers") : perk ? `Back with ${formatMoney(perk.priceMinor)}` : "Pick a perk to back"}
          </Button>
          {accepting && <Body muted small style={{ textAlign: "center" }}>Charged when you back. No fees added at checkout. Refunded in full if the goal isn't met.</Body>}
          {!session.session && accepting && <Body muted small style={{ textAlign: "center" }}>You'll create a free account and verify your email first.</Body>}
        </View>

        <Story story={c.story} risks={c.risks} tranches={tranches} goalMinor={c.goalMinor} />

        <View style={{ gap: space(3) }}>
          <H2>FAQ</H2>
          {CAMPAIGN_FAQ.map((f) => <Faq key={f.q} q={f.q} a={f.a} />)}
        </View>
      </Screen>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: "center", gap: space(0.5) }}>
      <Num style={{ fontSize: 18 }}>{value}</Num>
      <Body muted small>{label}</Body>
    </View>
  );
}

function PerkOption({ perk: p, selected, onSelect, disabled }: { perk: PerkView; selected: boolean; onSelect: () => void; disabled?: boolean }) {
  const { soldOut, low } = perkStock(p);
  const off = soldOut || disabled;
  return (
    <Pressable testID="perk-option" accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: off }} disabled={off} onPress={onSelect}
      style={({ pressed }) => [{ borderWidth: 1, borderColor: selected ? color.gold : color.line, borderRadius: radius.lg, backgroundColor: color.surface, padding: space(4), gap: space(2) }, off && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
      <Row style={{ alignItems: "flex-start" }}>
        <Ionicons name={KIND_ICON[p.kind]} size={20} color={selected ? color.gold : color.muted} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: space(1) }}>
          <Body style={{ fontFamily: "Inter_600SemiBold" }}>{p.title}</Body>
          {p.description ? <Body muted small>{p.description}</Body> : null}
        </View>
        <Num style={{ fontSize: 17 }}>{formatMoney(p.priceMinor)}</Num>
      </Row>
      <Row style={{ gap: space(4), flexWrap: "wrap", paddingLeft: space(8) }}>
        <Body muted small>Delivery by <Num style={{ fontSize: 13 }}>{formatDate(p.fulfillBy)}</Num></Body>
        {soldOut ? <Badge>Sold out</Badge> : p.remaining !== null ? (
          <Body small style={{ color: low ? color.warning : color.muted }}><Num style={{ fontSize: 13, color: low ? color.warning : color.muted }}>{p.remaining}</Num> of <Num style={{ fontSize: 13, color: low ? color.warning : color.muted }}>{p.limit ?? 0}</Num> left</Body>
        ) : <Body muted small>Unlimited</Body>}
      </Row>
    </Pressable>
  );
}

function Story({ story, risks, tranches, goalMinor }: { story: string | null; risks: string | null; tranches: CampaignDetail["tranches"]; goalMinor: number }) {
  const hasMilestones = tranches.length > 1;
  if (!story && !risks && !hasMilestones) return null;
  return (
    <View style={{ gap: space(5) }}>
      {story ? <View style={{ gap: space(2) }}><H2>Story</H2><Body muted>{story}</Body></View> : null}
      {risks ? <View style={{ gap: space(2) }}><H2>Risks and challenges</H2><Body muted>{risks}</Body></View> : null}
      {hasMilestones && (
        <View style={{ gap: space(3) }} testID="milestones">
          <H2>Release milestones</H2>
          {tranches.map((t) => (
            <Row key={t.seq} style={{ alignItems: "flex-start" }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, alignItems: "center", justifyContent: "center" }}>
                <Num style={{ fontSize: 11, color: color.muted }}>{t.seq}</Num>
              </View>
              <View style={{ flex: 1, gap: space(0.5) }}>
                <Body>{t.seq === 1 ? "Goal reached" : t.milestone} <Num style={{ fontSize: 13, color: color.muted }}>· {t.pct}% · {formatMoney((goalMinor * t.pct) / 100)} of the goal</Num></Body>
                <Body muted small>
                  {TRANCHE_STATUS_COPY[t.status] ?? t.status}
                  {t.releasedAt ? ` · released ${formatDate(t.releasedAt.slice(0, 10))}` : t.verifiedAt ? ` · verified ${formatDate(t.verifiedAt.slice(0, 10))}` : t.targetDate ? ` · target ${formatDate(t.targetDate)}` : ""}
                </Body>
              </View>
            </Row>
          ))}
        </View>
      )}
    </View>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: space(2), paddingVertical: space(3) }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3) }}>
        <Body style={{ flex: 1, fontFamily: "Inter_500Medium" }}>{q}</Body>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={color.muted} />
      </Pressable>
      {open && <Body muted small>{a}</Body>}
    </Card>
  );
}
