import { Badge, Card, Container, PageHeader } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { ActionForm, StaffLoadGate } from "@/components/admin/StaffGate";
import { useLoad } from "@/components/invest/l2ui";
import { l2 } from "@/lib/l2";
import { formatInstant } from "@/lib/format";

/**
 * Source: (new) CR-002 FR-L2-INV-002 / ADM — investor KYC/AML manual reviews. Decisions go to the provider party
 * record and the audit log; staff can never decide their own check.
 */
export default function AdminInvestorsPage() {
  return (
    <RequireAccount verified={false}>
      <AdminInvestors />
    </RequireAccount>
  );
}

const TONE: Record<string, "warning" | "success" | "error" | "neutral"> = { manual_review: "warning", approved: "success", rejected: "error", pending: "warning", not_started: "neutral" };

function AdminInvestors() {
  const load = useLoad(() => l2.staffInvestors(), []);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Layer 2 · staff" title="Investor identity checks" description="Manual reviews come from the provider's AML screening. Approve only with a documented reason." />
      <StaffLoadGate load={load} what="investors">
        {({ investors }) => (
          <Card padded={false} className="divide-y divide-line" data-testid="staff-investors">
            {investors.map((i) => (
              <div key={i.userId} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 font-medium text-fg">{i.name}</span>
                  <Badge tone={TONE[i.kycStatus] ?? "neutral"}>{i.kycStatus.replace("_", " ")}</Badge>
                  <span className="text-sm text-muted">{i.state ?? "—"} · {i.accredited ? "accredited" : i.certified ? "limit set" : "no attestation"}</span>
                  <span className="num text-xs text-muted">{formatInstant(i.updatedAt)}</span>
                </div>
                {i.kycStatus === "manual_review" && (
                  <div className="flex flex-col gap-2">
                    <ActionForm label="Approve" testId={`kyc-approve-${i.userId}`} run={(r) => l2.decideKyc(i.userId, "approved", r).then((x) => (load.reload(), x))} />
                    <ActionForm label="Reject" tone="secondary" run={(r) => l2.decideKyc(i.userId, "rejected", r).then((x) => (load.reload(), x))} />
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </StaffLoadGate>
    </Container>
  );
}
