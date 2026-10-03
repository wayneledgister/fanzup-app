import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Ban, BadgeCheck, Building2, CheckCircle2, Clock, FileCheck2, Minus, Plus, Receipt, Users, UserRoundCheck } from "lucide-react";
import {
  Badge, Button, Callout, Card, Checkbox, ChoiceCard, Container, Field, IconChip, KeyValue, LockupNotice, PageHeader, RegulatoryFooter, Select, TextInput,
} from "@/components/brand";
import { PoolNotFound } from "@/components/invest/ui";
import { day, holdingViews, TODAY } from "@/components/invest/data";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FanZuP-Draft SecondaryMarket.tsx — rebuilt as the Mechanism 07 P1 soft-transfer request.
 * Changes: order book, prices, volume, "liquidity vault" and ETH settlement removed. This is a request
 * form only: recipient type limited by the Reg CF resale rules, no price discovery and no marketplace;
 * eligibility is re-checked and the transfer agent records the transfer.
 */
type Recipient = "issuer" | "accredited" | "family" | "anyone";

const RECIPIENTS: { id: Recipient; icon: React.ReactNode; t: string; d: string; afterLockup?: boolean }[] = [
  { id: "issuer", icon: <Building2 />, t: "Back to the issuer", d: "The artist's Pool entity takes the Units back, if it agrees to." },
  { id: "accredited", icon: <BadgeCheck />, t: "An accredited investor", d: "They'll need to verify their accredited status." },
  { id: "family", icon: <Users />, t: "A family member", d: "Including a spouse, parent, child, sibling or in-law, or a trust for them." },
  { id: "anyone", icon: <UserRoundCheck />, t: "Any eligible person", d: "Available once your 12-month lock-up ends.", afterLockup: true },
];

const RELATIONSHIPS = ["Spouse or spousal equivalent", "Parent or step-parent", "Child or step-child", "Sibling", "Grandparent or grandchild", "In-law", "Trust for a family member"];

export default function SoftTransfer() {
  const { poolId = "" } = useParams();
  const v = holdingViews().find((x) => x.pool.id === poolId);
  if (!v) return <PoolNotFound backTo="/portfolio" backLabel="Back to Portfolio" />;
  return <TransferForm v={v} />;
}

function TransferForm({ v }: { v: ReturnType<typeof holdingViews>[number] }) {
  const { pool, holding } = v;
  const locked = new Date(day(holding.unlocksOn)) > TODAY;
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [units, setUnits] = useState(1);
  const [ack, setAck] = useState({ noMarket: false, tax: false });
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const errors = {
    recipient: !recipient ? "Choose who you're transferring to." : undefined,
    name: recipient && recipient !== "issuer" && name.trim().length < 3 ? "Enter the recipient's full legal name." : undefined,
    email: recipient && recipient !== "issuer" && !emailOk ? "Enter a valid email so we can invite them to verify." : undefined,
    relationship: recipient === "family" && !relationship ? "Choose how you're related." : undefined,
    units: units < 1 || units > holding.units ? `Choose between 1 and ${holding.units} Units.` : undefined,
    ack: !ack.noMarket || !ack.tax ? "Please confirm both statements." : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const submit = () => {
    setTouched(true);
    if (valid) setSubmitted(true);
  };
  const recipientLabel = RECIPIENTS.find((r) => r.id === recipient)?.t ?? "";

  if (submitted) {
    return (
      <Container size="md" className="flex flex-col gap-8 py-10">
        <Card className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full border border-success/30 bg-success/12 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <Badge tone="warning">Request received</Badge>
          <h1 className="text-3xl font-bold">We've sent your transfer request</h1>
          <p className="max-w-md text-muted">
            Nothing changes in your Portfolio until the transfer agent records the transfer. We'll keep you posted by email.
          </p>
        </Card>
        <Card>
          <dl className="divide-y divide-line">
            <KeyValue k="Pool" v={pool.title} />
            <KeyValue k="Units" v={<span className="num">{units}</span>} />
            <KeyValue k="Recipient" v={recipient === "issuer" ? "The issuer" : `${name} · ${recipientLabel.toLowerCase()}`} />
            <KeyValue k="Reference" v={<span className="num">TR-{pool.id.slice(0, 4).toUpperCase()}-0412</span>} />
          </dl>
        </Card>
        <ol className="flex flex-col gap-4">
          {[
            { i: <UserRoundCheck />, t: "Eligibility check", d: recipient === "issuer" ? "The issuer confirms it will take the Units back." : "The recipient creates or signs in to a FanZuP account and verifies their identity and eligibility." },
            { i: <FileCheck2 />, t: "Transfer agent review", d: "The transfer agent checks the request against the Reg CF resale rules and the Pool's documents." },
            { i: <Clock />, t: "Recorded", d: "Once recorded, the Units and any future distributions move to the recipient. This usually takes 5–10 business days." },
          ].map((s) => (
            <li key={s.t} className="flex gap-4">
              <IconChip tone="muted">{s.i}</IconChip>
              <div>
                <p className="font-medium text-fg">{s.t}</p>
                <p className="text-sm text-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button asChild className="self-start">
          <Link to={`/portfolio/${pool.id}`}>Back to holding</Link>
        </Button>
      </Container>
    );
  }

  return (
    <Container size="md" className="flex flex-col gap-8 py-8 sm:py-10">
      <Link to={`/portfolio/${pool.id}`} className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> {pool.title}
      </Link>
      <PageHeader
        eyebrow="Permitted transfer"
        title="Request a transfer of your Units"
        description="Reg CF only allows certain transfers, especially in the first 12 months. Tell us who you want to transfer to and we'll handle the checks."
        className="pb-0"
      />

      <Callout tone="info" icon={<Ban />} title="FanZuP doesn't run a marketplace">
        We don't list Units for sale, match buyers and sellers, suggest or display prices, or handle payment between you and the recipient. This form
        only asks the transfer agent to record a transfer you've already arranged.
      </Callout>

      <LockupNotice unlocksOn={day(holding.unlocksOn)} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-lg font-semibold">Who are you transferring to?</legend>
        <div role="radiogroup" aria-label="Recipient type" className="grid gap-3 sm:grid-cols-2">
          {RECIPIENTS.map((r) => {
            const disabled = r.afterLockup && locked;
            return (
              <ChoiceCard key={r.id} selected={recipient === r.id} onSelect={() => setRecipient(r.id)} disabled={disabled} className="flex gap-4">
                <IconChip tone={recipient === r.id ? "gold" : "muted"}>{r.icon}</IconChip>
                <div className="flex flex-col gap-1">
                  <p className="font-semibold text-fg">{r.t}</p>
                  <p className="text-sm text-muted">{disabled ? `Available from ${formatDate(day(holding.unlocksOn))}.` : r.d}</p>
                </div>
              </ChoiceCard>
            );
          })}
        </div>
        {touched && errors.recipient && <p className="text-sm text-error">{errors.recipient}</p>}
      </fieldset>

      {recipient && recipient !== "issuer" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Recipient details</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Full legal name" htmlFor="r-name" error={touched ? errors.name : undefined}>
              <TextInput id="r-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-invalid={touched && !!errors.name} />
            </Field>
            <Field label="Email" htmlFor="r-email" hint="We'll invite them to verify." error={touched ? errors.email : undefined}>
              <TextInput id="r-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={touched && !!errors.email} />
            </Field>
            {recipient === "family" && (
              <Field label="Relationship to you" htmlFor="r-rel" error={touched ? errors.relationship : undefined} className="sm:col-span-2">
                <Select id="r-rel" value={relationship} onChange={(e) => setRelationship(e.target.value)} aria-invalid={touched && !!errors.relationship}>
                  <option value="">Choose one</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <p className="text-sm text-muted">
            {recipient === "accredited"
              ? "Before the transfer is recorded, the recipient must verify their identity and accredited status with our intermediary."
              : "Before the transfer is recorded, the recipient must verify their identity, and we re-check that the transfer is permitted."}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <label htmlFor="t-units" className="text-lg font-semibold">
          Units to transfer
        </label>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Fewer Units" onClick={() => setUnits((u) => Math.max(1, u - 1))} disabled={units <= 1}>
            <Minus />
          </Button>
          <input
            id="t-units"
            type="number"
            min={1}
            max={holding.units}
            value={units}
            onChange={(e) => setUnits(Math.floor(Number(e.target.value) || 0))}
            className="num h-11 w-24 rounded-md border border-line bg-surface-2 text-center text-lg text-fg focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
          <Button variant="secondary" size="icon" aria-label="More Units" onClick={() => setUnits((u) => Math.min(holding.units, u + 1))} disabled={units >= holding.units}>
            <Plus />
          </Button>
          <span className="text-sm text-muted">
            of <span className="num">{holding.units}</span> you hold
          </span>
        </div>
        {touched && errors.units && <p className="text-sm text-error">{errors.units}</p>}
      </section>

      <Callout tone="info" icon={<Receipt />} title="Tax note">
        If you receive money or anything of value for your Units, that may be a sale for tax purposes and you may receive a Form 1099-B. Gifts can
        have their own reporting rules. FanZuP doesn't give tax advice — talk to a tax professional.
      </Callout>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <Checkbox id="t-nomarket" checked={ack.noMarket} onChange={(c) => setAck((a) => ({ ...a, noMarket: c }))}>
          I understand FanZuP doesn't run a marketplace, set prices or handle payment, and that the transfer agent may decline a transfer that isn't
          permitted.
        </Checkbox>
        <Checkbox id="t-tax" checked={ack.tax} onChange={(c) => setAck((a) => ({ ...a, tax: c }))}>
          I understand a transfer may have tax consequences for me, including a possible Form 1099-B.
        </Checkbox>
        {touched && errors.ack && <p className="text-sm text-error">{errors.ack}</p>}
      </section>

      <div className={cn("flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between")}>
        <Button asChild variant="ghost">
          <Link to={`/portfolio/${pool.id}`}>Cancel</Link>
        </Button>
        <Button onClick={submit}>
          Submit request <ArrowRight />
        </Button>
      </div>

      <RegulatoryFooter />
    </Container>
  );
}
