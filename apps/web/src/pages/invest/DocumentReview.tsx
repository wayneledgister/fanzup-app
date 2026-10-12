import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, CircleAlert, FileText, Lock, RotateCcw } from "lucide-react";
import { Button, Callout, Card, Checkbox, Container, InvestmentRiskDisclosure, KeyValue, PageHeader, RegulatoryFooter } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { FormCLinkTo, IntermediaryPending, LoadGate, RiskBadgeChip, useLoad } from "@/components/invest/l2ui";
import { CancellationNotice, LimitMeter, OfferingEscrowNotice } from "@/components/invest/ui";
import { l2, l2ErrorCopy, newKey, TERMINAL_PURCHASE_CODES, type InvestorMeView, type PoolDetailView } from "@/lib/l2";
import { formatInstant, formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup DocumentReview.tsx, rebuilt on the API (CR-002, FR-L2-INV-004).
 * Order is fixed: risk disclosure → acknowledgments (versioned) → Units reserved → trade + fund move into the
 * offering's escrow → confirmation. The purchase is idempotent (design §5): the key is kept for this page view, so a
 * double click or a retry after a network error never creates a second investment. A stored final answer for the key
 * (reservation expired, cancelled, returned, a rule refusal) needs a NEW key to start again — "Start again" makes one.
 */
export default function DocumentReviewPage() {
  return (
    <RequireAccount>
      <DocumentReview />
    </RequireAccount>
  );
}

function DocumentReview() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const units = Math.max(1, Math.floor(Number(params.get("units")) || 1));
  const load = useLoad(async () => ({ pool: await l2.pool(id), me: await l2.investorMe() }), [id]);
  return (
    <Container size="md" className="flex flex-col gap-8 py-8">
      <Link to={`/pools/${id}`} className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back to the Pool
      </Link>
      <LoadGate load={load} what="the offering documents">
        {({ pool, me }) => <Review pool={pool} me={me} units={units} />}
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}

const ACKS = [
  { id: "ack-risk", text: "I understand I could lose all the money I invest, and that potential payouts depend only on royalties actually collected." },
  { id: "ack-unsecured", text: "I understand my claim is unsecured and that Units are not ownership of the artist's music or business." },
  { id: "ack-lockup", text: "I understand I can't resell Units for 12 months and that there's no marketplace to sell them afterwards." },
  { id: "ack-formc", text: "I've read the Form C, including the risk factors and how royalties are collected." },
];

function Review({ pool, me, units }: { pool: PoolDetailView; me: InvestorMeView; units: number }) {
  const navigate = useNavigate();
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ReturnType<typeof l2ErrorCopy> | null>(null);
  const [key, setKey] = useState(() => newKey());
  const total = units * pool.unitPriceMinor;
  const allAck = ACKS.every((a) => acks[a.id]);
  const ready = me.kycStatus === "approved" && me.certified;

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await l2.invest(pool.id, units, pool.riskAckVersion, key);
      navigate(`/invest/${pool.slug}/confirmation?investment=${r.investmentId}`);
    } catch (x) {
      setErr(l2ErrorCopy(x));
      setBusy(false);
    }
  };
  const startAgain = () => {
    setKey(newKey());
    setErr(null);
  };
  const terminal = !!err && TERMINAL_PURCHASE_CODES.has(err.code);

  return (
    <>
      <PageHeader eyebrow="Review and confirm" title={pool.title} description={`${units} Unit${units > 1 ? "s" : ""} at ${formatMoney(pool.unitPriceMinor)} each`} />
      <InvestmentRiskDisclosure lockupMonths={pool.lockupMonths} />
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2"><RiskBadgeChip badge={pool.riskBadge} /></div>
        <dl className="divide-y divide-line">
          <KeyValue k="Units" v={<span className="num">{units}</span>} />
          <KeyValue k="You pay" v={<span className="num text-lg font-medium">{formatMoney(total)}</span>} />
          <KeyValue k="Most these Units can ever pay (cap)" v={<span className="num">{formatMoney(Math.floor((total * pool.returnCapBps) / 10_000))}</span>} />
          <KeyValue k="Least they can pay" v={<span className="num">{formatMoney(0)}</span>} />
          <KeyValue k="Offering closes" v={<span className="num">{pool.endsAt ? formatInstant(pool.endsAt) : "—"}</span>} />
          <KeyValue k="Payment" v="Bank transfer into the offering's escrow account (simulated)" />
        </dl>
        {me.limitMinor != null && <LimitMeter limit={me.limitMinor} used={me.usedMinor} extra={Math.min(total, Math.max(0, me.limitMinor - me.usedMinor))} />}
      </Card>
      <Card className="flex items-center gap-4">
        <FileText className="size-5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">Form C (mock){pool.formC && <span className="num text-xs text-muted"> · v{pool.formC.version} · {pool.formC.sha256.slice(0, 12)}</span>}</p>
          <p className="text-sm text-muted">Terms, use of funds, collection and risk factors.</p>
        </div>
        <FormCLinkTo slug={pool.slug}>Read</FormCLinkTo>
      </Card>
      <OfferingEscrowNotice />
      <CancellationNotice cancelBy={pool.endsAt ? formatInstant(new Date(new Date(pool.endsAt).getTime() - pool.cancelCutoffHours * 3_600_000).toISOString()) : undefined} />
      <IntermediaryPending />
      <Card className="flex flex-col gap-3" data-testid="acknowledgments">
        <p className="font-semibold text-fg">Before you confirm</p>
        {ACKS.map((a) => (
          <Checkbox key={a.id} id={a.id} checked={!!acks[a.id]} onChange={(v) => setAcks((s) => ({ ...s, [a.id]: v }))}>{a.text}</Checkbox>
        ))}
      </Card>
      {!ready && (
        <p className="text-sm text-error" role="alert">
          Finish <Link className="underline" to={`/investor/certification?next=${encodeURIComponent(`/invest/${pool.slug}/documents?units=${units}`)}`}>investor verification</Link> first.
        </p>
      )}
      {err && (
        <div role="alert" data-testid="purchase-error" data-code={err.code}>
          <Callout tone="error" icon={<CircleAlert />} title={err.title}>
            {err.body}{" "}
            {terminal && (
              <Button variant="ghost" size="sm" onClick={startAgain} data-testid="start-again"><RotateCcw /> Start again</Button>
            )}
            {err.next === "verify" && <Link className="font-medium text-gold underline-offset-4 hover:underline" to={`/investor/certification?next=${encodeURIComponent(`/invest/${pool.slug}/documents?units=${units}`)}`}>Investor verification</Link>}
            {err.next === "pools" && <Link className="font-medium text-gold underline-offset-4 hover:underline" to="/pools">Browse Pools</Link>}
            {err.next === "reload" && <Link className="font-medium text-gold underline-offset-4 hover:underline" to={`/pools/${pool.slug}`}>Back to the Pool</Link>}
          </Callout>
        </div>
      )}
      <Button size="lg" block disabled={!allAck || !ready || busy || terminal} onClick={confirm} data-testid="confirm-investment">
        <Lock /> {busy ? "Sending to escrow…" : `Invest ${formatMoney(total)}`}
      </Button>
    </>
  );
}
