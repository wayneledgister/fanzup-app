import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, BadgeCheck, CircleAlert, Clock, Fingerprint, ShieldX } from "lucide-react";
import { regCfLimitMinor } from "@fanzup/shared/l2";
import { POLICY } from "@fanzup/shared/policy";
import { Badge, Button, Callout, Card, Checkbox, Container, Field, PageHeader, RegulatoryFooter, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { apiMessage, LoadGate, useLoad } from "@/components/invest/l2ui";
import { PartnerBanner } from "@/components/invest/ui";
import { l2, type InvestorMeView } from "@/lib/l2";
import { safeNext } from "@/lib/supabase";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup InvestorCertification.tsx + KYC handoff, rebuilt on the API (CR-002, FR-L2-INV-002/003).
 * Step 1: identity and AML check through the escrow provider's party record (mock; names go to the provider only).
 * Step 2: income / net worth / accredited attestation, which sets the 12-month Reg CF limit (17 CFR 227.100(a)(2),
 * figures verified on the date shown). The limit preview uses the same shared formula the database enforces.
 */
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export default function InvestorCertificationPage() {
  return (
    <RequireAccount>
      <InvestorCertification />
    </RequireAccount>
  );
}

function InvestorCertification() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"), "/pools");
  const load = useLoad(() => l2.investorMe(), []);
  return (
    <Container size="md" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Investor verification" title="Before you invest" description="Two steps: confirm who you are, then tell us your income and net worth. Together they set how much you can invest." />
      <LoadGate load={load} what="your investor profile">
        {(me) => <Steps me={me} onChange={load.set} next={next} />}
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}

function Steps({ me, onChange, next }: { me: InvestorMeView; onChange: (m: InvestorMeView) => void; next: string }) {
  const navigate = useNavigate();
  // Poll while the provider decides (KYC is asynchronous; the result arrives by webhook).
  useEffect(() => {
    if (me.kycStatus !== "pending") return;
    const t = setInterval(() => l2.investorMe().then(onChange).catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [me.kycStatus, onChange]);
  const done = me.kycStatus === "approved" && me.certified;
  return (
    <>
      <Identity me={me} onStarted={() => l2.investorMe().then(onChange)} />
      <Attestation me={me} onSaved={onChange} />
      {done && (
        <Card className="flex flex-col gap-3" data-testid="investor-ready">
          <p className="flex items-center gap-2 font-semibold text-fg"><BadgeCheck className="size-5 text-success" /> You're ready to invest</p>
          <p className="text-sm text-muted">
            {me.limitMinor == null ? "As an accredited investor, no Reg CF limit applies." : <>You can invest up to <span className="num text-fg">{formatMoney(me.remainingMinor ?? 0)}</span> more in the next 12 months across all Reg CF offerings.</>}
          </p>
          <Button onClick={() => navigate(next)} data-testid="investor-continue">Continue <ArrowRight /></Button>
        </Card>
      )}
    </>
  );
}

function Identity({ me, onStarted }: { me: InvestorMeView; onStarted: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [state, setState] = useState(me.state ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = me.kycStatus;
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!first.trim() || !last.trim() || !state) return setErr("Enter your legal name and state.");
    setBusy(true);
    setErr(null);
    try {
      await l2.startKyc({ firstName: first.trim(), lastName: last.trim(), state });
      onStarted();
    } catch (x) {
      setErr(apiMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-4" data-testid="kyc-step" data-kyc-status={status}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Fingerprint className="size-5 text-gold" /> 1. Identity check</h2>
        <KycBadge status={status} />
      </div>
      {status === "not_started" && (
        <form onSubmit={start} className="flex flex-col gap-4" noValidate>
          <PartnerBanner />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal first name" htmlFor="kyc-first"><TextInput id="kyc-first" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" /></Field>
            <Field label="Legal last name" htmlFor="kyc-last"><TextInput id="kyc-last" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" /></Field>
          </div>
          <Field label="State of residence" htmlFor="kyc-state" hint="Some offerings aren't available in every state.">
            <select id="kyc-state" value={state} onChange={(e) => setState(e.target.value)} className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-fg focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30">
              <option value="">Choose…</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <p className="text-xs text-muted">Demo identity checks are simulated. Last name KYCFAIL is rejected; AMLHOLD goes to manual review.</p>
          {err && <p className="text-sm text-error" role="alert">{err}</p>}
          <Button type="submit" disabled={busy} data-testid="kyc-submit">{busy ? "Starting…" : "Verify my identity"}</Button>
        </form>
      )}
      {status === "pending" && <p className="flex items-center gap-2 text-sm text-muted"><Clock className="size-4" /> Checking with our identity partner. This usually takes a few seconds.</p>}
      {status === "manual_review" && (
        <Callout tone="warning" icon={<Clock />} title="Your check needs a manual review">
          Our compliance team will look at it, usually within {POLICY.adminSlaBusinessDays.identity} business day. We'll email you.
        </Callout>
      )}
      {status === "rejected" && (
        <Callout tone="error" icon={<ShieldX />} title="We couldn't verify your identity">
          You can't invest in Pools from this account. You can still back reward campaigns. <Link to="/support" className="font-medium text-gold hover:underline">Contact support</Link>
        </Callout>
      )}
      {status === "approved" && <p className="text-sm text-muted">Identity and AML checks passed.</p>}
    </Card>
  );
}

function KycBadge({ status }: { status: string }) {
  const m: Record<string, [string, "neutral" | "warning" | "success" | "error"]> = {
    not_started: ["Not started", "neutral"], pending: ["Checking", "warning"], manual_review: ["Manual review", "warning"], approved: ["Verified", "success"], rejected: ["Not verified", "error"],
  };
  const [label, tone] = m[status] ?? [status, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

const dollars = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);

function Attestation({ me, onSaved }: { me: InvestorMeView; onSaved: (m: InvestorMeView) => void }) {
  const [income, setIncome] = useState("");
  const [worth, setWorth] = useState("");
  const [elsewhere, setElsewhere] = useState("0");
  const [accredited, setAccredited] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = Number.isFinite(dollars(income)) && Number.isFinite(dollars(worth)) && income !== "" && worth !== "" && dollars(income) >= 0 && dollars(worth) >= 0;
  const preview = useMemo(() => (valid ? regCfLimitMinor({ annualIncomeMinor: dollars(income), netWorthMinor: dollars(worth), accredited }) : undefined), [valid, income, worth, accredited]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return setErr("Enter your annual income and net worth in dollars.");
    if (!confirm) return setErr("Confirm that the figures are accurate.");
    setBusy(true);
    setErr(null);
    try {
      onSaved(await l2.certify({ annualIncomeMinor: dollars(income), netWorthMinor: dollars(worth), accredited, elsewhereMinor: dollars(elsewhere || "0") }));
    } catch (x) {
      setErr(apiMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-4" data-testid="certification-step">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">2. Your investment limit</h2>
        {me.certified && <Badge tone="success">Saved</Badge>}
      </div>
      <p className="text-sm text-muted">
        Regulation Crowdfunding limits how much non-accredited investors can put into all Reg CF offerings in 12 months. Figures verified{" "}
        <span className="num">{formatDate(POLICY.regCf.verifiedOn)}</span>: if your income or net worth is under{" "}
        <span className="num">{formatMoney(POLICY.regCf.thresholdMinor)}</span>, the greater of <span className="num">{formatMoney(POLICY.regCf.floorMinor)}</span> or{" "}
        <span className="num">5%</span> of the greater figure; if both are at or above it, <span className="num">10%</span> of the greater, up to{" "}
        <span className="num">{formatMoney(POLICY.regCf.thresholdMinor)}</span>.
      </p>
      {me.certified && (
        <p className="text-sm text-fg" data-testid="limit-summary">
          {me.limitMinor == null ? "Accredited: no limit." : <>Limit <span className="num">{formatMoney(me.limitMinor)}</span> · used <span className="num">{formatMoney(me.usedMinor)}</span> · left <span className="num">{formatMoney(me.remainingMinor ?? 0)}</span></>}
        </p>
      )}
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Annual income (USD)" htmlFor="c-income"><TextInput id="c-income" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="60,000" /></Field>
          <Field label="Net worth, excluding your home (USD)" htmlFor="c-worth"><TextInput id="c-worth" inputMode="decimal" value={worth} onChange={(e) => setWorth(e.target.value)} placeholder="40,000" /></Field>
        </div>
        <Field label="Reg CF investments elsewhere in the last 12 months (USD)" htmlFor="c-else" optional>
          <TextInput id="c-else" inputMode="decimal" value={elsewhere} onChange={(e) => setElsewhere(e.target.value)} />
        </Field>
        <Checkbox id="c-acc" checked={accredited} onChange={setAccredited}>I'm an accredited investor (for example, income over $200,000 or net worth over $1 million excluding my home).</Checkbox>
        {preview !== undefined && (
          <p className="text-sm text-muted">
            Your limit would be <span className="num text-fg">{preview == null ? "no limit" : formatMoney(preview)}</span> over 12 months.
          </p>
        )}
        <Checkbox id="c-confirm" checked={confirm} onChange={setConfirm}>These figures are accurate. I understand my limit is based on what I tell you.</Checkbox>
        {err && <p className="flex items-center gap-2 text-sm text-error" role="alert"><CircleAlert className="size-4" /> {err}</p>}
        <Button type="submit" variant={me.certified ? "secondary" : "primary"} disabled={busy} data-testid="certify-submit">{busy ? "Saving…" : me.certified ? "Update" : "Save"}</Button>
      </form>
    </Card>
  );
}
