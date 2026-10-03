/**
 * Compliance reviewer workspace for reward campaigns (PRD 01 FR-ADMIN, Mechanism 05).
 * One component, three queue views: under review · revisions requested · approved.
 * Audit entries are append-only — the UI offers no edit or delete.
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router";
import { BadgeCheck, Check, ChevronDown, CircleCheck, Clock, ExternalLink, Flag, History, Lock, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Callout, Card, Container, EmptyState, Field, KeyValue, PageHeader, Select, TextArea } from "@/components/brand";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { CampaignFanView } from "./CampaignFanView";
import {
  CHECKS, REVISION_SECTIONS, SUBMISSIONS, autoSignal, formatAge, slaState, stamp,
  type AuditEntry, type CheckId, type Decision, type ReviewStatus, type RevisionRequest, type Submission,
} from "./reviewData";

/* ── Store (in-memory; shared across the three routes) ──── */

let subs: Submission[] = SUBMISSIONS;
const ls = new Set<() => void>();
const ME = "You (Dana Okafor)";
function patch(id: string, fn: (s: Submission) => Partial<Submission>) {
  subs = subs.map((s) => (s.id === id ? { ...s, ...fn(s) } : s));
  ls.forEach((l) => l());
}
const log = (s: Submission, action: string, detail?: string): AuditEntry[] => [...s.audit, { at: new Date().toISOString(), actor: ME, action, detail }];
export function useSubmissions() {
  return useSyncExternalStore(
    (cb) => {
      ls.add(cb);
      return () => ls.delete(cb);
    },
    () => subs,
    () => subs,
  );
}

const ROUTE: Record<ReviewStatus, string> = { "under-review": "/admin/review/under-review", revisions: "/admin/review/revisions", approved: "/admin/review/approved" };
const LABEL: Record<ReviewStatus, string> = { "under-review": "Under review", revisions: "Revisions requested", approved: "Approved" };
const SLA_BADGE = { ok: { tone: "neutral", t: "Within SLA" }, risk: { tone: "warning", t: "SLA at risk" }, breach: { tone: "error", t: "SLA breached" } } as const;

/* ── Workspace ──────────────────────────────────────────── */

export function ReviewWorkspace({ status }: { status: ReviewStatus }) {
  const all = useSubmissions();
  const [params, setParams] = useSearchParams();
  const wanted = params.get("id");
  const inQueue = all.filter((s) => s.status === status).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  // The revisions composer may open for a campaign that's still under review.
  const pinned = wanted ? all.find((s) => s.id === wanted) : undefined;
  const list = pinned && !inQueue.includes(pinned) && status === "revisions" ? [pinned, ...inQueue] : inQueue;
  const selected = (pinned && list.includes(pinned) ? pinned : list[0]) ?? null;

  return (
    <Container size="xl" className="py-8">
      <PageHeader
        eyebrow="Compliance"
        title="Campaign review"
        description="Every reward campaign is reviewed before it goes live. Target: a decision within 2 business days of submission."
      />
      <nav aria-label="Review queues" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 border-b border-line">
          {(Object.keys(ROUTE) as ReviewStatus[]).map((st) => (
            <NavLink
              key={st}
              to={ROUTE[st]}
              className={({ isActive }) =>
                cn("-mb-px flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm transition-colors", isActive ? "border-gold font-medium text-fg" : "border-transparent text-muted hover:text-fg")
              }
            >
              {LABEL[st]}
              <span className="num rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{all.filter((s) => s.status === st).length}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {list.length === 0 || !selected ? (
        <EmptyState icon={<CircleCheck />} title={`Nothing ${status === "approved" ? "approved yet" : "in this queue"}`}>
          {status === "under-review" ? "New submissions land here. You're all caught up." : "Campaigns move here as reviewers act on them."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr] xl:grid-cols-[20rem_1fr]">
          <QueueList items={list} selectedId={selected.id} onSelect={(id) => setParams({ id })} status={status} />
          <div className="flex min-w-0 flex-col gap-6">
            <SubmissionHeader s={selected} />
            {status === "under-review" && <ReviewPanel s={selected} />}
            {status === "revisions" && <RevisionsPanel s={selected} />}
            {status === "approved" && <ApprovedPanel s={selected} />}
            <FanPage s={selected} />
            <AuditLog entries={selected.audit} />
          </div>
        </div>
      )}
    </Container>
  );
}

function QueueList({ items, selectedId, onSelect, status }: { items: Submission[]; selectedId: string; onSelect: (id: string) => void; status: ReviewStatus }) {
  return (
    <aside aria-label="Queue" className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
      <p className="eyebrow px-1">
        Oldest first · <span className="num">{items.length}</span>
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {items.map((s) => {
          const sla = slaState(s.submittedAt);
          const active = s.id === selectedId;
          return (
            <li key={s.id} className="w-64 shrink-0 lg:w-auto">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active || undefined}
                className={cn("flex w-full flex-col gap-2 rounded-lg border p-4 text-left transition-colors", active ? "border-gold/60 bg-surface-2" : "border-line bg-surface hover:bg-surface-2")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-xs text-muted">{s.id}</span>
                  {status === "approved" ? (
                    <Badge tone="success">Approved</Badge>
                  ) : s.status === "under-review" && status === "revisions" ? (
                    <Badge tone="warning">Drafting</Badge>
                  ) : status === "revisions" ? (
                    <Badge tone="info">With artist</Badge>
                  ) : (
                    <Badge tone={SLA_BADGE[sla].tone}>{SLA_BADGE[sla].t}</Badge>
                  )}
                </div>
                <span className="line-clamp-2 font-medium text-fg">{s.view.title}</span>
                <span className="flex items-center justify-between text-xs text-muted">
                  <span>{s.artist.name}</span>
                  <span className="num">
                    {status === "approved" && s.approvedAt ? formatDate(s.approvedAt) : `${formatAge(s.submittedAt)} old`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function SubmissionHeader({ s }: { s: Submission }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="num text-xs text-muted">{s.id}</span>
          <h2 className="text-2xl font-semibold">{s.view.title}</h2>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
            <span>{s.artist.name}</span>
            {s.identity === "verified" && <BadgeCheck className="size-4 text-success" aria-label="Identity verified" />}
            <span>· {s.artist.tier} · {s.artist.city}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="gold">{s.view.type}</Badge>
          <Badge tone={s.status === "approved" ? "success" : "warning"}>{LABEL[s.status]}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
        <KeyValue className="flex-col items-start gap-0.5" k="Goal" v={<span className="num">${(s.view.goalMinor / 100).toLocaleString()}</span>} />
        <KeyValue className="flex-col items-start gap-0.5" k="Length" v={<span className="num">{s.view.durationDays} days</span>} />
        <KeyValue className="flex-col items-start gap-0.5" k="Perks" v={<span className="num">{s.view.perks.length}</span>} />
        <KeyValue className="flex-col items-start gap-0.5" k="Submitted" v={<span className="num">{stamp(s.submittedAt).slice(0, 16)}</span>} />
      </div>
    </Card>
  );
}

/* ── Checklist ──────────────────────────────────────────── */

const TONE_TEXT = { success: "text-success", warning: "text-warning", error: "text-error", neutral: "text-muted" } as const;

function Checklist({ s, readOnly }: { s: Submission; readOnly?: boolean }) {
  const decide = (id: CheckId, d: Decision) => {
    const label = CHECKS.find((c) => c.id === id)!.label;
    patch(s.id, (x) => ({ decisions: { ...x.decisions, [id]: d }, audit: log(x, `Marked “${label}” as ${d}`) }));
  };
  return (
    <ul className="flex flex-col divide-y divide-line">
      {CHECKS.map((c) => {
        const sig = autoSignal(s, c.id);
        const d = s.decisions[c.id];
        const note = s.notes[c.id] ?? "";
        return (
          <li key={c.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3.5",
                    d === "pass" ? "border-success/40 bg-success/10 text-success" : d === "flag" ? "border-error/40 bg-error/10 text-error" : "border-line text-muted",
                  )}
                  aria-hidden
                >
                  {d === "pass" ? <Check /> : d === "flag" ? <Flag /> : null}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-medium text-fg">{c.label}</p>
                  <p className="text-sm text-muted">{c.help}</p>
                  <p className={cn("text-xs", TONE_TEXT[sig.tone])}>
                    Automated: <span className="num">{sig.text}</span>
                  </p>
                </div>
              </div>
              {readOnly ? (
                <Badge tone={d === "pass" ? "success" : d === "flag" ? "error" : "neutral"} className="self-start">
                  {d === "pass" ? "Pass" : d === "flag" ? "Flagged" : "Not reviewed"}
                </Badge>
              ) : (
                <div role="radiogroup" aria-label={`${c.label} decision`} className="flex shrink-0 gap-1 self-start rounded-md border border-line bg-surface p-1">
                  {(["pass", "flag"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={d === v}
                      onClick={() => decide(c.id, d === v ? null : v)}
                      className={cn(
                        "flex min-h-9 items-center gap-1.5 rounded-sm px-3 text-sm transition-colors [&_svg]:size-4",
                        d === v ? (v === "pass" ? "bg-success/15 text-success" : "bg-error/15 text-error") : "text-muted hover:text-fg",
                      )}
                    >
                      {v === "pass" ? <Check /> : <Flag />}
                      {v === "pass" ? "Pass" : "Flag"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(d === "flag" || note) && (
              <div className="sm:pl-9">
                {readOnly ? (
                  <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">{note}</p>
                ) : (
                  <Field label="Reviewer note" htmlFor={`note-${s.id}-${c.id}`} hint={d === "flag" ? "Required for flagged checks. The artist sees this in the revision request." : undefined} error={d === "flag" && !note.trim() ? "Add a note explaining the flag." : undefined}>
                    <TextArea
                      id={`note-${s.id}-${c.id}`}
                      rows={2}
                      className="min-h-16"
                      value={note}
                      onChange={(e) => patch(s.id, (x) => ({ notes: { ...x.notes, [c.id]: e.target.value } }))}
                      aria-invalid={(d === "flag" && !note.trim()) || undefined}
                    />
                  </Field>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReviewPanel({ s }: { s: Submission }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const decided = CHECKS.filter((c) => s.decisions[c.id] !== null).length;
  const flagged = CHECKS.filter((c) => s.decisions[c.id] === "flag");
  const allPass = CHECKS.every((c) => s.decisions[c.id] === "pass");
  const missingNotes = flagged.some((c) => !(s.notes[c.id] ?? "").trim());

  const approve = () => {
    const now = new Date().toISOString();
    patch(s.id, (x) => ({ status: "approved", approvedAt: now, reviewer: "Dana Okafor", audit: log(x, "Approved", "Campaign scheduled to go live") }));
    navigate(`${ROUTE.approved}?id=${s.id}`);
  };

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Review checklist</h3>
          <p className="text-sm text-muted">
            <span className="num">{decided}</span> of <span className="num">{CHECKS.length}</span> decided
            {flagged.length > 0 && (
              <>
                {" "}
                · <span className="num text-error">{flagged.length}</span> flagged
              </>
            )}
          </p>
        </div>
        <Badge tone={SLA_BADGE[slaState(s.submittedAt)].tone} icon={<Clock />}>
          <span className="num">{formatAge(s.submittedAt)}</span>&nbsp;in queue
        </Badge>
      </div>
      <Checklist s={s} />

      <div className="flex flex-col gap-3 border-t border-line pt-5">
        {confirming ? (
          <Callout tone="success" icon={<ShieldCheck />} title="Approve this campaign?">
            <p>It goes live on the artist's chosen date and backers can start pledging. This decision is recorded in the audit log.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={approve}>
                <Check /> Confirm approval
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </Callout>
        ) : (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            {!allPass && <p className="text-sm text-muted sm:mr-auto">{flagged.length ? "Flagged checks need revisions before approval." : "Mark every check as pass to approve."}</p>}
            <Button variant="secondary" disabled={flagged.length === 0 || missingNotes} onClick={() => navigate(`${ROUTE.revisions}?id=${s.id}`)}>
              <Send /> Request revisions
            </Button>
            <Button disabled={!allPass} onClick={() => setConfirming(true)}>
              <ShieldCheck /> Approve
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ── Revisions ──────────────────────────────────────────── */

const SECTION_FOR: Record<CheckId, string> = { language: "Perks", goal: "Funding goal", fulfillment: "Fulfillment dates", identity: "Identity", tier: "Funding goal", escrow: "Milestone release" };

function RevisionsPanel({ s }: { s: Submission }) {
  const drafting = s.status === "under-review";
  const seed = (): RevisionRequest[] =>
    drafting
      ? CHECKS.filter((c) => s.decisions[c.id] === "flag").map((c) => ({ id: c.id, section: SECTION_FOR[c.id], issue: s.notes[c.id] ?? "", change: "", priority: c.id === "language" || c.id === "tier" || c.id === "identity" ? "high" : "medium" }))
      : [];
  const [reqs, setReqs] = useState<RevisionRequest[]>(seed);
  const [composing, setComposing] = useState(drafting);
  const [show, setShow] = useState(false);
  const [sent, setSent] = useState(false);
  const blank = (): RevisionRequest => ({ id: `r${Date.now()}`, section: "", issue: "", change: "", priority: "medium" });
  const set = (id: string, p: Partial<RevisionRequest>) => setReqs((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const valid = reqs.length > 0 && reqs.every((r) => r.section && r.issue.trim() && r.change.trim());
  const count = (p: RevisionRequest["priority"]) => reqs.filter((r) => r.priority === p).length;

  const send = () => {
    setShow(true);
    if (!valid) return;
    const summary = `${reqs.length} request${reqs.length > 1 ? "s" : ""} (${count("high")} high, ${count("medium")} medium, ${count("low")} low) sent to artist`;
    patch(s.id, (x) => ({ status: "revisions", revisions: [...x.revisions, ...reqs], audit: log(x, "Requested revisions", summary) }));
    setReqs([]);
    setComposing(false);
    setSent(true);
    setShow(false);
  };

  return (
    <Card className="flex flex-col gap-6">
      {sent && (
        <Callout tone="success" icon={<Check />} title="Revision requests sent">
          The artist has been emailed. The campaign stays off the marketplace until they resubmit.
        </Callout>
      )}
      {s.revisions.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Sent to the artist</h3>
          <ul className="flex flex-col gap-3">
            {s.revisions.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{r.section}</span>
                  <Badge tone={r.priority === "high" ? "error" : r.priority === "medium" ? "warning" : "neutral"}>{r.priority[0].toUpperCase() + r.priority.slice(1)}</Badge>
                </div>
                <p className="text-sm text-muted">
                  <span className="text-fg">Issue:</span> {r.issue}
                </p>
                <p className="mt-1 text-sm text-muted">
                  <span className="text-fg">Change:</span> {r.change}
                </p>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 text-sm text-muted">
            <Clock className="size-4" /> Waiting on the artist. Their resubmission returns to “Under review”.
          </p>
        </div>
      )}

      {composing ? (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-lg font-semibold">{s.revisions.length ? "Add a follow-up request" : "Request revisions"}</h3>
            <p className="text-sm text-muted">Be specific: name the section, say what's wrong, and say exactly what to change. Flagged checks are pre-filled.</p>
          </div>
          {reqs.length === 0 && <p className="text-sm text-muted">No requests yet.</p>}
          {reqs.map((r, i) => {
            const err = (k: keyof RevisionRequest) => (show && !String(r[k]).trim() ? "Required." : undefined);
            return (
              <fieldset key={r.id} className="flex flex-col gap-4 rounded-lg border border-line p-4">
                <div className="flex items-center justify-between">
                  <legend className="text-sm font-semibold">
                    Request <span className="num">{i + 1}</span>
                  </legend>
                  <Button variant="ghost" size="icon" aria-label={`Remove request ${i + 1}`} onClick={() => setReqs((x) => x.filter((y) => y.id !== r.id))}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <Field label="Section" htmlFor={`sec-${r.id}`} error={err("section")}>
                    <Select id={`sec-${r.id}`} value={r.section} onChange={(e) => set(r.id, { section: e.target.value })} aria-invalid={!!err("section") || undefined}>
                      <option value="">Choose a section…</option>
                      {REVISION_SECTIONS.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Priority" htmlFor={`pri-${r.id}`}>
                    <div role="radiogroup" aria-label="Priority" className="flex gap-1 rounded-md border border-line bg-surface p-1">
                      {(["high", "medium", "low"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          role="radio"
                          aria-checked={r.priority === p}
                          onClick={() => set(r.id, { priority: p })}
                          className={cn("min-h-9 rounded-sm px-3 text-sm capitalize", r.priority === p ? "bg-surface-2 font-medium text-fg ring-1 ring-gold/50" : "text-muted hover:text-fg")}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
                <Field label="Issue" htmlFor={`iss-${r.id}`} error={err("issue")}>
                  <TextArea id={`iss-${r.id}`} rows={2} className="min-h-16" value={r.issue} onChange={(e) => set(r.id, { issue: e.target.value })} aria-invalid={!!err("issue") || undefined} placeholder="What's wrong or doesn't meet the rules" />
                </Field>
                <Field label="Change required" htmlFor={`chg-${r.id}`} error={err("change")}>
                  <TextArea id={`chg-${r.id}`} rows={3} className="min-h-20" value={r.change} onChange={(e) => set(r.id, { change: e.target.value })} aria-invalid={!!err("change") || undefined} placeholder="Exactly what the artist should change" />
                </Field>
              </fieldset>
            );
          })}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button variant="secondary" size="sm" onClick={() => setReqs((x) => [...x, blank()])}>
              <Plus /> Add request
            </Button>
            <p className="text-sm text-muted sm:ml-auto">
              <span className="num text-error">{count("high")}</span> high · <span className="num text-warning">{count("medium")}</span> medium ·{" "}
              <span className="num">{count("low")}</span> low
            </p>
          </div>
          {show && !valid && <p className="text-sm text-error">{reqs.length === 0 ? "Add at least one request." : "Fill in every section, issue and change."}</p>}
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            {drafting ? (
              <Button asChild variant="secondary">
                <Link to={`${ROUTE["under-review"]}?id=${s.id}`}>Back to checklist</Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setComposing(false)}>
                Cancel
              </Button>
            )}
            <Button onClick={send}>
              <Send /> Send to artist
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => { setReqs([blank()]); setComposing(true); setSent(false); }}>
            <Plus /> Add a follow-up request
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ── Approved ───────────────────────────────────────────── */

function ApprovedPanel({ s }: { s: Submission }) {
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h3 className="text-lg font-semibold">Approved</h3>
            <p className="text-sm text-muted">
              by {s.reviewer ?? "—"} · <span className="num">{s.approvedAt ? stamp(s.approvedAt) : "—"}</span>
            </p>
          </div>
        </div>
        {s.goLive ? (
          <Badge tone="success">Live since {formatDate(s.goLive)}</Badge>
        ) : (
          <Badge tone="info">Scheduled to go live</Badge>
        )}
      </div>
      <Checklist s={s} readOnly />
      {s.artist.id === "nova-reyes" && (
        <div className="flex border-t border-line pt-5">
          <Button asChild variant="secondary">
            <Link to="/campaigns/nova-live-band-tour">
              <ExternalLink /> View live campaign
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ── Shared blocks ──────────────────────────────────────── */

function FanPage({ s }: { s: Submission }) {
  const [open, setOpen] = useState(false);
  return (
    <Card padded={false}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-5 text-left">
        <span>
          <span className="block font-semibold">Campaign page</span>
          <span className="text-sm text-muted">Exactly what fans will see, including the escrow notice</span>
        </span>
        <ChevronDown className={cn("size-5 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line p-5">
          <CampaignFanView v={s.view} />
        </div>
      )}
    </Card>
  );
}

export function AuditLog({ entries, title = "Audit log" }: { entries: AuditEntry[]; title?: ReactNode }) {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <History className="size-5 text-muted" /> {title}
        </h3>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Lock className="size-3.5" /> Append-only · entries can't be edited or deleted
        </span>
      </div>
      <ol className="flex flex-col">
        {sorted.map((e, i) => (
          <li key={`${e.at}-${i}`} className="grid gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 sm:grid-cols-[11.5rem_1fr] sm:gap-4">
            <time dateTime={e.at} className="num text-xs text-muted sm:pt-0.5">
              {stamp(e.at)}
            </time>
            <div className="text-sm">
              <p className="text-fg">
                <span className="text-muted">{e.actor}</span> · {e.action}
              </p>
              {e.detail && <p className="text-muted">{e.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

