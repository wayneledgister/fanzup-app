import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CircleAlert, Inbox, Mail, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, Card, Container, EmptyState, PageHeader } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { MKT_OFF_PLATFORM_NOTICE, categoryLabel, requestStatusCopy, type ServiceRequestView } from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-005 MKT-1, FR-MKT-010. The artist's service requests, the provider's answer, and the provider's
 * contact once they accept (NFR-MKT-04). An open request can be withdrawn.
 */
export default function MyServiceRequestsPage() {
  return (
    <RequireAccount>
      <MyServiceRequests />
    </RequireAccount>
  );
}

export const toneOf = (s: ServiceRequestView["status"]) => {
  const t = requestStatusCopy(s).tone;
  return t === "muted" ? "neutral" : t;
};

function MyServiceRequests() {
  const [items, setItems] = useState<ServiceRequestView[] | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    api.myServiceRequests().then((r) => setItems(r.items)).catch(() => setError(true));
  };
  useEffect(load, []);
  const withdraw = async (id: string) => {
    const r = await api.withdrawServiceRequest(id).catch(() => null);
    if (r) setItems((xs) => xs?.map((x) => (x.id === id ? r : x)) ?? null);
  };

  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Services" title="Your service requests" description={MKT_OFF_PLATFORM_NOTICE} />
      {error && (
        <Callout tone="error" icon={<CircleAlert />} title="We couldn't load your requests">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw /> Retry</Button>
        </Callout>
      )}
      {!items && !error && <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading your requests" />}
      {items && items.length === 0 && (
        <EmptyState icon={<Inbox />} title="No requests yet" action={<Button asChild><Link to="/services">Find services <ArrowRight /></Link></Button>}>
          When you ask a provider for help, the request and their answer show up here.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-4" data-testid="my-service-requests">
          {items.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/services/${r.provider.slug}`} className="font-semibold hover:underline">{r.listing.title}</Link>
                    <p className="text-sm text-muted">
                      {r.provider.displayName} · {categoryLabel(r.listing.category)} · sent <span className="num">{formatDate(r.createdAt.slice(0, 10))}</span>
                      {r.campaign && <> · for {r.campaign.title}</>}
                    </p>
                  </div>
                  <Badge tone={toneOf(r.status)}>{requestStatusCopy(r.status).label}</Badge>
                </div>
                <p className="line-clamp-3 whitespace-pre-line text-sm">{r.brief}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  {r.budgetMinor != null && <span>Budget <span className="num text-fg">{formatMoney(r.budgetMinor)}</span></span>}
                  {r.neededBy && <span>Needed by <span className="num text-fg">{formatDate(r.neededBy)}</span></span>}
                </div>
                {r.providerNote && <Callout tone={r.status === "accepted" ? "success" : "info"} title={`${r.provider.displayName} wrote`}>{r.providerNote}</Callout>}
                {r.providerContactEmail && (
                  <a href={`mailto:${r.providerContactEmail}`} className="inline-flex items-center gap-2 self-start text-sm text-gold underline-offset-4 hover:underline">
                    <Mail className="size-4" aria-hidden /> {r.providerContactEmail}
                  </a>
                )}
                {r.status === "sent" && <Button variant="ghost" size="sm" className="self-start" onClick={() => withdraw(r.id)}>Withdraw request</Button>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
