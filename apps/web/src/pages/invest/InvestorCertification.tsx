import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Calculator, CheckCircle2, Info, Scale, TriangleAlert } from "lucide-react";
import { Badge, Button, Callout, Card, Checkbox, ChoiceCard, Field, IconChip, KeyValue, TextInput } from "@/components/brand";
import { WizardFooter } from "@/components/invest/ui";
import { formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup src/pages/investor/InvestorCertification.tsx (wireframe).
 * Changes: the wireframe hard-coded 2024 dollar thresholds and used "the lesser of" income/net worth.
 * Per the current rule the limit is based on the GREATER of the two; dollar thresholds, the minimum
 * and the annual maximum are SEC-set and inflation-adjusted, so they're described, not hard-coded.
 * The figure shown is an illustrative example; the intermediary confirms the exact limit.
 */
type Accredited = "no" | "yes" | null;

function toMinor(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) * 100 : null;
}

function MoneyInput({ id, label, hint, value, onChange, error }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        <TextInput
          id={id}
          inputMode="numeric"
          autoComplete="off"
          className="num pl-7"
          placeholder="0"
          value={value}
          aria-invalid={!!error}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
            onChange(digits ? Number(digits).toLocaleString("en-US") : "");
          }}
        />
      </div>
    </Field>
  );
}

export default function InvestorCertification() {
  const [accredited, setAccredited] = useState<Accredited>(null);
  const [income, setIncome] = useState("");
  const [netWorth, setNetWorth] = useState("");
  const [elsewhere, setElsewhere] = useState("");
  const [certify, setCertify] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  const incomeMinor = toMinor(income);
  const nwMinor = toMinor(netWorth);
  const elsewhereMinor = toMinor(elsewhere) ?? 0;

  const example = useMemo(() => {
    if (incomeMinor === null || nwMinor === null) return null;
    const greater = Math.max(incomeMinor, nwMinor);
    return { greater, basis: incomeMinor >= nwMinor ? "annual income" : "net worth", low: Math.round(greater * 0.05), high: Math.round(greater * 0.1) };
  }, [incomeMinor, nwMinor]);

  const errors = {
    accredited: accredited === null ? "Tell us whether you're an accredited investor." : undefined,
    income: accredited === "no" && incomeMinor === null ? "Enter your annual income. Enter 0 if you have none." : undefined,
    netWorth: accredited === "no" && nwMinor === null ? "Enter your net worth. Enter 0 if it's zero or negative." : undefined,
    certify: !certify ? "Please confirm the certification to continue." : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  const save = () => {
    setTouched(true);
    if (valid) setSaved(true);
  };

  if (saved) {
    return (
      <div className="flex flex-col gap-8">
        <Card className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full border border-success/30 bg-success/12 text-success">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <h1 className="text-3xl font-bold">Certification saved</h1>
          <p className="max-w-md text-muted">
            {accredited === "yes"
              ? "You've certified as an accredited investor. Our intermediary may ask for proof before accepting an investment."
              : "Our intermediary will confirm your exact 12-month limit using the current SEC figures. You'll see it on every Pool before you invest."}
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link to="/pools">
                Browse Pools <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/settings">Back to settings</Link>
            </Button>
          </div>
        </Card>
        <p className="text-center text-xs text-muted">Your income or net worth changed? You can update this certification any time from Settings.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="eyebrow text-gold">Investor certification</span>
        <h1 className="text-3xl font-bold">Set your 12-month investment limit</h1>
        <p className="text-muted">Regulation Crowdfunding limits how much most people can invest in crowdfunding offerings each year. Tell us a little about your finances and we'll work it out.</p>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <IconChip>
            <Scale />
          </IconChip>
          <h2 className="text-lg font-semibold">How the limit works</h2>
        </div>
        <ul className="flex flex-col gap-3 text-sm text-muted">
          <li className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
            <span>
              Your limit is based on the <strong className="text-fg">greater</strong> of your annual income or your net worth.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
            <span>
              If either figure is below the SEC's threshold, you can invest up to <span className="num text-fg">5%</span> of the greater figure,
              with a set minimum. If both are at or above it, the rate rises to <span className="num text-fg">10%</span>, up to an annual maximum.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
            <span>Accredited investors have no Reg CF limit.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
            <span>
              The limit covers <strong className="text-fg">all</strong> Reg CF investments you make in any rolling 12 months, on every platform — not
              just FanZuP.
            </span>
          </li>
        </ul>
        <p className="text-xs text-muted">The SEC sets the dollar thresholds, minimum and maximum, and adjusts them for inflation. Our intermediary applies the current figures when it confirms your limit.</p>
      </Card>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-lg font-semibold">Are you an accredited investor?</legend>
        <div role="radiogroup" aria-label="Accredited investor" className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard selected={accredited === "no"} onSelect={() => setAccredited("no")}>
            <p className="font-semibold text-fg">No, or I'm not sure</p>
            <p className="mt-1 text-sm text-muted">Most fans choose this. We'll estimate your limit from your income and net worth.</p>
          </ChoiceCard>
          <ChoiceCard selected={accredited === "yes"} onSelect={() => setAccredited("yes")}>
            <p className="flex items-center gap-2 font-semibold text-fg">
              Yes, I'm accredited <BadgeCheck className="size-4 text-gold" aria-hidden />
            </p>
            <p className="mt-1 text-sm text-muted">You meet the SEC's income or net-worth tests, or hold a qualifying license (Series 7, 65 or 82).</p>
          </ChoiceCard>
        </div>
        {touched && errors.accredited && <p className="text-sm text-error">{errors.accredited}</p>}
      </fieldset>

      {accredited === "no" && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <MoneyInput id="income" label="Annual income" hint="Before tax, last 12 months" value={income} onChange={setIncome} error={touched ? errors.income : undefined} />
            <MoneyInput id="net-worth" label="Net worth" hint="Excluding your primary home" value={netWorth} onChange={setNetWorth} error={touched ? errors.netWorth : undefined} />
            <MoneyInput
              id="elsewhere"
              label="Reg CF investments elsewhere"
              hint="On other platforms in the last 12 months. Enter 0 if none."
              value={elsewhere}
              onChange={setElsewhere}
            />
          </div>
          <p className="text-xs text-muted">These figures are self-reported and used only to work out your limit. They're shared with our intermediary and kept only as long as regulations require.</p>

          <Card elevated className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <IconChip>
                  <Calculator />
                </IconChip>
                <h2 className="text-lg font-semibold">Your estimated limit</h2>
              </div>
              <Badge tone="info">Example</Badge>
            </div>
            {example ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="num text-3xl font-medium text-gold sm:text-4xl">{formatMoney(example.low)}</span>
                  <span className="text-sm text-muted">
                    5% of your {example.basis} (<span className="num">{formatMoney(example.greater)}</span>), per rolling 12 months
                  </span>
                </div>
                <dl className="border-t border-line pt-2">
                  <KeyValue k="If both figures are at or above the SEC threshold" v={<span className="num">{formatMoney(example.high)} (10%), up to the annual maximum</span>} />
                  <KeyValue k="Already invested elsewhere" v={<span className="num">−{formatMoney(elsewhereMinor)}</span>} />
                  <KeyValue k="Estimated left to invest" v={<span className="num font-medium">{formatMoney(Math.max(0, example.low - elsewhereMinor))}</span>} />
                </dl>
                <p className="flex items-start gap-2 text-xs text-muted">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Illustrative only. The SEC's minimum and maximum may raise or cap this figure; your intermediary confirms your exact limit before you
                  invest.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Enter your annual income and net worth to see an example.</p>
            )}
          </Card>

          <Callout tone="warning" icon={<TriangleAlert />} title="Your limit is shared across platforms">
            If you've invested through Reg CF on another platform in the last 12 months, that counts toward the same limit.
          </Callout>
        </div>
      )}

      {accredited === "yes" && (
        <Callout tone="info" icon={<BadgeCheck />} title="No Reg CF investment limit applies">
          Accredited investors can invest without the annual Reg CF limit. Our intermediary may ask you for proof, such as a letter from your
          accountant or recent tax documents, before accepting a larger investment.
        </Callout>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <Checkbox id="certify" checked={certify} onChange={setCertify}>
          {accredited === "yes"
            ? "I certify that I meet the SEC's definition of an accredited investor, and I understand FanZuP and our intermediary rely on this certification."
            : "I certify that the figures above are accurate to the best of my knowledge, and I understand FanZuP and our intermediary rely on them to determine how much I can invest under Regulation Crowdfunding."}
        </Checkbox>
        {touched && errors.certify && <p className="pl-7 text-sm text-error">{errors.certify}</p>}
      </div>

      <WizardFooter backTo="/settings" backLabel="Cancel">
        <Button onClick={save}>
          Save certification <ArrowRight />
        </Button>
      </WizardFooter>
    </div>
  );
}
