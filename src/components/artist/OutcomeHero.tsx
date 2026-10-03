import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Centered status header for outcome screens (pending / approved / rejected / unlocked). */
export function OutcomeHero({ icon, tone, eyebrow, title, children }: { icon: ReactNode; tone: "success" | "warning" | "error" | "gold"; eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  const ring = {
    success: "border-success/30 bg-success/12 text-success",
    warning: "border-warning/30 bg-warning/12 text-warning",
    error: "border-error/30 bg-error/12 text-error",
    gold: "border-gold/40 bg-gold/12 text-gold shadow-gold",
  }[tone];
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      <div className={cn("flex size-16 items-center justify-center rounded-full border [&_svg]:size-8", ring)} aria-hidden>
        {icon}
      </div>
      {eyebrow && <span className={cn("eyebrow", tone === "gold" && "text-gold")}>{eyebrow}</span>}
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      {children && <p className="max-w-lg text-base text-muted">{children}</p>}
    </header>
  );
}
