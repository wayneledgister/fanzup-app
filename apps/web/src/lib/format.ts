/** Money is stored in minor units (cents) everywhere, matching the PRD 01a ledger. */
export function formatMoney(minor: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  const dollars = minor / 100;
  if (opts.compact && Math.abs(dollars) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(dollars);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(dollars);
}

/**
 * Exact money for Layer 2 (PR #13 review round 2, finding 1): whole dollars without decimals, otherwise the cents —
 * never rounded. `formatUsd(3750)` → "$37.50", `formatUsd(100000)` → "$1,000", `formatUsd(1)` → "$0.01".
 */
export function formatUsd(minor: number): string {
  const whole = Number.isInteger(minor) && minor % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

export function formatNumber(n: number, compact = false): string {
  return new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(n);
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Parses "YYYY-MM-DD" as a local calendar date (not UTC midnight, which shows the previous day in US time zones). */
export function parseDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
}

export function formatDate(iso: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("en-US", style === "short" ? { month: "short", day: "numeric", year: "numeric" } : { dateStyle: "long" }).format(parseDate(iso));
}

export function daysUntil(iso: string, from = new Date()): number {
  return Math.ceil((parseDate(iso).getTime() - from.getTime()) / 86_400_000);
}

/** One instant in the viewer's own time zone, with the zone shown (FR-BCK-004). */
export function formatInstant(iso: string, long = false): string {
  return new Intl.DateTimeFormat(undefined, {
    ...(long ? { weekday: "long", month: "long" } : { month: "short" }),
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
