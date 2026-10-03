import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CircleAlert, ExternalLink, FileText, Pencil, Rocket, Send } from "lucide-react";
import { REVENUE_TYPE_COPY } from "@fanzup/shared/l2";
import { Badge, Button, Callout, Card, Container, Field, KeyValue, PageHeader, ProgressBar, SectionHeading, Stat, TextArea, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { apiMessage, CollectionStateBadge, LoadGate, mechanismLabel, POOL_STATUS_COPY, RiskBadgeChip, shortDate, useLoad } from "@/components/invest/l2ui";
import { l2, type CreatorPoolView } from "@/lib/l2";
import { formatInstant, formatMoney } from "@/lib/format";

/**
 * Source: (new) CR-002 FR-L2-CR-005, REV-001 — one Pool for its creator: status, Form C review outcome, collection
 * agreement, launch, escrow and milestone releases, and (once funded) the royalty statements that drive the Waterfall.
 */
export default function PoolManagePage() {
  return (
    <RequireAccount>
      <PoolManage />
    </RequireAccount>
  );
}

function PoolManage() {
  const { id = "" } = useParams();
  const load = useLoad(() => l2.creatorPool(id), [id]);
  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <Link to="/creator/pools" className="flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Your Pools</Link>
      <LoadGate load={load} what="this Pool">
        {(p) => <Manage p={p} reload={load.reload} />}
      </LoadGate>
    </Container>
  );
}

function Manage({ p, reload }: { p: CreatorPoolView; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const lastReview = p.reviews[0];
  const executed = p.collection?.status === "executed";
  return (
    <>
      <PageHeader
        eyebrow={`Album royalty Pool · ${POOL_STATUS_COPY[p.status]}`}
        title={p.title}
        description={<span className="flex flex-wrap items-center gap-2"><RiskBadgeChip badge={p.riskBadge} /> {p.revenueTypes.map((t) => REVENUE_TYPE_COPY[t].label).join(", ")}</span>}
        actions={["live", "funded", "matured", "failed", "refunded"].includes(p.status) ? <Button asChild variant="secondary"><Link to={`/pools/${p.slug}`}><ExternalLink /> Public page</Link></Button> : undefined}
      />
      <div data-testid="creator-pool-status" data-status={p.status} className="sr-only">{p.status}</div>

      {(p.status === "draft" || p.status === "revisions_requested") && (
        <Card className="flex flex-col gap-3">
          {p.status === "revisions_requested" && lastReview && (
            <Callout tone="warning" icon={<CircleAlert />} title="Revisions requested">{lastReview.notes}</Callout>
          )}
          <p className="text-sm text-muted">When you submit, we generate the Form C from this Pool's data and FanZuP compliance reviews it.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="secondary"><Link to={`/creator/pools/new?edit=${p.id}`}><Pencil /> Edit</Link></Button>
            <Button disabled={busy} onClick={() => run(() => l2.submitPool(p.id))} data-testid="submit-pool"><Send /> Submit for Form C review</Button>
          </div>
        </Card>
      )}
      {p.status === "in_review" && <Callout tone="info" icon={<FileText />} title="Form C under review">FanZuP compliance is reviewing the Form C. Reviews usually take up to 2 business days.</Callout>}
      {p.status === "approved" && (
        <Card className="flex flex-col gap-3">
          <p className="font-semibold text-fg">Form C approved</p>
          <KeyValue k="Collection agreement" v={executed ? <Badge tone="success">Executed</Badge> : <Badge tone="warning">Waiting for execution</Badge>} />
          <p className="text-sm text-muted">Launching opens the offering with the escrow provider and starts the {p.durationDays}-day clock.</p>
          <Button disabled={busy || !executed} onClick={() => run(() => l2.launchPool(p.id))} data-testid="launch-pool"><Rocket /> Launch the offering</Button>
        </Card>
      )}
      {err && <Callout tone="error" icon={<CircleAlert />} title="That didn't work">{err}</Callout>}

      {["live", "funded", "matured", "failed", "refunded"].includes(p.status) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card><Stat label="Raised" value={<span className="num">{formatMoney(p.raisedMinor)}</span>} hint={<>target <span className="num">{formatMoney(p.targetMinor)}</span></>} /></Card>
          <Card><Stat label="Released to you" value={<span className="num">{formatMoney(p.money.releasedMinor)}</span>} hint={<>still in escrow <span className="num">{formatMoney(p.money.escrowMinor)}</span></>} /></Card>
          <Card><Stat label="Investors" value={<span className="num">{p.investors}</span>} hint={p.endsAt ? <>closes {formatInstant(p.endsAt)}</> : undefined} /></Card>
        </div>
      )}
      {p.status === "live" && <ProgressBar value={p.raisedMinor} max={p.targetMinor} tone="info" label="Raised vs target" />}

      <section>
        <SectionHeading eyebrow="Escrow releases" title="Milestones" />
        <Card padded={false} className="divide-y divide-line">
          {p.tranches.map((t) => <TrancheRow key={t.id} t={t} pool={p} onDone={reload} />)}
        </Card>
      </section>

      {(p.status === "funded" || p.status === "matured") && (
        <section className="flex flex-col gap-4">
          <SectionHeading eyebrow="Royalties" title="Statements and collection" action={<CollectionStateBadge state={p.collectionState} />} />
          <Card padded={false} className="divide-y divide-line">
            {p.statements.length === 0 && <p className="p-4 text-sm text-muted">No statements yet.</p>}
            {p.statements.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span className="text-fg">{s.periodLabel}</span>
                <Badge tone={s.status === "collected" ? "success" : s.status === "short" ? "warning" : "neutral"}>{s.status === "collected" ? "Collected" : s.status === "short" ? "Short" : "Reported, not collected"}</Badge>
                <span className="num text-muted">{formatMoney(s.collectedMinor)} of {formatMoney(s.coveredMinor)}</span>
              </div>
            ))}
          </Card>
          {p.status === "funded" && <StatementForm p={p} onDone={reload} />}
          <p className="text-xs text-muted">Collected royalties are split {p.fansBps / 100}% to fans, {p.creatorBps / 100}% to you and {p.platformBps / 100}% to the platform. Royalties paid to you so far: <span className="num">{formatMoney(p.money.creatorRoyaltiesPaidMinor)}</span>.</p>
        </section>
      )}

      <section>
        <SectionHeading eyebrow="Terms" title="What fans are buying" />
        <Card>
          <dl className="divide-y divide-line">
            <KeyValue k="Units × price" v={<span className="num">{p.unitsTotal} × {formatMoney(p.unitPriceMinor)}</span>} />
            <KeyValue k="Fan share" v={<span className="num">{p.fansBps / 100}%</span>} />
            <KeyValue k="Return cap" v={<span className="num">{p.returnCapBps / 10_000}×</span>} />
            <KeyValue k="Ends after" v={<span className="num">{p.maturityMonths / 12} years{p.maturesAt ? ` (${shortDate(p.maturesAt)})` : ""}</span>} />
            <KeyValue k="Collection" v={`${mechanismLabel(p.collectionMechanism)} · ${p.collection?.status ?? "—"}`} />
          </dl>
        </Card>
      </section>
    </>
  );
}

function TrancheRow({ t, pool, onDone }: { t: CreatorPoolView["tranches"][number]; pool: CreatorPoolView; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const canSubmit = pool.status === "funded" && t.seq > 1 && (t.status === "pending" || t.status === "evidence_submitted");
  const label = { pending: "Pending", evidence_submitted: "Evidence submitted", verified: "Verified · releasing", released: "Released", rejected: "Rejected" }[t.status] ?? t.status;
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-fg"><span className="num">{t.pct}%</span> — {t.seq === 1 ? "at close" : t.milestone}</span>
        <Badge tone={t.status === "released" ? "success" : t.status === "pending" ? "neutral" : "info"}>{label}</Badge>
        {t.releasedMinor != null && <span className="num text-sm text-muted">{formatMoney(t.releasedMinor)}</span>}
      </div>
      {canSubmit && (
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={async (e) => { e.preventDefault(); try { await l2.trancheEvidence(t.id, notes); setNotes(""); onDone(); } catch (x) { setErr(apiMessage(x)); } }}>
          <Field label="Evidence for this milestone" htmlFor={`ev-${t.id}`} className="flex-1"><TextArea id={`ev-${t.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.evidenceRequired ?? "What happened, with links"} /></Field>
          <Button type="submit" variant="secondary" disabled={notes.trim().length < 10}>Submit evidence</Button>
        </form>
      )}
      {err && <p className="text-sm text-error" role="alert">{err}</p>}
    </div>
  );
}

function StatementForm({ p, onDone }: { p: CreatorPoolView; onDone: () => void }) {
  const [label, setLabel] = useState(`Quarter ${p.statements.length + 1}`);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({ master: "", sync: "", publishing: "" });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setOk(null);
    const lines = Object.entries(amounts).filter(([, v]) => v).map(([t, v]) => ({ revenueType: t as "master", source: t === "master" ? "Distributor statement" : t === "sync" ? "Sync agency" : "PRO statement", amountMinor: Math.round(Number(v.replace(/[$,]/g, "")) * 100) }));
    if (!start || !end || !lines.length) return setErr("Add the period dates and at least one amount.");
    try {
      const r = await l2.addStatement(p.id, { periodLabel: label, periodStart: start, periodEnd: end, lines });
      setOk(`Statement saved. ${formatMoney(r.coveredMinor)} is covered by this Pool; it becomes distributable once the matching cash arrives in the collection account.`);
      onDone();
    } catch (x) {
      setErr(apiMessage(x));
    }
  };
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="statement-form">
        <p className="font-semibold text-fg">Upload a royalty statement (mock distributor statement)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period" htmlFor="st-label"><TextInput id="st-label" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="From" htmlFor="st-start"><TextInput id="st-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="To" htmlFor="st-end"><TextInput id="st-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          {(["master", "sync", "publishing"] as const).map((t) => (
            <Field key={t} label={`${REVENUE_TYPE_COPY[t].label} ($)`} htmlFor={`st-${t}`} hint={p.revenueTypes.includes(t) ? "Covered by this Pool" : "Not covered — kept by you"}>
              <TextInput id={`st-${t}`} inputMode="decimal" value={amounts[t]} onChange={(e) => setAmounts((s) => ({ ...s, [t]: e.target.value }))} />
            </Field>
          ))}
        </div>
        {err && <p className="text-sm text-error" role="alert">{err}</p>}
        {ok && <p className="text-sm text-success">{ok}</p>}
        <Button type="submit" variant="secondary">Save statement</Button>
      </form>
    </Card>
  );
}
