import { cn } from "@/lib/utils";
import monogram from "@/assets/fanzup-monogram-transparent.png";
import monogramTile from "@/assets/fanzup-monogram-on-black.png";

/**
 * Brand §2. Wordmark: Space Grotesk Bold, tight tracking — FAN off-white, ZUP gold.
 * Monogram ≥ 24px; wordmark ≥ 120px wide. Never recolor/stretch/shadow the mark.
 * NOTE: PNGs are raster extractions from the brand board (Brand §10 open item) —
 * swap for the vector master when available.
 */
export function Logo({ size = "md", showWordmark = true, className }: { size?: "sm" | "md" | "lg"; showWordmark?: boolean; className?: string }) {
  const mark = { sm: "size-7", md: "size-9", lg: "size-12" }[size];
  const text = { sm: "text-lg", md: "text-xl", lg: "text-3xl" }[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <img src={monogram} alt={showWordmark ? "" : "FanZuP"} className={cn(mark, "object-contain")} />
      {showWordmark && (
        <span className={cn("font-display font-bold tracking-[-0.03em]", text)} aria-label="FanZuP">
          <span className="text-fg">FAN</span>
          <span className="text-gold">ZUP</span>
        </span>
      )}
    </span>
  );
}

export function MonogramTile({ className }: { className?: string }) {
  return <img src={monogramTile} alt="FanZuP" className={cn("rounded-xl object-cover", className)} />;
}
