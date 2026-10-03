/**
 * Standard disclosure blocks. Copy here is the single source for regulated language —
 * pages must use these components rather than writing their own risk/escrow text.
 * Sources: Brand §7.3–§7.4, PRD 01 §6.5 / §11, Mechanism 05 §2, Mechanism 07 §1.
 * Copy is product guidance pending counsel review — not legal advice.
 */
import { Lock, ShieldCheck, TriangleAlert, Hourglass } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { Callout } from "./primitives";
import { formatDate } from "@/lib/format";

/** Layer 1 reward campaigns ("Fund My Show", Mechanism 05). */
export function EscrowNotice({ compact = false }: { compact?: boolean }) {
  return (
    <Callout tone="gold" icon={<ShieldCheck />} title="Held in escrow until the goal is met">
      {compact ? (
        "If the goal isn't reached by the deadline, every backer is refunded automatically."
      ) : (
        <>
          Your money is held by our escrow partner — not by FanZuP and not by the artist — until the campaign reaches its goal. If it
          isn't met by the deadline, every backer is refunded automatically. Backing gets you the perks listed; it is not an investment
          and doesn't include any share of the artist's earnings.
        </>
      )}
    </Callout>
  );
}

/** Layer 2 (Reg CF) — required before any purchase. PRD 01 §11. */
export function InvestmentRiskDisclosure({ lockupMonths = 12 }: { lockupMonths?: number }) {
  return (
    <Callout tone="warning" icon={<TriangleAlert />} title="This is a risky investment. You could lose all of it.">
      <ul className="mt-1 list-disc space-y-1 pl-4">
        <li>Potential payouts depend on revenue the artist actually earns and pays through. There are no guaranteed returns.</li>
        <li>
          Your claim on revenue is <strong className="text-fg">unsecured</strong>. If the artist underperforms, stops reporting, or changes
          distributors, you may not recover your money.
        </li>
        <li>
          Units can't be resold for <span className="num">{lockupMonths}</span> months, and there is no marketplace to sell them. Plan to
          hold them until maturity.
        </li>
        <li>Offered under Regulation Crowdfunding through our registered intermediary. Read the Form C before investing.</li>
      </ul>
    </Callout>
  );
}

/** Per-holding lock-up state — Mechanism 07 P0 (Beta). */
export function LockupNotice({ unlocksOn }: { unlocksOn: string }) {
  const locked = new Date(unlocksOn) > new Date();
  return (
    <Callout tone={locked ? "info" : "success"} icon={locked ? <Lock /> : <Hourglass />} title={locked ? `Locked until ${formatDate(unlocksOn)}` : "Resale lock-up ended"}>
      {locked
        ? "Reg CF units can only be transferred back to the issuer, to an accredited investor, or to a family member during the first 12 months."
        : "There is currently no marketplace for these units. Permitted transfers can be requested from your holdings."}
    </Callout>
  );
}

export function FormCLink({ href = "#", children = "Read the Form C" }: { href?: string; children?: ReactNode }) {
  return (
    <Link to={href} className="text-sm font-medium text-gold underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

/** Footer line for any investment-facing page. */
export function RegulatoryFooter() {
  return (
    <p className="text-xs leading-relaxed text-muted">
      FanZuP is a technology platform, not a broker-dealer or investment adviser, and does not give investment advice. Securities
      offerings are made through a FINRA-registered intermediary under Regulation Crowdfunding. Investing in these offerings is
      speculative and illiquid, and you may lose your entire investment.
    </p>
  );
}
