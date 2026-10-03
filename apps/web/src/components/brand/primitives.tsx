/**
 * FanZuP brand primitives. Pages compose these instead of raw markup + colors.
 * Rules enforced here (docs/brand/BRAND_GUIDELINES.md):
 *  - Surfaces: canvas → surface card → surface-2 elevated, hairline borders (§8)
 *  - Money/metrics in JetBrains Mono tabular (§4.3) via <Money>/<Stat>
 *  - Badges: green verified/funded, amber pending, red rejected, cyan new, gray inactive (§8)
 *  - Gold is ~10% of a screen: CTAs, focus, key highlights only (§3.5)
 */
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

/* ── Layout ─────────────────────────────────────────────── */

export function Container({ className, size = "lg", ...p }: React.HTMLAttributes<HTMLDivElement> & { size?: "sm" | "md" | "lg" | "xl" }) {
  const max = { sm: "max-w-xl", md: "max-w-3xl", lg: "max-w-6xl", xl: "max-w-[1440px]" }[size];
  return <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", max, className)} {...p} />;
}

export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 pb-8 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex max-w-2xl flex-col gap-2">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

export function SectionHeading({ eyebrow, title, action, className }: { eyebrow?: ReactNode; title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="flex flex-col gap-1">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/* ── Card ───────────────────────────────────────────────── */

export const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; elevated?: boolean; padded?: boolean }>(
  ({ className, interactive, elevated, padded = true, ...p }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-line shadow-sm",
        elevated ? "bg-surface-2" : "bg-surface",
        padded && "p-6",
        interactive && "transition-shadow duration-200 hover:shadow-gold focus-within:shadow-gold",
        className,
      )}
      {...p}
    />
  ),
);
Card.displayName = "Card";

/* ── Badge ──────────────────────────────────────────────── */

const BADGE = {
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  error: "bg-error/12 text-error border-error/30",
  info: "bg-info/12 text-info border-info/30",
  neutral: "bg-surface-2 text-muted border-line",
  gold: "bg-gold/12 text-gold border-gold/30",
} as const;

export function Badge({ tone = "neutral", icon, children, className }: { tone?: keyof typeof BADGE; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3", BADGE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/* ── Numbers ────────────────────────────────────────────── */

export function Money({ minor, cents, compact, className }: { minor: number; cents?: boolean; compact?: boolean; className?: string }) {
  return <span className={cn("num", className)}>{formatMoney(minor, { cents, compact })}</span>;
}

export function Stat({ label, value, hint, className, accent }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="eyebrow">{label}</span>
      <span className={cn("num text-2xl font-medium sm:text-3xl", accent ? "text-gold" : "text-fg")}>{value}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </div>
  );
}

/* ── Progress ───────────────────────────────────────────── */

export function ProgressBar({ value, max = 1, tone = "gold", className, label }: { value: number; max?: number; tone?: "gold" | "success" | "info"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill = { gold: "bg-gold-gradient", success: "bg-success", info: "bg-info" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Funding progress for a campaign / Pool card. Amounts in minor units. */
export function FundingProgress({ raisedMinor, goalMinor, backers, daysLeft, className }: { raisedMinor: number; goalMinor: number; backers: number; daysLeft?: number; className?: string }) {
  const pct = goalMinor ? Math.round((raisedMinor / goalMinor) * 100) : 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-lg font-medium text-fg">{formatMoney(raisedMinor)}</span>
        <span className="num text-sm text-gold">{pct}%</span>
      </div>
      <ProgressBar value={raisedMinor} max={goalMinor} tone={pct >= 100 ? "success" : "gold"} label="Funding progress" />
      <div className="flex justify-between text-xs text-muted">
        <span>
          of <span className="num">{formatMoney(goalMinor)}</span> goal · <span className="num">{backers.toLocaleString()}</span> backers
        </span>
        {daysLeft !== undefined && <span className="num">{daysLeft > 0 ? `${daysLeft}d left` : "Ended"}</span>}
      </div>
    </div>
  );
}

/* ── Stepper ────────────────────────────────────────────── */

export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn("flex w-full items-center gap-2", className)} aria-label="Progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex flex-1 flex-col gap-2" aria-current={active ? "step" : undefined}>
            <div className={cn("h-1 rounded-full", done ? "bg-gold" : active ? "bg-gold/60" : "bg-surface-2")} />
            <span className={cn("hidden text-xs sm:block", active ? "font-medium text-fg" : done ? "text-muted" : "text-muted/60")}>{label}</span>
          </li>
        );
      })}
      <span className="sr-only">
        Step {current} of {steps.length}
      </span>
    </ol>
  );
}

/* ── Forms ──────────────────────────────────────────────── */

export function Field({ label, htmlFor, hint, error, children, className, optional }: {
  label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; optional?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error ? <p className="text-sm text-error">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-md border border-line bg-surface-2 px-3.5 text-sm text-fg placeholder:text-muted/70 transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 disabled:opacity-50 aria-[invalid=true]:border-error";

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(inputBase, "h-11", className)} {...p} />
));
TextInput.displayName = "TextInput";

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(inputBase, "min-h-28 py-3", className)} {...p} />
));
TextArea.displayName = "TextArea";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(inputBase, "h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238E929B' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Checkbox({ checked, onChange, children, id, className }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id: string; className?: string }) {
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 text-sm text-muted", className)}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-line bg-surface-2 accent-[#D4AF37]" />
      <span>{children}</span>
    </label>
  );
}

/** Large selectable option card (path choice, ID type, tiers, perks). */
export function ChoiceCard({ selected, onSelect, children, className, disabled }: { selected: boolean; onSelect: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border bg-surface p-5 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-gold shadow-gold" : "border-line hover:border-muted/50 hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── Feedback ───────────────────────────────────────────── */

const CALLOUT = {
  info: "border-info/30 bg-info/8 [&>svg]:text-info",
  warning: "border-warning/30 bg-warning/8 [&>svg]:text-warning",
  error: "border-error/30 bg-error/8 [&>svg]:text-error",
  success: "border-success/30 bg-success/8 [&>svg]:text-success",
  gold: "border-gold/30 bg-gold/8 [&>svg]:text-gold",
} as const;

export function Callout({ tone = "info", icon, title, children, className }: { tone?: keyof typeof CALLOUT; icon?: ReactNode; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-lg border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0", CALLOUT[tone], className)} role="note">
      {icon}
      <div className="flex flex-col gap-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center", className)}>
      {icon && <div className="flex size-12 items-center justify-center rounded-lg bg-surface-2 text-gold [&_svg]:size-6">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Rounded-square icon chip (Brand §5 category icons). */
export function IconChip({ children, className, tone = "gold" }: { children: ReactNode; className?: string; tone?: "gold" | "muted" | "success" | "info" | "warning" | "error" }) {
  const t = { gold: "text-gold", muted: "text-muted", success: "text-success", info: "text-info", warning: "text-warning", error: "text-error" }[tone];
  return <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 [&_svg]:size-5", t, className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-line", className)} />;
}

/** Key/value row for summaries & receipts. */
export function KeyValue({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2 text-sm", className)}>
      <span className="text-muted">{k}</span>
      <span className="text-right text-fg">{v}</span>
    </div>
  );
}
