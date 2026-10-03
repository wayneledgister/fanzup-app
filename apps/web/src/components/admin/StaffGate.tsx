/**
 * Staff gate for Layer 2 screens (FR-ID-002 staff, ADR-004): staff actions need a second-factor (aal2) session.
 * If the API says the session lacks it, this panel verifies the authenticator code — or enrolls an authenticator first
 * (Supabase TOTP) — then reloads. The API enforces aal2 on every staff route; this is the browser half.
 */
import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Button, Callout, Card, Container, Field, TextInput } from "@/components/brand";
import { LoadGate, apiMessage, type Load } from "@/components/invest/l2ui";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import type { StaffAction } from "@/lib/l2";
import { formatInstant } from "@/lib/format";

export function StaffLoadGate<T>({ load, children, what }: { load: { s: Load<T>; reload: () => void }; children: (d: T) => ReactNode; what?: string }) {
  if (load.s.state === "error" && load.s.error instanceof ApiError) {
    if (load.s.error.code === "second_factor_required") return <SecondFactor onDone={load.reload} />;
    if (load.s.error.code === "not_staff" || load.s.error.status === 401) {
      return (
        <Container size="md" className="py-16">
          <Callout tone="warning" icon={<ShieldAlert />} title="This area is for FanZuP staff">{load.s.error.message}</Callout>
        </Container>
      );
    }
  }
  return <LoadGate load={load} what={what}>{children}</LoadGate>;
}

function SecondFactor({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const en = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `FanZuP staff ${new Date().toISOString().slice(0, 10)}` });
      if (en.error) return setErr(en.error.message);
      setFactorId(en.data.id);
      setQr(en.data.totp.qr_code);
      setSecret(en.data.totp.secret);
    })().catch((e) => setErr(String(e)));
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !factorId) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) return setErr("That code didn't work. Check your authenticator app and try again.");
    await session.refresh();
    onDone();
  };

  return (
    <Container size="sm" className="py-12">
      <Card className="flex flex-col gap-4" data-testid="staff-second-factor">
        <p className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="size-5 text-gold" /> Confirm it's you</p>
        <p className="text-sm text-muted">Staff tools need a code from your authenticator app.</p>
        {qr && (
          <div className="flex flex-col items-center gap-2">
            <img src={qr} alt="Authenticator setup QR code" className="size-44 rounded-md bg-fg p-2" />
            <p className="text-xs text-muted">Or enter this key: <span className="num break-all text-fg">{secret}</span></p>
          </div>
        )}
        <form onSubmit={verify} className="flex flex-col gap-3">
          <Field label="6-digit code" htmlFor="mfa-code"><TextInput id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          {err && <p className="text-sm text-error" role="alert">{err}</p>}
          <Button type="submit" disabled={busy || code.trim().length < 6}>Verify</Button>
        </form>
      </Card>
    </Container>
  );
}

/** A privileged action: typed reason (≥ 10 chars, audited) + button; shows executed vs scheduled (single-operator delay). */
export function ActionForm({ label, run, tone = "primary", testId, defaultReason = "" }: { label: string; run: (reason: string) => Promise<StaffAction | unknown>; tone?: "primary" | "secondary"; testId?: string; defaultReason?: string }) {
  const [reason, setReason] = useState(defaultReason);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = (await run(reason)) as StaffAction | undefined;
      const a = r && typeof r === "object" && "action" in r ? r.action : null;
      setMsg({ ok: true, text: a?.status === "scheduled" ? `Scheduled: runs after ${a.executeAfter ? formatInstant(a.executeAfter) : "the single-operator delay"} (cancellable).` : "Done." });
    } catch (x) {
      setMsg({ ok: false, text: apiMessage(x) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={go} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field label="Reason (goes in the audit log)" htmlFor={`r-${testId ?? label}`} className="flex-1">
        <TextInput id={`r-${testId ?? label}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters" />
      </Field>
      <Button type="submit" variant={tone} disabled={busy || reason.trim().length < 10} data-testid={testId}>{busy ? "Working…" : label}</Button>
      {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`} role="status">{msg.text}</p>}
    </form>
  );
}
