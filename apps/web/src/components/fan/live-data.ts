/** Pay-per-view live sessions (PRD 01 §6.1) shared by /live, /live/access and /live/:id. Fictional demo data. */
export interface LiveSession {
  id: string;
  artistId: string;
  title: string;
  description: string;
  priceMinor: number;
  startsAt: string; // ISO with offset
  durationMin: number;
  status: "live" | "upcoming";
  viewers?: number;
  /** Access code the demo fan already holds, if purchased. */
  code?: string;
}

export const liveSessions: LiveSession[] = [
  { id: "ls1", artistId: "velvet-circuit", title: "Warehouse modular set", description: "Ninety minutes of live modular from the Corktown space where the Night Shift video will be shot.", priceMinor: 1200, startsAt: "2026-10-02T21:00:00-04:00", durationMin: 90, status: "live", viewers: 386, code: "FZP-VC7Q-M4K2" },
  { id: "ls2", artistId: "nova-reyes", title: "Acoustic set + horn arrangements", description: "Stripped-down versions of the Late Night EP, with the horn section sitting in for two songs.", priceMinor: 1500, startsAt: "2026-10-09T20:00:00-04:00", durationMin: 60, status: "upcoming" },
  { id: "ls3", artistId: "sol-amara", title: "Headline show rehearsal + Q&A", description: "Watch the band run the set, then ask Sol anything about the first headline show.", priceMinor: 1000, startsAt: "2026-10-16T19:00:00-05:00", durationMin: 75, status: "upcoming" },
  { id: "ls4", artistId: "kai-marlo", title: "Beat-making session: sampling day", description: "Kai flips three newly cleared samples live and takes requests from chat.", priceMinor: 800, startsAt: "2026-10-23T21:00:00-05:00", durationMin: 120, status: "upcoming" },
];

export const sessionById = (id: string) => liveSessions.find((s) => s.id === id);
export const sessionByCode = (code: string) => liveSessions.find((s) => s.code && s.code === code.trim().toUpperCase());

export function formatSessionTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
