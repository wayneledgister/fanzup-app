/**
 * Provider (CR-005, FR-MKT-012, parity FR-MKT-006/007): a listed provider's profile and services, and the request
 * form. Contact details never appear here: they're shared only after the provider accepts (NFR-MKT-04). Portfolio
 * links open in the in-app browser, never embedded.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { dollarsToMinor } from "@fanzup/shared/money";
import {
  MKT_OFF_PLATFORM_NOTICE, MKT_VETTING_NOTE, ServiceRequestInput, categoryLabel, priceFromLabel, turnaroundLabel,
  type ListingView, type ProviderPage,
} from "@fanzup/shared/marketplace";
import { Badge, Body, Button, Callout, Card, Checkbox, EmptyState, Eyebrow, Field, H1, H2, Loading, Num, Screen, TextField } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { color, space } from "@/theme";

export default function Provider() {
  const { slug = "" } = useLocalSearchParams<{ slug: string }>();
  const [p, setP] = useState<ProviderPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ListingView | null>(null);

  useEffect(() => {
    api.serviceProvider(slug).then(setP).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "We couldn't find that provider." : "We couldn't load this provider."));
  }, [slug]);

  if (error) return <Screen><EmptyState icon="alert-circle-outline" title={error} action={<Button variant="secondary" onPress={() => router.back()}>Back</Button>} /></Screen>;
  if (!p) return <Screen><Loading label="Loading provider" /></Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: p.displayName }} />
      <Eyebrow>Service provider</Eyebrow>
      <H1>{p.displayName}</H1>
      <Body muted>{p.headline}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        {p.categories.map((c) => <Badge key={c}>{categoryLabel(c)}</Badge>)}
        <Badge>{p.remoteOk ? (p.city ? `${p.city} or remote` : "Remote") : p.city ?? "In person"}</Badge>
      </View>
      {p.bio ? <Body>{p.bio}</Body> : null}
      {p.links.map((l) => (
        <Button key={l} variant="ghost" icon="open-outline" onPress={() => WebBrowser.openBrowserAsync(l)}>{new URL(l).hostname}</Button>
      ))}
      <H2>Services</H2>
      {p.listings.map((l) => (
        <Card key={l.id}>
          <Body style={{ fontFamily: "Inter_600SemiBold" }}>{l.title}</Body>
          <Badge>{categoryLabel(l.category)}</Badge>
          {l.description ? <Body muted small>{l.description}</Body> : null}
          <Num>{priceFromLabel(l.priceFromMinor, l.priceUnit)}</Num>
          {turnaroundLabel(l.turnaroundDays) ? <Body muted small>{turnaroundLabel(l.turnaroundDays)}</Body> : null}
          <Button variant={picked?.id === l.id ? "primary" : "secondary"} onPress={() => setPicked(l)}>Request this</Button>
        </Card>
      ))}
      {picked && <RequestForm key={picked.id} listing={picked} providerName={p.displayName} slug={p.slug} />}
      <Body muted small>{MKT_VETTING_NOTE}</Body>
    </Screen>
  );
}

function RequestForm({ listing, providerName, slug }: { listing: ListingView; providerName: string; slug: string }) {
  const session = useSession();
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("");
  const [shareEmail, setShareEmail] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!session.session) return <SignInPrompt next={`/services/${slug}`} text={`Log in with your artist account to request ${listing.title}.`} />;
  if (sent) {
    return (
      <Callout tone="success" icon="checkmark-circle-outline" title="Request sent">
        <View style={{ gap: space(2) }}>
          <Body muted small>{providerName} will accept or decline it. {MKT_OFF_PLATFORM_NOTICE}</Body>
          <Button variant="secondary" onPress={() => router.push("/services/requests")}>See your requests</Button>
        </View>
      </Callout>
    );
  }

  const submit = async () => {
    const parsed = ServiceRequestInput.safeParse({ listingId: listing.id, brief, shareEmail, budgetMinor: budget.trim() ? dollarsToMinor(Number(budget)) : null });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    setSending(true);
    try {
      await api.sendServiceRequest(parsed.data);
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "email_unverified") return router.push(`/auth/verify?next=${encodeURIComponent(`/services/${slug}`)}`);
      setErrors({ form: e instanceof ApiError ? e.message : "We couldn't send your request. Try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <H2>Request: {listing.title}</H2>
      <Field label="What do you need?" error={errors.brief} hint="The songs, the deadline, references.">
        <TextField value={brief} onChangeText={setBrief} multiline maxLength={4000} invalid={!!errors.brief} style={{ minHeight: 120, textAlignVertical: "top" }} />
      </Field>
      <Field label="Budget in USD (optional)" error={errors.budgetMinor} hint="A guide for the conversation. Nothing is charged.">
        <TextField value={budget} onChangeText={(t) => setBudget(t.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" invalid={!!errors.budgetMinor} />
      </Field>
      <Checkbox checked={shareEmail} onChange={setShareEmail}>{`Share my account email with ${providerName} if they accept.`}</Checkbox>
      <Callout tone="info" icon="information-circle-outline" title="How payment works">{<Body muted small>{MKT_OFF_PLATFORM_NOTICE}</Body>}</Callout>
      {errors.form ? <Body small style={{ color: color.error }}>{errors.form}</Body> : null}
      <Button icon="send-outline" loading={sending} onPress={submit}>Send request</Button>
    </Card>
  );
}
