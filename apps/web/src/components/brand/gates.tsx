import { FlaskConical } from "lucide-react";
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
