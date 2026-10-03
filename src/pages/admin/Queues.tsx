import { Link } from "react-router";
import { ArrowRight, ClipboardCheck, Clock, Fingerprint, MessageSquareWarning, RotateCcw } from "lucide-react";
import { Badge, Card, Container, IconChip, PageHeader, SectionHeading } from "@/components/brand";
import { useSubmissions } from "@/components/campaign/ReviewWorkspace";
import { IDENTITY, DISPUTES, REFUNDS } from "@/components/campaign/identityData";
import { formatAge, slaState, type SlaState } from "@/components/campaign/reviewData";
import { useFlag } from "@/lib/flags";
import { cn } from "@/lib/utils";

/**
 * Source: (new) queue index — PRD 01 FR-ADMIN, PRD 03.
 * Four queues with open counts and SLA age. SLA targets are internal goals, shown as estimates.
 * Disputes and Refunds show a summary only; their full queue tooling isn't specced yet (CONSOLIDATION.md).
 */

type Item = { id: string; subject: string; openedAt: string };
const SLA_TONE: Record<SlaState, "neutral" | "warning" | "error"> = { ok: "neutral", risk: "warning", breach: "error" };
const SLA_TEXT: Record<SlaState, string> = { ok: "Within SLA", risk: "At risk", breach: "Breached" };

export default function Queues() {
  const subs = useSubmissions();
  const layer2 = useFlag("layer2");

  const queues: { key: string; title: string; icon: React.ReactNode; to?: string; slaH: number; slaLabel: string; items: Item[] }[] = [
    {
      key: "campaign",
      title: "Campaign review",
      icon: <ClipboardCheck />,
      to: "/admin/review/under-review",
      slaH: 48,
      slaLabel: "2 business days",
      items: subs.filter((s) => s.status === "under-review").map((s) => ({ id: s.id, subject: `${s.view.title} — ${s.artist.name}`, openedAt: s.submittedAt })),
    },
    {
      key: "identity",
      title: "Identity review",
      icon: <Fingerprint />,
      to: "/admin/kyc",
      slaH: 24,
      slaLabel: "1 business day",
      items: IDENTITY.filter((c) => (layer2 || !c.layer2) && (c.status === "needs-review" || c.status === "escalated")).map((c) => ({ id: c.id, subject: `${c.name} — ${c.role}`, openedAt: c.submittedAt })),
    },
    { key: "disputes", title: "Disputes", icon: <MessageSquareWarning />, slaH: 72, slaLabel: "3 business days", items: DISPUTES },
    { key: "refunds", title: "Refunds", icon: <RotateCcw />, slaH: 24, slaLabel: "1 business day", items: REFUNDS },
  ];

  const attention = queues
    .flatMap((q) => q.items.map((i) => ({ ...i, queue: q.title, to: q.to, sla: slaState(i.openedAt, q.slaH) })))
    .filter((i) => i.sla !== "ok")
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));

  return (
    <Container size="xl" className="py-8">
      <PageHeader eyebrow="Compliance" title="Queues" description="Everything waiting on a human decision, oldest first. SLA targets are internal goals." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {queues.map((q) => {
          const oldest = [...q.items].sort((a, b) => a.openedAt.localeCompare(b.openedAt))[0];
          const breached = q.items.filter((i) => slaState(i.openedAt, q.slaH) === "breach").length;
          const risk = q.items.filter((i) => slaState(i.openedAt, q.slaH) === "risk").length;
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <IconChip>{q.icon}</IconChip>
                {breached > 0 ? (
                  <Badge tone="error">
                    <span className="num">{breached}</span>&nbsp;breached
                  </Badge>
                ) : risk > 0 ? (
                  <Badge tone="warning">
                    <span className="num">{risk}</span>&nbsp;at risk
                  </Badge>
                ) : (
                  <Badge tone="neutral">On track</Badge>
                )}
              </div>
              <div>
                <p className="text-sm text-muted">{q.title}</p>
                <p className="num text-4xl font-medium text-fg">{q.items.length}</p>
                <p className="text-sm text-muted">open</p>
              </div>
              <div className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
                <span className="flex items-center justify-between">
                  Oldest <span className="num text-fg">{oldest ? formatAge(oldest.openedAt) : "—"}</span>
                </span>
                <span className="flex items-center justify-between">
                  SLA target <span>{q.slaLabel}</span>
                </span>
              </div>
              {q.to ? (
                <span className="flex items-center gap-1 text-sm font-medium text-gold">
                  Open queue <ArrowRight className="size-4" />
                </span>
              ) : (
                <span className="text-xs text-muted">Summary only — queue view not built yet</span>
              )}
            </>
          );
          return q.to ? (
            <Card key={q.key} interactive padded={false}>
              <Link to={q.to} className="flex h-full flex-col gap-4 p-5">
                {body}
              </Link>
            </Card>
          ) : (
            <Card key={q.key} className="flex flex-col gap-4 p-5">
              {body}
            </Card>
          );
        })}
      </div>

      <section className="mt-12">
        <SectionHeading eyebrow="SLA" title="Needs attention" />
        {attention.length === 0 ? (
          <Card className="text-sm text-muted">Every open item is within its SLA.</Card>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">Items at risk of or past their SLA</caption>
                <thead className="bg-surface-2 text-left text-xs text-muted">
                  <tr>
                    {["Reference", "Item", "Queue", "Age", "SLA"].map((h) => (
                      <th key={h} scope="col" className={cn("px-4 py-3 font-medium", h === "Age" && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attention.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="num px-4 py-3 text-muted">
                        {i.to ? (
                          <Link to={`${i.to}?id=${i.id}`} className="text-gold hover:underline">
                            {i.id}
                          </Link>
                        ) : (
                          i.id
                        )}
                      </td>
                      <td className="px-4 py-3 text-fg">{i.subject}</td>
                      <td className="px-4 py-3 text-muted">{i.queue}</td>
                      <td className="num px-4 py-3 text-right text-fg">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5 text-muted" />
                          {formatAge(i.openedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={SLA_TONE[i.sla]}>{SLA_TEXT[i.sla]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <p className="mt-3 text-xs text-muted">
          Ages count calendar hours since submission. Business-day SLA math lands with the review service.
        </p>
      </section>
    </Container>
  );
}
