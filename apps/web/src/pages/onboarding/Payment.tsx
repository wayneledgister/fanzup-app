import { useState } from "react";
import { useNavigate } from "react-router";
import { CircleHelp, CreditCard, Landmark, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Callout, Card, Field, IconChip, TextInput } from "@/components/brand";
import { OnboardingFooter, OnboardingHeader } from "@/components/public/onboarding";
import { cn } from "@/lib/utils";

/**
 * Source: FPS payment/PaymentSetup.tsx (context=onboarding).
 * Doc-driven changes: payment methods only — no stored balance, wallet top-up or custody claims (CONSOLIDATION
 * "Fan money custody"). Adds the escrow explanation: you're charged only when you back something, and that money is
 * held by our escrow partner. Bank connection partner isn't named (not confirmed in docs). Card form stands in for
 * the processor's hosted fields; nothing is stored in the prototype.
 */

interface Method {
  id: string;
  kind: "card" | "bank";
  label: string;
  detail: string;
  isDefault: boolean;
}

function brand(num: string) {
  const n = num.replace(/\s/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^6(011|5)/.test(n)) return "Discover";
  return "Card";
}

export default function Payment() {
  const navigate = useNavigate();
  const [methods, setMethods] = useState<Method[]>([]);
  const [adding, setAdding] = useState<"card" | "bank" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const add = (m: Omit<Method, "id" | "isDefault">) => {
    setMethods((ms) => [...ms, { ...m, id: crypto.randomUUID(), isDefault: ms.length === 0 }]);
    setAdding(null);
  };
  const remove = (id: string) => {
    setMethods((ms) => {
      const wasDefault = ms.find((m) => m.id === id)?.isDefault;
      const rest = ms.filter((m) => m.id !== id);
      if (wasDefault && rest.length) rest[0] = { ...rest[0], isDefault: true };
      return rest;
    });
    setRemoving(null);
  };
  const makeDefault = (id: string) => setMethods((ms) => ms.map((m) => ({ ...m, isDefault: m.id === id })));

  return (
    <div>
      <OnboardingHeader step={5} title="Add a payment method" description="So you're ready the moment a campaign you love goes live. Nothing is charged now." />

      <Callout tone="gold" icon={<ShieldCheck />} title="You're only charged when you back something">
        When you back a campaign, your payment is held by our escrow partner until the goal is met — and refunded automatically if it
        isn't. FanZuP never keeps a balance for you.
      </Callout>

      <div className="mt-8 flex flex-col gap-3">
        <p className="eyebrow">Express</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" size="lg" onClick={() => add({ kind: "card", label: "Apple Pay", detail: "Device wallet" })}>
            Apple Pay
          </Button>
          <Button variant="secondary" size="lg" onClick={() => add({ kind: "card", label: "Google Pay", detail: "Device wallet" })}>
            Google Pay
          </Button>
        </div>
        <p className="text-xs text-muted">Shown only on devices that support them.</p>
      </div>

      {methods.length > 0 && (
        <section className="mt-8 flex flex-col gap-3" aria-labelledby="saved-h">
          <h2 id="saved-h" className="eyebrow">
            Saved methods
          </h2>
          {methods.map((m) => (
            <Card key={m.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <IconChip tone="muted">{m.kind === "card" ? <CreditCard /> : <Landmark />}</IconChip>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.label}</p>
                  <p className="num text-sm text-muted">{m.detail}</p>
                </div>
                {m.isDefault ? (
                  <Badge tone="gold">Default</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => makeDefault(m.id)}>
                    Set default
                  </Button>
                )}
                <Button variant="ghost" size="icon" aria-label={`Remove ${m.label}`} onClick={() => setRemoving(m.id)}>
                  <Trash2 />
                </Button>
              </div>
              {removing === m.id && (
                <div className="flex flex-col gap-3 rounded-md border border-error/30 bg-error/8 p-3 sm:flex-row sm:items-center sm:justify-between" role="alertdialog" aria-label="Confirm removal">
                  <p className="text-sm">
                    Remove this payment method?{m.isDefault && methods.length > 1 && <span className="text-muted"> Your next saved method becomes the default.</span>}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setRemoving(null)}>
                      Keep
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => remove(m.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </section>
      )}

      <section className="mt-8 flex flex-col gap-3" aria-labelledby="add-h">
        <h2 id="add-h" className="eyebrow">
          {methods.length ? "Add another" : "Or add"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <AddOption active={adding === "card"} icon={<CreditCard />} title="Credit or debit card" sub="Visa, Mastercard, Amex, Discover" onClick={() => setAdding(adding === "card" ? null : "card")} />
          <AddOption active={adding === "bank"} icon={<Landmark />} title="Bank account" sub="US checking or savings (ACH)" onClick={() => setAdding(adding === "bank" ? null : "bank")} />
        </div>
        {adding === "card" && <CardForm onCancel={() => setAdding(null)} onSave={(last4, b) => add({ kind: "card", label: b, detail: `•••• ${last4}` })} />}
        {adding === "bank" && (
          <Card className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              You'll log in to your bank through our secure bank-connection partner. FanZuP never sees or stores your banking password.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button onClick={() => add({ kind: "bank", label: "Checking account", detail: "•••• 6789" })}>Connect bank</Button>
            </div>
          </Card>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Lock className="size-3.5" /> Card details are encrypted and handled by our payment processor, Stripe.
        </p>
      </section>

      <OnboardingFooter
        back="/onboarding/discover"
        skip={
          <Button variant="ghost" size="lg" onClick={() => navigate("/onboarding/complete")}>
            Skip for now
          </Button>
        }
        primary={
          <Button size="lg" disabled={!methods.length} onClick={() => navigate("/onboarding/complete")}>
            Continue
          </Button>
        }
      />
    </div>
  );
}

function AddOption({ active, icon, title, sub, onClick }: { active: boolean; icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={cn("flex items-center gap-3 rounded-lg border bg-surface p-4 text-left transition-colors", active ? "border-gold" : "border-line hover:bg-surface-2")}
    >
      <IconChip tone={active ? "gold" : "muted"}>{icon}</IconChip>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      <Plus className={cn("size-4 text-muted transition-transform", active && "rotate-45")} />
    </button>
  );
}

function CardForm({ onCancel, onSave }: { onCancel: () => void; onSave: (last4: string, brand: string) => void }) {
  const [num, setNum] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [cvcHelp, setCvcHelp] = useState(false);
  const digits = num.replace(/\s/g, "");
  const b = brand(num);
  const [mm, yy] = exp.split("/");
  const expOk = /^\d{2}\/\d{2}$/.test(exp) && +mm >= 1 && +mm <= 12 && new Date(2000 + +yy, +mm) > new Date();
  const errs = {
    num: digits.length < 15 ? "Enter the full card number." : undefined,
    exp: !expOk ? "Enter a valid expiry date (MM/YY)." : undefined,
    cvc: cvc.length < (b === "Amex" ? 4 : 3) ? "Enter the security code." : undefined,
    name: !name.trim() ? "Enter the name on the card." : undefined,
  };
  const e = (k: keyof typeof errs) => (submitted ? errs[k] : undefined);

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setSubmitted(true);
          if (Object.values(errs).some(Boolean)) return;
          onSave(digits.slice(-4), b);
        }}
      >
        <Field label="Card number" htmlFor="cc-number" error={e("num")}>
          <div className="relative">
            <TextInput
              id="cc-number"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 1234 1234 1234"
              value={num}
              onChange={(x) => setNum(x.target.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 "))}
              aria-invalid={!!e("num") || undefined}
              className="num pr-28"
            />
            {digits && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted">{b}</span>}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Expiry" htmlFor="cc-exp" error={e("exp")}>
            <TextInput
              id="cc-exp"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              value={exp}
              onChange={(x) => {
                const d = x.target.value.replace(/\D/g, "").slice(0, 4);
                setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
              }}
              aria-invalid={!!e("exp") || undefined}
              className="num"
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor="cc-cvc" className="text-sm font-medium">
                Security code
              </label>
              <button type="button" aria-label="What's this?" aria-expanded={cvcHelp} onClick={() => setCvcHelp((v) => !v)} className="text-muted hover:text-fg">
                <CircleHelp className="size-4" />
              </button>
            </div>
            <TextInput id="cc-cvc" inputMode="numeric" autoComplete="cc-csc" placeholder={b === "Amex" ? "4 digits" : "3 digits"} value={cvc} onChange={(x) => setCvc(x.target.value.replace(/\D/g, "").slice(0, 4))} aria-invalid={!!e("cvc") || undefined} className="num" />
            {e("cvc") ? <p className="text-sm text-error">{e("cvc")}</p> : cvcHelp && <p className="text-sm text-muted">3 digits on the back of your card. Amex: 4 digits on the front.</p>}
          </div>
        </div>
        <Field label="Name on card" htmlFor="cc-name" error={e("name")}>
          <TextInput id="cc-name" autoComplete="cc-name" value={name} onChange={(x) => setName(x.target.value)} aria-invalid={!!e("name") || undefined} placeholder="As it appears on your card" />
        </Field>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save card</Button>
        </div>
      </form>
    </Card>
  );
}
