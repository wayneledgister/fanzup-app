/**
 * Fan-area UI helpers that the brand kit doesn't provide yet (dialog/sheet, segmented tabs,
 * switch, copy-code, quantity stepper). Built on brand tokens only. Candidates to promote
 * into src/components/brand once reviewed.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, Minus, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { Badge, KeyValue, Divider } from "@/components/brand";
import { POLICY, processingFeeMinor as artistProcessingFeeMinor } from "@/config/policy";

/* ── Modal: bottom sheet on mobile, centered dialog from sm ── */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-xl border border-line bg-surface shadow-xl focus:outline-none",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
            size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="font-display text-xl font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-sm text-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="-mr-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-gold" aria-label="Close">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-3 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ── Segmented tabs ── */

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-gold",
              active ? "bg-surface-2 text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cn("num text-xs", active ? "text-gold" : "text-muted")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Filter chips ── */

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center rounded-full border px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-gold",
        active ? "border-gold/50 bg-gold/10 text-fg" : "border-line text-muted hover:border-muted/50 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/* ── Switch ── */

export function Toggle({ id, checked, onChange, label, description, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-40",
          checked ? "border-gold/60 bg-gold/25" : "border-line bg-surface-2",
        )}
      >
        <span className={cn("inline-block size-4 rounded-full shadow-sm transition-transform", checked ? "translate-x-6 bg-gold" : "translate-x-1 bg-muted")} />
      </button>
    </div>
  );
}

/* ── Copyable code ── */

export function CopyCode({ code, label = "Code" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable — still show feedback so the code can be read off screen */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-line bg-surface-2 py-1 pl-3 pr-1">
      <span className="sr-only">{label}:</span>
      <code className="num flex-1 truncate text-sm tracking-wider text-fg">{code}</code>
      <button
        type="button"
        onClick={copy}
        className="flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-gold"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ── Quantity stepper ── */

export function QtyStepper({ value, onChange, min = 1, max, id }: { value: number; onChange: (n: number) => void; min?: number; max: number; id?: string }) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-surface-2" id={id}>
      <button type="button" className="flex size-11 items-center justify-center text-muted hover:text-fg disabled:opacity-30" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease quantity">
        <Minus className="size-4" />
      </button>
      <span className="num w-10 text-center text-base" aria-live="polite">
        {value}
      </span>
      <button type="button" className="flex size-11 items-center justify-center text-muted hover:text-fg disabled:opacity-30" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase quantity">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/* ── Fees ── */

/**
 * Fee the FAN pays on top of the price. Card processing is passed through to the artist at cost
 * (products/fees.html; council D1 Q3), so fans pay the sticker price and this is 0 unless policy changes.
 */
export function processingFeeMinor(subtotalMinor: number) {
  if (subtotalMinor <= 0 || POLICY.processing.payer !== "fan") return 0;
  return artistProcessingFeeMinor(subtotalMinor);
}

export function OrderSummary({ lines, subtotalMinor, extra, extraMinor = 0 }: { lines?: { k: ReactNode; v: ReactNode }[]; subtotalMinor: number; extra?: ReactNode; extraMinor?: number }) {
  const fee = processingFeeMinor(subtotalMinor + extraMinor);
  return (
    <div className="flex flex-col">
      {lines?.map((l, i) => <KeyValue key={i} k={l.k} v={l.v} />)}
      <KeyValue k="Subtotal" v={<span className="num">{formatMoney(subtotalMinor, { cents: true })}</span>} />
      <KeyValue
        k={
          <span className="flex flex-col">
            <span>Fees</span>
            <span className="text-xs">{fee ? "Card processing, passed through at cost" : "None. Card processing is covered by the artist."}</span>
          </span>
        }
        v={<span className="num">{formatMoney(fee, { cents: true })}</span>}
      />
      {extra}
      <Divider className="my-2" />
      <KeyValue k={<span className="font-medium text-fg">Total</span>} v={<span className="num text-lg font-medium">{formatMoney(subtotalMinor + fee + extraMinor, { cents: true })}</span>} />
    </div>
  );
}

/* ── Status badge for perk fulfillment ── */

export type Fulfillment = "Preparing" | "Scheduled" | "Shipped" | "Delivered";
export function FulfillmentBadge({ status }: { status: Fulfillment }) {
  const tone = { Preparing: "warning", Scheduled: "info", Shipped: "info", Delivered: "success" } as const;
  return <Badge tone={tone[status]}>{status}</Badge>;
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 2600);
  };
  const node = msg ? (
    <div role="status" className="fixed inset-x-4 bottom-24 z-[60] mx-auto flex max-w-sm items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm shadow-xl lg:bottom-8">
      <Check className="size-4 shrink-0 text-success" />
      {msg}
    </div>
  ) : null;
  return { show, node };
}

/** Date-only ISO strings ("2027-02-13") parse as UTC midnight; format in UTC so the day never shifts by timezone. */
export function formatDay(iso: string, style: "short" | "long" = "short") {
  const opts: Intl.DateTimeFormatOptions = style === "short" ? { month: "short", day: "numeric", year: "numeric" } : { dateStyle: "long" };
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: iso.length <= 10 ? "UTC" : undefined }).format(new Date(iso));
}
