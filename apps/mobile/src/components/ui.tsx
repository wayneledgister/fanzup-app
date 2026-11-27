/**
 * Native brand kit (NFR-MOB-06): the mobile counterparts of `apps/web/src/components/brand`. Colors only from
 * `theme.ts`; one gold primary action per screen; touch targets ≥ 44 pt; labelled controls (NFR-MOB-05).
 */
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { REFUND_PROMISE, TEST_MODE_NOTICE } from "@fanzup/shared/backing-copy";
import { color, font, GUTTER, radius, space, TOUCH, toneColor, type Tone } from "@/theme";
import { useConfig } from "@/lib/config";

type IconName = ComponentProps<typeof Ionicons>["name"];

// ── Text ───────────────────────────────────────────────────────────────
export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[s.h2, style]}>{children}</Text>;
}
export function Body({ children, muted, small, style, numberOfLines }: { children: ReactNode; muted?: boolean; small?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[s.body, muted && { color: color.muted }, small && { fontSize: 13, lineHeight: 18 }, style]}>{children}</Text>;
}
/** Every money amount, count, date or id uses the mono face (web: `num`). */
export function Num({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.num, style]}>{children}</Text>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}

// ── Layout ─────────────────────────────────────────────────────────────
export function Screen({ children, scroll = true, refreshControl, edges = ["top"] }: {
  children: ReactNode; scroll?: boolean; refreshControl?: ComponentProps<typeof ScrollView>["refreshControl"]; edges?: ("top" | "bottom")[];
}) {
  return (
    <SafeAreaView style={s.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={s.screenInner} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      ) : (
        <View style={[s.screenInner, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View testID={testID} style={[s.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: space(3) }, style]}>{children}</View>;
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <View style={s.kv}>
      <Body muted small>{k}</Body>
      {typeof v === "string" ? <Body style={{ textAlign: "right", flexShrink: 1 }}>{v}</Body> : v}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color.line }} />;
}

// ── Controls ───────────────────────────────────────────────────────────
export function Button({ children, onPress, variant = "primary", disabled, loading, icon, accessibilityLabel, testID }: {
  children: ReactNode; onPress?: () => void; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; loading?: boolean; icon?: IconName; accessibilityLabel?: string; testID?: string;
}) {
  const fg = variant === "primary" ? color.onGold : variant === "secondary" ? color.fg : color.gold;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [s.btn, s[`btn_${variant}`], (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]}>{children}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space(1.5) }}>
      <Text style={s.label}>{label}</Text>
      {children}
      {error ? <Text accessibilityLiveRegion="polite" style={[s.small, { color: color.error }]}>{error}</Text> : hint ? <Text style={[s.small, { color: color.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function TextField(props: ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return <TextInput placeholderTextColor={color.muted} selectionColor={color.gold} style={[s.input, invalid && { borderColor: color.error }, style]} {...rest} />;
}

export function Checkbox({ checked, onChange, children, testID }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={s.check} hitSlop={6}>
      <View style={[s.checkBox, checked && { backgroundColor: color.gold, borderColor: color.gold }]}>
        {checked && <Ionicons name="checkmark" size={16} color={color.onGold} />}
      </View>
      <View style={{ flex: 1 }}>{typeof children === "string" ? <Body>{children}</Body> : children}</View>
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="tablist" style={s.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[s.segItem, on && { backgroundColor: color.surface2, borderColor: color.gold }]}>
            <Text style={[s.bodyMedium, { color: on ? color.fg : color.muted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <Row>
      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} disabled={value <= min} onPress={() => onChange(value - 1)} style={[s.stepBtn, value <= min && { opacity: 0.4 }]}>
        <Ionicons name="remove" size={20} color={color.fg} />
      </Pressable>
      <Num style={{ fontSize: 18, minWidth: 28, textAlign: "center" }}>{value}</Num>
      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} style={[s.stepBtn, value >= max && { opacity: 0.4 }]}>
        <Ionicons name="add" size={20} color={color.fg} />
      </Pressable>
    </Row>
  );
}

// ── Feedback ───────────────────────────────────────────────────────────
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const c = toneColor[tone];
  return (
    <View style={[s.badge, { borderColor: c }]}>
      <Text style={[s.badgeText, { color: c }]}>{children}</Text>
    </View>
  );
}

export function Callout({ tone = "info", icon, title, children, testID }: { tone?: Tone; icon?: IconName; title: string; children?: ReactNode; testID?: string }) {
  const c = toneColor[tone];
  return (
    <View testID={testID} accessibilityRole={tone === "error" ? "alert" : undefined} style={[s.callout, { borderColor: c }]}>
      {icon && <Ionicons name={icon} size={20} color={c} style={{ marginTop: 1 }} />}
      <View style={{ flex: 1, gap: space(1) }}>
        <Text style={[s.bodySemibold, { color: color.fg }]}>{title}</Text>
        {typeof children === "string" ? <Body muted small>{children}</Body> : children}
      </View>
    </View>
  );
}

export function ProgressBar({ value, max, tone = "gold", label }: { value: number; max: number; tone?: Tone; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }} style={s.track}>
      <View style={[s.fill, { width: `${pct}%`, backgroundColor: toneColor[tone] }]} />
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View accessibilityLabel={label} accessibilityState={{ busy: true }} style={{ paddingVertical: space(16), alignItems: "center" }}>
      <ActivityIndicator color={color.gold} />
    </View>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: space(3), paddingVertical: space(12) }}>
      <Ionicons name={icon} size={36} color={color.muted} />
      <H2 style={{ textAlign: "center" }}>{title}</H2>
      {children && <Body muted style={{ textAlign: "center" }}>{children}</Body>}
      {action}
    </View>
  );
}

/** Deterministic artwork from a seed — no stock photos or external images (BUILD_CONVENTIONS). */
export function ArtistArt({ seed, label, size = 56, round = false }: { seed: string; label: string; size?: number; round?: boolean }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const palette = [color.navy, color.teal, color.goldDeep, "#3a2f5b", "#5b2f3a", "#2f5b4a"];
  const bg = palette[h % palette.length];
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <View accessibilityLabel={label} accessibilityRole="image" style={{ width: size, height: size, borderRadius: round ? size / 2 : radius.md, backgroundColor: bg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.line }}>
      <Text style={{ color: color.fg, fontFamily: font.heading, fontSize: size * 0.34 }}>{initials}</Text>
    </View>
  );
}

// ── Disclosures (copy from @fanzup/shared, same words as the web) ──────
export function EscrowNotice({ compact = false }: { compact?: boolean }) {
  return (
    <Callout tone="gold" icon="shield-checkmark-outline" title={REFUND_PROMISE.title}>
      {compact ? REFUND_PROMISE.compact : REFUND_PROMISE.full}
    </Callout>
  );
}

/** FR-MOB-006 / FR-PLT-006: shown until the API confirms live mode, so it never flickers off wrongly. */
export function TestModeNotice() {
  const cfg = useConfig();
  if (cfg && !cfg.testMode) return null;
  return (
    <Callout tone="warning" icon="flask-outline" title={TEST_MODE_NOTICE.title} testID="test-mode-notice">
      <Body muted small>
        {TEST_MODE_NOTICE.intro}{" "}
        {cfg?.provider === "stripe-test" ? <>Pay with the test card <Num style={{ fontSize: 13 }}>{TEST_MODE_NOTICE.stripeTestCard}</Num> {TEST_MODE_NOTICE.stripeTestCardHint}.</> : "Pay with a test card."}{" "}
        {TEST_MODE_NOTICE.closing}
      </Body>
    </Callout>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  screenInner: { padding: GUTTER, gap: space(5), paddingBottom: space(12) },
  h1: { color: color.fg, fontFamily: font.heading, fontSize: 28, lineHeight: 34 },
  h2: { color: color.fg, fontFamily: font.heading, fontSize: 20, lineHeight: 26 },
  body: { color: color.fg, fontFamily: font.body, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: font.bodyMedium, fontSize: 14 },
  bodySemibold: { fontFamily: font.bodySemibold, fontSize: 15 },
  small: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  num: { color: color.fg, fontFamily: font.mono, fontSize: 15 },
  eyebrow: { color: color.gold, fontFamily: font.bodySemibold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  label: { color: color.fg, fontFamily: font.bodyMedium, fontSize: 14 },
  card: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 1, borderRadius: radius.lg, padding: space(4), gap: space(3) },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(3), paddingVertical: space(2) },
  btn: { minHeight: TOUCH + 4, borderRadius: radius.md, paddingHorizontal: space(5), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2) },
  btn_primary: { backgroundColor: color.gold },
  btn_secondary: { backgroundColor: color.surface2, borderWidth: 1, borderColor: color.line },
  btn_ghost: { backgroundColor: "transparent" },
  btnText: { fontFamily: font.bodySemibold, fontSize: 16 },
  input: { minHeight: TOUCH + 4, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, color: color.fg, paddingHorizontal: space(3), fontFamily: font.body, fontSize: 16 },
  check: { flexDirection: "row", gap: space(3), alignItems: "flex-start", minHeight: TOUCH, paddingVertical: space(1) },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: color.muted, alignItems: "center", justifyContent: "center", marginTop: 1 },
  seg: { flexDirection: "row", gap: space(2) },
  segItem: { flex: 1, minHeight: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  stepBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface2, alignItems: "center", justifyContent: "center" },
  badge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space(2.5), paddingVertical: space(0.5), alignSelf: "flex-start" },
  badgeText: { fontFamily: font.bodyMedium, fontSize: 12 },
  callout: { flexDirection: "row", gap: space(3), borderWidth: 1, borderRadius: radius.lg, padding: space(4), backgroundColor: color.surface },
  track: { height: 8, borderRadius: radius.full, backgroundColor: color.surface2, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.full },
});
