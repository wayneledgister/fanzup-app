import { ReviewWorkspace } from "@/components/campaign/ReviewWorkspace";

/**
 * Source: FPS src/pages/compliance/ReviewUnderReview.tsx
 * Doc-driven changes: FINRA broker-dealer review stage, "SEC-registered" partner copy and the 7–10 day equity timeline removed — Layer 1 reward campaigns get a FanZuP compliance review only (Mechanism 05). Replaced the stage timeline with the six-point reward checklist, automated signals, per-check notes, approve / request revisions, and an append-only audit log.
 */
export default function ReviewUnderReview() {
  return <ReviewWorkspace status="under-review" />;
}
