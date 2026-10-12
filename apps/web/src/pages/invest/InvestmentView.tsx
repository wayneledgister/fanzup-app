import { Link, useParams } from "react-router";
import { ArrowLeft, PauseCircle } from "lucide-react";
import { Callout, Container, PageHeader, RegulatoryFooter } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { LoadGate, useLoad } from "@/components/invest/l2ui";
import { useFlag } from "@/lib/flags";
import { l2 } from "@/lib/l2";
import { Holding } from "./HoldingDetail";

/**
 * Source: (new) CR-002 L2-T-038 (design §2, round 5 finding 3) — one investment by id, from GET /investments/:id, a
 * completion route that answers with the layer2 flag off. With the server flag on this is the full holding; with it
 * off (the route renders only on the server's `flags.layer2Completion` signal, which a deployed server never sends) it
 * is a cancel-only view: status, amount and the cancel right while it lasts — linked from, and back to, the cancel-only
 * list at /portfolio (also a completion route; review round 2, finding 2), never into the closed Layer 2 pages.
 */
export default function InvestmentViewPage() {
  return (
    <RequireAccount verified={false}>
      <InvestmentView />
    </RequireAccount>
  );
}

function InvestmentView() {
  const { id = "" } = useParams();
  const flagOn = useFlag("layer2");
  const load = useLoad(() => l2.investment(id), [id]);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <Link to="/portfolio" className="flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> {flagOn ? "Portfolio" : "Open investments"}</Link>
      <LoadGate load={load} what="this investment">
        {(i) => (
          <>
            <PageHeader eyebrow={i.artistDisplay} title={i.poolTitle} description={flagOn ? undefined : "Your investment"} />
            {!flagOn && (
              <Callout tone="warning" icon={<PauseCircle />} title="Investing is paused">
                <span data-testid="cancel-only-view">
                  New investments are switched off for now. Money already on its way still finishes, and you can still cancel an open investment until its cut-off.
                </span>
              </Callout>
            )}
            <Holding i={i} onChange={load.reload} cancelOnly={!flagOn} />
          </>
        )}
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}
