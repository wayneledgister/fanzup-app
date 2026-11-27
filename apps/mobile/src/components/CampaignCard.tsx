/** One campaign in the Explore list (FR-MOB-001): title, artist, raised of goal, backers, time left. */
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { CampaignCard as Campaign } from "@fanzup/shared/schemas";
import { timeLeft } from "@fanzup/shared/campaign";
import { formatMoney, formatNumber } from "@fanzup/shared/format";
import { ArtistArt, Badge, Body, Card, Num, ProgressBar, Row } from "./ui";
import { color, space } from "@/theme";

export function CampaignCard({ c }: { c: Campaign }) {
  const t = timeLeft(c.endsAt);
  const funded = c.raisedMinor >= c.goalMinor;
  return (
    <Link href={`/campaigns/${c.slug}`} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${c.title} by ${c.artist.name}`} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <Card testID="campaign-card">
          <Row style={{ alignItems: "flex-start" }}>
            <ArtistArt seed={c.artist.slug} label={c.artist.name} />
            <View style={{ flex: 1, gap: space(1) }}>
              <Body style={{ fontFamily: "Inter_600SemiBold" }} numberOfLines={2}>{c.title}</Body>
              <Body muted small numberOfLines={1}>{c.artist.name}{c.artist.city ? ` · ${c.artist.city}` : ""}</Body>
            </View>
            {funded ? <Badge tone="success">Goal reached</Badge> : <Badge tone="gold">{c.type}</Badge>}
          </Row>
          {c.blurb ? <Body muted small numberOfLines={2}>{c.blurb}</Body> : null}
          <ProgressBar value={c.raisedMinor} max={c.goalMinor} label={`${formatMoney(c.raisedMinor)} raised of ${formatMoney(c.goalMinor)}`} />
          <Row style={{ justifyContent: "space-between" }}>
            <Body small muted><Num style={{ fontSize: 13, color: color.fg }}>{formatMoney(c.raisedMinor, { compact: true })}</Num> of <Num style={{ fontSize: 13 }}>{formatMoney(c.goalMinor, { compact: true })}</Num></Body>
            <Body small muted><Num style={{ fontSize: 13 }}>{formatNumber(c.backers)}</Num> backers</Body>
            <Body small muted>{t.ended ? "Ended" : <><Num style={{ fontSize: 13 }}>{t.value}</Num> {t.label}</>}</Body>
          </Row>
        </Card>
      </Pressable>
    </Link>
  );
}
