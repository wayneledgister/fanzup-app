/**
 * The investor's cancellation right (17 CFR 227.304(a); FR-L2-INV-004; L2-T-031, L2-T-043). Shown whenever the API
 * says the investment can still be cancelled (`canCancelUntil` set) — whatever its status — and answered with
 * `{ result: 'cancelled' | 'cancel_pending' }`. Works with the layer2 flag off (a completion route, L2-T-038).
 */
import { useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { POLICY } from "@fanzup/shared/policy";
import { Button, Callout } from "@/components/brand";
import { l2, l2ErrorCopy, type InvestmentView } from "@/lib/l2";
import { formatInstant } from "@/lib/format";

export const CANNOT_CANCEL_LINE = `Can't be cancelled — within ${POLICY.l2.cancelCutoffHours} hours of the deadline`;

/** True once the cancel-by instant has passed for an investment that would otherwise still be open. */
export function pastCancelBy(i: Pick<InvestmentView, "cancelBy">, now = Date.now()) {
  return !!i.cancelBy && new Date(i.cancelBy).getTime() <= now;
}

export function CancelInvestment({ i, onDone }: { i: InvestmentView; onDone: (next: InvestmentView, result: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; body: string } | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  if (!i.canCancelUntil) return null;
  const moneyMoved = i.status === "funded" || i.status === "funding";
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await l2.cancel(i.id);
      setConfirming(false);
      onDone(r.investment, r.result);
    } catch (e) {
      const c = l2ErrorCopy(e);
      setErr({ title: c.title, body: c.body });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="cancel-investment">
      <p className="text-sm text-muted">
        You can cancel until <span className="num text-fg" data-testid="cancel-until">{formatInstant(i.canCancelUntil)}</span>
        {moneyMoved ? " and get a full refund." : "."}
      </p>
      {!confirming ? (
        <Button
          variant="secondary"
          onClick={() => {
            setConfirming(true);
            setTimeout(() => yesRef.current?.focus(), 0);
          }}
          data-testid="cancel-start"
        >
          <Undo2 /> Cancel this investment
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-line p-3" role="group" aria-labelledby={`cancel-q-${i.id}`}>
          <p id={`cancel-q-${i.id}`} className="text-sm text-fg">
            Cancel {i.units} Unit{i.units === 1 ? "" : "s"} in {i.poolTitle}? {moneyMoved ? "Your payment is refunded in full." : "If any payment was taken, it's refunded in full."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button ref={yesRef} onClick={go} disabled={busy} data-testid="cancel-confirm">{busy ? "Cancelling…" : "Yes, cancel"}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep it</Button>
          </div>
        </div>
      )}
      {err && <Callout tone="error" title={err.title}>{err.body}</Callout>}
    </div>
  );
}

/** What happened after a cancel, in one sentence (Brand §7). */
export function cancelOutcome(result: string, i: InvestmentView): string {
  if (result === "cancel_pending") {
    return i.status === "reserved"
      ? "Cancellation received — if any payment was taken, we'll refund it in full as soon as it arrives."
      : "Cancellation received — we'll refund your payment in full as soon as it arrives.";
  }
  if (i.status === "refund_pending" || i.status === "refunded") return "Cancelled. Your refund from escrow has started, for the full amount.";
  return "Cancelled. Nothing was charged.";
}
