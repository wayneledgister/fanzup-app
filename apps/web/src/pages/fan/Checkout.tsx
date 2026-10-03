import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, CircleAlert, CircleCheck, Clock, CreditCard, Share2, ShieldCheck } from "lucide-react";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { POLICY } from "@fanzup/shared/policy";
import type { BackCampaignResponse, CampaignDetail, Me } from "@fanzup/shared/schemas";
import { ArtistArt, Button, Callout, Card, Checkbox, Container, EscrowNotice, Field, KeyValue, Select, TestModeNotice, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { api, ApiError } from "@/lib/api";
import { loadConfig } from "@/lib/config";
import { sourceFor } from "@/lib/attribution";
import { formatDate, formatInstant, formatMoney } from "@/lib/format";

/**
 * Checkout (new route). M1: FR-BCK-001 (one screen: perk, delivery date, quantity, total in USD, when the card is
 * charged, the refund promise; failure categories; confirmation), FR-BCK-002 (reached after sign-up/verify with the
 * same campaign and perk), FR-PAY-001 (the perk is held while the fan pays), FR-PAY-006 (one Idempotency-Key per
 * checkout attempt, kept in sessionStorage so a reload or double tap resumes the same backing), FR-PRV-001
 * (re-acceptance), FR-PLT-006 (test-mode notice). Cards are taken by Stripe's hosted Payment Element; in local/CI
 * sandbox mode a clearly labelled test-card form stands in for it.
 */

type Step = "review" | "pay" | "processing" | "done";
type Failure = { category: "declined" | "expired" | "authentication failed" | "network" | "closed" | "other"; message: string; next: string };

const localDeadline = (iso: string) => formatInstant(iso, true);

/** Design §4.3: provider signal → category shown → next step. */
export function categorize(e: unknown): Failure {
  const x = e as { code?: string; decline_code?: string; type?: string; status?: number; message?: string };
  const code = x.decline_code ?? x.code ?? "";
  if (e instanceof ApiError) {
    if (e.code === "network" || e.code === "provider_unavailable" || e.status >= 500) return { category: "network", message: "We couldn't reach the payment processor.", next: "Check your connection and try again — nothing was charged." };
    if (e.code === "checkout_expired") return { category: "expired", message: "This checkout expired before payment.", next: "Start again from the campaign page — nothing was charged." };
    if (["campaign_closed", "perk_sold_out"].includes(e.code)) return { category: "closed", message: e.message, next: "Go back to the campaign page to pick another perk — nothing was charged." };
    return { category: "other", message: e.message, next: "Nothing was charged." };
  }
  if (code === "expired_card") return { category: "expired", message: "Your card has expired.", next: "Use a card that hasn't expired." };
  if (code === "authentication_required" || code === "payment_intent_authentication_failure" || x.type === "authentication_error")
    return { category: "authentication failed", message: "Your bank's check wasn't completed.", next: "Try again and complete your bank's check." };
  if (x.type === "card_error" || /declin|insufficient|cvc/i.test(code)) return { category: "declined", message: "Your card was declined.", next: "Try another card. Nothing was charged." };
  return { category: "network", message: x.message ?? "Something went wrong.", next: "Check your connection and try again — nothing was charged." };
}

const keyFor = (slug: string, perk: string, qty: number) => `fanzup.checkout.${slug}.${perk}.${qty}`;
function idempotencyKey(slug: string, perk: string, qty: number) {
  const k = keyFor(slug, perk, qty);
  try {
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID();
      sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

export default function CheckoutPage() {
  return (
    <RequireAccount entry="signup">
      <Checkout />
    </RequireAccount>
  );
}

function Checkout() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const perkId = params.get("perk") ?? "";
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [qty, setQty] = useState(1);
  const [accept, setAccept] = useState(false);
  const [step, setStep] = useState<Step>("review");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [backing, setBacking] = useState<BackCampaignResponse | null>(null);

  useEffect(() => {
    Promise.all([api.campaign(slug), api.me()])
      .then(([d, m]) => {
        setDetail(d);
        setMe(m);
      })
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? "We couldn't find that campaign." : "We couldn't load checkout. Check your connection and try again."));
  }, [slug]);

  const perk = detail?.perks.find((p) => p.id === perkId);
  const maxQty = Math.max(1, Math.min(10, perk?.remaining ?? 10));
  const total = (perk?.priceMinor ?? 0) * qty;

  if (loadError) return <Shell slug={slug}><Callout tone="error" icon={<CircleAlert />} title="Checkout unavailable">{loadError}</Callout></Shell>;
  if (!detail || !me) return <Shell slug={slug}><div className="h-80 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading checkout" /></Shell>;
  const c = detail.campaign;
  if (!perk) {
    return (
      <Shell slug={slug}>
        <Callout tone="warning" icon={<CircleAlert />} title="Pick a perk first">
          That perk isn't part of this campaign any more. <Link to={`/campaigns/${slug}`} className="font-medium text-gold hover:underline">Choose a perk</Link>
        </Callout>
      </Shell>
    );
  }
  const closed = c.status !== "live" || !c.endsAt || Date.parse(c.endsAt) <= Date.now();
  const soldOut = perk.remaining === 0;
  const needsAcceptance = me.needsAcceptance.length > 0;

  const start = async () => {
    setFailure(undefined);
    setBusy(true);
    try {
      if (needsAcceptance) {
        await api.accept(me.needsAcceptance.map((k) => ({
          kind: k as "terms" | "privacy" | "adult_attestation",
          version: k === "terms" ? POLICY.legal.termsVersion : k === "privacy" ? POLICY.legal.privacyVersion : "v1",
        })));
        setMe({ ...me, needsAcceptance: [] });
      }
      const r = await api.back({ campaignId: c.id, perkId: perk.id, quantity: qty, source: sourceFor(slug) ?? null }, idempotencyKey(slug, perk.id, qty));
      setBacking(r);
      setStep("pay");
    } catch (e) {
      setFailure(categorize(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmed = () => {
    try {
      sessionStorage.removeItem(keyFor(slug, perk.id, qty));
    } catch { /* ignore */ }
    setStep("done");
  };

  if (step === "done" && backing) return <Confirmation detail={detail} perkTitle={perk.title} amountMinor={backing.amountMinor} />;

  return (
    <Shell slug={slug}>
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold">Checkout</h1>
          <TestModeNotice />
          {failure && (
            <Callout tone="error" icon={<CircleAlert />} title={`Payment ${failure.category === "other" || failure.category === "closed" ? "not possible" : failure.category}`}>
              <span data-testid="checkout-failure">{failure.message} {failure.next}</span>
            </Callout>
          )}
          {step === "review" && (
            <Card className="flex flex-col gap-5">
              <Field label="Quantity" htmlFor="qty">
                <Select id="qty" value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={closed || soldOut}>
                  {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </Field>
              {needsAcceptance && (
                <Checkbox id="accept" checked={accept} onChange={setAccept}>
                  I've read and accept the updated <Link to="/legal/terms" className="text-gold hover:underline">Terms</Link> and{" "}
                  <Link to="/legal/privacy" className="text-gold hover:underline">Privacy Policy</Link>.
                </Checkbox>
              )}
              {closed ? (
                <Callout tone="warning" icon={<Clock />} title="This campaign isn't accepting backers">Nothing was charged.</Callout>
              ) : soldOut ? (
                <Callout tone="warning" icon={<Clock />} title="That perk just sold out">Go back and pick another one. Nothing was charged.</Callout>
              ) : (
                <Button size="lg" block onClick={start} disabled={busy || (needsAcceptance && !accept)} data-testid="continue-to-payment">
                  {busy ? "Holding your perk…" : `Continue to payment · ${formatMoney(total, { cents: true })}`}
                </Button>
              )}
              <p className="text-xs text-muted">
                We hold your perk for <span className="num">{POLICY.checkout.holdMinutes}</span> minutes while you pay. Your card is charged when you pay.
              </p>
            </Card>
          )}
          {(step === "pay" || step === "processing") && backing && (
            <PaymentStep backing={backing} processing={step === "processing"} onProcessing={() => setStep("processing")} onFailure={(f) => { setFailure(f); setStep("pay"); }} onConfirmed={confirmed} onExpired={() => navigate(`/campaigns/${slug}`)} />
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <ArtistArt seed={c.artist.slug} label={c.artist.name} rounded="md" className="size-14" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.title}</p>
                <p className="text-sm text-muted">{c.artist.name}</p>
              </div>
            </div>
            <div className="flex flex-col divide-y divide-line">
              <KeyValue k="Perk" v={perk.title} />
              <KeyValue k="Delivery by" v={<span className="num">{formatDate(perk.fulfillBy)}</span>} />
              <KeyValue k="Quantity" v={<span className="num">{qty}</span>} />
              <KeyValue k="Total (USD)" v={<span className="num text-lg" data-testid="checkout-total">{formatMoney(total, { cents: true })}</span>} />
            </div>
            <p className="text-xs text-muted">No fees are added. The artist covers card processing.</p>
            {c.endsAt && <p className="text-xs text-muted">Campaign deadline: <span className="num">{localDeadline(c.endsAt)}</span></p>}
          </Card>
          <EscrowNotice compact />
          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" /> Card details go straight to our payment processor and never touch FanZuP's servers. The artist receives only what's needed to deliver your perk.
          </p>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <Container size="xl" className="flex flex-col gap-6 py-8 sm:py-12">
      <Link to={`/campaigns/${slug}`} className="flex w-fit items-center gap-2 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Back to the campaign</Link>
      {children}
    </Container>
  );
}

function PaymentStep({ backing, processing, onProcessing, onFailure, onConfirmed, onExpired }: {
  backing: BackCampaignResponse; processing: boolean; onProcessing: () => void; onFailure: (f: Failure) => void; onConfirmed: () => void; onExpired: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.round((Date.parse(backing.holdExpiresAt) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft(Math.max(0, Math.round((Date.parse(backing.holdExpiresAt) - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [backing.holdExpiresAt]);

  /** Wait until the backend has applied the payment (webhook / sandbox event → ledger). */
  const waitForCapture = async () => {
    onProcessing();
    for (let i = 0; i < 40; i++) {
      try {
        const b = await api.backing(backing.backingId);
        if (b.status === "held") return onConfirmed();
        if (b.status === "refund_pending" || b.status === "refunded") return onFailure({ category: "closed", message: "Your payment arrived after the campaign or your checkout closed, so it's being refunded in full.", next: "You'll get an email when the refund completes." });
        if (b.status === "canceled") return onFailure({ category: "expired", message: "This checkout expired before payment.", next: "Start again from the campaign page — nothing was charged." });
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    onFailure({ category: "network", message: "We're still waiting for your payment to be confirmed.", next: "Check My backings in a minute — you won't be charged twice." });
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payment</h2>
        <span className="num text-sm text-muted" aria-live="polite">
          {secondsLeft > 0 ? <>Perk held for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</> : "Hold expired"}
        </span>
      </div>
      {secondsLeft === 0 ? (
        <Callout tone="warning" icon={<Clock />} title="Your hold expired">
          Nothing was charged. <button type="button" className="font-medium text-gold hover:underline" onClick={onExpired}>Start again</button>
        </Callout>
      ) : backing.provider === "stripe-test" ? (
        <StripeForm backing={backing} disabled={processing} onFailure={onFailure} onPaid={waitForCapture} />
      ) : (
        <SandboxCardForm backing={backing} disabled={processing} onFailure={onFailure} onPaid={waitForCapture} />
      )}
      {processing && <p className="text-sm text-muted" aria-live="polite">Confirming your payment…</p>}
    </Card>
  );
}

function StripeForm({ backing, disabled, onFailure, onPaid }: { backing: BackCampaignResponse; disabled: boolean; onFailure: (f: Failure) => void; onPaid: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<{ stripe: Stripe; elements: StripeElements } | null>(null);
  const [busy, setBusy] = useState(false);
  const failRef = useRef(onFailure);
  failRef.current = onFailure;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await loadConfig();
      if (!cfg?.stripePublishableKey) return failRef.current({ category: "other", message: "Card payments aren't configured here.", next: "Nothing was charged." });
      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(cfg.stripePublishableKey);
      if (!stripe || cancelled || !mount.current) return;
      const elements = stripe.elements({ clientSecret: backing.clientSecret, appearance: { theme: "night" } });
      elements.create("payment").mount(mount.current);
      setReady({ stripe, elements });
    })();
    return () => {
      cancelled = true;
    };
  }, [backing.clientSecret]);

  const pay = async () => {
    if (!ready) return;
    setBusy(true);
    const { error } = await ready.stripe.confirmPayment({ elements: ready.elements, redirect: "if_required", confirmParams: { return_url: window.location.href } });
    setBusy(false);
    if (error) return onFailure(categorize(error));
    onPaid();
  };

  return (
    <div className="flex flex-col gap-4">
      <div ref={mount} />
      <Button size="lg" block onClick={pay} disabled={!ready || busy || disabled}>{busy ? "Paying…" : `Pay ${formatMoney(backing.amountMinor, { cents: true })}`}</Button>
    </div>
  );
}

/** Local/CI only: stands in for the processor's card form. Clearly labelled; never shown with a real provider. */
function SandboxCardForm({ backing, disabled, onFailure, onPaid }: { backing: BackCampaignResponse; disabled: boolean; onFailure: (f: Failure) => void; onPaid: () => void }) {
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [busy, setBusy] = useState(false);
  const digits = useMemo(() => card.replace(/\D/g, ""), [card]);
  const pay = async () => {
    setBusy(true);
    try {
      const outcome = digits === "4242424242424242" ? "succeed" : "decline";
      const r = await api.sandboxPay(backing.backingId, outcome);
      if (r.status === "declined") onFailure({ category: "declined", message: "Your card was declined.", next: "Try another card. Nothing was charged." });
      else onPaid();
    } catch (e) {
      onFailure(categorize(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" icon={<CreditCard />} title="Sandbox card form">
        This environment has no payment processor connected. <span className="num">4242 4242 4242 4242</span> pays; any other number is declined.
      </Callout>
      <Field label="Card number" htmlFor="card">
        <TextInput id="card" inputMode="numeric" autoComplete="off" value={card} onChange={(e) => setCard(e.target.value)} />
      </Field>
      <Button size="lg" block onClick={pay} disabled={busy || disabled} data-testid="pay">
        {busy ? "Paying…" : `Pay ${formatMoney(backing.amountMinor, { cents: true })}`}
      </Button>
    </div>
  );
}

function Confirmation({ detail, perkTitle, amountMinor }: { detail: CampaignDetail; perkTitle: string; amountMinor: number }) {
  const c = detail.campaign;
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/campaigns/${c.slug}`;
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: c.title, url });
        return;
      } catch { /* cancelled */ }
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
  };
  return (
    <Container size="md" className="flex flex-col gap-6 py-12">
      <Card className="flex flex-col gap-6 p-6 sm:p-8" data-testid="checkout-confirmed">
        <div className="flex flex-col gap-3">
          <CircleCheck className="size-10 text-success" />
          <h1 className="text-3xl font-bold">You're backing {c.title}</h1>
          <p className="text-muted">
            {perkTitle} · <span className="num">{formatMoney(amountMinor, { cents: true })}</span> charged to your card.
          </p>
        </div>
        <TestModeNotice />
        {c.endsAt && (
          <div className="flex flex-col gap-2 text-sm">
            <p><span className="font-medium">Deadline:</span> <span className="num">{localDeadline(c.endsAt)}</span></p>
            <p className="text-muted">If the goal is reached by then, {c.artist.name} receives the money in stages as milestones are verified, and you'll get your perk by its delivery date.</p>
            <p className="text-muted">If it isn't, you're refunded in full automatically — you don't need to do anything.</p>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={share}><Share2 /> {copied ? "Link copied" : "Share the campaign"}</Button>
          <Button asChild size="lg" variant="secondary"><Link to="/backed">See my backings</Link></Button>
        </div>
      </Card>
    </Container>
  );
}
