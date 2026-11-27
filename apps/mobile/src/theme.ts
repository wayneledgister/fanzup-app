/**
 * Brand tokens for native (NFR-MOB-06), copied from `apps/web/src/styles/index.css` — keep both in step.
 * Gold ≈ 10 % of a screen: one primary action, active tab, focus, a key number. Never white text on gold.
 */
export const color = {
  canvas: "#0b0b0d",
  surface: "#17181c",
  surface2: "#212329",
  line: "#2a2c33",
  muted: "#8e929b",
  fg: "#f5f5f7",
  goldDeep: "#b8932f",
  gold: "#d4af37",
  goldChampagne: "#f0d98a",
  onGold: "#0b0b0d",
  cyan: "#00d4ff",
  teal: "#00888b",
  mint: "#16c784",
  navy: "#102a43",
  success: "#00c853",
  warning: "#ffb300",
  error: "#e33035",
  info: "#00d4ff",
} as const;

export const font = {
  heading: "SpaceGrotesk_700Bold",
  headingMedium: "SpaceGrotesk_500Medium",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemibold: "Inter_600SemiBold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

/** 4 pt grid. */
export const space = (n: number) => n * 4;
export const radius = { md: 8, lg: 12, full: 999 } as const;
/** Minimum touch target (NFR-MOB-05). */
export const TOUCH = 44;
export const GUTTER = 16;

export type Tone = "gold" | "success" | "info" | "warning" | "error" | "neutral";
export const toneColor: Record<Tone, string> = {
  gold: color.gold, success: color.success, info: color.info, warning: color.warning, error: color.error, neutral: color.muted,
};
