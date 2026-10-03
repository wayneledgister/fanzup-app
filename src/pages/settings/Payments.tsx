import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Building2, CreditCard, Download, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Callout, Card, ChoiceCard, Container, EmptyState, Field, PageHeader, SectionHeading, Select, TextInput, Checkbox } from "@/components/brand";
import { Chip, Modal, useToast, formatDay } from "@/components/fan/kit";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FPS PaymentSetup.tsx (context=settings) + FanZuP BankingSystem.tsx.
 * Doc-driven (CONSOLIDATION, Concerns #5): FanZuP never holds a balance. Dropped the wallet balance, auto-sweep,
 * virtual card, cashback, "yield-to-spend" and "Apex Clearing"/FDIC claims. Campaign payments are held by our
 * escrow partner until the goal is met. Card processing is a 2.9% + $0.30 pass-through; platform fee TBD.
 */

interface Method {
  id: string;
  type: "card" | "bank";
  label: string;
  last4: string;
  detail: string;
  isDefault: boolean;
}

const INITIAL_METHODS: Method[] = [
  { id: "pm1", type: "card", label: "Visa", last4: "4242", detail: "Expires 08/28", isDefault: true },
  { id: "pm2", type: "bank", label: "Arvest Bank checking", last4: "6011", detail: "Verified Jun 2, 2026", isDefault: false },
];

type Kind = "Backing" | "Ticket" | "Merch" | "Subscription" | "Live session" | "Tip" | "Refund";

const HISTORY: { id: string; on: string; kind: Kind; description: string; amountMinor: number; status: "Held in escrow" | "Paid" | "Refunded" }[] = [
  { id: "t1", on: "2026-09-30", kind: "Subscription", description: "Nova Reyes — monthly subscription", amountMinor: 800, status: "Paid" },
  { id: "t2", on: "2026-09-24", kind: "Live session", description: "Velvet Circuit — Warehouse modular set", amountMinor: 1200, status: "Paid" },
  { id: "t3", on: "2026-09-12", kind: "Backing", description: "Take the band on the road — Two tickets + soundcheck", amountMinor: 15000, status: "Held in escrow" },
  { id: "t4", on: "2026-09-03", kind: "Merch", description: "Horn Section Tee (M)", amountMinor: 3000, status: "Paid" },
  { id: "t5", on: "2026-09-01", kind: "Subscription", description: "Sol Amara — monthly subscription", amountMinor: 500, status: "Paid" },
  { id: "t6", on: "2026-08-30", kind: "Backing", description: "Take the band on the road — Digital thank-you", amountMinor: 1000, status: "Held in escrow" },
  { id: "t7", on: "2026-08-18", kind: "Ticket", description: "Sol Amara — Headline Night × 2", amountMinor: 6000, status: "Paid" },
  { id: "t8", on: "2026-07-21", kind: "Backing", description: "Press our debut LP to vinyl — Vinyl + digital", amountMinor: 3500, status: "Paid" },
  { id: "t9", on: "2026-06-30", kind: "Refund", description: "Record the porch sessions — goal not met", amountMinor: -2500, status: "Refunded" },
];

const FILTERS = ["All", "Backing", "Ticket", "Merch", "Subscription", "Refund"] as const;

const INITIAL_SUBS = [
  { id: "s1", artist: "Nova Reyes", priceMinor: 800, renews: "2026-10-30", since: "2026-05-30" },
  { id: "s2", artist: "Sol Amara", priceMinor: 500, renews: "2026-11-01", since: "2026-06-03" },
];

export default function Payments() {
  const toast = useToast();
  const [methods, setMethods] = useState(INITIAL_METHODS);
  const [subs, setSubs] = useState(INITIAL_SUBS);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Method | null>(null);
  const [cancelling, setCancelling] = useState<(typeof INITIAL_SUBS)[number] | null>(null);

  const rows = HISTORY.filter((h) => filter === "All" || h.kind === filter);
  const inEscrow = HISTORY.filter((h) => h.status === "Held in escrow").reduce((s, h) => s + h.amountMinor, 0);

  const makeDefault = (id: string) => {
    setMethods((m) => m.map((x) => ({ ...x, isDefault: x.id === id })));
    toast.show("Default payment method updated.");
  };

  return (
    <Container size="lg" className="py-8 sm:py-10">
      <Link to="/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageHeader eyebrow="Settings" title="Payments" description="Payment methods, everything you've paid for, and your subscriptions." />

      <Callout tone="info" icon={<ShieldCheck />} title="FanZuP doesn't hold a balance for you" className="mb-8">
        We charge your saved method only when you buy or back something. Campaign payments go to our escrow partner and stay there until the goal is
        met — right now that's <span className="num text-fg">{formatMoney(inEscrow, { cents: true })}</span> across your live backings. If a goal is missed,
        you're refunded to the original method automatically.
      </Callout>

      {/* Methods */}
      <section className="mb-10">
        <SectionHeading
          title="Payment methods"
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add method
            </Button>
          }
        />
        {methods.length === 0 ? (
          <EmptyState icon={<CreditCard />} title="No payment methods yet">
            Add a card or bank account to back campaigns, buy tickets and subscribe.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {methods.map((m) => (
              <li key={m.id}>
                <Card className={cn("flex h-full flex-col gap-4 p-5", m.isDefault && "border-gold/40")}>
                  <div className="flex items-start gap-4">
                    <div className="flex size-12 items-center justify-center rounded-md border border-line bg-surface-2 text-muted [&_svg]:size-5">{m.type === "card" ? <CreditCard /> : <Building2 />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {m.label} <span className="num text-muted">•••• {m.last4}</span>
                      </p>
                      <p className="text-sm text-muted">{m.detail}</p>
                    </div>
                    {m.isDefault && <Badge tone="gold">Default</Badge>}
                  </div>
                  <div className="mt-auto flex gap-2 border-t border-line pt-3">
                    {!m.isDefault && (
                      <Button variant="ghost" size="sm" onClick={() => makeDefault(m.id)}>
                        Set as default
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRemoving(m)} disabled={m.isDefault && methods.length > 1} title={m.isDefault && methods.length > 1 ? "Choose another default first" : undefined}>
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Card details are stored by our payment processor, not by FanZuP. Card payments include a processing pass-through of 2.9% + $0.30.</p>
      </section>

      {/* Subscriptions */}
      <section className="mb-10">
        <SectionHeading title="Active subscriptions" />
        {subs.length === 0 ? (
          <EmptyState title="No active subscriptions">Subscribe to an artist to unlock their backstage drops.</EmptyState>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {subs.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.artist}</p>
                    <p className="text-sm text-muted">
                      <span className="num">{formatMoney(s.priceMinor, { cents: true })}</span>/month · renews <span className="num">{formatDay(s.renews)}</span>
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setCancelling(s)}>
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* History */}
      <section>
        <SectionHeading title="Payment history" action={<Link to="/settings/tax" className="text-sm text-gold hover:underline">Receipts</Link>} />
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter history">
          {FILTERS.map((f) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f === "All" ? "All" : f === "Refund" ? "Refunds" : f === "Merch" ? "Merch" : `${f}s`}
            </Chip>
          ))}
        </div>
        <Card padded={false} className="overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Nothing here yet.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Payment history</caption>
              <thead className="hidden border-b border-line text-left text-xs text-muted sm:table-header-group">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3"><span className="sr-only">Receipt</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((h) => (
                  <tr key={h.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-5 py-4 sm:table-row sm:p-0">
                    <td className="num order-3 text-xs text-muted sm:px-5 sm:py-4 sm:text-sm">{formatDay(h.on)}</td>
                    <td className="order-1 sm:px-5 sm:py-4">
                      <span className="block font-medium text-fg">{h.description}</span>
                      <span className="text-xs text-muted">{h.kind}</span>
                    </td>
                    <td className="order-4 justify-self-end sm:px-5 sm:py-4">
                      <Badge tone={h.status === "Held in escrow" ? "info" : h.status === "Refunded" ? "success" : "neutral"} icon={h.status === "Refunded" ? <RotateCcw /> : undefined}>
                        {h.status}
                      </Badge>
                    </td>
                    <td className={cn("num order-2 text-right sm:px-5 sm:py-4", h.amountMinor < 0 && "text-success")}>
                      {h.amountMinor < 0 ? "+" : ""}
                      {formatMoney(Math.abs(h.amountMinor), { cents: true })}
                    </td>
                    <td className="hidden sm:table-cell sm:px-3 sm:py-4">
                      <Button variant="ghost" size="icon" aria-label={`Download receipt for ${h.description}`}>
                        <Download />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <AddMethodDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(m) => {
          setMethods((cur) => [...cur.map((x) => (m.isDefault ? { ...x, isDefault: false } : x)), m]);
          toast.show(`${m.label} ending ${m.last4} added.`);
        }}
        first={methods.length === 0}
      />

      <Modal
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove payment method?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setMethods((m) => m.filter((x) => x.id !== removing?.id));
                toast.show("Payment method removed.");
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {removing?.label} ending <span className="num text-fg">{removing?.last4}</span> will be removed. Backings already held in escrow aren't affected — any refund still goes back to
          this method.
        </p>
      </Modal>

      <Modal
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel your ${cancelling?.artist} subscription?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              Stay subscribed
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setSubs((s) => s.filter((x) => x.id !== cancelling?.id));
                toast.show("Subscription cancelled.");
                setCancelling(null);
              }}
            >
              Cancel subscription
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          You'll keep access to backstage drops until <span className="num text-fg">{cancelling && formatDay(cancelling.renews)}</span>, then you won't be charged again. You'll also lose
          backer presale access that comes from this subscription.
        </p>
      </Modal>
      {toast.node}
    </Container>
  );
}

function AddMethodDialog({ open, onClose, onAdd, first }: { open: boolean; onClose: () => void; onAdd: (m: Method) => void; first: boolean }) {
  const [type, setType] = useState<"card" | "bank">("card");
  const [f, setF] = useState({ name: "", number: "", exp: "", cvc: "", zip: "", routing: "", account: "", accountType: "checking" });
  const [makeDefault, setMakeDefault] = useState(first);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const close = () => {
    onClose();
    window.setTimeout(() => {
      setF({ name: "", number: "", exp: "", cvc: "", zip: "", routing: "", account: "", accountType: "checking" });
      setErrors({});
      setType("card");
    }, 200);
  };
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = type === "card" ? "Enter the name on the card." : "Enter the account holder's name.";
    if (type === "card") {
      const digits = f.number.replace(/\s/g, "");
      if (!/^\d{15,16}$/.test(digits)) e.number = "Card numbers are 15 or 16 digits.";
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(f.exp)) e.exp = "Use MM/YY.";
      if (!/^\d{3,4}$/.test(f.cvc)) e.cvc = "3 or 4 digits.";
      if (!/^\d{5}$/.test(f.zip)) e.zip = "5-digit ZIP.";
    } else {
      if (!/^\d{9}$/.test(f.routing)) e.routing = "Routing numbers are 9 digits.";
      if (!/^\d{4,17}$/.test(f.account)) e.account = "Check the account number.";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    const last4 = (type === "card" ? f.number.replace(/\s/g, "") : f.account).slice(-4);
    onAdd({
      id: `pm${Date.now()}`,
      type,
      label: type === "card" ? (f.number.startsWith("5") ? "Mastercard" : f.number.startsWith("3") ? "American Express" : "Visa") : `Bank ${f.accountType}`,
      last4,
      detail: type === "card" ? `Expires ${f.exp}` : "Verification pending — 1–2 business days",
      isDefault: makeDefault,
    });
    close();
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Add a payment method"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit}>Save {type === "card" ? "card" : "bank account"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Method type">
          <ChoiceCard selected={type === "card"} onSelect={() => setType("card")} className="p-4">
            <CreditCard className="mb-2 size-5 text-gold" />
            <p className="text-sm font-medium">Card</p>
            <p className="text-xs text-muted">Debit or credit</p>
          </ChoiceCard>
          <ChoiceCard selected={type === "bank"} onSelect={() => setType("bank")} className="p-4">
            <Building2 className="mb-2 size-5 text-gold" />
            <p className="text-sm font-medium">Bank account</p>
            <p className="text-xs text-muted">US checking or savings</p>
          </ChoiceCard>
        </div>
        <Field label={type === "card" ? "Name on card" : "Account holder"} htmlFor="pm-name" error={errors.name}>
          <TextInput id="pm-name" autoComplete="cc-name" value={f.name} onChange={set("name")} aria-invalid={!!errors.name} />
        </Field>
        {type === "card" ? (
          <>
            <Field label="Card number" htmlFor="pm-number" error={errors.number}>
              <TextInput id="pm-number" inputMode="numeric" autoComplete="cc-number" placeholder="1234 1234 1234 1234" className="num" value={f.number} onChange={set("number")} aria-invalid={!!errors.number} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Expiry" htmlFor="pm-exp" error={errors.exp}>
                <TextInput id="pm-exp" placeholder="MM/YY" autoComplete="cc-exp" className="num" value={f.exp} onChange={set("exp")} aria-invalid={!!errors.exp} />
              </Field>
              <Field label="CVC" htmlFor="pm-cvc" error={errors.cvc}>
                <TextInput id="pm-cvc" inputMode="numeric" autoComplete="cc-csc" className="num" value={f.cvc} onChange={set("cvc")} aria-invalid={!!errors.cvc} />
              </Field>
              <Field label="ZIP" htmlFor="pm-zip" error={errors.zip}>
                <TextInput id="pm-zip" inputMode="numeric" autoComplete="postal-code" className="num" value={f.zip} onChange={set("zip")} aria-invalid={!!errors.zip} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Routing number" htmlFor="pm-routing" error={errors.routing}>
                <TextInput id="pm-routing" inputMode="numeric" className="num" value={f.routing} onChange={set("routing")} aria-invalid={!!errors.routing} />
              </Field>
              <Field label="Account number" htmlFor="pm-account" error={errors.account}>
                <TextInput id="pm-account" inputMode="numeric" className="num" value={f.account} onChange={set("account")} aria-invalid={!!errors.account} />
              </Field>
            </div>
            <Field label="Account type" htmlFor="pm-type">
              <Select id="pm-type" value={f.accountType} onChange={set("accountType")}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </Select>
            </Field>
            <p className="text-xs text-muted">We'll send two small test deposits to confirm the account. They're reversed automatically.</p>
          </>
        )}
        <Checkbox id="pm-default" checked={makeDefault} onChange={setMakeDefault}>
          Make this my default payment method
        </Checkbox>
      </div>
    </Modal>
  );
}
