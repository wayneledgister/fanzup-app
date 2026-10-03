import { ReviewWorkspace } from "@/components/campaign/ReviewWorkspace";

/**
 * Source: FPS src/pages/compliance/ReviewRevisions.tsx
 * Doc-driven changes: Section list rewritten for reward campaigns (Offering Memorandum, Subscription Agreement, Operating Agreement, Financial Projections removed). Flagged checklist items pre-fill requests; sends are recorded in the audit log.
 */
export default function ReviewRevisions() {
  return <ReviewWorkspace status="revisions" />;
}
