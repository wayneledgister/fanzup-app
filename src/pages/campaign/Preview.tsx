import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CircleAlert, Eye, Pencil, Send, ShieldCheck } from "lucide-react";
import { Button, Callout, Checkbox } from "@/components/brand";
import { FormSection, WizardFooter, WizardHeader } from "@/components/campaign/WizardFrame";
import { CampaignFanView, viewFromDraft } from "@/components/campaign/CampaignFanView";
import { CREATOR, SUBMITTED_PATH, STEP_PATH, exampleDraft, replaceDraft, stepStatus, tierLimit, updateDraft, useDraft } from "@/components/campaign/draft";
import { cn } from "@/lib/utils";

/**
 * Source: FPS src/pages/campaign/CampaignPreview.tsx
 * Doc-driven changes: revenue-share / equity / event-certificate term blocks, "minimum investment" and
 * "SEC compliance documentation" copy removed (Mechanism 05: perks only). The preview now renders the real
 * public campaign page fans will see — including the escrow notice — and adds creator attestations.
 * Review timing ("1-2 business days") restated as an estimate of about 2 business days.
 */

const CHECKS = [
  "Perks only — nothing that offers money, earnings or a financial interest",
  "A goal that fits your fan base and your tier limit",
  "A delivery month on every perk",
  "Your identity is verified",
  "Escrow and refund terms are shown to backers",
];

export default function Preview() {
  const d = useDraft();
  const example = useMemo(() => exampleDraft(), []);
  const usingExample = !d.touched;
  const draft = usingExample ? example : d;
  const view = viewFromDraft(draft);
  const status = stepStatus(draft);
  const incomplete = (["basics", "details", "perks"] as const).filter((k) => !status[k]);
  const [agree, setAgree] = useState({ deliver: false, escrow: false, terms: false });
  const [show, setShow] = useState(false);
  const allAgreed = agree.deliver && agree.escrow && agree.terms;

  return (
    <>
      <WizardHeader step={4} title="Preview and submit" description="This is your campaign page exactly as fans will see it once it's approved." />

      {usingExample && (
        <Callout tone="info" title="You haven't started a draft yet" className="mb-6">
          <p>Below is an example campaign. Use it as a starting point or begin from scratch.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => replaceDraft({ ...example, touched: true })}>
              Use this example
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to={STEP_PATH[0]}>Start from scratch</Link>
            </Button>
          </div>
        </Callout>
      )}

      {incomplete.length > 0 && !usingExample && (
        <Callout tone="warning" icon={<CircleAlert />} title="A few things are missing" className="mb-6">
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {incomplete.map((k) => (
              <li key={k}>
                <Link to={STEP_PATH[["basics", "details", "perks"].indexOf(k)]} className="font-medium capitalize text-gold hover:underline">
                  Finish {k}
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
          <span className="flex items-center gap-2 text-xs text-muted">
            <Eye className="size-4" /> Fan view · not live yet
          </span>
          <span className="num truncate text-xs text-muted">fanzup.com/c/{CREATOR.handle.slice(1)}</span>
        </div>
        <div className="bg-canvas p-4 sm:p-6">
          <CampaignFanView v={view} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2">
        {(["Basics", "Details", "Perks"] as const).map((s, i) => (
          <Button key={s} asChild variant="secondary" size="sm">
            <Link to={STEP_PATH[i]}>
              <Pencil /> Edit {s.toLowerCase()}
            </Link>
          </Button>
        ))}
      </div>

      <FormSection title="What our reviewers check" description="We review every campaign before it goes live. That usually takes about 2 business days (estimate)." className="mt-10 border-t pt-8">
        <ul className="grid gap-2 sm:grid-cols-2">
          {CHECKS.map((c) => (
            <li key={c} className="flex items-start gap-2 text-sm text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold" />
              {c}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          {CREATOR.tier} limit: <span className="num">${tierLimit(CREATOR.tier).toLocaleString()}</span>. Editing a campaign after approval sends the changes back
          for review.
        </p>
      </FormSection>

      <FormSection title="Before you submit">
        <div className={cn("flex flex-col gap-4 rounded-lg border bg-surface p-5", show && !allAgreed ? "border-error/60" : "border-line")} data-error={(show && !allAgreed) || undefined} tabIndex={-1}>
          <Checkbox id="agree-deliver" checked={agree.deliver} onChange={(v) => setAgree((a) => ({ ...a, deliver: v }))}>
            I can deliver every perk by its estimated date, and I'll update backers if anything changes.
          </Checkbox>
          <Checkbox id="agree-escrow" checked={agree.escrow} onChange={(v) => setAgree((a) => ({ ...a, escrow: v }))}>
            I understand backers' money is held in escrow, released only if the goal is met
            {draft.release === "milestones" ? " and in stages as milestones are verified" : ""}, and refunded automatically if it isn't.
          </Checkbox>
          <Checkbox id="agree-terms" checked={agree.terms} onChange={(v) => setAgree((a) => ({ ...a, terms: v }))}>
            I agree to the{" "}
            <Link to="/legal/terms" className="text-gold hover:underline">
              Creator Terms
            </Link>{" "}
            and confirm this campaign offers perks only.
          </Checkbox>
        </div>
        {show && !allAgreed && <p className="text-sm text-error">Confirm all three to submit.</p>}
        {show && (incomplete.length > 0 || usingExample) && (
          <p className="text-sm text-error">{usingExample ? "Use the example or build your own draft before submitting." : "Finish the missing steps above before submitting."}</p>
        )}
      </FormSection>

      <WizardFooter
        step={4}
        nextPath={SUBMITTED_PATH}
        continueLabel="Submit for review"
        continueIcon={<Send />}
        onContinue={() => {
          setShow(true);
          const ok = allAgreed && incomplete.length === 0 && !usingExample;
          if (ok) {
            const n = Math.floor(1000 + Math.random() * 9000);
            updateDraft({ submittedAt: new Date().toISOString(), submissionId: `CMP-${new Date().getFullYear().toString().slice(2)}-${n}` });
          }
          return ok;
        }}
      />
    </>
  );
}
