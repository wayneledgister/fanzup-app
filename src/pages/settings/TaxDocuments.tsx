import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, CheckCircle2, Download, FileText, Info, Receipt } from "lucide-react";
import { Badge, Button, Callout, Card, Checkbox, Container, Field, FormCLink, KeyValue, PageHeader, SectionHeading, Select, TextInput, WhenFlag } from "@/components/brand";
import { Modal, useToast } from "@/components/fan/kit";
import { fan } from "@/lib/mock";
import { formatMoney } from "@/lib/format";

/**
 * Source: FanZuP TaxCenter.tsx / TaxPortal.
 * Doc-driven: "Institutional Tax Center", "Automated revenue harvesting" and "Run annual harvest" removed.
 * Layer 1: fan purchases (backings, tickets, merch, subscriptions) produce receipts, not tax forms (Mechanism 05 §4).
 * Layer 2 (`layer2`): 1099-DIV for Pool distributions (Mechanism 04 Decision 1; council D1 Blocker 2 — was 1099-MISC),
 * cost basis notes and W-9 update (PRD 01 §11.1). Final form type per offering confirmed by tax counsel (D1 Card C).
 */

const RECEIPTS = [
  { year: 2026, count: 14, totalMinor: 43_400, months: "Jan – Sep" },
  { year: 2025, count: 0, totalMinor: 0, months: "" },
];

const FORMS = [
  { id: "f1", year: 2026, form: "1099-DIV", pool: "Kai Marlo — next two albums", amountMinor: 3_140, costBasisMinor: 50_000, status: "Available Jan 31, 2027" as const },
  { id: "f2", year: 2026, form: "1099-DIV", pool: "Velvet Circuit — 2027 tour", amountMinor: 0, costBasisMinor: 20_000, status: "No form needed" as const },
];

export default function TaxDocuments() {
  const toast = useToast();
  const [w9Open, setW9Open] = useState(false);
  const [w9OnFile, setW9OnFile] = useState(false);

  return (
    <Container size="md" className="py-8 sm:py-10">
      <Link to="/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageHeader eyebrow="Settings" title="Tax documents" description="Receipts for everything you buy on FanZuP, and any tax forms that apply to you." />

      <Callout tone="info" icon={<Info />} title="Backing a campaign is a purchase, not income" className="mb-8">
        When you back a campaign, buy tickets or merch, subscribe or tip, you're paying for perks and products. There's nothing to report and no tax
        forms are issued for them. Download your receipts below if you need them for your own records.
      </Callout>

      <section className="mb-10">
        <SectionHeading title="Receipts" />
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {RECEIPTS.map((r) => (
              <li key={r.year} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="flex size-10 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                  <Receipt className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="num">{r.year}</span> receipts
                  </p>
                  <p className="text-sm text-muted">
                    {r.count ? (
                      <>
                        <span className="num">{r.count}</span> payments · <span className="num">{formatMoney(r.totalMinor, { cents: true })}</span> · {r.months}
                      </>
                    ) : (
                      `No payments — you joined in ${new Date(fan.joined).getUTCFullYear()}.`
                    )}
                  </p>
                </div>
                <Button variant="secondary" size="sm" disabled={!r.count} onClick={() => toast.show(`${r.year} receipts downloading (PDF).`)}>
                  <Download /> PDF
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        <p className="mt-3 text-sm text-muted">
          Need a single receipt? Find it in <Link to="/settings/payments" className="text-gold hover:underline">payment history</Link>.
        </p>
      </section>

      <WhenFlag flag="layer2">
        <section className="flex flex-col gap-4">
          <SectionHeading eyebrow="Investments" title="Pool tax forms" />
          <p className="text-sm text-muted">
            If you hold Units in a Pool and receive distributions, you get a Form 1099-DIV for each year you were paid. The exact form for each offering is
            confirmed by tax counsel and stated in its Form C. Your cost basis (what you paid for your Units) is shown alongside so you or your tax
            professional can report correctly.
          </p>

          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-start gap-3">
              {w9OnFile ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <FileText className="mt-0.5 size-5 shrink-0 text-warning" />}
              <div>
                <p className="font-medium">Tax info (W-9) {w9OnFile ? <Badge tone="success">On file</Badge> : <Badge tone="warning">Needs update</Badge>}</p>
                <p className="text-sm text-muted">
                  {w9OnFile ? "Taxpayer ID ending ••• •• 4821, certified today." : "A current W-9 is required before you can invest, and before we can issue your 1099 or send distributions."}
                </p>
              </div>
            </div>
            <Button variant={w9OnFile ? "secondary" : "primary"} onClick={() => setW9Open(true)}>
              Update tax info (W-9)
            </Button>
          </Card>

          <Card padded={false}>
            <ul className="divide-y divide-line">
              {FORMS.map((f) => (
                <li key={f.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        <span className="num">{f.year}</span> · Form <span className="num">{f.form}</span>
                      </p>
                      <p className="text-sm text-muted">{f.pool}</p>
                    </div>
                    <Badge tone={f.status === "No form needed" ? "neutral" : "warning"}>{f.status}</Badge>
                  </div>
                  <div className="grid gap-x-8 rounded-md border border-line bg-surface-2 px-4 py-1 sm:grid-cols-2">
                    <KeyValue k="Distributions received" v={<span className="num">{formatMoney(f.amountMinor, { cents: true })}</span>} />
                    <KeyValue k="Cost basis" v={<span className="num">{formatMoney(f.costBasisMinor, { cents: true })}</span>} />
                  </div>
                  <p className="text-xs text-muted">
                    {f.amountMinor > 0
                      ? "Cost basis is what you paid for your Units in this Pool. Keep it with your records."
                      : "No distributions were paid this year, so no 1099 will be issued. Your cost basis carries forward."}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-muted">
            FanZuP doesn't give tax advice. Talk to a tax professional about your situation. <FormCLink>Read the Form C</FormCLink>
          </p>
        </section>
      </WhenFlag>

      <W9Dialog
        open={w9Open}
        onClose={() => setW9Open(false)}
        onSave={() => {
          setW9OnFile(true);
          toast.show("Tax info saved.");
        }}
      />
      {toast.node}
    </Container>
  );
}

function W9Dialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: () => void }) {
  const [f, setF] = useState({ name: fan.name, tinType: "SSN", tin: "", address: "", certify: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Enter your legal name as it appears on your tax return.";
    if (!/^\d{9}$/.test(f.tin.replace(/-/g, ""))) e.tin = `${f.tinType} must be 9 digits.`;
    if (f.address.trim().length < 8) e.address = "Enter your full mailing address.";
    if (!f.certify) e.certify = "You need to certify to continue.";
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave();
    onClose();
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Update tax info (W-9)"
      description="Used only to issue your 1099. Encrypted and never shown in full."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Certify and save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Legal name" htmlFor="w9-name" error={errors.name}>
          <TextInput id="w9-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!errors.name} />
        </Field>
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <Field label="ID type" htmlFor="w9-type">
            <Select id="w9-type" value={f.tinType} onChange={(e) => setF({ ...f, tinType: e.target.value })}>
              <option>SSN</option>
              <option>ITIN</option>
            </Select>
          </Field>
          <Field label="Taxpayer ID" htmlFor="w9-tin" error={errors.tin}>
            <TextInput id="w9-tin" type="password" inputMode="numeric" autoComplete="off" className="num" value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} aria-invalid={!!errors.tin} />
          </Field>
        </div>
        <Field label="Mailing address" htmlFor="w9-addr" error={errors.address}>
          <TextInput id="w9-addr" autoComplete="street-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} aria-invalid={!!errors.address} />
        </Field>
        <div className="flex flex-col gap-1">
          <Checkbox id="w9-cert" checked={f.certify} onChange={(v) => setF({ ...f, certify: v })}>
            Under penalties of perjury, I certify the taxpayer ID above is correct, I'm not subject to backup withholding, and I'm a U.S. person.
          </Checkbox>
          {errors.certify && <p className="pl-7 text-sm text-error">{errors.certify}</p>}
        </div>
      </div>
    </Modal>
  );
}
