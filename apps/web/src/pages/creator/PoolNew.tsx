import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, CircleAlert, Minus, Plus, Save, Send } from "lucide-react";
import { COLLECTION_MECHANISMS, REVENUE_TYPE_COPY, riskBadge, type CollectionMechanism, type RevenueType } from "@fanzup/shared/l2";
import { POLICY } from "@fanzup/shared/policy";
import { Button, Callout, Card, Checkbox, ChoiceCard, Container, Field, KeyValue, PageHeader, SectionHeading, TextArea, TextInput } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { apiMessage, mechanismLabel, PayoutIllustration, RiskBadgeChip } from "@/components/invest/l2ui";
import { ApiError } from "@/lib/api";
import { l2, type PoolDraftRequest } from "@/lib/l2";
import { formatMoney } from "@/lib/format";

/**
 * Source: FanZuP CreatorApp create-pool modal steps 2–3, rebuilt as one page with sections (CR-002 FR-L2-CR-002…004;
 * L2 gate condition 11). Album basics, use of funds (= target), royalty terms (revenue types, split, Units, price,
 * cap, maturity), collection mechanism with its derived badge, production milestones, then a plain-language summary
 * with a potential-payout illustration that includes zero. "Shares" are Units (Brand §7.5).
 */
export default function PoolNewPage() {
  return (
    <RequireAccount>
      <PoolNew />
    </RequireAccount>
  );
}

type Line = { label: string; dollars: string };
type Tranche = { pct: string; milestone: string; evidence: string; date: string };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const cents = (d: string) => Math.round(Number((d || "0").replace(/[$,\s]/g, "")) * 100);

function PoolNew() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get("edit");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [genre, setGenre] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [tracks, setTracks] = useState("");
  const [story, setStory] = useState("");
  const [risks, setRisks] = useState("");
  const [funds, setFunds] = useState<Line[]>([{ label: "Studio time", dollars: "" }, { label: "Mixing and mastering", dollars: "" }]);
  const [types, setTypes] = useState<RevenueType[]>(["master"]);
  const [fansPct, setFansPct] = useState(String(POLICY.l2.defaults.fansBps / 100));
  const platformPct = POLICY.l2.defaults.platformBps / 100;
  const [units, setUnits] = useState("400");
  const [price, setPrice] = useState("50");
  const [minUnits, setMinUnits] = useState("1");
  const [days, setDays] = useState("30");
  const [cap, setCap] = useState(String(POLICY.l2.defaults.returnCapBps / 10_000));
  const [years, setYears] = useState(String(POLICY.l2.defaults.maturityMonths / 12));
  const [mechanism, setMechanism] = useState<CollectionMechanism>("DISTRIBUTOR_REDIRECT");
  const [counterparty, setCounterparty] = useState("");
  const [tranches, setTranches] = useState<Tranche[]>([{ pct: "50", milestone: "", evidence: "", date: "" }, { pct: "50", milestone: "", evidence: "", date: "" }]);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [err, setErr] = useState<{ title: string; body: string; tier?: boolean } | null>(null);

  useEffect(() => {
    if (!editId) return;
    l2.creatorPool(editId).then((p) => {
      setTitle(p.title); setSlug(p.slug); setSlugTouched(true); setGenre(p.genre ?? ""); setReleaseDate(p.releaseDate ?? ""); setTracks(p.tracklist.join("\n"));
      setStory(p.story ?? ""); setRisks(p.risks ?? ""); setFunds(p.useOfFunds.map((u) => ({ label: u.label, dollars: String(u.amountMinor / 100) })));
      setTypes(p.revenueTypes); setFansPct(String(p.fansBps / 100)); setUnits(String(p.unitsTotal)); setPrice(String(p.unitPriceMinor / 100)); setMinUnits(String(p.minUnits));
      setDays(String(p.durationDays)); setCap(String(p.returnCapBps / 10_000)); setYears(String(p.maturityMonths / 12)); setMechanism(p.collectionMechanism as CollectionMechanism);
      setCounterparty(p.collection?.details?.counterparty ?? "");
      setTranches(p.tranches.map((t) => ({ pct: String(t.pct), milestone: t.milestone ?? "", evidence: t.evidenceRequired ?? "", date: t.targetDate ?? "" })));
    }).catch((e) => setErr({ title: "We couldn't load that draft", body: apiMessage(e) }));
  }, [editId]);

  const target = funds.reduce((s, f) => s + cents(f.dollars), 0);
  const unitPriceMinor = cents(price);
  const unitsN = Math.floor(Number(units) || 0);
  const maxMinor = unitsN * unitPriceMinor;
  const fansBps = Math.round(Number(fansPct) * 100);
  const creatorPct = Math.round((100 - Number(fansPct) - platformPct) * 100) / 100;
  const badge = riskBadge(mechanism, types);
  const trancheSum = tranches.reduce((s, t) => s + (Number(t.pct) || 0), 0);
  const capBps = Math.round(Number(cap) * 10_000);
  const maturityMonths = Math.round(Number(years) * 12);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (title.trim().length < 2) p.push("Name the album.");
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) p.push("The Pool address needs 3+ lowercase letters, numbers or dashes.");
    if (!tracks.trim()) p.push("Add the tracklist.");
    if (target < 100_000) p.push("The funding target (sum of use of funds) must be at least $1,000.");
    if (maxMinor < target) p.push("Units × Unit price must cover the funding target.");
    if (!types.length) p.push("Choose at least one revenue type.");
    if (!(fansBps >= 100 && fansBps <= 9000) || creatorPct < 0) p.push("The fan share must be between 1% and 90%.");
    if (trancheSum !== 100) p.push("Milestone percentages must add up to 100%.");
    if (tranches.slice(1).some((t) => !t.milestone.trim())) p.push("Describe every milestone after the first.");
    if (!(capBps >= 10_000 && capBps <= 30_000)) p.push("The return cap must be between 1× and 3×.");
    if (!(maturityMonths >= 12 && maturityMonths <= 120)) p.push("Maturity must be between 1 and 10 years.");
    const d = Number(days);
    if (!(d >= POLICY.l2.deadlineDays.min && d <= POLICY.l2.deadlineDays.max)) p.push(`The offering runs ${POLICY.l2.deadlineDays.min}–${POLICY.l2.deadlineDays.max} days.`);
    return p;
  }, [title, slug, tracks, target, maxMinor, types, fansBps, creatorPct, trancheSum, tranches, capBps, maturityMonths, days]);

  const body = (): PoolDraftRequest => ({
    slug, title: title.trim(), genre: genre || null, releaseDate: releaseDate || null,
    tracklist: tracks.split("\n").map((t) => t.trim()).filter(Boolean), story: story || null, risks: risks || null,
    useOfFunds: funds.filter((f) => f.label.trim() && cents(f.dollars) > 0).map((f) => ({ label: f.label.trim(), amountMinor: cents(f.dollars) })),
    revenueTypes: types, fansBps, platformBps: POLICY.l2.defaults.platformBps, unitsTotal: unitsN, unitPriceMinor, minUnits: Math.max(1, Math.floor(Number(minUnits) || 1)),
    durationDays: Number(days), returnCapBps: capBps, maturityMonths, collectionMechanism: mechanism, collectionDetails: counterparty ? { counterparty } : {},
    tranches: tranches.map((t, i) => ({ seq: i + 1, pct: Number(t.pct), milestone: i === 0 ? null : t.milestone, evidenceRequired: t.evidence || null, targetDate: t.date || null })),
  });

  const save = async (andSubmit: boolean) => {
    if (problems.length) return setErr({ title: "Fix these first", body: problems.join(" ") });
    setBusy(andSubmit ? "submit" : "save");
    setErr(null);
    try {
      const id = editId ? (await l2.updatePool(editId, body())).id : (await l2.createPool(body())).id;
      if (andSubmit) await l2.submitPool(id);
      navigate(`/creator/pools/${id}`);
    } catch (e) {
      const tier = e instanceof ApiError && e.code === "tier_not_eligible";
      setErr({ title: tier ? "Pools open at Rising tier" : "We couldn't save the Pool", body: apiMessage(e), tier });
      setBusy(null);
    }
  };

  const toggleType = (t: RevenueType) => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <Link to="/creator/pools" className="flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Your Pools</Link>
      <PageHeader eyebrow="New revenue-share Pool" title={editId ? "Edit album Pool" : "Offer fans a share of an album's royalties"} description="Fans buy Units; Units receive a share of the album's collected royalties until they reach a cap or the Pool ends. Everything here goes into the Form C." />

      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="1" title="The album" />
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label="Album title" htmlFor="p-title"><TextInput id="p-title" value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} /></Field>
          <Field label="Pool address" htmlFor="p-slug" hint={`fanzup.com/pools/${slug || "…"}`}><TextInput id="p-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} /></Field>
          <Field label="Genre" htmlFor="p-genre" optional><TextInput id="p-genre" value={genre} onChange={(e) => setGenre(e.target.value)} /></Field>
          <Field label="Planned release date" htmlFor="p-release" optional><TextInput id="p-release" type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} /></Field>
          <Field label="Tracklist (one per line)" htmlFor="p-tracks" className="sm:col-span-2"><TextArea id="p-tracks" rows={5} value={tracks} onChange={(e) => setTracks(e.target.value)} /></Field>
          <Field label="Story" htmlFor="p-story" className="sm:col-span-2" optional><TextArea id="p-story" rows={4} value={story} onChange={(e) => setStory(e.target.value)} /></Field>
          <Field label="Risks fans should know" htmlFor="p-risks" className="sm:col-span-2" optional><TextArea id="p-risks" rows={3} value={risks} onChange={(e) => setRisks(e.target.value)} /></Field>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="2" title="Use of funds" />
        <Card className="flex flex-col gap-3">
          {funds.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
              <Field label={i === 0 ? "Line item" : <span className="sr-only">Line item {i + 1}</span>} htmlFor={`f-l-${i}`}><TextInput id={`f-l-${i}`} value={f.label} onChange={(e) => setFunds((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label={i === 0 ? "Amount ($)" : <span className="sr-only">Amount {i + 1} ($)</span>} htmlFor={`f-a-${i}`}><TextInput id={`f-a-${i}`} inputMode="decimal" value={f.dollars} onChange={(e) => setFunds((s) => s.map((x, j) => (j === i ? { ...x, dollars: e.target.value } : x)))} /></Field>
              <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setFunds((s) => s.filter((_, j) => j !== i))} disabled={funds.length <= 1}><Minus /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setFunds((s) => [...s, { label: "", dollars: "" }])} disabled={funds.length >= 12}><Plus /> Add a line</Button>
            <p className="text-sm text-muted">Funding target <span className="num text-fg" data-testid="target">{formatMoney(target)}</span></p>
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="3" title="Royalty terms" />
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-fg">Which royalties the Pool shares in</p>
            {(["master", "sync", "publishing"] as const).map((t) => (
              <Checkbox key={t} id={`rt-${t}`} checked={types.includes(t)} onChange={() => toggleType(t)}>
                {REVENUE_TYPE_COPY[t].label}
                {REVENUE_TYPE_COPY[t].note && <span className={t === "publishing" ? "text-warning" : "text-muted"}> — {REVENUE_TYPE_COPY[t].note}</span>}
              </Checkbox>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fans' share of those royalties (%)" htmlFor="t-fans"><TextInput id="t-fans" inputMode="decimal" value={fansPct} onChange={(e) => setFansPct(e.target.value)} /></Field>
            <Field label="Your share (%)" htmlFor="t-creator"><TextInput id="t-creator" value={Number.isFinite(creatorPct) ? String(creatorPct) : ""} readOnly /></Field>
            <Field label="Platform share (%)" htmlFor="t-platform" hint="Placeholder pending the fee schedule"><TextInput id="t-platform" value={String(platformPct)} readOnly /></Field>
            <Field label="Units" htmlFor="t-units"><TextInput id="t-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
            <Field label="Unit price ($)" htmlFor="t-price"><TextInput id="t-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            <Field label="Minimum Units per fan" htmlFor="t-min"><TextInput id="t-min" inputMode="numeric" value={minUnits} onChange={(e) => setMinUnits(e.target.value)} /></Field>
            <Field label="Offering length (days)" htmlFor="t-days"><TextInput id="t-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
            <Field label="Return cap (× Unit price)" htmlFor="t-cap"><TextInput id="t-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
            <Field label="Pool ends after (years)" htmlFor="t-years"><TextInput id="t-years" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} /></Field>
          </div>
          <p className="text-sm text-muted">Distributions are quarterly, from collected royalties only. Maximum raise <span className="num text-fg">{formatMoney(maxMinor)}</span> (Units × price).</p>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="4" title="How royalties will be collected" />
        <div className="grid gap-3 sm:grid-cols-2">
          {COLLECTION_MECHANISMS.map((m) => (
            <ChoiceCard key={m} selected={mechanism === m} onSelect={() => setMechanism(m)}>
              <p className="font-medium text-fg">{mechanismLabel(m)}</p>
              <div className="mt-2"><RiskBadgeChip badge={riskBadge(m, types)} /></div>
            </ChoiceCard>
          ))}
        </div>
        <Field label="Counterparty (distributor, bank or agency)" htmlFor="c-party" optional><TextInput id="c-party" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></Field>
        <Callout tone="info" title="The collection agreement must be executed before you can launch">FanZuP staff execute the collection record after Form C review. The badge fans see: <RiskBadgeChip badge={badge} /></Callout>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="5" title="Production milestones" />
        <Card className="flex flex-col gap-4">
          {tranches.map((t, i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-[100px_1fr_1fr_160px]">
              <Field label={`Release ${i + 1} (%)`} htmlFor={`tr-p-${i}`}><TextInput id={`tr-p-${i}`} inputMode="numeric" value={t.pct} onChange={(e) => setTranches((s) => s.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} /></Field>
              {i === 0 ? (
                <p className="self-end pb-3 text-sm text-muted sm:col-span-3">Released when the offering closes at its target.</p>
              ) : (
                <>
                  <Field label="Milestone" htmlFor={`tr-m-${i}`}><TextInput id={`tr-m-${i}`} value={t.milestone} onChange={(e) => setTranches((s) => s.map((x, j) => (j === i ? { ...x, milestone: e.target.value } : x)))} /></Field>
                  <Field label="Evidence" htmlFor={`tr-e-${i}`} optional><TextInput id={`tr-e-${i}`} value={t.evidence} onChange={(e) => setTranches((s) => s.map((x, j) => (j === i ? { ...x, evidence: e.target.value } : x)))} /></Field>
                  <Field label="Target date" htmlFor={`tr-d-${i}`} optional><TextInput id={`tr-d-${i}`} type="date" value={t.date} onChange={(e) => setTranches((s) => s.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} /></Field>
                </>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setTranches((s) => (s.length < 3 ? [...s, { pct: "0", milestone: "", evidence: "", date: "" }] : s.slice(0, 2)))}>
              {tranches.length < 3 ? <><Plus /> Add a third milestone</> : <><Minus /> Remove the third milestone</>}
            </Button>
            <p className={`num text-sm ${trancheSum === 100 ? "text-muted" : "text-error"}`}>{trancheSum}% of 100%</p>
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="6" title="What fans will see" />
        <Card>
          <dl className="divide-y divide-line">
            <KeyValue k="Target / maximum" v={<span className="num">{formatMoney(target)} / {formatMoney(maxMinor)}</span>} />
            <KeyValue k="Each Unit" v={<span className="num">{formatMoney(unitPriceMinor)}, a {unitsN ? (Number(fansPct) / unitsN).toFixed(4) : "0"}% share of collected royalties</span>} />
            <KeyValue k="Cap per Unit" v={<span className="num">{formatMoney(Math.floor((unitPriceMinor * capBps) / 10_000))}</span>} />
            <KeyValue k="Collection" v={<RiskBadgeChip badge={badge} />} />
          </dl>
        </Card>
        {unitsN > 0 && unitPriceMinor > 0 && <PayoutIllustration fansBps={fansBps} unitsTotal={unitsN} unitPriceMinor={unitPriceMinor} capBps={capBps} maturityMonths={maturityMonths} />}
      </section>

      {err && (
        <Callout tone="error" icon={<CircleAlert />} title={err.title}>
          {err.body} {err.tier && <Link to="/tier/rising" className="font-medium text-gold hover:underline">See what Rising requires</Link>}
        </Callout>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => save(false)} disabled={!!busy} data-testid="save-draft"><Save /> {busy === "save" ? "Saving…" : "Save draft"}</Button>
        <Button onClick={() => save(true)} disabled={!!busy} data-testid="submit-pool"><Send /> {busy === "submit" ? "Submitting…" : "Submit for Form C review"}</Button>
      </div>
    </Container>
  );
}
