import { useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, Copy, Gift, Mic2, MessageCircle, Package, Plus, Sparkles, Trash2, Award, Music, Truck, TriangleAlert } from "lucide-react";
import { Button, Callout, Field, IconChip, Select, TextArea, TextInput, EmptyState } from "@/components/brand";
import { FormSection, MoneyInput, Segmented, WizardFooter, WizardHeader } from "@/components/campaign/WizardFrame";
import {
  deadlineOf, emptyPerk, formatMonth, monthKey, toInt, uid, updateDraft, useDraft, validatePerks, digits,
  type PerkDraft, type PerkKind, type ShipsTo,
} from "@/components/campaign/draft";
import { cn } from "@/lib/utils";

/**
 * Source: FPS src/pages/campaign/CampaignPerks.tsx (perk-tier builder)
 * Doc-driven changes: the wireframe's unit-based tiers ("N units minimum", Early Supporter → Diamond Investor),
 * "revenue sharing (all unit holders)", investor vs non-investor pricing, the +30% non-investor premium,
 * subscriptions and prepaid packages are removed. Reward campaigns have one price per perk and no financial
 * terms (Mechanism 05). Kept: standard templates vs custom build, perk categories, per-perk included items,
 * pricing guidance. Added: required estimated delivery month per perk, quantity limits, shipping regions,
 * and an inline perks-only language check. "Skip perks" removed — every campaign needs at least one perk.
 */

type Template = { title: string; price: string; kind: PerkKind; description: string; items: string[] };
const CATEGORIES: { id: string; label: string; icon: React.ReactNode; templates: Template[] }[] = [
  {
    id: "content",
    label: "Content & access",
    icon: <Music />,
    templates: [
      { title: "Digital thank-you + early listen", price: "10", kind: "digital", description: "Hear the project 48 hours before everyone else, plus a signed digital thank-you card.", items: ["Early listen (48 hours before release)", "Signed digital thank-you card"] },
      { title: "Behind-the-scenes diary", price: "20", kind: "digital", description: "Studio sessions, rehearsals and the road — posted for backers only.", items: ["Backer-only video diary", "Demo and acoustic versions"] },
    ],
  },
  {
    id: "merch",
    label: "Merch & physical",
    icon: <Package />,
    templates: [
      { title: "Limited campaign tee", price: "40", kind: "physical", description: "A shirt printed only for this campaign. Never sold again.", items: ["Campaign-exclusive tee", "Digital thank-you card"] },
      { title: "Signed vinyl", price: "60", kind: "physical", description: "First-press vinyl, signed and numbered.", items: ["Signed, numbered vinyl", "Digital download"] },
    ],
  },
  {
    id: "live",
    label: "Live & experiences",
    icon: <Mic2 />,
    templates: [
      { title: "Show ticket", price: "35", kind: "experience", description: "One general-admission ticket to the show.", items: ["1 GA ticket"] },
      { title: "Soundcheck + meet the band", price: "150", kind: "experience", description: "Watch soundcheck from the floor and hang with the band before doors.", items: ["Soundcheck access", "Pre-show meet & greet", "1 GA ticket"] },
    ],
  },
  {
    id: "recognition",
    label: "Recognition",
    icon: <Award />,
    templates: [
      { title: "Name in the credits", price: "25", kind: "digital", description: "Your name in the liner notes and on the project page.", items: ["Name in liner notes", "Name on the project page"] },
      { title: "Personal video shout-out", price: "75", kind: "digital", description: "A short video message from the artist, made for you.", items: ["Personal video (up to 60 seconds)"] },
    ],
  },
  {
    id: "community",
    label: "Community",
    icon: <MessageCircle />,
    templates: [
      { title: "Backer listening party", price: "30", kind: "experience", description: "An online listening party with a live Q&A for backers.", items: ["Online listening party", "Live Q&A with the artist"] },
      { title: "Private acoustic set", price: "500", kind: "experience", description: "A short acoustic set for you and up to 10 friends (travel within 50 miles).", items: ["30-minute acoustic set", "Photo with the artist"] },
    ],
  },
];

const KIND_LABEL: Record<PerkKind, string> = { digital: "Digital", physical: "Physical", experience: "Experience" };
const SHIPS: Record<ShipsTo, string> = { us: "United States only", na: "United States and Canada", world: "Worldwide" };
const GUIDE = [
  ["Digital perks", "$5–$25"],
  ["Physical items", "$25–$75"],
  ["Online experiences", "$30–$150"],
  ["Live experiences", "$35–$300"],
  ["One-off premium", "$500+"],
];

export default function Perks() {
  const d = useDraft();
  const [show, setShow] = useState(false);
  const [category, setCategory] = useState(CATEGORIES[0].id);
  const [open, setOpen] = useState<Set<string>>(() => new Set<string>());
  const errors = show ? validatePerks(d) : {};
  const deadline = monthKey(deadlineOf(d));

  const setPerk = (id: string, patch: Partial<PerkDraft>) => updateDraft((s) => ({ perks: s.perks.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const addPerk = (p: PerkDraft) => {
    updateDraft((s) => ({ perks: [...s.perks, p] }));
    setOpen((o) => new Set(o).add(p.id));
  };
  const fromTemplate = (t: Template) => addPerk({ ...emptyPerk(t.kind), title: t.title, price: t.price, description: t.description, items: [...t.items] });
  const move = (i: number, dir: -1 | 1) =>
    updateDraft((s) => {
      const next = [...s.perks];
      const [p] = next.splice(i, 1);
      next.splice(i + dir, 0, p);
      return { perks: next };
    });
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const prices = d.perks.map((p) => toInt(p.price)).filter(Number.isFinite);
  const months = d.perks.map((p) => p.fulfillBy).filter(Boolean).sort();
  const cat = CATEGORIES.find((c) => c.id === category)!;
  const starterSet = () => [CATEGORIES[0].templates[0], CATEGORIES[1].templates[1], CATEGORIES[2].templates[0]].forEach(fromTemplate);

  return (
    <>
      <WizardHeader step={3} title="Choose your perks" description="Perks are what backers get for backing you. Offer things you can make and deliver on time." />

      <Callout tone="gold" icon={<Gift />} title="How perks work">
        Each perk has one price. A backer picks a perk, and that's the amount they pledge. Every perk needs an estimated delivery month, and backers see
        it before they pledge. Perks are rewards only — no money, earnings or financial interest in your work.
      </Callout>

      <FormSection title="Start from a template" description="Pick a starting point and make it yours. You can edit everything." className="mt-8">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div role="tablist" aria-label="Perk categories" className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                type="button"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors [&_svg]:size-4",
                  category === c.id ? "border-gold/50 bg-gold/10 text-fg" : "border-line text-muted hover:text-fg",
                )}
              >
                {c.icon}
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div role="tabpanel" aria-label={cat.label} className="grid gap-3 sm:grid-cols-2">
          {cat.templates.map((t) => (
            <div key={t.title} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{t.title}</p>
                  <p className="text-xs text-muted">{KIND_LABEL[t.kind]}</p>
                </div>
                <span className="num text-sm text-fg">${t.price}</span>
              </div>
              <p className="text-sm text-muted">{t.description}</p>
              <Button variant="secondary" size="sm" className="mt-auto self-start" onClick={() => fromTemplate(t)}>
                <Plus /> Add this perk
              </Button>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection
        title="Your perks"
        description={
          d.perks.length ? (
            <>
              <span className="num">{d.perks.length}</span> {d.perks.length === 1 ? "perk" : "perks"}
              {prices.length ? (
                <>
                  {" "}
                  · from <span className="num">${Math.min(...prices).toLocaleString()}</span>
                </>
              ) : null}
              {months.length ? <> · first delivery {formatMonth(months[0])}</> : null}
            </>
          ) : (
            "Most campaigns offer 3–6 perks at different prices."
          )
        }
      >
        {d.perks.length === 0 ? (
          <div data-error={!!errors.perks || undefined} tabIndex={-1}>
            <EmptyState
              icon={<Gift />}
              title="No perks yet"
              className={errors.perks ? "border-error" : undefined}
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={starterSet}>
                    <Sparkles /> Add a starter set
                  </Button>
                  <Button variant="secondary" onClick={() => addPerk(emptyPerk())}>
                    <Plus /> Build your own
                  </Button>
                </div>
              }
            >
              Start with a starter set — a digital perk, a physical item and a ticket — or build one from scratch.
            </EmptyState>
            {errors.perks && <p className="mt-2 text-sm text-error">{errors.perks}</p>}
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {d.perks.map((p, i) => {
              const k = (f: string) => errors[`perk-${p.id}-${f}`];
              const hasErr = Object.keys(errors).some((x) => x.startsWith(`perk-${p.id}-`));
              const expanded = open.has(p.id) || hasErr;
              return (
                <li key={p.id} className={cn("rounded-lg border bg-surface", hasErr ? "border-error/60" : "border-line")}>
                  <div className="flex items-center gap-3 p-4">
                    <button type="button" onClick={() => toggle(p.id)} aria-expanded={expanded} aria-controls={`perk-body-${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="num flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-xs text-gold">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-fg">{p.title || "Untitled perk"}</span>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span className="num text-fg">{p.price ? `$${Number(p.price).toLocaleString()}` : "$—"}</span>·<span>{KIND_LABEL[p.kind]}</span>·
                          <span>{p.fulfillBy ? `Est. ${formatMonth(p.fulfillBy)}` : "No delivery date"}</span>
                          {p.limit && (
                            <>
                              ·<span className="num">{Number(p.limit).toLocaleString()} available</span>
                            </>
                          )}
                        </span>
                      </span>
                      <ChevronDown className={cn("size-5 shrink-0 text-muted transition-transform", expanded && "rotate-180")} />
                    </button>
                  </div>

                  {expanded && (
                    <div id={`perk-body-${p.id}`} className="flex flex-col gap-5 border-t border-line p-4 sm:p-5">
                      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                        <Field label="Perk name" htmlFor={`perk-${p.id}-title`} error={k("title")}>
                          <TextInput id={`perk-${p.id}-title`} value={p.title} onChange={(e) => setPerk(p.id, { title: e.target.value })} aria-invalid={!!k("title") || undefined} placeholder="Signed show poster" />
                        </Field>
                        <Field label="Price" htmlFor={`perk-${p.id}-price`} error={k("price")}>
                          <MoneyInput id={`perk-${p.id}-price`} value={p.price} onChange={(v) => setPerk(p.id, { price: v })} invalid={!!k("price")} placeholder="40" />
                        </Field>
                      </div>

                      <Field label="Type" htmlFor={`perk-${p.id}-kind`}>
                        <Segmented
                          label="Perk type"
                          value={p.kind}
                          onChange={(v) => setPerk(p.id, { kind: v })}
                          options={(Object.keys(KIND_LABEL) as PerkKind[]).map((x) => ({ value: x, label: KIND_LABEL[x] }))}
                        />
                      </Field>

                      <Field label="Description" htmlFor={`perk-${p.id}-description`} error={k("description")}>
                        <TextArea id={`perk-${p.id}-description`} rows={2} className="min-h-20" value={p.description} onChange={(e) => setPerk(p.id, { description: e.target.value })} aria-invalid={!!k("description") || undefined} placeholder="18×24 screen print designed for the night, signed by the band." />
                      </Field>

                      <fieldset className="flex flex-col gap-2" data-error={!!k("items") || undefined} tabIndex={k("items") ? -1 : undefined}>
                        <legend className="mb-1.5 text-sm font-medium text-fg">What's included</legend>
                        {p.items.map((it, j) => (
                          <div key={j} className="flex gap-2">
                            <TextInput
                              aria-label={`Included item ${j + 1}`}
                              value={it}
                              onChange={(e) => setPerk(p.id, { items: p.items.map((x, n) => (n === j ? e.target.value : x)) })}
                              placeholder={j === 0 ? "Signed 18×24 screen print" : "Another item"}
                            />
                            <Button variant="ghost" size="icon" aria-label={`Remove included item ${j + 1}`} disabled={p.items.length <= 1} onClick={() => setPerk(p.id, { items: p.items.filter((_, n) => n !== j) })}>
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                        <div>
                          <Button variant="ghost" size="sm" className="px-2 text-gold" disabled={p.items.length >= 8} onClick={() => setPerk(p.id, { items: [...p.items, ""] })}>
                            <Plus /> Add item
                          </Button>
                        </div>
                        {k("items") && <p className="text-sm text-error">{k("items")}</p>}
                      </fieldset>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Estimated delivery" htmlFor={`perk-${p.id}-fulfillBy`} error={k("fulfillBy")} hint={`Month you expect to deliver. ${formatMonth(deadline)} or later.`}>
                          <TextInput id={`perk-${p.id}-fulfillBy`} type="month" min={deadline} className="num" value={p.fulfillBy} onChange={(e) => setPerk(p.id, { fulfillBy: e.target.value })} aria-invalid={!!k("fulfillBy") || undefined} />
                        </Field>
                        <Field label="Quantity" htmlFor={`perk-${p.id}-limit`} optional error={k("limit")} hint="Leave blank for no limit.">
                          <TextInput id={`perk-${p.id}-limit`} inputMode="numeric" className="num" value={p.limit} onChange={(e) => setPerk(p.id, { limit: digits(e.target.value).slice(0, 6) })} aria-invalid={!!k("limit") || undefined} placeholder="Unlimited" />
                        </Field>
                      </div>

                      {p.kind === "physical" && (
                        <Field label="Ships to" htmlFor={`perk-${p.id}-ships`} hint="Shipping is included in the price. Backers outside these regions can't choose this perk.">
                          <div className="flex items-center gap-3">
                            <Truck className="size-5 shrink-0 text-muted" />
                            <Select id={`perk-${p.id}-ships`} value={p.shipsTo} onChange={(e) => setPerk(p.id, { shipsTo: e.target.value as ShipsTo })} className="max-w-xs">
                              {(Object.keys(SHIPS) as ShipsTo[]).map((x) => (
                                <option key={x} value={x}>
                                  {SHIPS[x]}
                                </option>
                              ))}
                            </Select>
                          </div>
                        </Field>
                      )}

                      {k("language") && (
                        <Callout tone="error" icon={<TriangleAlert />} title="This perk reads like a financial offer">
                          <span data-error="true" tabIndex={-1}>
                            {k("language")}
                          </span>
                        </Callout>
                      )}

                      <div className="flex flex-wrap items-center gap-1 border-t border-line pt-4">
                        <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.title || "perk"} up`}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === d.perks.length - 1} aria-label={`Move ${p.title || "perk"} down`}>
                          <ArrowDown />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={d.perks.length >= 12} onClick={() => addPerk({ ...p, id: uid("perk"), title: `${p.title} (copy)`, items: [...p.items] })}>
                          <Copy /> Duplicate
                        </Button>
                        <Button variant="ghost" size="sm" className="ml-auto text-error hover:text-error" onClick={() => updateDraft((s) => ({ perks: s.perks.filter((x) => x.id !== p.id) }))}>
                          <Trash2 /> Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {d.perks.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" disabled={d.perks.length >= 12} onClick={() => addPerk(emptyPerk())}>
              <Plus /> Add a custom perk
            </Button>
            <span className="text-xs text-muted">
              Up to <span className="num">12</span> perks
            </span>
          </div>
        )}
      </FormSection>

      <FormSection title="Pricing guidance" description="Typical ranges on reward campaigns. Price physical perks to cover making and shipping them.">
        <div className="relative overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Suggested perk price ranges</caption>
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Perk type
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Suggested range
                </th>
              </tr>
            </thead>
            <tbody>
              {GUIDE.map(([a, b]) => (
                <tr key={a} className="border-t border-line">
                  <td className="px-4 py-2.5 text-fg">{a}</td>
                  <td className="num px-4 py-2.5 text-right text-muted">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-start gap-3 text-sm text-muted">
          <IconChip tone="muted" className="size-9">
            <CalendarClock />
          </IconChip>
          <p>
            Pad your delivery dates. Pressing vinyl and printing merch often take longer than quoted. If a date slips, you'll update backers from your
            campaign page.
          </p>
        </div>
      </FormSection>

      {show && Object.keys(errors).length > 0 && d.perks.length > 0 && (
        <Callout tone="error" title="Some perks need attention" className="mt-2">
          Fix the highlighted fields to continue.
        </Callout>
      )}

      <WizardFooter
        step={3}
        continueLabel="Preview"
        onContinue={() => {
          setShow(true);
          return Object.keys(validatePerks(d)).length === 0;
        }}
      />
    </>
  );
}

