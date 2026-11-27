import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CircleAlert, ExternalLink, Info, MapPin, Send } from "lucide-react";
import { Badge, Button, Callout, Card, Checkbox, Container, EmptyState, Field, PageHeader, SectionHeading, Select, TextArea, TextInput } from "@/components/brand";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dollarsToMinor } from "@fanzup/shared/money";
import {
  MKT_OFF_PLATFORM_NOTICE, MKT_VETTING_NOTE, ServiceRequestInput, categoryLabel, priceFromLabel, turnaroundLabel,
  type ListingView, type ProviderPage as Provider,
} from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-005 MKT-1, FR-MKT-006/007. A listed provider's profile and services, and the request form.
 * Contact details are never shown here (NFR-MKT-04): they're shared only after the provider accepts a request.
 */
export default function ServiceProviderPage() {
  const { slug = "" } = useParams();
  const [p, setP] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ListingView | null>(null);

  useEffect(() => {
    api.serviceProvider(slug).then(setP).catch((e) => setError(e instanceof ApiError && e.status === 404 ? "We couldn't find that provider." : "We couldn't load this provider. Try again."));
  }, [slug]);

  if (error) {
    return (
      <Container size="md" className="py-16">
        <EmptyState icon={<CircleAlert />} title={error} action={<Button asChild variant="secondary"><Link to="/services"><ArrowLeft /> All services</Link></Button>} />
      </Container>
    );
  }
  if (!p) return <Container size="lg" className="py-8"><div className="h-64 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading provider" /></Container>;

  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <Link to="/services" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> All services</Link>
      <PageHeader eyebrow="Service provider" title={p.displayName} description={p.headline} />
      <div className="flex flex-wrap gap-2">
        {p.categories.map((c) => <Badge key={c}>{categoryLabel(c)}</Badge>)}
        <Badge icon={<MapPin />}>{p.remoteOk ? (p.city ? `${p.city} or remote` : "Remote") : p.city ?? "In person"}</Badge>
      </div>
      {p.bio && <p className="max-w-prose whitespace-pre-line text-muted">{p.bio}</p>}
      {p.links.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {p.links.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm text-gold underline-offset-4 hover:underline">
                {new URL(l).hostname} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeading title="Services" />
        <ul className="grid gap-4 sm:grid-cols-2">
          {p.listings.map((l) => (
            <li key={l.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">{l.title}</h3>
                  <Badge>{categoryLabel(l.category)}</Badge>
                </div>
                {l.description && <p className="whitespace-pre-line text-sm text-muted">{l.description}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="num">{priceFromLabel(l.priceFromMinor, l.priceUnit)}</span>
                    {turnaroundLabel(l.turnaroundDays) && <span className="text-muted"> · {turnaroundLabel(l.turnaroundDays)}</span>}
                  </div>
                  <Button size="sm" variant={picked?.id === l.id ? "primary" : "secondary"} onClick={() => setPicked(l)}>Request this</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {picked && <RequestForm key={picked.id} listing={picked} providerName={p.displayName} />}
      <p className="text-sm text-muted">{MKT_VETTING_NOTE}</p>
    </Container>
  );
}

type MyCampaign = { id: string; title: string; status: string };

function RequestForm({ listing, providerName }: { listing: ListingView; providerName: string }) {
  const s = useSession();
  const nav = useNavigate();
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [shareEmail, setShareEmail] = useState(true);
  const [campaigns, setCampaigns] = useState<MyCampaign[] | null>(null);
  const [noArtist, setNoArtist] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!s.session) return;
    api.request<{ campaigns: MyCampaign[] }>("/v1/artist")
      .then((a) => setCampaigns(a.campaigns.filter((c) => !["withdrawn", "closed"].includes(c.status))))
      .catch((e) => { if (e instanceof ApiError && e.code === "no_artist") setNoArtist(true); setCampaigns([]); });
  }, [s.session]);

  if (!s.session) {
    const next = encodeURIComponent(window.location.pathname);
    return (
      <Callout tone="info" icon={<Info />} title={`Request ${listing.title}`}>
        <Link className="text-gold underline-offset-4 hover:underline" to={`/login?next=${next}`}>Log in</Link> or <Link className="text-gold underline-offset-4 hover:underline" to={`/signup?next=${next}`}>join FanZuP</Link> with your artist account to send a request.
      </Callout>
    );
  }
  if (noArtist) {
    return (
      <Callout tone="info" icon={<Info />} title="Requests come from artist profiles">
        Create your artist profile first, then you can request services. <Link className="text-gold underline-offset-4 hover:underline" to="/onboarding">Set up your artist profile</Link>
      </Callout>
    );
  }
  if (sent) {
    return (
      <Callout tone="success" title="Request sent">
        {providerName} will accept or decline it. {MKT_OFF_PLATFORM_NOTICE}{" "}
        <Link className="text-gold underline-offset-4 hover:underline" to="/services/requests">See your requests</Link>
      </Callout>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ServiceRequestInput.safeParse({
      listingId: listing.id, brief, shareEmail,
      budgetMinor: budget.trim() ? dollarsToMinor(Number(budget)) : null,
      neededBy: neededBy || null,
      campaignId: campaignId || null,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSending(true);
    try {
      await api.sendServiceRequest(parsed.data);
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_unverified") return nav(`/verify-email?next=${encodeURIComponent(window.location.pathname)}`);
      setErrors({ form: err instanceof ApiError ? err.message : "We couldn't send your request. Try again." });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card elevated>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <SectionHeading eyebrow="Send a request" title={listing.title} />
        <Field label="What do you need?" htmlFor="rq-brief" error={errors.brief} hint="The songs, the deadline, references, what you've got already.">
          <TextArea id="rq-brief" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} aria-invalid={!!errors.brief} aria-describedby="rq-brief-msg" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget (USD)" htmlFor="rq-budget" optional error={errors.budgetMinor} hint="A guide for the conversation. Nothing is charged.">
            <TextInput id="rq-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} aria-invalid={!!errors.budgetMinor} />
          </Field>
          <Field label="Needed by" htmlFor="rq-date" optional error={errors.neededBy}>
            <TextInput id="rq-date" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} aria-invalid={!!errors.neededBy} />
          </Field>
        </div>
        {campaigns && campaigns.length > 0 && (
          <Field label="For which campaign?" htmlFor="rq-campaign" optional>
            <Select id="rq-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Not linked to a campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </Field>
        )}
        <Checkbox id="rq-share" checked={shareEmail} onChange={setShareEmail}>
          Share my account email with {providerName} if they accept, so they can reply directly.
        </Checkbox>
        <Callout tone="info" icon={<Info />}>{MKT_OFF_PLATFORM_NOTICE}</Callout>
        {errors.form && <p className="text-sm text-error" role="alert">{errors.form}</p>}
        <Button type="submit" disabled={sending} className="self-start"><Send /> {sending ? "Sending…" : "Send request"}</Button>
      </form>
    </Card>
  );
}
