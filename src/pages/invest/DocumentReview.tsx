import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, CheckCircle2, ChevronDown, Download, FileText, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Badge, Button, Callout, Card, Checkbox, Container, Field, InvestmentRiskDisclosure, KeyValue, PageHeader, RegulatoryFooter, TextInput,
} from "@/components/brand";
import { LimitMeter, OfferingEscrowNotice, PoolNotFound } from "@/components/invest/ui";
import { addMonths, COLLECTION_INFO, day, DEMO_INVESTOR, regCfUsage } from "@/components/invest/data";
import { artistById, poolById, type Pool } from "@/lib/mock";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/investment/DocumentReview.tsx (wireframe).
 * Changes: equity-style docs (pre-money valuation, common stock, "one vote per share", dilution) replaced
 * with revenue-share Pool documents — Form C, subscription agreement, risk factors. Each document must
 * be opened before it can be acknowledged; explicit loss / 12-month resale acknowledgments and a Reg CF
 * limit check gate the confirm button (PRD 01 §11).
 */
type DocKey = "formc" | "subscription" | "risks";

function docsFor(pool: Pool) {
  return [
    {
      key: "formc" as DocKey,
      title: "Form C",
      size: "1.8 MB PDF",
      description: "The issuer's offering statement filed with the SEC: the business, use of funds, the deal terms and the risks.",
      terms: [
        ["Issuer", artistById(pool.artistId).name],
        ["Target raise", formatMoney(pool.targetMinor)],
        ["Offering deadline", formatDate(day(pool.endsOn))],
        ["Use of funds", "Itemized in the Form C"],
      ],
    },
    {
      key: "subscription" as DocKey,
      title: "Subscription agreement",
      size: "640 KB PDF",
      description: "The contract you sign to buy Units: what you're paying, what you receive, and the transfer restrictions.",
      terms: [
        ["Security", "Revenue-share Units"],
        ["Unit price", formatMoney(pool.unitPriceMinor)],
        ["Revenue share", `${pool.revenueSharePct}% of covered revenue, split across all Units`],
        ["Cap and maturity", `${pool.returnCapMultiple}× or ${pool.maturityYears} years, whichever is first`],
      ],
    },
    {
      key: "risks" as DocKey,
      title: "Risk factors",
      size: "420 KB PDF",
      description: "The specific ways you could lose some or all of your money in this Pool.",
      terms: [
        ["Loss of money", "You may lose your entire investment"],
        ["Unsecured claim", "No collateral backs the revenue share"],
        ["Collection", COLLECTION_INFO[pool.collection].short],
        ["Resale", "None for 12 months; no marketplace after that"],
      ],
    },
  ];
}

export default function DocumentReview() {
  const { id = "" } = useParams();
  const pool = poolById(id);
  if (!pool) return <PoolNotFound />;
  return <Review pool={pool} />;
}

function Review({ pool }: { pool: Pool }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const units = Math.max(1, Math.floor(Number(params.get("units")) || 1));
  const total = units * pool.unitPriceMinor;
  const usage = regCfUsage();
  const withinLimit = total <= usage.remaining;
  const docs = docsFor(pool);

  const [opened, setOpened] = useState<Record<DocKey, boolean>>({ formc: false, subscription: false, risks: false });
  const [expanded, setExpanded] = useState<DocKey | null>(null);
  const [acked, setAcked] = useState<Record<DocKey, boolean>>({ formc: false, subscription: false, risks: false });
  const [ack, setAck] = useState({ loss: false, resale: false, payouts: false, cancel: false });
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const allDocs = docs.every((d) => acked[d.key]);
  const allAcks = Object.values(ack).every(Boolean);
  const signed = name.trim().length >= 3;
  const ready = allDocs && allAcks && signed && withinLimit;
  const doneCount = docs.filter((d) => acked[d.key]).length;

  const open = (k: DocKey) => {
    setOpened((o) => ({ ...o, [k]: true }));
    setExpanded((e) => (e === k ? null : k));
  };

  const confirm = () => {
    setTouched(true);
    if (!ready) return;
    setSubmitting(true);
    window.setTimeout(() => navigate(`/invest/${pool.id}/confirmation?units=${units}`), 1000);
  };

  return (
    <Container size="md" className="flex flex-col gap-8 py-8 sm:py-10">
      <Link to={`/pools/${pool.id}`} className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back to offering
      </Link>
      <PageHeader eyebrow="Review & sign" title="Read the documents before you invest" description="Open each document, confirm you've read it, then sign. Nothing is charged until you confirm." className="pb-0" />

      <Card className="flex flex-col gap-1">
        <span className="eyebrow">Your investment</span>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold">{pool.title}</p>
          <span className="num text-2xl font-medium text-fg">{formatMoney(total)}</span>
        </div>
        <p className="text-sm text-muted">
          <span className="num">{units}</span> {units === 1 ? "Unit" : "Units"} × <span className="num">{formatMoney(pool.unitPriceMinor)}</span> · paid from{" "}
          {DEMO_INVESTOR.paymentMethod}
        </p>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">Offering documents</h2>
          <span className="num text-sm text-muted">
            {doneCount}/{docs.length} acknowledged
          </span>
        </div>
        {docs.map((d) => {
          const isOpen = expanded === d.key;
          return (
            <Card key={d.key} padded={false} className={cn("overflow-hidden", acked[d.key] && "border-success/40")}>
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 gap-4">
                  <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-md border", acked[d.key] ? "border-success/30 bg-success/12 text-success" : "border-line bg-surface-2 text-muted")}>
                    {acked[d.key] ? <CheckCircle2 className="size-5" /> : <FileText className="size-5" />}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                      {d.title}
                      {d.key === "formc" && <Badge tone="info">Required by Reg CF</Badge>}
                    </p>
                    <p className="text-sm text-muted">{d.description}</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => open(d.key)} aria-expanded={isOpen}>
                    {isOpen ? "Close" : opened[d.key] ? "Open again" : "Open"}
                    <ChevronDown className={cn("transition-transform", isOpen && "rotate-180")} />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Download ${d.title} (${d.size})`} onClick={() => setOpened((o) => ({ ...o, [d.key]: true }))}>
                    <Download />
                  </Button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-line bg-surface-2 p-5">
                  <p className="eyebrow mb-2">Key terms · {d.size}</p>
                  <dl className="divide-y divide-line">
                    {d.terms.map(([k, v]) => (
                      <KeyValue key={k} k={k} v={v} />
                    ))}
                  </dl>
                  <p className="mt-3 text-xs text-muted">This is a summary. The full document is legally binding — read it in full or download a copy for your records.</p>
                </div>
              )}
              <div className="border-t border-line px-5 py-4">
                <Checkbox
                  id={`ack-${d.key}`}
                  checked={acked[d.key]}
                  onChange={(v) => opened[d.key] && setAcked((a) => ({ ...a, [d.key]: v }))}
                  className={cn(!opened[d.key] && "cursor-not-allowed opacity-50")}
                >
                  {opened[d.key] ? `I've read the ${d.title}.` : `Open the ${d.title} to acknowledge it.`}
                </Checkbox>
              </div>
            </Card>
          );
        })}
        {touched && !allDocs && <p className="text-sm text-error">Open and acknowledge each document to continue.</p>}
      </section>

      <InvestmentRiskDisclosure />

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Please confirm you understand</h2>
        <Checkbox id="ack-loss" checked={ack.loss} onChange={(v) => setAck((a) => ({ ...a, loss: v }))}>
          I understand I may lose my entire investment.
        </Checkbox>
        <Checkbox id="ack-resale" checked={ack.resale} onChange={(v) => setAck((a) => ({ ...a, resale: v }))}>
          I understand I can't resell my Units for 12 months (until about <span className="num text-fg">{formatDate(day(addMonths(pool.endsOn, 12)))}</span>), and
          there's no marketplace to sell them after that.
        </Checkbox>
        <Checkbox id="ack-payouts" checked={ack.payouts} onChange={(v) => setAck((a) => ({ ...a, payouts: v }))}>
          I understand payouts depend on revenue actually collected, may be zero, and can never exceed <span className="num text-fg">{pool.returnCapMultiple}×</span> what I
          paid.
        </Checkbox>
        <Checkbox id="ack-cancel" checked={ack.cancel} onChange={(v) => setAck((a) => ({ ...a, cancel: v }))}>
          I understand I can cancel up to 48 hours before the offering closes, and after that my commitment is final.
        </Checkbox>
        {touched && !allAcks && <p className="text-sm text-error">Please confirm each statement.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Reg CF limit check</h2>
        <Card className="flex flex-col gap-3">
          <LimitMeter limit={usage.limit} used={usage.used} extra={Math.min(total, usage.limit)} />
          {withinLimit ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <ShieldCheck className="size-4" aria-hidden /> This investment fits within your 12-month limit.
            </p>
          ) : (
            <Callout tone="error" icon={<ShieldAlert />} title="This is over your limit">
              You have <span className="num text-fg">{formatMoney(usage.remaining)}</span> left this 12 months.{" "}
              <Link to={`/pools/${pool.id}`} className="text-fg underline underline-offset-4">
                Choose fewer Units
              </Link>{" "}
              or{" "}
              <Link to="/investor/certification" className="text-fg underline underline-offset-4">
                update your certification
              </Link>
              .
            </Callout>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Sign</h2>
        <Field
          label="Type your full legal name"
          htmlFor="signature"
          hint="Typing your name is your electronic signature on the subscription agreement. We record the date, time and your IP address."
          error={touched && !signed ? "Type your full legal name to sign." : undefined}
        >
          <TextInput id="signature" autoComplete="name" placeholder={DEMO_INVESTOR.name} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !signed} />
        </Field>
        {signed && <p className="font-display text-2xl italic text-fg">{name}</p>}
      </section>

      <OfferingEscrowNotice />

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <Button size="lg" block onClick={confirm} disabled={submitting || !withinLimit}>
          {submitting ? (
            <>
              <Loader2 className="animate-spin" /> Submitting…
            </>
          ) : (
            <>Confirm investment of {formatMoney(total)}</>
          )}
        </Button>
        {touched && !ready && withinLimit && <p className="text-center text-sm text-error">A few items above still need your attention.</p>}
        <p className="text-center text-xs text-muted">Your money moves into escrow, not to the artist. You can cancel up to 48 hours before the offering closes.</p>
      </div>

      <RegulatoryFooter />
    </Container>
  );
}
