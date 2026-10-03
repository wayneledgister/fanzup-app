/**
 * In-memory state for the Rising upgrade wizard (PRD 01 §6.3). Session only; replace with the
 * tier-assessment API. Values are re-assessed when the artist creates a campaign.
 */
import { useSyncExternalStore } from "react";
import type { Requirement } from "./RequirementsChecklist";
import { RISING_MIN_HISTORY_DAYS, RISING_MIN_MONTHLY_LISTENERS } from "./tiers";

export interface RisingState {
  business: { entityType: string; legalName: string; einLast4: string } | null;
  streaming: { platform: string; monthlyListeners: number; historyDays: number } | null;
}

let state: RisingState = { business: null, streaming: null };
const listeners = new Set<() => void>();

export function updateRising(patch: Partial<RisingState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useRising(): RisingState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export const DEMO_RISING: Required<{ [K in keyof RisingState]: NonNullable<RisingState[K]> }> = {
  business: { entityType: "LLC", legalName: "Rhea Kline Music LLC", einLast4: "4417" },
  streaming: { platform: "Spotify for Artists", monthlyListeners: 4820, historyDays: 431 },
};

export function risingRequirements(s: RisingState): Requirement[] {
  const st = s.streaming;
  return [
    { id: "starter", label: "Starter requirements met", detail: "Verified identity, confirmed contact details, complete profile and a released track.", status: "met" },
    {
      id: "entity",
      label: "Business entity with an EIN",
      detail: s.business ? `${s.business.legalName} · EIN ending ${s.business.einLast4}` : "An LLC or corporation in good standing, with an IRS-issued EIN.",
      status: s.business ? "met" : "todo",
      action: { to: "/tier/rising/business", label: "Add your business" },
    },
    {
      id: "streaming",
      label: "Streaming analytics connected",
      detail: st ? st.platform : "Read-only access to Spotify for Artists or Apple Music for Artists.",
      status: st ? "met" : "todo",
      action: { to: "/tier/rising/streaming", label: "Connect streaming" },
    },
    {
      id: "listeners",
      label: `${RISING_MIN_MONTHLY_LISTENERS.toLocaleString()}+ monthly listeners`,
      detail: "Measured over the last 28 days on your connected platform.",
      status: !st ? "todo" : st.monthlyListeners >= RISING_MIN_MONTHLY_LISTENERS ? "met" : "blocked",
      value: st ? st.monthlyListeners.toLocaleString() : undefined,
      action: { to: "/tier/rising/streaming", label: "Connect streaming" },
    },
    {
      id: "history",
      label: `${RISING_MIN_HISTORY_DAYS} days of release history`,
      detail: "Time since your first release on the connected platform.",
      status: !st ? "todo" : st.historyDays >= RISING_MIN_HISTORY_DAYS ? "met" : "blocked",
      value: st ? `${st.historyDays} days` : undefined,
      action: { to: "/tier/rising/streaming", label: "Connect streaming" },
    },
  ];
}
