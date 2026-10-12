import { Info } from "lucide-react";
import { Callout } from "@/components/brand";

/** Required on every Rising screen that mentions Pools (PRD 01 §6.3, CONSOLIDATION Layer 2). */
export function PoolsAvailabilityNotice({ className }: { className?: string }) {
  return (
    <Callout tone="info" icon={<Info />} title="Investment Pools aren't open yet" className={className}>
      Revenue-share Pools aren't available yet: no registered intermediary has been chosen to run them. Reaching Rising now means you're ready
      when they open. Every Pool is a Regulation Crowdfunding offering and goes through Form C review before fans can invest.
    </Callout>
  );
}
