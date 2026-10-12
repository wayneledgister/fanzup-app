import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Clock, FastForward, RefreshCw, Scale } from "lucide-react";
import { Badge, Button, Callout, Card, Container, Field, KeyValue, PageHeader, SectionHeading, TextArea, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { ActionForm, StaffLoadGate } from "@/components/admin/StaffGate";
import { apiMessage, CollectionStateBadge, mechanismLabel, POOL_STATUS_COPY, RiskBadgeChip, useLoad } from "@/components/invest/l2ui";
import { l2, STAFF_RESOLVED_BREAKS, type DryRun, type ReconResult, type StaffMoney } from "@/lib/l2";
import { formatInstant, formatMoney } from "@/lib/format";

/**
 * Source: (new) CR-002 FR-L2-ADM — one Pool for staff: Form C review, collection agreement, ledger vs provider
 * (escrow and collection mirrors), investments, milestone verification, royalty statements and cash, distribution
 * dry-run → commit (same hash) on funded and matured Pools (L2-T-034), collection state incl. "Return to collecting
 * (cured)" from REMEDIATION (L2-T-022), provider operations with `pool_op.replay` (L2-T-046, L2-T-053) and open breaks
 * with `pool_break.resolve` (L2-T-056). Money views, recon, replay, resolve and collection state work with the layer2
 * flag off (design §9); the demo clock exists only on mock rails.
 */
export default function AdminPoolPage() {
  return (
    <RequireAccount verified={false}>
      <AdminPool />
    </RequireAccount>
  );
}

const LEDGER_LABEL: Record<string, string> = {
  pool_escrow: "Escrow (FBO mirror)", pool_investor_liability: "Owed to investors (pre-close)", pool_issuer_payable: "Owed to creator (unreleased)",
  pool_collection: "Collection account mirror", pool_revenue_suspense: "Cash not yet reconciled", pool_revenue_unallocated: "Collected, not distributed",
  pool_distributions_payable: "Distributions owed to fans", pool_creator_payable: "Royalties owed to creator", pool_platform_payable: "Platform share owed",
};
/** Debit-normal Pool accounts (money held); every other Pool account is credit-normal (money owed). */
const DEBIT_NORMAL = new Set(["pool_escrow", "pool_collection"]);
/**
 * Balance in the account's natural sign (round-1 review: no Math.abs): held money and owed money both read positive
 * when normal, so a NEGATIVE natural balance is abnormal and is highlighted.
 */
export const naturalBalance = (kind: string, stored: number) => (DEBIT_NORMAL.has(kind) ? stored : -stored);

function AdminPool() {
  const { id = "" } = useParams();
  const load = useLoad(() => l2.staffMoney(id), [id]);
  return (
    <Container size="xl" className="flex flex-col gap-8 py-8">
      <Link to="/admin/pools" className="flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Pools</Link>
      <StaffLoadGate load={load} what="this Pool">
        {(m) => <Money m={m} reload={load.reload} />}
      </StaffLoadGate>
    </Container>
  );
}

function Money({ m, reload }: { m: StaffMoney; reload: () => void }) {
  const p = m.pool;
  const after = <T,>(x: T) => (reload(), x);
  const distributing = p.status === "funded" || p.status === "matured";
  const ledgerKinds = [...Object.keys(LEDGER_LABEL), ...Object.keys(m.ledger).filter((k) => !(k in LEDGER_LABEL))];
  const unconfirmedOpen = m.breaks.some((b) => b.kind === "op_unconfirmed");
  return (
    <>
      <PageHeader
        eyebrow={`Pool · ${POOL_STATUS_COPY[p.status] ?? p.status}`}
        title={`${p.title} — ${p.artistDisplay}`}
        description={<span className="flex flex-wrap items-center gap-2"><RiskBadgeChip badge={p.riskBadge} /> {mechanismLabel(p.collectionMechanism)} {distributing && <CollectionStateBadge state={p.collectionState} />}</span>}
        actions={<Button variant="ghost" onClick={reload}><RefreshCw /> Refresh</Button>}
      />
      <div className="sr-only" data-testid="staff-pool-status">{p.status}</div>
      <DemoClock endsAt={p.endsAt} onDone={reload} />

      {p.status === "in_review" && <FormCReview id={p.id} sha={p.formCSha256} onDone={reload} />}
      {p.collection && p.collection.status === "submitted" && ["in_review", "approved"].includes(p.status) && (
        <Card className="flex flex-col gap-3">
          <p className="font-semibold text-fg">Collection agreement — {mechanismLabel(p.collection.mechanism)}</p>
          <p className="text-sm text-muted">Counterparty: {p.collection.details?.counterparty ?? "—"}. Execute only once the signed agreement is on file (the Pool can't go live without it).</p>
          <ActionForm label="Mark executed" testId="execute-collection" run={(r) => l2.executeCollection(p.id, r).then(after)} />
        </Card>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading eyebrow="Ledger" title="Pool accounts" />
          <p className="mb-2 text-xs text-muted">Shown in each account's natural sign: money held and money owed read positive. A negative balance is abnormal.</p>
          <dl className="divide-y divide-line" data-testid="pool-ledger">
            {ledgerKinds.map((k) => {
              const v = naturalBalance(k, m.ledger[k] ?? 0);
              return (
                <KeyValue
                  key={k}
                  k={LEDGER_LABEL[k] ?? k}
                  v={
                    <span className={`num ${v < 0 ? "font-semibold text-error" : ""}`} data-testid={`ledger-${k}`} data-negative={v < 0 || undefined}>
                      {formatMoney(v, { cents: true })}
                      {v < 0 && <span className="sr-only"> (abnormal: negative)</span>}
                    </span>
                  }
                />
              );
            })}
          </dl>
        </Card>
        <ProviderRecon id={p.id} />
      </section>

      <section>
        <SectionHeading eyebrow="Investors" title={`Investments (${m.investments.length})`} />
        <Card padded={false} className="divide-y divide-line overflow-x-auto">
          {m.investments.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1 text-fg">{i.investor}</span>
              <Badge tone="neutral">{i.status.replace("_", " ")}</Badge>
              <span className="num">{i.units} Units · {formatMoney(i.amountMinor)}</span>
              <span className="num text-muted">paid {formatMoney(i.distributedMinor, { cents: true })} / cap {formatMoney(i.capMinor)}</span>
            </div>
          ))}
          {m.investments.length === 0 && <p className="p-4 text-sm text-muted">No investments yet.</p>}
        </Card>
      </section>

      <section>
        <SectionHeading eyebrow="Escrow releases" title="Milestones" />
        <Card padded={false} className="divide-y divide-line">
          {m.tranches.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="flex-1 text-fg"><span className="num">{t.pct}%</span> — {t.seq === 1 ? "at close" : t.milestone}</span>
                <Badge tone={t.status === "released" ? "success" : t.status === "evidence_submitted" ? "warning" : "neutral"}>{t.status.replace("_", " ")}</Badge>
                {t.released_minor && <span className="num">{formatMoney(Number(t.released_minor))}</span>}
              </div>
              {t.status === "evidence_submitted" && <ActionForm label="Verify milestone" testId={`verify-${t.seq}`} run={(r) => l2.verifyTranche(t.id, r).then(after)} />}
            </div>
          ))}
        </Card>
      </section>

      {distributing && <Revenue m={m} onDone={reload} />}

      {["AT_RISK", "DEFAULT", "REMEDIATION"].includes(p.collectionState) && distributing && (
        <Card className="flex flex-col gap-3" data-testid="collection-state">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">Collection <CollectionStateBadge state={p.collectionState} /></p>
          {p.collectionState === "AT_RISK" && <p className="text-sm text-muted">A royalty payment is late or short. It returns to collecting by itself once the late cash is reconciled.</p>}
          {p.collectionState === "DEFAULT" && <ActionForm label="Move to remediation" testId="to-remediation" run={(r) => l2.collectionState(p.id, "REMEDIATION", r).then(after)} />}
          {p.collectionState === "REMEDIATION" && (
            <>
              <p className="text-sm text-muted">
                Back to normal collection only once the Pool is no longer past due — the late royalty cash has arrived and been reconciled. Otherwise the API
                refuses it.
              </p>
              <ActionForm label="Return to collecting (cured)" testId="to-collecting" run={(r) => l2.collectionState(p.id, "COLLECTING", r).then(after)} />
            </>
          )}
          {(p.collectionState === "DEFAULT" || p.collectionState === "REMEDIATION") && (
            <ActionForm label="Charge off" tone="secondary" testId="charge-off" run={(r) => l2.collectionState(p.id, "CHARGED_OFF", r).then(after)} />
          )}
        </Card>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading eyebrow="Provider" title="Operations" />
          <ul className="divide-y divide-line text-sm" data-testid="pool-ops">
            {m.ops.map((o) => {
              const replayable = o.status === "failed" || o.status === "dead" || (o.status === "sent" && unconfirmedOpen);
              return (
                <li key={o.id} className="flex flex-col gap-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">{o.kind.replace("_", " ")}</span>
                    <Badge tone={o.status === "confirmed" ? "success" : o.status === "failed" || o.status === "dead" ? "error" : "warning"}>{o.status}</Badge>
                    <span className="num">{formatMoney(Number(o.amount_minor), { cents: true })}</span>
                    {o.attempts > 0 && <span className="num text-xs text-muted">{o.attempts} attempt{o.attempts === 1 ? "" : "s"}</span>}
                  </div>
                  {o.last_error && <span className="text-xs text-error">{o.last_error}</span>}
                  {replayable && (
                    <ActionForm label="Replay operation" tone="secondary" testId={`replay-${o.id}`} run={(r) => l2.replayPoolOp(o.id, r).then(after)} />
                  )}
                </li>
              );
            })}
            {m.ops.length === 0 && <li className="py-2 text-muted">None yet.</li>}
          </ul>
        </Card>
        <Card>
          <SectionHeading eyebrow="Breaks" title="Open" />
          <ul className="divide-y divide-line text-sm" data-testid="pool-breaks">
            {m.breaks.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 py-2">
                <div className="flex justify-between gap-2">
                  <span>{b.kind.replaceAll("_", " ")}</span>
                  <span className="num">{formatMoney(Number(b.amount_minor), { cents: true })}</span>
                </div>
                {STAFF_RESOLVED_BREAKS.has(b.kind) ? (
                  <ActionForm label="Resolve break" tone="secondary" testId={`resolve-${b.id}`} run={(r) => l2.resolvePoolBreak(b.id, r).then(after)} />
                ) : (
                  <span className="text-xs text-muted">Clears when reconciliation no longer finds it.</span>
                )}
              </li>
            ))}
            {m.breaks.length === 0 && <li className="py-2 text-muted">No open breaks.</li>}
          </ul>
        </Card>
      </section>
    </>
  );
}

function FormCReview({ id, sha, onDone }: { id: string; sha: string | null; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [doc, setDoc] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-3" data-testid="form-c-review">
      <p className="font-semibold text-fg">Form C review</p>
      <p className="text-sm text-muted">Mock Form C generated from the Pool data. <span className="num break-all">SHA-256 {sha}</span></p>
      <Button variant="ghost" onClick={() => l2.staffFormC(id).then((d) => setDoc(JSON.stringify(d.body, null, 2))).catch((e) => setDoc(apiMessage(e)))}>Show the document</Button>
      {doc && <pre className="max-h-80 overflow-auto rounded-md border border-line bg-surface-2 p-3 text-xs text-muted">{doc}</pre>}
      <ActionForm label="Approve Form C" testId="approve-form-c" run={(r) => l2.review(id, "approved", r).then((x) => (onDone(), x))} />
      <Field label="What needs to change (sent to the creator)" htmlFor="rv-notes"><TextArea id="rv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ActionForm label="Request revisions" tone="secondary" run={(r) => l2.review(id, "revisions_requested", r, notes).then((x) => (onDone(), x))} />
    </Card>
  );
}

function ProviderRecon({ id }: { id: string }) {
  const [r, setR] = useState<ReconResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-3">
      <SectionHeading eyebrow="Reconciliation" title="Ledger vs escrow provider" />
      <Button variant="secondary" onClick={() => { setErr(null); l2.recon(id).then(setR).catch((e) => setErr(apiMessage(e))); }} data-testid="run-recon"><Scale /> Reconcile now</Button>
      {err && <p className="text-sm text-error" role="alert">{err}</p>}
      {r && r.ledger.pools.map((x) => (
        <dl key={x.poolId} className="divide-y divide-line" data-testid="recon-result" data-diff={r.ledger.diffMinor}>
          <KeyValue k="Escrow: ledger / provider" v={<span className="num">{formatMoney(x.escrow.ledgerMinor, { cents: true })} / {formatMoney(x.escrow.providerMinor, { cents: true })}</span>} />
          <KeyValue k="Collection: ledger / provider" v={<span className="num">{formatMoney(x.collection.ledgerMinor, { cents: true })} / {formatMoney(x.collection.providerMinor, { cents: true })}</span>} />
          <KeyValue k="Difference" v={<Badge tone={r.ledger.diffMinor === 0 ? "success" : "error"}>{formatMoney(r.ledger.diffMinor, { cents: true })}</Badge>} />
          {(r.ledger.inFlight ?? []).length > 0 && <KeyValue k="In flight (inside the grace window)" v={<span className="num">{r.ledger.inFlight.length}</span>} />}
          {(x.breaks ?? []).length > 0 && <KeyValue k="Breaks found" v={x.breaks.map((b) => b.kind.replaceAll("_", " ")).join(", ")} />}
        </dl>
      ))}
      {r && r.ledger.pools.length === 0 && <p className="text-sm text-muted">This Pool has no escrow offering yet, so there's nothing to reconcile.</p>}
    </Card>
  );
}

function Revenue({ m, onDone }: { m: StaffMoney; onDone: () => void }) {
  const p = m.pool;
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState(m.statements.find((s) => s.status !== "collected")?.period_label ?? "");
  const [label, setLabel] = useState(m.statements.at(-1)?.period_label ?? "");
  const [run, setRun] = useState<DryRun | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const unallocated = naturalBalance("pool_revenue_unallocated", m.ledger.pool_revenue_unallocated ?? 0);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading eyebrow="Royalties" title="Statements, cash and the Waterfall" />
      <Card padded={false} className="divide-y divide-line">
        {m.statements.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="flex-1 text-fg">{s.period_label}</span>
            <Badge tone={s.status === "collected" ? "success" : s.status === "short" ? "warning" : "neutral"}>{s.status}</Badge>
            <span className="num">{formatMoney(Number(s.collected_minor), { cents: true })} of {formatMoney(Number(s.covered_minor), { cents: true })}</span>
            <span className="text-xs text-muted">{s.verification}</span>
          </div>
        ))}
        {m.settlements.map((s) => (
          <div key={s.provider_ref} className="flex flex-wrap items-center gap-3 p-3 text-sm text-muted">
            <span className="flex-1">Cash {s.reference} · BANK_RECONCILED</span>
            <span className="num">{formatMoney(Number(s.amount_minor), { cents: true })}</span>
            <span className="text-xs">{s.statement_id ? "matched" : "unmatched"}</span>
          </div>
        ))}
        {m.statements.length + m.settlements.length === 0 && <p className="p-4 text-sm text-muted">No statements or cash yet.</p>}
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-semibold text-fg">Simulate a lockbox / distributor settlement (mock provider)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount ($)" htmlFor="dep-amt"><TextInput id="dep-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reference (statement period)" htmlFor="dep-ref"><TextInput id="dep-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Button variant="secondary" data-testid="simulate-deposit" onClick={() => l2.deposit(p.id, Math.round(Number(amount) * 100), ref).then(() => setMsg("Deposit sent to the provider. It settles in a few seconds; then reconcile.")).catch((e) => setMsg(apiMessage(e)))} disabled={!amount || !ref}>Send cash</Button>
          </div>
        </div>
        {msg && <p className="text-sm text-muted" role="status">{msg}</p>}
        <Button variant="ghost" onClick={() => l2.recon(p.id).then(onDone).catch((e) => setMsg(apiMessage(e)))} data-testid="recon-revenue"><Scale /> Reconcile statements to cash</Button>
      </Card>
      <Card className="flex flex-col gap-3" data-testid="distribution">
        <p className="font-semibold text-fg">Distribution run{p.status === "matured" && " — final runs after maturity"}</p>
        <p className="text-sm text-muted">Allocates everything collected and not yet distributed (<span className="num text-fg" data-testid="unallocated">{formatMoney(unallocated, { cents: true })}</span>). The label names the run; it doesn't filter.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Run label" htmlFor="run-label" className="flex-1"><TextInput id="run-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></Field>
          <Button variant="secondary" disabled={label.trim().length < 2} onClick={() => { setMsg(null); l2.dryRun(p.id, label.trim()).then(setRun).catch((e) => setMsg(apiMessage(e))); }} data-testid="dry-run">Dry-run</Button>
        </div>
        {run && (
          <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm" data-testid="dry-run-result">
            <KeyValue k="Total" v={<span className="num">{formatMoney(run.allocation.runTotalMinor, { cents: true })}</span>} />
            <KeyValue k="Fans (pro rata by Units)" v={<span className="num">{formatMoney(run.allocation.payouts.reduce((s, x) => s + x.amountMinor, 0), { cents: true })} to {run.allocation.payouts.length} holdings</span>} />
            <KeyValue k="Creator (incl. any cap overflow)" v={<span className="num">{formatMoney(run.allocation.creatorMinor, { cents: true })}</span>} />
            <KeyValue k="Platform" v={<span className="num">{formatMoney(run.allocation.platformMinor, { cents: true })}</span>} />
            {run.allCapped && <Callout tone="info" title="Every holding reaches its cap">Committing ends the Pool (cap reached).</Callout>}
            <p className="num break-all text-xs text-muted">hash <span data-testid="dry-run-hash">{run.hash}</span></p>
            {run.allocation.runTotalMinor > 0 && (
              <ActionForm
                label="Commit distribution"
                testId="commit-run"
                run={(r) =>
                  l2.commitRun(p.id, run.label, run.hash, r).then((x) => {
                    onDone();
                    // A replay of an already committed run (same label + hash) returns the earlier run, not an action.
                    return x.action ? { action: x.action } : { action: { id: x.runId ?? "", status: "executed" as const, executeAfter: null, correlationId: null } };
                  })
                }
              />
            )}
          </div>
        )}
        {m.runs.length > 0 && (
          <ul className="divide-y divide-line text-sm" data-testid="runs">
            {m.runs.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2" data-testid="run-row" data-label={r.label}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{r.label}</span>
                  <Badge tone={r.status === "paid" ? "success" : "warning"}>{r.status}</Badge>
                  <span className="num">{formatMoney(Number(r.run_total_minor), { cents: true })}</span>
                  <span className="num text-xs text-muted">{formatInstant(r.committed_at)}</span>
                </div>
                <span className="num break-all text-xs text-muted">hash <span data-testid="run-hash">{r.input_hash}</span></span>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="text-sm text-error" role="alert">{msg}</p>}
      </Card>
    </section>
  );
}

/** Mock rails only: the provider's virtual clock and one worker tick at the same offset (POST /dev/l2/advance). */
function DemoClock({ endsAt, onDone }: { endsAt: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (seconds: number, label: string) => {
    setBusy(true);
    try {
      await l2.advance(seconds);
      setMsg(`${label}: done.`);
      onDone();
    } catch (e) {
      setMsg(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const toDeadline = endsAt ? Math.max(5, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000) + 20 * 60) : null;
  return (
    <Callout tone="warning" icon={<Clock />} title="Demo clock (mock provider only)">
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(5, "Provider settled")} data-testid="advance-5s"><FastForward /> Let the provider settle</Button>
        {toDeadline && <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(toDeadline, "Moved past the deadline")} data-testid="advance-deadline"><FastForward /> Run past the offering deadline</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => go(86_400, "One day later")}>+1 day</Button>
        {msg && <span className="text-xs">{msg}</span>}
      </span>
    </Callout>
  );
}
