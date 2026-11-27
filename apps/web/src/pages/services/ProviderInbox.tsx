import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CircleAlert, Inbox, Mail, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, Card, Container, EmptyState, Field, PageHeader, TextArea } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { MKT_OFF_PLATFORM_NOTICE, categoryLabel, requestStatusCopy, type ServiceRequestView } from "@fanzup/shared/marketplace";
import { toneOf } from "./MyRequests";

/**
 * Source: (new) CR-005 MKT-1, FR-MKT-009. Requests artists sent this provider. Accept or decline once, with a note.
 * The artist's email appears only after accepting, and only if the artist chose to share it (NFR-MKT-04).
 */
export default function ProviderInboxPage() {
  return (
    <RequireAccount>
      <ProviderInbox />
    </RequireAccount>
  );
}

function ProviderInbox() {
  const [items, setItems] = useState<ServiceRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    api.providerRequests().then((r) => setItems(r.items)).catch((e) => setError(e instanceof ApiError && e.code === "no_provider" ? "no_provider" : "load"));
  };
  useEffect(load, []);

  if (error === "no_provider") {
    return (
      <Container size="md" className="py-16">
        <EmptyState icon={<Inbox />} title="No provider profile yet" action={<Button asChild><Link to="/provider">Create your profile</Link></Button>}>
          Set up your provider profile to receive requests from artists.
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Services marketplace" title="Requests from artists" description={MKT_OFF_PLATFORM_NOTICE} />
      {error && (
        <Callout tone="error" icon={<CircleAlert />} title="We couldn't load your requests">
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw /> Retry</Button>
        </Callout>
      )}
      {!items && !error && <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading requests" />}
      {items && items.length === 0 && <EmptyState icon={<Inbox />} title="No requests yet">Once you're listed, requests from artists show up here.</EmptyState>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((r) => <RequestRow key={r.id} r={r} onChange={(x) => setItems((xs) => xs?.map((y) => (y.id === x.id ? x : y)) ?? null)} />)}
        </ul>
      )}
    </Container>
  );
}

function RequestRow({ r, onChange }: { r: ServiceRequestView; onChange: (r: ServiceRequestView) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const respond = async (decision: "accepted" | "declined") => {
    setBusy(true);
    setErr(null);
    try {
      onChange(await api.respondServiceRequest(r.id, { decision, note: note.trim() || null }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "We couldn't send your answer. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{r.artist.name}: {r.listing.title}</p>
            <p className="text-sm text-muted">
              {categoryLabel(r.listing.category)} · received <span className="num">{formatDate(r.createdAt.slice(0, 10))}</span>
              {r.campaign && <> · for the campaign {r.campaign.title}</>}
            </p>
          </div>
          <Badge tone={toneOf(r.status)}>{requestStatusCopy(r.status).label}</Badge>
        </div>
        <p className="whitespace-pre-line text-sm">{r.brief}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {r.budgetMinor != null && <span>Budget <span className="num text-fg">{formatMoney(r.budgetMinor)}</span></span>}
          {r.neededBy && <span>Needed by <span className="num text-fg">{formatDate(r.neededBy)}</span></span>}
        </div>
        {r.status === "accepted" && (
          r.requesterEmail
            ? <a href={`mailto:${r.requesterEmail}`} className="inline-flex items-center gap-2 self-start text-sm text-gold underline-offset-4 hover:underline"><Mail className="size-4" aria-hidden /> {r.requesterEmail}</a>
            : <p className="text-sm text-muted">The artist didn't share their email. They have your contact email and will reach out.</p>
        )}
        {r.providerNote && r.status !== "sent" && <p className="text-sm text-muted">Your note: {r.providerNote}</p>}
        {r.status === "sent" && (
          <div className="flex flex-col gap-3">
            <Field label="Note to the artist" htmlFor={`note-${r.id}`} optional>
              <TextArea id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-20" />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => respond("accepted")} disabled={busy}>Accept</Button>
              <Button variant="secondary" onClick={() => respond("declined")} disabled={busy}>Decline</Button>
            </div>
          </div>
        )}
        {err && <p className="text-sm text-error" role="alert">{err}</p>}
      </Card>
    </li>
  );
}
