/**
 * Checkout (FR-MOB-004; parity FR-BCK-001/002, FR-PAY-001, FR-PAY-006, FR-PRV-001, FR-PLT-006). The same state machine
 * and rules as the web checkout, from @fanzup/shared: Idempotency-Key lifecycle (`checkout-key`), failure categories,
 * dead/paid statuses, hold announcements and the capture poll (`checkout-flow`). Cards go to Stripe's PaymentSheet and
 * never touch FanZuP code; with the sandbox provider (local/CI) a labelled sandbox form stands in. The app never
 * decides on its own that a payment succeeded — only `GET /backings/:id` does (NFR-MOB-01).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Share, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { initPaymentSheet, initStripe, presentPaymentSheet, PaymentSheetError } from "@stripe/stripe-react-native";
import { POLICY } from "@fanzup/shared/policy";
import { checkoutKeyName } from "@fanzup/shared/checkout-key";
import {
  acceptanceDocuments, categorize, deadReason, DECLINED, EXPIRED, failureTitle, formatHold, holdAnnouncement, holdSecondsLeft, PAID_STATUSES,
  PHYSICAL_PERK_NOTE, SANDBOX_PAYING_CARD, waitForCapture, type Failure,
} from "@fanzup/shared/checkout-flow";
import type { BackCampaignResponse, CampaignDetail, Me } from "@fanzup/shared/schemas";
import { acceptingBackers } from "@fanzup/shared/backing-copy";
import { formatDate, formatInstant, formatMoney } from "@fanzup/shared/format";
import { ArtistArt, Body, Button, Callout, Card, Checkbox, Divider, EscrowNotice, Field, H1, H2, KeyValue, Loading, Num, Row, Screen, Stepper, TestModeNotice, TextField } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";
import { api, ApiError } from "@/lib/api";
import { loadConfig } from "@/lib/config";
import { keys } from "@/lib/ids";
import { campaignShareUrl, openWeb } from "@/lib/links";
import { useSession } from "@/lib/session";
import { color, font, space } from "@/theme";

type Step = "review" | "pay" | "processing" | "done";

export default function CheckoutScreen() {
  const { slug = "", perk: perkId = "" } = useLocalSearchParams<{ slug: string; perk?: string }>();
  const session = useSession();
  if (session.loading) return <Screen edges={["bottom"]}><Loading label="Loading checkout" /></Screen>;
  const next = `/checkout/${slug}?perk=${perkId}`;
  if (!session.session) return <Screen edges={["bottom"]}><H1>Checkout</H1><SignInPrompt next={next} text="Create a free account or log in to back this campaign. You'll come straight back here." /></Screen>;
  if (!session.emailVerified) {
    return (
      <Screen edges={["bottom"]}>
        <H1>Verify your email first</H1>
        <Body muted>Open the link we emailed you, then come back to finish backing.</Body>
        <Button onPress={() => router.push(`/auth/verify?next=${encodeURIComponent(next)}`)}>I've verified</Button>
      </Screen>
    );
  }
  return <Checkout slug={slug} perkId={perkId} />;
}

function Checkout({ slug, perkId }: { slug: string; perkId: string }) {
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

  if (loadError) return <Screen edges={["bottom"]}><Callout tone="error" icon="alert-circle-outline" title="Checkout unavailable">{loadError}</Callout></Screen>;
  if (!detail || !me) return <Screen edges={["bottom"]}><Loading label="Loading checkout" /></Screen>;
  const c = detail.campaign;
  if (!perk) {
    return (
      <Screen edges={["bottom"]}>
        <Callout tone="warning" icon="alert-circle-outline" title="Pick a perk first">That perk isn't part of this campaign any more.</Callout>
        <Button onPress={() => router.replace(`/campaigns/${slug}`)}>Choose a perk</Button>
      </Screen>
    );
  }
  const closed = !acceptingBackers(c);
  const soldOut = perk.remaining === 0;
  const needsAcceptance = me.needsAcceptance.length > 0;
  const keyName = checkoutKeyName(slug, perk.id, qty);

  const confirmed = () => {
    keys.discard(keyName);
    setStep("done");
  };
  /** The backing can't be paid any more (hold expired, canceled, refunded): new key, back to the review step. */
  const dead = (f: Failure) => {
    keys.discard(keyName);
    setBacking(null);
    setFailure(f);
    setStep("review");
  };

  const start = async () => {
    setFailure(undefined);
    setBusy(true);
    try {
      if (needsAcceptance) {
        await api.accept(acceptanceDocuments(me));
        setMe({ ...me, needsAcceptance: [] });
      }
      const r = await api.back({ campaignId: c.id, perkId: perk.id, quantity: qty, source: null }, keys.get(keyName));
      setBacking(r);
      // The key may replay a 201 for a backing already paid or already dead: ask where it is now.
      let current: { status: string; holdExpiresAt: string | null } | null = null;
      try {
        current = await api.backing(r.backingId);
      } catch { /* can't tell: show the card step; paying twice can't charge twice */ }
      if (current && PAID_STATUSES.includes(current.status)) return confirmed();
      const why = current && deadReason(current);
      if (why) return dead(why);
      setStep("pay");
    } catch (e) {
      // Any stored 4xx ends this attempt: the next try gets a new key. 502 / in_progress / network keep it.
      if (e instanceof ApiError) keys.afterError(keyName, e);
      setFailure(categorize(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done" && backing) return <Confirmation detail={detail} perkTitle={perk.title} physical={perk.kind === "physical"} amountMinor={backing.amountMinor} />;

  return (
    <Screen edges={["bottom"]}>
      <Card>
        <Row>
          <ArtistArt seed={c.artist.slug} label={c.artist.name} size={48} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontFamily: font.bodySemibold }} numberOfLines={2}>{c.title}</Body>
            <Body muted small>{c.artist.name}</Body>
          </View>
        </Row>
        <Divider />
        <KeyValue k="Perk" v={perk.title} />
        <KeyValue k="Delivery by" v={<Num>{formatDate(perk.fulfillBy)}</Num>} />
        <KeyValue k="Quantity" v={step === "review" && !closed && !soldOut ? <Stepper value={qty} max={maxQty} onChange={setQty} label="quantity" /> : <Num>{qty}</Num>} />
        <KeyValue k="Total (USD)" v={<Num style={{ fontSize: 18, color: color.gold }}>{formatMoney(total, { cents: true })}</Num>} />
        <Body muted small>No fees are added. The artist covers card processing.</Body>
        {perk.kind === "physical" && <Body muted small>{PHYSICAL_PERK_NOTE}</Body>}
        {c.endsAt && <Body muted small>Campaign deadline: <Num style={{ fontSize: 13 }}>{formatInstant(c.endsAt, true)}</Num></Body>}
      </Card>

      <TestModeNotice />
      {failure && (
        <Callout tone="error" icon="alert-circle-outline" title={failureTitle(failure)} testID="checkout-failure">
          <View style={{ gap: space(2) }}>
            <Body muted small>{failure.message} {failure.next}</Body>
            {failure.category === "unconfirmed" && <Button variant="secondary" onPress={() => router.navigate("/backed")}>Open My backings</Button>}
          </View>
        </Callout>
      )}

      {step === "review" && (
        <View style={{ gap: space(4) }}>
          {needsAcceptance && (
            <Checkbox checked={accept} onChange={setAccept}>
              <Body>
                I've read and accept the updated{" "}
                <Body style={{ color: color.gold }} >Terms</Body> and <Body style={{ color: color.gold }}>Privacy Policy</Body>.
              </Body>
            </Checkbox>
          )}
          {needsAcceptance && (
            <Row style={{ gap: space(2) }}>
              <Button variant="ghost" onPress={() => openWeb("/legal/terms")}>Read Terms</Button>
              <Button variant="ghost" onPress={() => openWeb("/legal/privacy")}>Read Privacy</Button>
            </Row>
          )}
          {closed ? (
            <Callout tone="warning" icon="time-outline" title="This campaign isn't accepting backers">Nothing was charged.</Callout>
          ) : soldOut ? (
            <Callout tone="warning" icon="time-outline" title="That perk just sold out">Go back and pick another one. Nothing was charged.</Callout>
          ) : (
            <Button onPress={start} loading={busy} disabled={needsAcceptance && !accept} testID="continue-to-payment">
              {busy ? "Holding your perk…" : `Continue to payment · ${formatMoney(total, { cents: true })}`}
            </Button>
          )}
          <Body muted small>We hold your perk for <Num style={{ fontSize: 13 }}>{POLICY.checkout.holdMinutes}</Num> minutes while you pay. Your card is charged when you pay.</Body>
        </View>
      )}

      {(step === "pay" || step === "processing") && backing && (
        <PaymentStep
          backing={backing}
          processing={step === "processing"}
          onProcessing={() => setStep("processing")}
          onFailure={(f) => { setFailure(f); setStep("pay"); }}
          onClearFailure={() => setFailure(undefined)}
          onConfirmed={confirmed}
          onDead={dead}
        />
      )}

      <EscrowNotice compact />
      <Body muted small>Card details go straight to our payment processor and never touch FanZuP's servers. The artist receives only what's needed to deliver your perk.</Body>
    </Screen>
  );
}

function PaymentStep({ backing, processing, onProcessing, onFailure, onClearFailure, onConfirmed, onDead }: {
  backing: BackCampaignResponse; processing: boolean; onProcessing: () => void; onFailure: (f: Failure) => void; onClearFailure: () => void; onConfirmed: () => void; onDead: (f: Failure) => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => holdSecondsLeft(backing.holdExpiresAt));
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft(holdSecondsLeft(backing.holdExpiresAt)), 1000);
    return () => clearInterval(t);
  }, [backing.holdExpiresAt]);

  // Announce only at the 5-minute, 1-minute and expiry thresholds (NFR-MOB-05), never every second.
  const announcement = holdAnnouncement(secondsLeft);
  const last = useRef("");
  useEffect(() => {
    if (announcement && announcement !== last.current) AccessibilityInfo.announceForAccessibility(announcement);
    last.current = announcement;
  }, [announcement]);

  /** A payment attempt failed: if the backing itself is dead (e.g. the hold expired), this attempt is over. */
  const failed = async (f: Failure) => {
    try {
      const why = deadReason(await api.backing(backing.backingId));
      if (why) return onDead(why);
    } catch { /* can't tell: keep the attempt */ }
    onFailure(f);
  };

  const paid = async () => {
    onProcessing();
    const r = await waitForCapture(() => api.backing(backing.backingId));
    if (r.kind === "paid") return onConfirmed();
    if (r.kind === "dead") return onDead(r.failure);
    onFailure(r.failure);
  };

  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <H2>Payment</H2>
        <Num style={{ fontSize: 13, color: color.muted }}>{secondsLeft > 0 ? `Perk held for ${formatHold(secondsLeft)}` : "Hold expired"}</Num>
      </Row>
      {secondsLeft === 0 ? (
        <Callout tone="warning" icon="time-outline" title="Your hold expired">
          <View style={{ gap: space(2) }}>
            <Body muted small>Nothing was charged.</Body>
            <Button variant="secondary" onPress={() => onDead(EXPIRED)} testID="start-again">Start again</Button>
          </View>
        </Callout>
      ) : backing.provider === "stripe-test" ? (
        <StripePay backing={backing} disabled={processing} onFailure={failed} onCanceled={onClearFailure} onPaid={paid} />
      ) : (
        <SandboxPay backing={backing} disabled={processing} onFailure={failed} onPaid={paid} />
      )}
      {processing && <View accessibilityLiveRegion="polite"><Body muted small>Confirming your payment…</Body></View>}
    </Card>
  );
}

/** Stripe PaymentSheet on the PaymentIntent the API created (design §5). */
function StripePay({ backing, disabled, onFailure, onCanceled, onPaid }: { backing: BackCampaignResponse; disabled: boolean; onFailure: (f: Failure) => void; onCanceled: () => void; onPaid: () => void }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const failRef = useRef(onFailure);
  failRef.current = onFailure;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await loadConfig();
      if (!cfg?.stripePublishableKey) return failRef.current({ category: "other", message: "Card payments aren't configured here.", next: "Nothing was charged." });
      await initStripe({ publishableKey: cfg.stripePublishableKey, urlScheme: "fanzup" });
      const { error } = await initPaymentSheet({
        merchantDisplayName: "FanZuP",
        paymentIntentClientSecret: backing.clientSecret,
        returnURL: "fanzup://stripe-redirect",
        style: "alwaysDark",
        appearance: {
          colors: { primary: color.gold, background: color.surface, componentBackground: color.surface2, componentBorder: color.line, componentDivider: color.line, primaryText: color.fg, secondaryText: color.muted, placeholderText: color.muted, icon: color.muted, error: color.error },
          shapes: { borderRadius: 8 },
          primaryButton: { colors: { background: color.gold, text: color.onGold } },
        },
      });
      if (cancelled) return;
      if (error) return failRef.current(categorize(error, "create"));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [backing.clientSecret]);

  const pay = async () => {
    setBusy(true);
    const { error } = await presentPaymentSheet();
    setBusy(false);
    if (error?.code === PaymentSheetError.Canceled) return onCanceled(); // the fan closed the sheet: nothing happened
    if (error) return onFailure(categorize(error, "pay"));
    onPaid();
  };

  return <Button onPress={pay} loading={!ready || busy} disabled={disabled} testID="pay">{`Pay ${formatMoney(backing.amountMinor, { cents: true })}`}</Button>;
}

/** Local/CI only: stands in for the processor's card form. Clearly labelled; never shown with a real provider. */
function SandboxPay({ backing, disabled, onFailure, onPaid }: { backing: BackCampaignResponse; disabled: boolean; onFailure: (f: Failure) => void; onPaid: () => void }) {
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [busy, setBusy] = useState(false);
  const digits = useMemo(() => card.replace(/\D/g, ""), [card]);
  const pay = async () => {
    setBusy(true);
    try {
      const r = await api.sandboxPay(backing.backingId, digits === SANDBOX_PAYING_CARD ? "succeed" : "decline");
      if (r.status === "declined") onFailure(DECLINED);
      else onPaid();
    } catch (e) {
      onFailure(categorize(e, "pay"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space(3) }}>
      <Callout tone="info" icon="card-outline" title="Sandbox card form">
        <Body muted small>This environment has no payment processor connected. <Num style={{ fontSize: 13 }}>4242 4242 4242 4242</Num> pays; any other number is declined.</Body>
      </Callout>
      <Field label="Card number">
        <TextField value={card} onChangeText={setCard} keyboardType="number-pad" autoComplete="off" accessibilityLabel="Card number" />
      </Field>
      <Button onPress={pay} loading={busy} disabled={disabled} testID="pay">{`Pay ${formatMoney(backing.amountMinor, { cents: true })}`}</Button>
    </View>
  );
}

function Confirmation({ detail, perkTitle, physical, amountMinor }: { detail: CampaignDetail; perkTitle: string; physical: boolean; amountMinor: number }) {
  const c = detail.campaign;
  const share = () => Share.share({ title: c.title, message: `${c.title} — ${campaignShareUrl(c.slug)}` }).catch(() => {});
  return (
    <Screen edges={["bottom"]}>
      <Card testID="checkout-confirmed">
        <Body style={{ color: color.success, fontFamily: font.bodySemibold }}>Backing confirmed</Body>
        <H1>You're backing {c.title}</H1>
        <Body muted>{perkTitle} · <Num>{formatMoney(amountMinor, { cents: true })}</Num> charged to your card.</Body>
      </Card>
      <TestModeNotice />
      {c.endsAt && (
        <View style={{ gap: space(2) }}>
          <Body><Body style={{ fontFamily: font.bodySemibold }}>Deadline:</Body> <Num>{formatInstant(c.endsAt, true)}</Num></Body>
          <Body muted small>If the goal is reached by then, {c.artist.name} receives the money in stages as milestones are verified{physical ? "." : ", and the perk is due by its delivery date (in test mode the artist doesn't owe it)."}</Body>
          {physical && <Body muted small>{PHYSICAL_PERK_NOTE}</Body>}
          <Body muted small>If it isn't, you're refunded in full automatically — you don't need to do anything.</Body>
        </View>
      )}
      <Button icon="share-outline" onPress={share}>Share the campaign</Button>
      <Button variant="secondary" onPress={() => router.navigate("/backed")}>See my backings</Button>
    </Screen>
  );
}
