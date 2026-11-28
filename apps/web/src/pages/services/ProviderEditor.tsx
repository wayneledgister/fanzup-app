import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CircleAlert, FileText, Inbox, Lock, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Callout, Card, Checkbox, Container, Field, PageHeader, SectionHeading, Select, TextArea, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { api, ApiError } from "@/lib/api";
import { refreshMarketplaceAccess, useMarketplaceAccess } from "@/lib/marketplace";
import { dollarsToMinor } from "@fanzup/shared/money";
import {
  ListingsInput, MARKETPLACE_CATEGORIES, MKT_INVITE_ONLY, MKT_OFF_PLATFORM_NOTICE, MKT_TERMS_DRAFT_NOTE, POLICY_LIMITS, PRICE_UNITS, ProviderProfileInput, categoryLabel, providerStatusCopy,
  type CategoryKey, type ListingInput, type MyProvider, type PriceUnit,
} from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-005 MKT-1, FR-MKT-003/004. A provider's profile, listings and review status. Submitting sends the
 * profile to staff review; editing what staff checked on a listed profile sends it back to review (design §3).
 */
export default function ProviderEditorPage() {
  return (
    <RequireAccount>
      <ProviderEditor />
    </RequireAccount>
  );
}

type ListingDraft = { id?: string; category: CategoryKey; title: string; description: string; price: string; priceUnit: PriceUnit; turnaround: string; active: boolean };
const toDraft = (p: MyProvider | null): ListingDraft[] =>
  (p?.listings ?? []).map((l) => ({
    id: l.id, category: l.category, title: l.title, description: l.description ?? "", price: l.priceFromMinor == null ? "" : String(l.priceFromMinor / 100),
    priceUnit: l.priceUnit, turnaround: l.turnaroundDays == null ? "" : String(l.turnaroundDays), active: l.active,
  }));
const UNIT_LABEL: Record<PriceUnit, string> = { project: "per project", song: "per song", hour: "per hour", day: "per day" };

function ProviderEditor() {
  const [p, setP] = useState<MyProvider | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({ slug: "", displayName: "", headline: "", bio: "", city: "", remoteOk: true, categories: [] as CategoryKey[], links: "", contactEmail: "" });
  const [listings, setListings] = useState<ListingDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // CR-007 (FR-MKT-021/025): provider access and the current Provider Terms come from the access check.
  const access = useMarketplaceAccess();
  const termsOk = !!access?.providerTerms.accepted;

  // Saving one section refreshes only that section, so unsaved edits in the other one survive (review finding 6).
  const apply = (x: MyProvider | null, only?: "profile" | "listings") => {
    setP(x);
    if (!x) return;
    if (only !== "listings") setForm({ slug: x.slug, displayName: x.displayName, headline: x.headline, bio: x.bio ?? "", city: x.city ?? "", remoteOk: x.remoteOk, categories: x.categories, links: x.links.join("\n"), contactEmail: x.contactEmail });
    if (only !== "profile") setListings(toDraft(x));
  };
  useEffect(() => {
    api.myProvider().then((r) => apply(r.provider)).catch(() => setLoadError(true));
  }, []);

  const fail = (e: unknown) => setErrors({ form: e instanceof ApiError ? e.message : "Something went wrong. Try again." });

  const saveProfile = async () => {
    const parsed = ProviderProfileInput.safeParse({
      ...form, bio: form.bio || null, city: form.city || null, links: form.links.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]))), false;
    setErrors({});
    setBusy(true);
    try {
      apply((await api.saveProvider(parsed.data)).provider, "profile");
      setMsg("Profile saved.");
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveListings = async () => {
    const body: ListingInput[] = listings.map((l) => ({
      ...(l.id ? { id: l.id } : {}), category: l.category, title: l.title, description: l.description || null, priceUnit: l.priceUnit, active: l.active,
      priceFromMinor: l.price.trim() ? dollarsToMinor(Number(l.price)) : null,
      turnaroundDays: l.turnaround.trim() ? Number(l.turnaround) : null,
    }));
    const parsed = ListingsInput.safeParse(body);
    if (!parsed.success) return setErrors({ listings: `Listing ${Number(parsed.error.issues[0].path[0]) + 1}: ${parsed.error.issues[0].message}` }), false;
    setErrors({});
    setBusy(true);
    try {
      apply((await api.saveListings(parsed.data)).provider, "listings");
      setMsg("Services saved.");
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      setP((await api.submitProvider()).provider);
      setMsg("Submitted for review.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (access === null) {
    return <Container size="md" className="py-16"><Callout tone="error" icon={<CircleAlert />} title="We couldn't check your marketplace access">Reload the page to try again.</Callout></Container>;
  }
  if (p === null && access && !access.canProvide) {
    return (
      <Container size="md" className="py-16">
        <Callout tone="info" icon={<Lock />} title="Provider profiles are invite-only for now">{MKT_INVITE_ONLY}</Callout>
      </Container>
    );
  }
  if (loadError) return <Container size="md" className="py-16"><Callout tone="error" icon={<CircleAlert />} title="We couldn't load your provider profile">Reload the page to try again.</Callout></Container>;
  if (p === undefined || access === undefined) return <Container size="md" className="py-8"><div className="h-64 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading" /></Container>;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const toggleCat = (c: CategoryKey) => setForm({ ...form, categories: form.categories.includes(c) ? form.categories.filter((x) => x !== c) : [...form.categories, c] });
  const setListing = (i: number, patch: Partial<ListingDraft>) => setListings(listings.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Container size="md" className="flex flex-col gap-8 py-8">
      <PageHeader
        eyebrow="Services marketplace"
        title="Your provider profile"
        description="Offer your services to artists on FanZuP. The team reviews every profile before it's listed."
        actions={p && <Button asChild variant="secondary"><Link to="/provider/requests"><Inbox /> Requests</Link></Button>}
      />
      {p && (
        <Callout tone={p.status === "listed" ? "success" : p.status === "suspended" ? "error" : "info"} title={<span className="flex items-center gap-2">Status <Badge>{p.status.replace("_", " ")}</Badge></span>}>
          {providerStatusCopy(p.status)}
          {p.reviewNote && <p className="mt-2 text-fg">Note from the team: {p.reviewNote}</p>}
          {p.status === "listed" && <p className="mt-2"><Link className="text-gold underline-offset-4 hover:underline" to={`/services/${p.slug}`}>See your public page</Link></p>}
        </Callout>
      )}
      <Callout tone="info">{MKT_OFF_PLATFORM_NOTICE}</Callout>
      {access && !termsOk && <ProviderTermsStep version={access.providerTerms.version} approved={access.providerTerms.approved} />}

      <Card className="flex flex-col gap-5">
        <SectionHeading title="Profile" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name artists will see" htmlFor="pv-name" error={errors.displayName}><TextInput id="pv-name" value={form.displayName} onChange={set("displayName")} maxLength={80} /></Field>
          <Field label="Profile address" htmlFor="pv-slug" error={errors.slug} hint={`fanzup.com/services/${form.slug || "your-name"}`}><TextInput id="pv-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} maxLength={60} /></Field>
        </div>
        <Field label="Headline" htmlFor="pv-headline" error={errors.headline} hint="One line on what you do and for whom."><TextInput id="pv-headline" value={form.headline} onChange={set("headline")} maxLength={120} /></Field>
        <Field label="About" htmlFor="pv-bio" optional error={errors.bio}><TextArea id="pv-bio" value={form.bio} onChange={set("bio")} maxLength={2000} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="pv-city" optional><TextInput id="pv-city" value={form.city} onChange={set("city")} maxLength={80} /></Field>
          <Field label="Contact email" htmlFor="pv-email" error={errors.contactEmail} hint="Shown only to artists whose request you accept."><TextInput id="pv-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} /></Field>
        </div>
        <Checkbox id="pv-remote" checked={form.remoteOk} onChange={(v) => setForm({ ...form, remoteOk: v })}>I work remotely</Checkbox>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">What you offer <span className="font-normal text-muted">(up to {POLICY_LIMITS.maxCategories})</span></legend>
          <div className="flex flex-wrap gap-2">
            {MARKETPLACE_CATEGORIES.map((c) => (
              <Button key={c.key} type="button" size="sm" variant={form.categories.includes(c.key) ? "primary" : "secondary"} aria-pressed={form.categories.includes(c.key)} onClick={() => toggleCat(c.key)}>
                {c.label}
              </Button>
            ))}
          </div>
          {errors.categories && <p className="text-sm text-error">{errors.categories}</p>}
        </fieldset>
        <Field label="Portfolio links" htmlFor="pv-links" optional error={errors.links} hint={`One https link per line, up to ${POLICY_LIMITS.maxLinks}.`}><TextArea id="pv-links" value={form.links} onChange={set("links")} className="min-h-20" /></Field>
        <Button onClick={saveProfile} disabled={busy || (!p && !termsOk)} className="self-start">{p ? "Save profile" : "Create profile"}</Button>
      </Card>

      {p && (
        <Card className="flex flex-col gap-5">
          <SectionHeading title="Services" action={listings.length < POLICY_LIMITS.maxListings && (
            <Button size="sm" variant="secondary" onClick={() => setListings([...listings, { category: p.categories[0], title: "", description: "", price: "", priceUnit: "project", turnaround: "", active: true }])}><Plus /> Add a service</Button>
          )} />
          {listings.length === 0 && <p className="text-sm text-muted">Add at least one service before you submit for review.</p>}
          {listings.map((l, i) => (
            <div key={i} className="flex flex-col gap-4 rounded-lg border border-line p-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
                <Field label="Service" htmlFor={`ls-title-${i}`}><TextInput id={`ls-title-${i}`} value={l.title} onChange={(e) => setListing(i, { title: e.target.value })} maxLength={90} placeholder="Mix and master one song" /></Field>
                <Field label="Category" htmlFor={`ls-cat-${i}`}>
                  <Select id={`ls-cat-${i}`} value={l.category} onChange={(e) => setListing(i, { category: e.target.value as CategoryKey })}>
                    {p.categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Description" htmlFor={`ls-desc-${i}`} optional><TextArea id={`ls-desc-${i}`} value={l.description} onChange={(e) => setListing(i, { description: e.target.value })} maxLength={2000} className="min-h-20" /></Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Starting at (USD)" htmlFor={`ls-price-${i}`} optional><TextInput id={`ls-price-${i}`} inputMode="decimal" value={l.price} onChange={(e) => setListing(i, { price: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
                <Field label="Price basis" htmlFor={`ls-unit-${i}`}>
                  <Select id={`ls-unit-${i}`} value={l.priceUnit} onChange={(e) => setListing(i, { priceUnit: e.target.value as PriceUnit })}>
                    {PRICE_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                  </Select>
                </Field>
                <Field label="Typical turnaround (days)" htmlFor={`ls-days-${i}`} optional><TextInput id={`ls-days-${i}`} inputMode="numeric" value={l.turnaround} onChange={(e) => setListing(i, { turnaround: e.target.value.replace(/\D/g, "") })} /></Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Checkbox id={`ls-active-${i}`} checked={l.active} onChange={(v) => setListing(i, { active: v })}>Show this service to artists</Checkbox>
                <Button variant="ghost" size="sm" onClick={() => setListings(listings.filter((_, j) => j !== i))}><Trash2 /> Remove</Button>
              </div>
            </div>
          ))}
          {errors.listings && <p className="text-sm text-error">{errors.listings}</p>}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={saveListings} disabled={busy}>Save services</Button>
            {(p.status === "draft" || p.status === "changes_requested") && (
              <Button onClick={submit} disabled={busy || !termsOk || p.listings.filter((l) => l.active).length === 0}>Submit for review</Button>
            )}
          </div>
        </Card>
      )}
      {errors.form && <p className="text-sm text-error" role="alert">{errors.form}</p>}
      {msg && !errors.form && <p className="text-sm text-success" role="status">{msg}</p>}
    </Container>
  );
}

/** FR-MKT-025: accept the current Provider Terms version (recorded with IP and user agent by the API). */
function ProviderTermsStep({ version, approved }: { version: string; approved: boolean }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.accept([{ kind: "provider_terms", version }]);
      refreshMarketplaceAccess();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-4" data-testid="provider-terms">
      <SectionHeading title={<span className="flex items-center gap-2"><FileText className="size-5 text-gold" /> Provider Terms</span>} />
      <p className="text-sm text-muted">
        Before you create a profile, send it for review or answer artists, please accept the{" "}
        <Link className="text-gold underline-offset-4 hover:underline" to="/legal/provider-terms" target="_blank">Provider Terms</Link> (version {version}).
      </p>
      {!approved && <Callout tone="warning">{MKT_TERMS_DRAFT_NOTE}</Callout>}
      <Checkbox id="pv-terms" checked={agree} onChange={setAgree}>I've read and agree to the Provider Terms</Checkbox>
      {err && <p className="text-sm text-error" role="alert">{err}</p>}
      <Button onClick={accept} disabled={!agree || busy} className="self-start" data-testid="accept-provider-terms">{busy ? "Saving…" : "Accept and continue"}</Button>
    </Card>
  );
}
