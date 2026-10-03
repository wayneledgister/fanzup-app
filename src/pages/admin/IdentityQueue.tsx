import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowUpRight, Check, CircleHelp, ExternalLink, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Badge, Button, Callout, Card, Container, EmptyState, Field, KeyValue, PageHeader, TextArea, TextInput } from "@/components/brand";
import { AuditLog } from "@/components/campaign/ReviewWorkspace";
import { IDENTITY, ID_STATUS, type CheckResult, type IdStatus, type IdentityCase } from "@/components/campaign/identityData";
import { formatAge, slaState } from "@/components/campaign/reviewData";
import { useFlag } from "@/lib/flags";
import { cn } from "@/lib/utils";

/**
 * Source: (new) KYC/AML queue per PRD 01 FR-ADMIN and PRD 03 (trust & safety).
 * Layer 1 shows artist verification only; investor KYC rows appear only with the `layer2` flag.
 * Personal data is masked (document ending, birth year); full documents stay with the verification vendor.
 */

const RESULT: Record<CheckResult, { label: string; tone: "success" | "warning" | "error" | "neutral" }> = {
  clear: { label: "Clear", tone: "success" },
  review: { label: "Review", tone: "warning" },
  fail: { label: "Fail", tone: "error" },
  pending: { label: "Pending", tone: "neutral" },
};
const FILTERS: { id: string; label: string; match: (s: IdStatus) => boolean }[] = [
  { id: "open", label: "Open", match: (s) => s === "needs-review" || s === "escalated" },
  { id: "waiting", label: "Waiting on user", match: (s) => s === "needs-info" },
  { id: "approved", label: "Approved", match: (s) => s === "approved" },
  { id: "rejected", label: "Rejected", match: (s) => s === "rejected" },
  { id: "all", label: "All", match: () => true },
];
const ME = "You (Dana Okafor)";

export default function IdentityQueue() {
  const layer2 = useFlag("layer2");
  const [cases, setCases] = useState<IdentityCase[]>(IDENTITY);
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  const openId = params.get("id");
  const visible = cases.filter((c) => layer2 || !c.layer2);
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = visible
    .filter((c) => f.match(c.status))
    .filter((c) => !q.trim() || `${c.name} ${c.id}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const selected = visible.find((c) => c.id === openId) ?? null;

  const act = (id: string, status: IdStatus, action: string, detail?: string) =>
    setCases((cs) => cs.map((c) => (c.id === id ? { ...c, status, audit: [...c.audit, { at: new Date().toISOString(), actor: ME, action, detail }] } : c)));

  return (
    <Container size="xl" className="py-8">
      <PageHeader
        eyebrow="Compliance"
        title="Identity review"
        description={
          layer2
            ? "Artist and investor verification: identity documents, AML screening and sanctions checks the vendor couldn't clear automatically."
            : "Artist verification: identity documents, AML screening and sanctions checks the vendor couldn't clear automatically."
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div role="tablist" aria-label="Status filter" className="flex w-max gap-1 rounded-md border border-line bg-surface p-1">
            {FILTERS.map((x) => (
              <button
                key={x.id}
                role="tab"
                type="button"
                aria-selected={filter === x.id}
                onClick={() => setFilter(x.id)}
                className={cn("flex min-h-9 items-center gap-2 rounded-sm px-3 text-sm", filter === x.id ? "bg-surface-2 font-medium text-fg ring-1 ring-gold/50" : "text-muted hover:text-fg")}
              >
                {x.label}
                <span className="num text-xs text-muted">{visible.filter((c) => x.match(c.status)).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <TextInput aria-label="Search by name or reference" placeholder="Search name or reference" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title={q ? "No matches" : "Nothing here"}>
          {q ? "Try a different name or reference." : "No verifications in this state right now."}
        </EmptyState>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">Identity verifications</caption>
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Person</th>
                  <th scope="col" className="px-4 py-3 font-medium">KYC</th>
                  <th scope="col" className="px-4 py-3 font-medium">AML</th>
                  <th scope="col" className="px-4 py-3 font-medium">Sanctions</th>
                  <th scope="col" className="px-4 py-3 font-medium">Risk</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Age</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const sla = slaState(c.submittedAt, 24);
                  const open = c.status === "needs-review" || c.status === "escalated";
                  return (
                    <tr key={c.id} className={cn("cursor-pointer border-t border-line transition-colors hover:bg-surface-2", openId === c.id && "bg-surface-2")} onClick={() => setParams({ id: c.id })}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-fg">{c.name}</p>
                        <p className="text-xs text-muted">
                          <span className="num">{c.id}</span> · {c.role}
                        </p>
                      </td>
                      {(["kyc", "aml", "sanctions"] as const).map((k) => (
                        <td key={k} className="px-4 py-3">
                          <Badge tone={RESULT[c[k]].tone}>{RESULT[c[k]].label}</Badge>
                        </td>
                      ))}
                      <td className={cn("px-4 py-3", c.risk === "High" ? "text-error" : c.risk === "Medium" ? "text-warning" : "text-muted")}>{c.risk}</td>
                      <td className="px-4 py-3">
                        <Badge tone={ID_STATUS[c.status].tone}>{ID_STATUS[c.status].label}</Badge>
                      </td>
                      <td className={cn("num px-4 py-3 text-right", open && sla === "breach" ? "text-error" : open && sla === "risk" ? "text-warning" : "text-fg")}>{formatAge(c.submittedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg" aria-label={`Open ${c.name}`} onClick={(e) => { e.stopPropagation(); setParams({ id: c.id }); }}>
                          <ArrowUpRight className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted">Open items target a decision within 1 business day. Ages turn amber at 18h and red past 24h.</p>

      {selected && <Drawer c={selected} onClose={() => setParams({})} onAct={act} />}
    </Container>
  );
}

function Drawer({ c, onClose, onAct }: { c: IdentityCase; onClose: () => void; onAct: (id: string, s: IdStatus, action: string, detail?: string) => void }) {
  const [note, setNote] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  const [noteErr, setNoteErr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const decided = c.status === "approved" || c.status === "rejected";

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    ref.current?.focus();
    setNote("");
    setConfirmReject(false);
    setNoteErr(false);
  }, [c.id]);

  const need = (fn: () => void) => () => {
    if (!note.trim()) return setNoteErr(true);
    fn();
    setNote("");
    setNoteErr(false);
    setConfirmReject(false);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button className="absolute inset-0 bg-black/60" aria-label="Close details" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-line bg-canvas shadow-xl focus:outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div className="flex flex-col gap-1">
            <span className="num text-xs text-muted">
              {c.id} · vendor ref {c.vendorRef}
            </span>
            <h2 id="drawer-title" className="text-2xl font-semibold">
              {c.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Badge tone={ID_STATUS[c.status].tone}>{ID_STATUS[c.status].label}</Badge>
              <Badge tone="neutral">{c.role}</Badge>
              <Badge tone={c.risk === "High" ? "error" : c.risk === "Medium" ? "warning" : "neutral"}>{c.risk} risk</Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </header>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
          {c.reason && (
            <Callout tone={c.status === "escalated" ? "error" : "warning"} icon={<ShieldAlert />} title="Why this needs a person">
              {c.reason}
            </Callout>
          )}

          <section className="grid grid-cols-3 gap-3">
            {(["kyc", "aml", "sanctions"] as const).map((k) => (
              <div key={k} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
                <span className="eyebrow">{k === "kyc" ? "KYC" : k === "aml" ? "AML" : "Sanctions"}</span>
                <Badge tone={RESULT[c[k]].tone} className="self-start">
                  {RESULT[c[k]].label}
                </Badge>
              </div>
            ))}
          </section>

          <section className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface px-4">
            <KeyValue k="ID type" v={c.idType} />
            <KeyValue k="Issued by" v={c.issuing} />
            <KeyValue k="Document" v={<span className="num">•••• {c.docEnding}</span>} />
            <KeyValue k="Birth year" v={<span className="num">{c.dobYear}</span>} />
            <KeyValue k="Selfie match" v={c.liveness ? <span className={cn("num", c.liveness >= 90 ? "text-success" : c.liveness >= 75 ? "text-warning" : "text-error")}>{c.liveness}/100</span> : <span className="text-muted">Not captured</span>} />
            <KeyValue k="Address matches account" v={c.addressMatch ? "Yes" : <span className="text-warning">No</span>} />
            <KeyValue k="Politically exposed person" v={c.pep ? <span className="text-warning">Possible match</span> : "No match"} />
          </section>

          {c.sanctionsHits.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">Screening hits</h3>
              <ul className="flex flex-col gap-2">
                {c.sanctionsHits.map((h) => (
                  <li key={h.list + h.name} className="flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/5 p-3 text-sm">
                    <span>
                      <span className="text-fg">{h.name}</span> <span className="text-muted">· {h.list}</span>
                    </span>
                    <span className="num text-error">{h.score}% name match</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Compare date of birth and nationality against the list entry before clearing.</p>
            </section>
          )}

          <a href="#" onClick={(e) => e.preventDefault()} className="inline-flex items-center gap-1.5 self-start text-sm text-gold hover:underline">
            Open documents in vendor console <ExternalLink className="size-3.5" />
          </a>

          {!decided ? (
            <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
              <h3 className="text-base font-semibold">Decision</h3>
              <Field label="Reviewer note" htmlFor="kyc-note" error={noteErr ? "Add a note — it's saved to the audit log with your decision." : undefined} hint="Required. Notes are internal; the person only sees the outcome.">
                <TextArea id="kyc-note" rows={3} value={note} onChange={(e) => { setNote(e.target.value); setNoteErr(false); }} aria-invalid={noteErr || undefined} />
              </Field>
              {confirmReject ? (
                <Callout tone="error" title={`Reject ${c.name}?`}>
                  <p>They'll be told verification failed and can reapply in 30 days. {c.role === "Artist" ? "They can't launch campaigns until verified." : "They can't invest until verified."}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="destructive" size="sm" onClick={need(() => onAct(c.id, "rejected", "Rejected", note))}>
                      Reject verification
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmReject(false)}>
                      Cancel
                    </Button>
                  </div>
                </Callout>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={need(() => onAct(c.id, "approved", "Approved", note))} className="col-span-2">
                    <Check /> Approve
                  </Button>
                  <Button variant="secondary" onClick={need(() => onAct(c.id, "needs-info", "Requested more information", note))}>
                    <CircleHelp /> Request info
                  </Button>
                  <Button variant="secondary" disabled={c.status === "escalated"} onClick={need(() => onAct(c.id, "escalated", "Escalated to AML lead", note))}>
                    <ShieldAlert /> Escalate
                  </Button>
                  <Button variant="ghost" className="col-span-2 text-error hover:text-error" onClick={() => (note.trim() ? setConfirmReject(true) : setNoteErr(true))}>
                    Reject…
                  </Button>
                </div>
              )}
            </section>
          ) : (
            <Callout tone={c.status === "approved" ? "success" : "info"} title={c.status === "approved" ? "Verified" : "Rejected"}>
              This decision is final for this submission. A new submission opens a new case.
            </Callout>
          )}

          <AuditLog entries={c.audit} />
        </div>
      </div>
    </div>
  );
}
