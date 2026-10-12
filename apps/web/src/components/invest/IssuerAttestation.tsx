/**
 * Issuer attestation (L2 design §4.1; L2-T-019; L2-Q12): Reg CF sales in the 12 months before this offering by the
 * creator, its 17 CFR 227.100(c) affiliates and predecessors, on any platform. Asked at submit and again at launch;
 * the API subtracts it from the 12-month issuer cap. Self-reported, pending counsel.
 */
import { Field, TextInput } from "@/components/brand";

export const ATTESTATION_LABEL = "Other Reg CF sales in the last 12 months (USD)";
export const ATTESTATION_NOTE = "Self-reported, pending counsel (L2-Q12)";

const AMOUNT = /^\$?\s*\d{1,3}(,?\d{3})*(\.\d{1,2})?$|^\$?\s*\d+(\.\d{1,2})?$/;

/** Cents from a dollar string; NaN when it isn't a dollar amount. */
export function parseAttestation(v: string): number {
  const t = v.trim();
  if (!AMOUNT.test(t)) return Number.NaN;
  return Math.round(Number(t.replace(/[$,\s]/g, "")) * 100);
}

export function attestationProblem(v: string): string | null {
  if (!v.trim()) return "Enter your other Reg CF sales in the last 12 months — 0 if there were none.";
  const c = parseAttestation(v);
  if (!Number.isFinite(c) || c < 0) return "Enter a dollar amount, like 25,000 — or 0 if there were none.";
  return null;
}

export function IssuerAttestationField({ id, value, onChange, touched = false }: { id: string; value: string; onChange: (v: string) => void; touched?: boolean }) {
  const problem = value.trim() || touched ? attestationProblem(value) : null;
  return (
    <Field
      label={
        <>
          {ATTESTATION_LABEL} <span className="font-normal text-muted" data-testid="attestation-note">— {ATTESTATION_NOTE}</span>
        </>
      }
      htmlFor={id}
      error={problem}
      hint="Include Reg CF offerings by you, your affiliates and any predecessor business, on any platform. Enter 0 if none. It counts toward the 12-month limit on how much you can raise."
    >
      <TextInput id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" aria-invalid={!!problem} aria-describedby={`${id}-msg`} data-testid="attestation-input" />
    </Field>
  );
}
