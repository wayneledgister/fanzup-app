/**
 * Tier gate checklist (PRD 01 §6.3). Used for Starter and Rising.
 * Status: met (green), pending (amber, being checked), todo (gray, artist action), blocked (red, threshold not reached).
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Circle, Clock, X } from "lucide-react";
import { Badge, ProgressBar } from "@/components/brand";
import { cn } from "@/lib/utils";

export type RequirementStatus = "met" | "pending" | "todo" | "blocked";

export interface Requirement {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  status: RequirementStatus;
  /** Measured value, e.g. listener count. Rendered in mono. */
  value?: ReactNode;
  action?: { to: string; label: string };
}

const ICON: Record<RequirementStatus, ReactNode> = {
  met: <Check />,
  pending: <Clock />,
  todo: <Circle />,
  blocked: <X />,
};
const TONE: Record<RequirementStatus, string> = {
  met: "border-success/30 bg-success/12 text-success",
  pending: "border-warning/30 bg-warning/12 text-warning",
  todo: "border-line bg-surface-2 text-muted",
  blocked: "border-error/30 bg-error/12 text-error",
};
const LABEL: Record<RequirementStatus, string> = { met: "Met", pending: "Checking", todo: "To do", blocked: "Not yet" };
const BADGE_TONE = { met: "success", pending: "warning", todo: "neutral", blocked: "error" } as const;

export function RequirementsChecklist({
  title,
  tier,
  items,
  footnote = "Tier requirements are checked again each time you create a campaign.",
  className,
}: {
  title?: ReactNode;
  tier?: string;
  items: Requirement[];
  footnote?: ReactNode | null;
  className?: string;
}) {
  const met = items.filter((i) => i.status === "met").length;
  return (
    <section className={cn("rounded-lg border border-line bg-surface shadow-sm", className)} aria-label={typeof title === "string" ? title : "Requirements"}>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            {tier && <span className="eyebrow">{tier} tier</span>}
            <h2 className="text-lg font-semibold">{title ?? "Requirements"}</h2>
          </div>
          <span className="num shrink-0 text-sm text-muted">
            <span className={met === items.length ? "text-success" : "text-fg"}>{met}</span> / {items.length} met
          </span>
        </div>
        <ProgressBar value={met} max={items.length} tone={met === items.length ? "success" : "gold"} label={`${met} of ${items.length} requirements met`} />
      </div>
      <ul className="divide-y divide-line">
        {items.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-4 sm:px-6">
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3.5", TONE[r.status])} aria-hidden>
              {ICON[r.status]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-fg">{r.label}</span>
                <span className="flex items-center gap-2">
                  {r.value !== undefined && <span className="num text-sm text-fg">{r.value}</span>}
                  <Badge tone={BADGE_TONE[r.status]}>{LABEL[r.status]}</Badge>
                </span>
              </div>
              {r.detail && <p className="text-sm text-muted">{r.detail}</p>}
              {r.action && r.status !== "met" && (
                <Link to={r.action.to} className="mt-1 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-gold hover:underline sm:min-h-0">
                  {r.action.label} <ArrowRight className="size-4" />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {footnote && <p className="border-t border-line px-4 py-3 text-xs text-muted sm:px-6">{footnote}</p>}
    </section>
  );
}
