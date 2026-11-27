/**
 * Standard disclosure blocks. Copy here is the single source for regulated language —
 * pages must use these components rather than writing their own risk/escrow text.
 * Sources: Brand §7.3–§7.4, PRD 01 §6.5 / §11, Mechanism 05 §2, Mechanism 07 §1.
 * Copy is product guidance pending counsel review — not legal advice.
 */
import { FlaskConical, Lock, ShieldCheck, TriangleAlert, Hourglass } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { Callout } from "./primitives";
import { formatDate, parseDate } from "@/lib/format";
import { REFUND_PROMISE, TEST_MODE_NOTICE } from "@fanzup/shared/backing-copy";
import { useConfig } from "@/lib/config";

/**
 * Layer 1 reward campaigns ("Fund My Show", Mechanism 05): the refund promise.
 * FR-PLT-006: while no custodian is live (E1 card B), no screen names one or says "escrow"; the promise is
 * stated as "if the goal isn't met by the deadline, every backer is refunded in full". (The component keeps its
 * old name so every page picks up the new wording.)
 */
export function EscrowNotice({ compact = false }: { compact?: boolean }) {
  return (
    <Callout tone="gold" icon={<ShieldCheck />} title={REFUND_PROMISE.title}>
      {compact ? REFUND_PROMISE.compact : REFUND_PROMISE.full}
    </Callout>
  );
}

/**
 * FR-PLT-006: persistent test-money notice on every money surface while the payment provider is in test mode.
 */
export function TestModeNotice({ className }: { className?: string }) {
  const cfg = useConfig();
  // Shown until the API confirms live mode — which FR-PAY-008 refuses in M1 — so it never flickers off wrongly.
  if (cfg && !cfg.testMode) return null;
  return (
    <Callout tone="warning" icon={<FlaskConical />} title={TEST_MODE_NOTICE.title} className={className}>
      {TEST_MODE_NOTICE.intro}{" "}
      {cfg?.provider === "stripe-test" ? (
        <>Pay with the test card <span className="num">{TEST_MODE_NOTICE.stripeTestCard}</span> {TEST_MODE_NOTICE.stripeTestCardHint}.</>
      ) : (
        <>Pay with a test card.</>
      )}{" "}
      {TEST_MODE_NOTICE.closing}
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
        <li>A Regulation Crowdfunding offering must be made through an intermediary registered with the SEC. None has been chosen yet (Intermediary: pending — L2-Q3), so this demo isn't an offer. Read the Form C before investing.</li>
      </ul>
    </Callout>
  );
}

/** Per-holding lock-up state — Mechanism 07 P0 (Beta). */
export function LockupNotice({ unlocksOn }: { unlocksOn: string }) {
  const locked = parseDate(unlocksOn) > new Date();
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
      FanZuP is a technology platform, not a broker-dealer, funding portal or investment adviser, and does not give investment advice.
      Regulation Crowdfunding offerings must be made through an intermediary registered with the SEC; none has been chosen yet (L2-Q3). Investing in
      these offerings is speculative and illiquid, and you may lose your entire investment.
    </p>
  );
}
