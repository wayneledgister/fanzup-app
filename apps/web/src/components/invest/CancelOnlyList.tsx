/**
 * The flag-off cancel-only list (PR #13 review round 2, finding 2; L2-T-038). With the layer2 flag off, /portfolio and
 * /portfolio/:poolId render only on the server's completion signal (`flags.layer2Completion`, never sent by a deployed
 * server) and show just the investor's OPEN investments — reserved / funding / funded before the cut-off, plus any
 * cancellation still pending — each linking to its cancel-only view at /investments/:id. Nothing else of Layer 2.
 */
import { Link } from "react-router";
import { ArrowRight, PauseCircle } from "lucide-react";
import { Callout, Card, EmptyState } from "@/components/brand";
import { l2, type InvestmentView } from "@/lib/l2";
import { formatUsd } from "@/lib/format";
import { cancelState } from "./l2copy";
import { displayStatus, LoadGate, StatusBadge, useLoad } from "./l2ui";

/** Open investments the investor can still act on or watch while investing is paused. */
export const openForCancelOnly = (list: InvestmentView[]) =>
  list.filter((i) => displayStatus(i) === "cancel_pending" || cancelState(i) === "open");

export function CancelOnlyList({ poolSlug }: { poolSlug?: string }) {
  const load = useLoad(async () => (await l2.investments()).investments.filter((i) => !poolSlug || i.poolSlug === poolSlug), [poolSlug]);
  return (
    <div className="flex flex-col gap-6" data-testid="cancel-only-list">
      <Callout tone="warning" icon={<PauseCircle />} title="Investing is paused">
        New investments are switched off for now. Money already on its way still finishes, and you can still cancel an open investment until its cut-off.
      </Callout>
      <LoadGate load={load} what="your open investments">
        {(all) => {
          const open = openForCancelOnly(all);
          return open.length === 0 ? (
            <EmptyState icon={<PauseCircle />} title="No open investments">Nothing is waiting to be cancelled.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {open.map((i) => (
                <li key={i.id}>
                  <Card className="flex flex-wrap items-center gap-4" data-testid="cancel-only-row" data-status={displayStatus(i)} data-pool={i.poolSlug}>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="font-semibold text-fg">{i.poolTitle}</p>
                      <p className="text-sm text-muted">{i.artistDisplay}</p>
                      <div className="mt-2"><StatusBadge status={displayStatus(i)} /></div>
                    </div>
                    <p className="num text-right text-sm text-muted">{i.units} Unit{i.units === 1 ? "" : "s"} · {formatUsd(i.amountMinor)}</p>
                    <Link to={`/investments/${i.id}`} className="flex items-center gap-1 text-sm font-medium text-fg underline" data-testid="cancel-only-open">
                      View{cancelState(i) === "open" ? " or cancel" : ""} <ArrowRight className="size-4" />
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          );
        }}
      </LoadGate>
    </div>
  );
}
