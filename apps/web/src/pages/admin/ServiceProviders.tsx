import { useState } from "react";
import { Badge, Button, Card, Container, Field, PageHeader, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { ActionForm, StaffLoadGate } from "@/components/admin/StaffGate";
import { useLoad } from "@/components/invest/l2ui";
import { api } from "@/lib/api";
import { categoryLabel, priceFromLabel, type ProviderPage } from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-005 MKT-1, FR-MKT-008. Staff vet providers before artists see them: list, request changes or
 * suspend. Each decision is a privileged action (aal2, typed reason, audit); staff can't vet their own profile.
 */
export default function AdminServiceProvidersPage() {
  return (
    <RequireAccount verified={false}>
      <AdminServiceProviders />
    </RequireAccount>
  );
}

type QueueItem = ProviderPage & { id: string; status: string; reviewNote: string | null; submittedAt: string | null; version: string };
const STATUSES = ["in_review", "listed", "changes_requested", "suspended"] as const;

function AdminServiceProviders() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("in_review");
  const load = useLoad(() => api.request<{ items: QueueItem[] }>(`/v1/staff/marketplace/providers?status=${status}`), [status]);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Services marketplace · staff" title="Service providers" description="Check the profile and portfolio links are real and the provider's own work before listing." />
      <div className="flex flex-wrap gap-2" role="tablist">
        {STATUSES.map((s) => (
          <Button key={s} size="sm" variant={s === status ? "primary" : "secondary"} role="tab" aria-selected={s === status} onClick={() => setStatus(s)}>{s.replace("_", " ")}</Button>
        ))}
      </div>
      <StaffLoadGate load={load} what="providers">
        {({ items }) => (
          <Card padded={false} className="divide-y divide-line" data-testid="staff-providers">
            {items.length === 0 && <p className="p-4 text-sm text-muted">Nothing here.</p>}
            {items.map((p) => <ProviderRow key={p.id} p={p} reload={load.reload} />)}
          </Card>
        )}
      </StaffLoadGate>
    </Container>
  );
}

function ProviderRow({ p, reload }: { p: QueueItem; reload: () => void }) {
  const [note, setNote] = useState("");
  const decide = (decision: "listed" | "changes_requested" | "suspended") => (reason: string) =>
    api.request(`/v1/staff/marketplace/providers/${p.id}/review`, { method: "POST", body: JSON.stringify({ decision, note: note.trim() || null, reason, version: p.version }) }).then((x) => (reload(), x));
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 font-medium text-fg">{p.displayName} <span className="text-muted">/{p.slug}</span></span>
        <Badge>{p.status.replace("_", " ")}</Badge>
      </div>
      <p className="text-sm">{p.headline}</p>
      {p.bio && <p className="whitespace-pre-line text-sm text-muted">{p.bio}</p>}
      <p className="text-sm text-muted">{p.categories.map(categoryLabel).join(" · ")} · {p.remoteOk ? "remote" : "in person"}{p.city ? ` · ${p.city}` : ""}</p>
      {p.links.length > 0 && <ul className="text-sm">{p.links.map((l) => <li key={l}><a className="text-gold underline-offset-4 hover:underline" href={l} target="_blank" rel="noopener noreferrer nofollow">{l}</a></li>)}</ul>}
      <ul className="text-sm text-muted">{p.listings.map((l) => <li key={l.id}>{l.title} · {priceFromLabel(l.priceFromMinor, l.priceUnit)}{l.active ? "" : " (hidden)"}</li>)}</ul>
      {p.status !== "suspended" && (
        <div className="flex flex-col gap-2">
          <Field label="Note to the provider (needed to request changes or suspend)" htmlFor={`note-${p.id}`}><TextInput id={`note-${p.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          {p.status === "in_review" && <ActionForm label="List provider" testId={`list-${p.id}`} run={decide("listed")} />}
          {p.status === "in_review" && <ActionForm label="Request changes" tone="secondary" testId={`changes-${p.id}`} run={decide("changes_requested")} />}
          <ActionForm label="Suspend" tone="secondary" testId={`suspend-${p.id}`} run={decide("suspended")} />
        </div>
      )}
    </div>
  );
}
