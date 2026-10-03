import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge, Button, ChoiceCard, Field, IconChip, Select } from "@/components/brand";
import { KycFrame, PartnerBanner, WizardFooter } from "@/components/invest/ui";
import { DOCS, type DocId } from "@/components/invest/kyc";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup src/pages/onboarding/kyc/KYCIdType.tsx (wireframe).
 * Changes: US-first document list (driver's license / state ID / passport) since Reg CF investors
 * are verified against US records; custom country dropdown replaced with an accessible native select.
 */
const COUNTRIES = [
  { code: "US", name: "United States", docs: ["drivers_license", "state_id", "passport"] as DocId[] },
  { code: "OTHER", name: "Another country", docs: ["passport"] as DocId[] },
];

export default function KycIdType() {
  const navigate = useNavigate();
  const [country, setCountry] = useState("US");
  const [doc, setDoc] = useState<DocId | null>(null);
  const [touched, setTouched] = useState(false);
  const available = COUNTRIES.find((c) => c.code === country)?.docs ?? [];

  const next = () => {
    setTouched(true);
    if (doc) navigate(`/onboarding/kyc/document?doc=${doc}`);
  };

  return (
    <KycFrame
      step={2}
      title="Choose your ID"
      description="Pick a document you have with you. It must be valid, undamaged and readable — photocopies and screenshots aren't accepted."
      footer={
        <WizardFooter backTo="/onboarding/kyc">
          <Button onClick={next}>
            Continue <ArrowRight />
          </Button>
        </WizardFooter>
      }
    >
      <PartnerBanner />
      <Field label="Issuing country" htmlFor="country" hint="This decides which documents we can accept.">
        <Select
          id="country"
          value={country}
          onChange={(e) => {
            const c = e.target.value;
            setCountry(c);
            if (doc && !COUNTRIES.find((x) => x.code === c)?.docs.includes(doc)) setDoc(null);
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-fg">Document type</legend>
        <div role="radiogroup" aria-label="Document type" className="flex flex-col gap-3">
          {available.map((id) => {
            const d = DOCS[id];
            const selected = doc === id;
            return (
              <ChoiceCard key={id} selected={selected} onSelect={() => setDoc(id)} className="flex items-center gap-4">
                <IconChip tone={selected ? "gold" : "muted"}>{d.icon}</IconChip>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold text-fg">{d.label}</span>
                  <span className="text-sm text-muted">{d.description}</span>
                </div>
                <Badge tone="neutral" className="hidden sm:inline-flex">
                  {d.sides === 2 ? "Front & back" : "One side"}
                </Badge>
                <CheckCircle2 className={cn("size-5 shrink-0", selected ? "text-gold" : "text-line")} aria-hidden />
              </ChoiceCard>
            );
          })}
        </div>
        {touched && !doc && <p className="text-sm text-error">Choose a document type to continue.</p>}
      </fieldset>
    </KycFrame>
  );
}
