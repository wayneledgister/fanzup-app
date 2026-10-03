/**
 * In-memory artist onboarding draft shared across the wizard steps (no localStorage —
 * BUILD_CONVENTIONS "State"). Lives for the browser session only; replace with the
 * profile API when services land (PRD 01 §9.2).
 */
import { useSyncExternalStore } from "react";

export const SOCIAL_PLATFORMS = ["Instagram", "TikTok", "X", "YouTube"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const STREAMING_PLATFORMS = ["Spotify", "Apple Music", "YouTube Music", "SoundCloud"] as const;
export type StreamingPlatform = (typeof STREAMING_PLATFORMS)[number];

export interface ArtistDraft {
  displayName: string;
  genres: string[];
  city: string;
  bio: string;
  phone: string;
  phoneVerified: boolean;
  avatarUrl: string | null;
  bannerUrl: string | null;
  socials: Partial<Record<SocialPlatform, string>>;
  streaming: Partial<Record<StreamingPlatform, string>>;
  trackUrl: string;
  /** Set once the artist has submitted any step — lets later screens tell a real draft from a direct visit. */
  touched: boolean;
}

const EMPTY: ArtistDraft = {
  displayName: "",
  genres: [],
  city: "",
  bio: "",
  phone: "",
  phoneVerified: false,
  avatarUrl: null,
  bannerUrl: null,
  socials: {},
  streaming: {},
  trackUrl: "",
  touched: false,
};

/** Fictional sample profile used when a screen is opened directly (design review, deep link). */
export const DEMO_DRAFT: ArtistDraft = {
  displayName: "Rhea Kline",
  genres: ["Indie", "Alternative"],
  city: "Pittsburgh, PA",
  bio: "Bedroom-pop songwriter turned four-piece band. Two singles out, debut EP recorded, first regional run booked for spring.",
  phone: "(412) 555-0148",
  phoneVerified: true,
  avatarUrl: null,
  bannerUrl: null,
  socials: { Instagram: "@rheakline", TikTok: "@rheaklinemusic" },
  streaming: { Spotify: "open.spotify.com/artist/rheakline", "Apple Music": "music.apple.com/artist/rheakline" },
  trackUrl: "open.spotify.com/track/glass-houses",
  touched: true,
};

let draft: ArtistDraft = EMPTY;
const listeners = new Set<() => void>();

export function updateDraft(patch: Partial<ArtistDraft>) {
  draft = { ...draft, ...patch, touched: true };
  listeners.forEach((l) => l());
}

export function useArtistDraft(): ArtistDraft {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => draft,
    () => draft,
  );
}

/** The draft if the artist has filled one in this session, otherwise the sample profile. */
export function useDisplayDraft(): { draft: ArtistDraft; isSample: boolean } {
  const d = useArtistDraft();
  return d.touched && d.displayName ? { draft: d, isSample: false } : { draft: DEMO_DRAFT, isSample: true };
}

/** Profile fields that count toward "100% profile" (Starter gate, PRD 01 §6.3). Media is shown separately but counted. */
export function profileChecklist(d: ArtistDraft) {
  const isSample = d === DEMO_DRAFT;
  return [
    { key: "name", label: "Artist name", done: d.displayName.trim().length >= 2 },
    { key: "genre", label: "Genre", done: d.genres.length > 0 },
    { key: "city", label: "Home city", done: d.city.trim().length > 1 },
    { key: "bio", label: "Bio", done: d.bio.trim().length >= 40 },
    { key: "avatar", label: "Profile photo", done: isSample || !!d.avatarUrl },
    { key: "banner", label: "Banner image", done: isSample || !!d.bannerUrl },
  ];
}

export function profileCompletion(d: ArtistDraft): number {
  const items = profileChecklist(d);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}
