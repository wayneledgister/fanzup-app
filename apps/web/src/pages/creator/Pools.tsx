import { Link } from "react-router";
import { ArrowRight, Disc3, Plus } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, PageHeader, ProgressBar } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { LoadGate, POOL_STATUS_COPY, RiskBadgeChip, useLoad } from "@/components/invest/l2ui";
import { ApiError } from "@/lib/api";
import { l2 } from "@/lib/l2";
import { formatMoney } from "@/lib/format";

/**
 * Source: (new) CR-002 FR-L2-CR-001 — the creator's album royalty Pools. A separate Layer 2 path, never mixed into
 * the reward-campaign list (CONSOLIDATION "Rebuild · Gate"). Rising tier and above only.
 */
export default function PoolsPage() {
  return (
    <RequireAccount>
      <Pools />
    </RequireAccount>
  );
}

function Pools() {
  const load = useLoad(() => l2.creatorPools(), []);
  return (
    <Container size="xl" className="flex flex-col gap-8 py-8 sm:py-10">
      <PageHeader
        eyebrow="Revenue-share Pools"
        title="Album royalty Pools"
        description="Offer fans a share of an album's royalties in exchange for Units. Each Pool is a Reg CF offering: Form C review, escrow, and target-or-refund."
        actions={
          <Button asChild>
            <Link to="/creator/pools/new" data-testid="new-pool"><Plus /> New album Pool</Link>
          </Button>
        }
      />
      <LoadGate load={{ ...load, s: load.s.state === "error" && (load.s.error as ApiError).code === "no_artist" ? { state: "ready", data: { pools: [] } } : load.s }} what="your Pools">
        {({ pools }) =>
          pools.length === 0 ? (
            <EmptyState icon={<Disc3 />} title="No Pools yet" action={<Button asChild><Link to="/creator/pools/new">Start an album Pool <ArrowRight /></Link></Button>}>
              Pools open at Rising tier. You'll set the royalty terms, how royalties are collected, and production milestones.
            </EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2" data-testid="creator-pools">
              {pools.map((p) => (
                <li key={p.id}>
                  <Card interactive className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <ArtistArt seed={p.slug} label={p.title} rounded="md" className="size-14 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <Link to={`/creator/pools/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Badge tone={p.status === "live" ? "gold" : p.status === "funded" ? "success" : "neutral"}>{POOL_STATUS_COPY[p.status]}</Badge>
                          <RiskBadgeChip badge={p.riskBadge} />
                        </div>
                      </div>
                    </div>
                    {["live", "funded", "matured"].includes(p.status) && (
                      <>
                        <ProgressBar value={p.raisedMinor} max={p.targetMinor} tone="info" label="Raised vs target" />
                        <p className="text-sm text-muted"><span className="num text-fg">{formatMoney(p.raisedMinor)}</span> of <span className="num">{formatMoney(p.targetMinor)}</span> · <span className="num">{p.investors}</span> investors</p>
                      </>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </LoadGate>
      <Callout tone="info" title="Demo">Pools run on a mock escrow provider in this build. Nothing here is a real offering.</Callout>
    </Container>
  );
}
