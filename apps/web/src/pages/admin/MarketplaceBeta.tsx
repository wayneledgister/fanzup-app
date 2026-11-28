import { useState } from "react";
import { Link } from "react-router";
import { Check, Copy, Link2 } from "lucide-react";
import { Badge, Button, Callout, Card, Container, Field, PageHeader, SectionHeading, Select, Stat, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { ActionForm, StaffLoadGate } from "@/components/admin/StaffGate";
import { useLoad } from "@/components/invest/l2ui";
import { api } from "@/lib/api";
import { refreshMarketplaceAccess, useMarketplaceAccess } from "@/lib/marketplace";
import { formatInstant } from "@/lib/format";
import {
  AUDIENCES, audienceLabel, categoryLabel, InviteInput, type Audience, type InviteView, type MarketplaceMetrics, type MemberKind, type MemberView,
} from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-007, FR-MKT-021/022/027/028/029. The closed beta's control room: who's in (audience), invites
 * (the link is shown once), members, and the discovery E1/E2 numbers. Every change is a privileged action (aal2,
 * typed reason, audit). No money (NFR-MKT-01).
 */
export default function AdminMarketplaceBetaPage() {
  return (
    <RequireAccount verified={false}>
      <MarketplaceBeta />
    </RequireAccount>
  );
}

function MarketplaceBeta() {
  const metrics = useLoad(() => api.staffMarketplaceMetrics(), []);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader
        eyebrow="Services marketplace · staff"
        title="Marketplace beta"
        description="Invite providers and artists, decide who can use the marketplace, and watch how the beta is going."
        actions={<Button asChild variant="secondary"><Link to="/admin/providers">Vet providers</Link></Button>}
      />
      <StaffLoadGate load={metrics} what="the beta numbers">
        {(m) => (
          <>
            <Metrics m={m} />
            <AudienceCard />
            <Invites onChange={metrics.reload} />
            <Members onChange={metrics.reload} />
          </>
        )}
      </StaffLoadGate>
    </Container>
  );
}

function Metrics({ m }: { m: MarketplaceMetrics }) {
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  return (
    <section className="flex flex-col gap-4" aria-label="Beta numbers">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="beta-metrics">
        <Stat label="Providers listed" value={m.providers.listed} hint={`${m.providers.in_review} in review`} accent />
        <Stat label="Members" value={m.members.provider + m.members.artist} hint={`${m.members.provider} providers · ${m.members.artist} artists`} />
        <Stat label="Requests (7 days)" value={m.requestsLast7Days} hint={`${m.requestsLast30Days} in 30 days`} />
        <Stat label="Accepted" value={pct(m.acceptanceRate)} hint={m.medianResponseHours == null ? "No answers yet" : `Median answer in ${m.medianResponseHours} h`} />
      </div>
      {Object.keys(m.listedByCategory).length > 0 && (
        <p className="text-sm text-muted">Listed by category: {Object.entries(m.listedByCategory).map(([k, v]) => `${categoryLabel(k)} ${v}`).join(" · ")}</p>
      )}
    </section>
  );
}

function AudienceCard() {
  const access = useMarketplaceAccess();
  const [next, setNext] = useState<Audience>("invited");
  const current = access?.audience;
  return (
    <Card className="flex flex-col gap-4">
      <SectionHeading title="Who can use the marketplace" />
      <p className="text-sm">Now: {current ? <Badge>{audienceLabel(current)}</Badge> : "…"}</p>
      <ul className="list-disc pl-5 text-sm text-muted">
        <li><strong className="text-fg">Invited people only:</strong> providers and artists need an invite.</li>
        <li><strong className="text-fg">Invited providers, any signed-in artist:</strong> listing needs an invite; anyone signed in can browse and request.</li>
        <li><strong className="text-fg">Everyone:</strong> anyone can browse; anyone signed in can request or apply as a provider (still vetted).</li>
      </ul>
      <Field label="Change to" htmlFor="aud-next">
        <Select id="aud-next" value={next} onChange={(e) => setNext(e.target.value as Audience)}>
          {AUDIENCES.map((a) => <option key={a} value={a}>{audienceLabel(a)}</option>)}
        </Select>
      </Field>
      <ActionForm label="Change audience" testId="set-audience" run={(reason) => api.staffSetAudience(next, reason).then((r) => (refreshMarketplaceAccess(), r))} />
    </Card>
  );
}

function Invites({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => api.staffMarketplaceInvites(), []);
  const [form, setForm] = useState({ email: "", name: "", kind: "provider" as MemberKind, note: "" });
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (reason: string) => {
    setErr(null);
    const parsed = InviteInput.safeParse({ ...form, name: form.name || null, note: form.note || null, reason });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Check the form.";
      setErr(msg);
      throw new Error(msg);
    }
    const r = await api.staffCreateInvite(parsed.data);
    setLink({ email: r.invite.email, url: `${window.location.origin}/services/join#code=${encodeURIComponent(r.code)}` });
    setCopied(false);
    setForm({ email: "", name: "", kind: form.kind, note: "" });
    list.reload();
    onChange();
    return r;
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="flex flex-col gap-5">
      <SectionHeading title="Invites" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="inv-email" hint="They must sign in with this address to use the invite."><TextInput id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={200} /></Field>
        <Field label="Name" htmlFor="inv-name" optional><TextInput id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></Field>
        <Field label="Invite as" htmlFor="inv-kind">
          <Select id="inv-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MemberKind })}>
            <option value="provider">Provider (can list services and request)</option>
            <option value="artist">Artist (can browse and request)</option>
          </Select>
        </Field>
        <Field label="Note for the team" htmlFor="inv-note" optional><TextInput id="inv-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} /></Field>
      </div>
      {err && <p className="text-sm text-error" role="alert">{err}</p>}
      <ActionForm label="Create invite" testId="create-invite" run={create} />
      {link && (
        <Callout tone="success" icon={<Link2 />} title={`Invite link for ${link.email}`}>
          <p>Copy it now and send it yourself: it's shown only once.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-2 py-1 text-xs text-fg" data-testid="invite-link">{link.url}</code>
            <Button size="sm" variant="secondary" onClick={copy}>{copied ? <><Check /> Copied</> : <><Copy /> Copy link</>}</Button>
          </div>
        </Callout>
      )}
      <StaffLoadGate load={list} what="invites">
        {({ items }) => (
          <div className="divide-y divide-line rounded-lg border border-line" data-testid="invites">
            {items.length === 0 && <p className="p-4 text-sm text-muted">No invites yet.</p>}
            {items.map((i) => <InviteRow key={i.id} i={i} reload={() => (list.reload(), onChange())} />)}
          </div>
        )}
      </StaffLoadGate>
    </Card>
  );
}

const INVITE_TONE = { open: "info", redeemed: "success", revoked: "neutral", expired: "warning" } as const;

function InviteRow({ i, reload }: { i: InviteView; reload: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 break-all text-sm font-medium text-fg">{i.name ? `${i.name} · ` : ""}{i.email}</span>
        <Badge>{i.kind}</Badge>
        <Badge tone={INVITE_TONE[i.status]}>{i.status}</Badge>
      </div>
      <p className="text-xs text-muted">
        Sent {formatInstant(i.createdAt)} · {i.status === "redeemed" && i.redeemedAt ? `joined ${formatInstant(i.redeemedAt)}` : `expires ${formatInstant(i.expiresAt)}`}
        {i.note ? ` · ${i.note}` : ""}
      </p>
      {i.status === "open" && (open
        ? <ActionForm label="Revoke invite" tone="secondary" testId={`revoke-${i.id}`} run={(reason) => api.staffRevokeInvite(i.id, reason).then((r) => (reload(), r))} />
        : <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen(true)}>Revoke…</Button>)}
    </div>
  );
}

function Members({ onChange }: { onChange: () => void }) {
  const list = useLoad(() => api.staffMarketplaceMembers(), []);
  return (
    <Card className="flex flex-col gap-5">
      <SectionHeading title="Members" />
      <StaffLoadGate load={list} what="members">
        {({ items }) => (
          <div className="divide-y divide-line rounded-lg border border-line" data-testid="members">
            {items.length === 0 && <p className="p-4 text-sm text-muted">Nobody has joined yet.</p>}
            {items.map((m) => <MemberRow key={m.userId} m={m} reload={() => (list.reload(), onChange())} />)}
          </div>
        )}
      </StaffLoadGate>
    </Card>
  );
}

function MemberRow({ m, reload }: { m: MemberView; reload: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-sm font-medium text-fg">{m.displayName}</span>
        <Badge>{m.kind}</Badge>
        {m.providerStatus && <Badge tone={m.providerStatus === "listed" ? "success" : "neutral"}>{m.providerStatus.replace("_", " ")}</Badge>}
        {m.removedAt && <Badge tone="warning">removed</Badge>}
      </div>
      <p className="text-xs text-muted">Joined {formatInstant(m.joinedAt)}{m.removedAt ? ` · removed ${formatInstant(m.removedAt)}` : ""}</p>
      {!m.removedAt && (open
        ? (
          <>
            {m.providerStatus === "listed" && <p className="text-xs text-muted">Removing ends their beta access. Their listing stays up until you suspend it on the vetting page.</p>}
            <ActionForm label="Remove from beta" tone="secondary" testId={`remove-${m.userId}`} run={(reason) => api.staffRemoveMember(m.userId, reason).then((r) => (reload(), r))} />
          </>
        )
        : <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen(true)}>Remove…</Button>)}
    </div>
  );
}
