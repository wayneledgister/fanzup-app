import { Link } from "react-router";
import { ArrowRight, Inbox } from "lucide-react";
import { Badge, Card, Container, EmptyState, PageHeader, SectionHeading } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { StaffLoadGate } from "@/components/admin/StaffGate";
import { POOL_STATUS_COPY, RiskBadgeChip, useLoad } from "@/components/invest/l2ui";
import { l2 } from "@/lib/l2";
import { formatInstant, formatUsd } from "@/lib/format";

/**
 * Source: (new) CR-002 FR-L2-ADM — the Layer 2 staff worklist (Form C reviews, collection agreements to execute, KYC
 * manual reviews, milestone verifications, distributions due, breaks, failed provider operations) and every Pool, plus
 * the Layer 2 rows of the M1 staff queue: `pool_dead_letters` (replay with `pool_op.replay`, L2-T-046) and
 * `pool_breaks` (staff-resolved kinds closed with `pool_break.resolve`, L2-T-056). All of it answers with the layer2
 * flag off (design §9): money already owed is a completion path.
 */
const TYPE: Record<string, { label: string; tone: "warning" | "info" | "error" | "gold" | "neutral" }> = {
  form_c_review: { label: "Form C review", tone: "gold" },
  collection_execute: { label: "Execute collection", tone: "info" },
  kyc_review: { label: "KYC review", tone: "warning" },
  milestone_verification: { label: "Milestone", tone: "info" },
  distribution_due: { label: "Distribution due", tone: "gold" },
  break: { label: "Break", tone: "error" },
  op_failed: { label: "Provider op failed", tone: "error" },
  pool_dead_letters: { label: "Op needs replay", tone: "error" },
  pool_breaks: { label: "Pool break", tone: "error" },
};

export default function AdminPoolsPage() {
  return (
    <RequireAccount verified={false}>
      <AdminPools />
    </RequireAccount>
  );
}

function AdminPools() {
  const load = useLoad(async () => {
    const [q, pools, dead, breaks] = await Promise.all([l2.staffQueue(), l2.staffPools(), l2.staffM1Queue("pool_dead_letters"), l2.staffM1Queue("pool_breaks")]);
    return { q, pools, money: [...dead.items, ...breaks.items] };
  }, []);
  return (
    <Container size="xl" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Layer 2 · staff" title="Pools" description="Every action asks for a reason and goes in the audit log. Money actions wait out the single-operator delay." />
      <StaffLoadGate load={load} what="the Pool queue">
        {({ q, pools, money }) => (
          <>
            <section>
              <SectionHeading eyebrow="Money owed" title="Operations and breaks" />
              {money.length === 0 ? (
                <p className="text-sm text-muted" data-testid="staff-money-queue-empty">No Pool operation needs a replay and no break is open.</p>
              ) : (
                <Card padded={false} className="divide-y divide-line" data-testid="staff-money-queue">
                  {money.map((i) => (
                    <Link key={`${i.type}:${i.id}`} to={i.subjectId ? `/admin/pools/${i.subjectId}` : "/admin/pools"} className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-2" data-testid="money-queue-row" data-type={i.type}>
                      <Badge tone={TYPE[i.type]?.tone ?? "neutral"}>{TYPE[i.type]?.label ?? i.type}</Badge>
                      <span className="min-w-0 flex-1 text-fg">{i.summary.replaceAll("_", " ")}</span>
                      <span className="num text-xs text-muted">{Math.round(i.ageSeconds / 60)} min</span>
                      <ArrowRight className="size-4 text-muted" aria-hidden />
                    </Link>
                  ))}
                </Card>
              )}
            </section>
            <section>
              <SectionHeading eyebrow="Worklist" title="Needs attention" />
              {q.items.length === 0 ? (
                <EmptyState icon={<Inbox />} title="Nothing waiting" />
              ) : (
                <Card padded={false} className="divide-y divide-line" data-testid="staff-queue">
                  {q.items.map((i) => (
                    <Link key={`${i.type}:${i.id}`} to={i.type === "kyc_review" ? "/admin/investors" : `/admin/pools/${i.poolId}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-2">
                      <Badge tone={TYPE[i.type]?.tone ?? "neutral"}>{TYPE[i.type]?.label ?? i.type}</Badge>
                      <span className="min-w-0 flex-1 text-fg">{i.summary}</span>
                      <span className="num text-xs text-muted">{formatInstant(i.createdAt)}</span>
                      <ArrowRight className="size-4 text-muted" />
                    </Link>
                  ))}
                </Card>
              )}
            </section>
            <section>
              <SectionHeading eyebrow="All" title="Pools" />
              <Card padded={false} className="divide-y divide-line">
                {pools.pools.map((p) => (
                  <Link key={p.id} to={`/admin/pools/${p.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-2" data-testid="staff-pool-row">
                    <span className="min-w-0 flex-1"><span className="font-medium text-fg">{p.title}</span> <span className="text-muted">· {p.artistDisplay}</span></span>
                    <RiskBadgeChip badge={p.riskBadge} />
                    <Badge tone="neutral">{POOL_STATUS_COPY[p.status]}</Badge>
                    <span className="num text-sm text-muted">{formatUsd(p.raisedMinor)} / {formatUsd(p.targetMinor)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          </>
        )}
      </StaffLoadGate>
    </Container>
  );
}
