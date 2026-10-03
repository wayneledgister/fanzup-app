import { ReviewWorkspace } from "@/components/campaign/ReviewWorkspace";

/**
 * Source: FPS src/pages/compliance/ReviewApproved.tsx
 * Doc-driven changes: "FINRA Broker-Dealer Review / Securities compliance approved", "Investment Opens" and "∞ Potential Investors" removed. Shows the approval record, read-only checklist and audit log.
 */
export default function ReviewApproved() {
  return <ReviewWorkspace status="approved" />;
}
