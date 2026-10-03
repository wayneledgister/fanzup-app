import { FlaskConical, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useFlag, type Flag } from "@/lib/flags";
import { Container, EmptyState } from "./primitives";

const COPY: Record<Flag, { title: string; body: string }> = {
  layer2: {
    title: "Investing isn't open yet",
    body: "Investment Pools launch once our registered funding-portal partner is live. Until then you can back campaigns, subscribe, and shop merch and tickets.",
  },
  postBeta: {
    title: "Coming after launch",
    body: "This feature is planned for after the Beta and isn't available yet.",
  },
};

/** Route-level gate: renders a branded "not yet available" page when the flag is off. */
export function FeatureRoute({ flag, children }: { flag: Flag; children: ReactNode }) {
  const on = useFlag(flag);
  if (on && flag === "layer2") {
    return (
      <>
        <Layer2DemoBanner />
        {children}
      </>
    );
  }
  if (on) return <>{children}</>;
  return (
    <Container size="md" className="py-20">
      <EmptyState icon={<FlaskConical />} title={COPY[flag].title}>
        {COPY[flag].body}
      </EmptyState>
    </Container>
  );
}

/** Inline gate: hides content when the flag is off. */
export function WhenFlag({ flag, children, fallback = null }: { flag: Flag; children: ReactNode; fallback?: ReactNode }) {
  return useFlag(flag) ? <>{children}</> : <>{fallback}</>;
}

/**
 * CR-002 (D-2): every Layer 2 screen carries this banner while Layer 2 runs on mock rails. Exact wording is required.
 */
export const LAYER2_DEMO_TEXT = "Demo — not an offer of securities. Mock escrow and data.";
export function Layer2DemoBanner() {
  return (
    <div role="note" data-testid="layer2-demo-banner" className="sticky top-0 z-30 border-b border-warning/30 bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-warning sm:px-8">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <p className="font-medium">{LAYER2_DEMO_TEXT}</p>
      </div>
    </div>
  );
}
