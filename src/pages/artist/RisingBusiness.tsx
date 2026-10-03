import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { Button, Callout, Card, Checkbox, Field, KeyValue, Select, TextInput } from "@/components/brand";
import { ArtistStepLayout, RisingStepper, WizardFooter, updateRising, useRising } from "@/components/artist";

/**
 * Source: Fan Profile Setup src/pages/artist-tier2/Tier2Business.tsx
 * Doc-driven changes: Tier 2 → Rising (Brand §7.5); added entity type, state of formation and an
 * authority attestation; "Verifying with IRS" reworded to a partner check (no direct IRS integration
 * is specced); EIN masked after verification. Failure state previews with ?state=failed.
 */
type Status = "idle" | "verifying" | "success" | "failed";
const ENTITY_TYPES = ["LLC", "S corporation", "C corporation", "Partnership"];
const STATES = ["Arkansas", "California", "Delaware", "Florida", "Georgia", "Illinois", "Michigan", "New Jersey", "New York", "Pennsylvania", "Tennessee", "Texas", "Wyoming", "Other"];

const formatEin = (v: string) => {
  const n = v.replace(/\D/g, "").slice(0, 9);
  return n.length <= 2 ? n : `${n.slice(0, 2)}-${n.slice(2)}`;
};

export default function RisingBusiness() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const existing = useRising().business;
  const [entityType, setEntityType] = useState(existing?.entityType ?? "LLC");
  const [legalName, setLegalName] = useState(existing?.legalName ?? "");
  const [formedIn, setFormedIn] = useState("");
  const [ein, setEin] = useState("");
  const [authority, setAuthority] = useState(false);
  const [status, setStatus] = useState<Status>(existing ? "success" : "idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failNext] = useState(params.get("state") === "failed");

  const verify = () => {
    const e: Record<string, string> = {};
    if (legalName.trim().length < 2) e.legalName = "Enter the legal name exactly as it appears on your IRS paperwork.";
    if (!formedIn) e.formedIn = "Choose the state where the business was formed.";
    if (ein.replace(/\D/g, "").length !== 9) e.ein = "An EIN has 9 digits, like 12-3456789.";
    if (!authority) e.authority = "You need to be authorized to act for this business.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setStatus("verifying");
    setTimeout(() => {
      if (failNext || ein.replace(/\D/g, "") === "000000000") {
        setStatus("failed");
        return;
      }
      updateRising({ business: { entityType, legalName: legalName.trim(), einLast4: ein.replace(/\D/g, "").slice(-4) } });
      setStatus("success");
    }, 1800);
  };

  const locked = status === "verifying" || status === "success";

  return (
    <ArtistStepLayout
      stepper={<RisingStepper step="Business" />}
      title="Your business entity"
      description="Pools are offered by your business, not by you personally. Add the LLC or corporation that will run them."
      footer={
        <WizardFooter backTo="/tier/rising">
          {status === "success" ? (
            <Button size="lg" onClick={() => navigate("/tier/rising/streaming")}>
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button size="lg" onClick={verify} disabled={status === "verifying"}>
              {status === "verifying" ? (
                <>
                  <Loader2 className="animate-spin" /> Checking
                </>
              ) : (
                "Verify business"
              )}
            </Button>
          )}
        </WizardFooter>
      }
    >
      {status === "success" && existing ? (
        <Card className="flex flex-col gap-3 border-success/30">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="size-5" />
            <h2 className="text-lg font-semibold text-fg">Business verified</h2>
          </div>
          <div className="divide-y divide-line">
            <KeyValue k="Legal name" v={existing.legalName} />
            <KeyValue k="Entity type" v={existing.entityType} />
            <KeyValue k="EIN" v={<span className="num">••-•••{existing.einLast4}</span>} />
            <KeyValue k="Standing" v={<span className="text-success">Active, in good standing</span>} />
          </div>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => { updateRising({ business: null }); setStatus("idle"); setEin(""); }}>
            Use a different business
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Entity type" htmlFor="entity">
              <Select id="entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} disabled={locked}>
                {ENTITY_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="State of formation" htmlFor="formed" error={errors.formedIn}>
              <Select id="formed" value={formedIn} onChange={(e) => setFormedIn(e.target.value)} disabled={locked} aria-invalid={!!errors.formedIn}>
                <option value="" disabled>
                  Choose a state
                </option>
                {STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Business legal name" htmlFor="legal" error={errors.legalName} hint="Exactly as it appears on your EIN confirmation letter (CP 575).">
            <TextInput id="legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g. Sound Wave Studios LLC" disabled={locked} aria-invalid={!!errors.legalName} />
          </Field>
          <Field label="Employer Identification Number (EIN)" htmlFor="ein" error={errors.ein} hint="9 digits. We store it encrypted and only show the last 4.">
            <TextInput id="ein" inputMode="numeric" autoComplete="off" value={ein} onChange={(e) => setEin(formatEin(e.target.value))} placeholder="XX-XXXXXXX" className="num" disabled={locked} aria-invalid={!!errors.ein} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Checkbox id="authority" checked={authority} onChange={setAuthority}>
              I'm an owner or officer of this business and authorized to act on its behalf.
            </Checkbox>
            {errors.authority && <p className="text-sm text-error">{errors.authority}</p>}
          </div>
        </Card>
      )}

      {status === "verifying" && (
        <Callout tone="info" icon={<Loader2 className="animate-spin" />} title="Checking your business">
          We're matching your legal name and EIN against federal records. This usually takes a few seconds.
        </Callout>
      )}
      {status === "failed" && (
        <Callout tone="error" icon={<TriangleAlert />} title="We couldn't match that EIN">
          <p>The legal name and EIN didn't match the records we checked. Look for:</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>A typo in the EIN</li>
            <li>The legal name spelled differently (for example "LLC" vs "L.L.C.")</li>
            <li>An entity that's newly formed. New EINs can take up to 2 weeks to show up.</li>
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setStatus("idle")}>
            Edit details
          </Button>
        </Callout>
      )}

      {status !== "success" && (
        <Card elevated className="flex flex-col gap-2 p-5">
          <h2 className="font-semibold">Don't have an EIN yet?</h2>
          <p className="text-sm text-muted">Applying with the IRS is free and usually takes a few minutes online. Form your LLC with your state first.</p>
          <a
            href="https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-gold hover:underline"
          >
            Apply for an EIN at IRS.gov <ExternalLink className="size-4" />
          </a>
        </Card>
      )}
    </ArtistStepLayout>
  );
}
