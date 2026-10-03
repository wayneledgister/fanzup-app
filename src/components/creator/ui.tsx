/**
 * Shared creator-area building blocks (KPI card, chart frame, status chips, controls).
 * Built locally because src/components/brand has no switch, segmented control, file drop,
 * copy field or chart wrapper yet — candidates to promote into the brand kit.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { Check, CircleDashed, Copy, Eye, FileUp, Hourglass, PencilLine, RotateCcw, Radio, TrendingDown, TrendingUp, Trophy, X } from "lucide-react";
import { Badge, Card } from "@/components/brand";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import type { CreatorCampaignStatus } from "./data";

/* ── KPI card ─────────────────────────────────────────── */

export function KpiCard({ label, value, hint, delta, icon, children, className }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Fractional change vs the previous period, e.g. 0.083 → +8.3% */
  delta?: number;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <Card className={cn("flex flex-col gap-3 p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
      </div>
      <span className="num text-2xl font-medium text-fg sm:text-[1.75rem]">{value}</span>
      {children}
      {(hint || delta !== undefined) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {delta !== undefined && (
            <span className={cn("num inline-flex items-center gap-1 font-medium", up ? "text-success" : "text-error")}>
              {up ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
              {up ? "+" : "−"}
              {Math.abs(delta * 100).toFixed(1)}%
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </Card>
  );
}

/* ── Campaign status chip ─────────────────────────────── */

const STATUS: Record<CreatorCampaignStatus, { label: string; tone: "success" | "warning" | "error" | "info" | "neutral" | "gold"; icon: ReactNode }> = {
  draft: { label: "Draft", tone: "neutral", icon: <PencilLine /> },
  review: { label: "In review", tone: "warning", icon: <Hourglass /> },
  live: { label: "Live", tone: "info", icon: <Radio /> },
  funded: { label: "Funded", tone: "success", icon: <Trophy /> },
  ended: { label: "Ended", tone: "neutral", icon: <Check /> },
  refunded: { label: "Refunded", tone: "error", icon: <RotateCcw /> },
};

export function CampaignStatusChip({ status }: { status: CreatorCampaignStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}
export const campaignStatusLabel = (s: CreatorCampaignStatus) => STATUS[s].label;

/* ── Segmented control (radio group) ──────────────────── */

export function Segmented<T extends string>({ options, value, onChange, label, className, size = "md" }: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-surface p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors",
              size === "sm" ? "h-8" : "h-9",
              active ? "bg-surface-2 text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={cn("num text-xs", active ? "text-gold" : "text-muted")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Toggle switch ────────────────────────────────────── */

export function Toggle({ checked, onChange, label, description, id, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={tid} className="cursor-pointer text-sm font-medium text-fg">
          {label}
        </label>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <button
        id={tid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
          checked ? "border-gold bg-gold" : "border-line bg-surface-2",
        )}
      >
        <span className={cn("inline-block size-4 rounded-full transition-transform", checked ? "translate-x-6 bg-on-gold" : "translate-x-1 bg-muted")} />
      </button>
    </div>
  );
}

/* ── File drop zone ───────────────────────────────────── */

export function FileDrop({ accept, hint, file, onFile, error, id, label = "Drag and drop your file here" }: {
  accept?: string;
  hint?: ReactNode;
  file: File | { name: string; size: number } | null;
  onFile: (f: File | null) => void;
  error?: ReactNode;
  id?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-gold">
          <FileUp className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-fg">{file.name}</span>
          <span className="num text-xs text-muted">{(file.size / 1_048_576).toFixed(1)} MB</span>
        </div>
        <button type="button" onClick={() => onFile(null)} aria-label="Remove file" className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button
        id={id}
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        aria-invalid={!!error}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          over ? "border-gold bg-gold/5" : error ? "border-error/60" : "border-line hover:border-muted/60 hover:bg-surface-2",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-lg bg-surface-2 text-gold">
          <FileUp className="size-6" />
        </span>
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className="text-sm text-muted">
          or <span className="text-gold underline-offset-4 hover:underline">browse your files</span>
        </span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </button>
      <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

/* ── Copy field ───────────────────────────────────────── */

export function CopyField({ value, label, secret, mono = true }: { value: string; label: string; secret?: boolean; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  const id = useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard unavailable in some browsers — still show confirmation of the attempt */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={shown ? value : "•".repeat(Math.min(value.length, 24))}
          className={cn("h-11 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3.5 text-sm text-fg focus:border-gold focus:outline-none", mono && "num")}
          onFocus={(e) => e.currentTarget.select()}
        />
        {secret && (
          <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? `Hide ${label}` : `Show ${label}`} className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:bg-surface-2 hover:text-fg">
            <Eye className="size-4" />
          </button>
        )}
        <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="flex h-11 shrink-0 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium text-fg hover:bg-surface-2">
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

/* ── Chart frame + tooltip (Brand §6.2: gold + cyan/teal/mint on charcoal) ── */

export const CHART = {
  gold: "var(--chart-1)",
  cyan: "var(--chart-2)",
  teal: "var(--chart-3)",
  mint: "var(--chart-4)",
  gray: "var(--chart-5)",
  grid: "var(--color-line)",
  axis: "var(--color-muted)",
  surface: "var(--color-surface)",
};

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.axis, fontSize: 12, fontFamily: "var(--font-mono)" },
  tickLine: false,
  axisLine: false,
} as const;

export function ChartCard({ title, subtitle, actions, children, footer, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
      {footer}
    </Card>
  );
}

/** Recharts tooltip content. Values are minor units. Text stays in text tokens; the swatch carries identity. */
export function MoneyTooltip({ active, payload, label, labelFormatter }: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[];
  label?: string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1.5 font-medium text-fg">{labelFormatter ? labelFormatter(label) : label}</p>}
      <ul className="flex flex-col gap-1">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <span className="num text-fg">{formatMoney(p.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Simple status pill for non-campaign states ───────── */

export function DotStatus({ tone, children }: { tone: "success" | "warning" | "error" | "info" | "muted"; children: ReactNode }) {
  const c = { success: "bg-success", warning: "bg-warning", error: "bg-error", info: "bg-info", muted: "bg-muted" }[tone];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg">
      <span className={cn("size-2 rounded-full", c)} aria-hidden />
      {children}
    </span>
  );
}

export function PendingIcon() {
  return <CircleDashed className="size-4 text-muted" aria-hidden />;
}

/** Table shell: horizontal rows on desktop. Pair with a stacked mobile list in the page. */
export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] text-left text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:pb-3 [&_th]:font-medium [&_th]:text-muted [&_thead_tr]:border-b [&_thead_tr]:border-line [&_tbody_tr]:border-b [&_tbody_tr]:border-line/60 [&_tbody_tr:last-child]:border-0 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-[0.08em]">
        {children}
      </table>
    </div>
  );
}

/** Date-only ISO strings ("2026-11-14") parse as UTC midnight and render a day early west of UTC; pin them to local noon. */
export function formatDay(iso: string, style: "short" | "long" = "short") {
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso, style);
}
