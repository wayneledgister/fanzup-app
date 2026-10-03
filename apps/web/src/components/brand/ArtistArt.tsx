import { cn } from "@/lib/utils";

/**
 * Placeholder artwork until real artist photography is supplied (Brand §6:
 * dark canvas + gold rim light). Deterministic per seed so the same artist
 * always gets the same art. Never use stock "happy SaaS" illustrations.
 */
const HUES = [
  ["#102A43", "#D4AF37"],
  ["#17181C", "#00888B"],
  ["#0B0B0D", "#B8932F"],
  ["#102A43", "#00D4FF"],
  ["#212329", "#F0D98A"],
  ["#0B0B0D", "#16C784"],
] as const;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function ArtistArt({ seed, label, className, rounded = "lg", src }: { seed: string; label?: string; className?: string; rounded?: "lg" | "full" | "md"; src?: string }) {
  const r = { lg: "rounded-lg", full: "rounded-full", md: "rounded-md" }[rounded];
  if (src) return <img src={src} alt={label ?? ""} className={cn("object-cover", r, className)} />;
  const h = hash(seed);
  const [base, glow] = HUES[h % HUES.length];
  const x = 20 + (h % 60);
  const y = 15 + ((h >> 3) % 50);
  const initials = (label ?? seed)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      role="img"
      aria-label={label ?? ""}
      className={cn("relative flex items-center justify-center overflow-hidden", r, className)}
      style={{
        background: `radial-gradient(120% 90% at ${x}% ${y}%, ${glow}55 0%, ${base} 55%, #0B0B0D 100%)`,
      }}
    >
      <span className="font-display text-[clamp(1rem,30%,3rem)] font-bold text-fg/20 select-none">{initials}</span>
    </div>
  );
}
