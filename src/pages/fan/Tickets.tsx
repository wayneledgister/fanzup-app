import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CalendarDays, CheckCircle2, Lock, MapPin, Search, Sparkles, Ticket } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, Field, KeyValue, PageHeader, Select, TextInput } from "@/components/brand";
import { Modal, OrderSummary, QtyStepper, processingFeeMinor, formatDay } from "@/components/fan/kit";
import { artistById, campaigns, events as mockEvents, fan, type EventItem } from "@/lib/mock";
import { formatMoney } from "@/lib/format";
import { POLICY } from "@/config/policy";

/**
 * Source: FanZuP TicketMarketplace.tsx.
 * Doc-driven: "BPU Holder" pricing, "Participation Bonus" and Star/Nebula/Galaxy/Supernova tier discounts removed —
 * holding units never changes ticket access (CONSOLIDATION, selected features). The only perk is a
 * Backer presale window for campaign backers and subscribers. Fees show card processing pass-through only
 * (platform fee TBD per products/fees.html). "Scanning global ticket nodes" loading copy dropped.
 */

interface Ev extends EventItem {
  presaleEndsOn?: string;
}

const EXTRA: Ev[] = [
  { id: "e5", artistId: "velvet-circuit", title: "Velvet Circuit — Warehouse Session", venue: "The Assembly Line", city: "Detroit, MI", date: "2027-02-27", priceMinor: 2800, remaining: 220, backerPresale: true, presaleEndsOn: "2026-11-01" },
  { id: "e6", artistId: "june-ash", title: "June Ash — Songs From the Porch", venue: "The Listening Room", city: "Nashville, TN", date: "2026-12-12", priceMinor: 1800, remaining: 24 },
];

const EVENTS: Ev[] = [...mockEvents.map((e) => ({ ...e, presaleEndsOn: e.backerPresale ? "2026-10-20" : undefined })), ...EXTRA].sort((a, b) => a.date.localeCompare(b.date));

/** Artists whose presales this fan qualifies for: backed one of their campaigns, or subscribes. */
const ELIGIBLE = new Set([...fan.subscriptions, ...campaigns.filter((c) => fan.backed.includes(c.id)).map((c) => c.artistId)]);

const artistName = (id: string) => (id === "june-ash" ? "June Ash" : artistById(id).name);

export default function Tickets() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("all");
  const [selected, setSelected] = useState<Ev | null>(null);

  const cities = useMemo(() => [...new Set(EVENTS.map((e) => e.city))].sort(), []);
  const list = EVENTS.filter((e) => (city === "all" || e.city === city) && `${e.title} ${e.venue} ${artistName(e.artistId)}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader eyebrow="Tickets" title="Shows from artists you back" description="Buy tickets straight from the artist. Backers and subscribers get early access to presales." />

      <div className="mb-8 grid gap-3 sm:grid-cols-[1fr_240px]">
        <Field label="Search events" htmlFor="ticket-q" className="[&>label]:sr-only">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <TextInput id="ticket-q" type="search" placeholder="Search artists, shows or venues" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
          </div>
        </Field>
        <Field label="City" htmlFor="ticket-city" className="[&>label]:sr-only">
          <Select id="ticket-city" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="all">All cities</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Ticket />}
          title="No shows match that search"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setCity("all");
              }}
            >
              Clear filters
            </Button>
          }
        >
          Try another artist or city, or follow more artists to hear about new dates first.
        </EmptyState>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <li key={e.id}>
              <EventCard e={e} onBuy={() => setSelected(e)} />
            </li>
          ))}
        </ul>
      )}

      <PurchaseDialog event={selected} onClose={() => setSelected(null)} />
    </Container>
  );
}

function presaleState(e: Ev): "none" | "eligible" | "locked" {
  if (!e.backerPresale || !e.presaleEndsOn || new Date(e.presaleEndsOn) < new Date()) return "none";
  return ELIGIBLE.has(e.artistId) ? "eligible" : "locked";
}

function EventCard({ e, onBuy }: { e: Ev; onBuy: () => void }) {
  const name = artistName(e.artistId);
  const soldOut = e.remaining === 0;
  const presale = presaleState(e);
  const low = !soldOut && e.remaining <= 30;
  return (
    <Card padded={false} interactive={!soldOut} className="flex h-full flex-col overflow-hidden">
      <div className="relative">
        <ArtistArt seed={`${e.artistId}-${e.id}`} label={name} className="aspect-[16/9] w-full rounded-none" />
        <div className="absolute inset-0 bg-scrim" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          {soldOut && <Badge tone="neutral">Sold out</Badge>}
          {presale !== "none" && (
            <Badge tone="gold" icon={<Sparkles />}>
              Backer presale
            </Badge>
          )}
        </div>
        <div className="absolute bottom-3 left-4 flex size-14 flex-col items-center justify-center rounded-md border border-line bg-canvas/85 backdrop-blur">
          <span className="text-[10px] uppercase text-muted">{new Date(e.date).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</span>
          <span className="num text-lg font-medium leading-none">{new Date(e.date).getUTCDate()}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <Link to={`/artist/${e.artistId}`} className="text-xs text-muted hover:text-fg">
            {name}
          </Link>
          <h3 className="text-lg font-semibold leading-snug">{e.title.replace(`${name} — `, "")}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <MapPin className="size-4 shrink-0" /> {e.venue} · {e.city}
          </p>
        </div>
        {presale === "eligible" && (
          <p className="rounded-md border border-gold/30 bg-gold/8 px-3 py-2 text-xs text-muted">
            <span className="font-medium text-fg">You're in the presale</span> as a backer or subscriber. Ends <span className="num">{formatDay(e.presaleEndsOn!)}</span>.
          </p>
        )}
        {presale === "locked" && (
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            Presale for {name}'s backers and subscribers. General sale opens <span className="num">{formatDay(e.presaleEndsOn!)}</span>.
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            <span className="num text-lg font-medium">{formatMoney(e.priceMinor)}</span>
            <span className="text-xs text-muted"> / ticket</span>
            {low && <p className="num text-xs text-warning">{e.remaining} left</p>}
          </div>
          {soldOut ? (
            <Button variant="secondary" size="sm" disabled>
              Sold out
            </Button>
          ) : presale === "locked" ? (
            <Button variant="secondary" size="sm" asChild>
              <Link to={`/artist/${e.artistId}`}>
                <Lock /> Get presale access
              </Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onBuy}>
              Get tickets
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function PurchaseDialog({ event, onClose }: { event: Ev | null; onClose: () => void }) {
  const [qty, setQty] = useState(2);
  const [done, setDone] = useState(false);
  const [processing, setProcessing] = useState(false);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setQty(2);
      setDone(false);
      setProcessing(false);
    }, 200);
  };
  const confirm = () => {
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      setDone(true);
    }, 700);
  };
  if (!event) return <Modal open={false} onOpenChange={() => undefined} title="" />;
  const max = Math.min(POLICY.tickets.maxPerOrder, event.remaining);
  const q = Math.min(qty, max);
  const subtotal = event.priceMinor * q;
  const total = subtotal + processingFeeMinor(subtotal);

  return (
    <Modal
      open={!!event}
      onOpenChange={(o) => !o && close()}
      title={done ? "You're going" : "Get tickets"}
      description={done ? undefined : event.title}
      footer={
        done ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={processing}>
              {processing ? "Processing…" : <>Pay <span className="num">{formatMoney(total, { cents: true })}</span></>}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-12 text-success" />
          <p className="text-sm text-muted">
            <span className="num text-fg">{q}</span> {q === 1 ? "ticket" : "tickets"} for {event.title} on <span className="num">{formatDay(event.date)}</span>. Your tickets and receipt are on their way to your email.
          </p>
          <div className="w-full rounded-lg border border-line bg-surface-2 p-4 text-left">
            <KeyValue k="Order" v={<span className="num">FZP-TIX-48213</span>} />
            <KeyValue k="Venue" v={`${event.venue}, ${event.city}`} />
            <KeyValue k="Charged" v={<span className="num">{formatMoney(total, { cents: true })}</span>} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 text-sm text-muted">
            <CalendarDays className="size-4 text-gold" />
            <span className="num">{formatDay(event.date, "long")}</span> · {event.venue}
          </div>
          {presaleState(event) === "eligible" && (
            <Callout tone="gold" icon={<Sparkles />} title="Backer presale">
              You have early access because you back or subscribe to {artistName(event.artistId)}.
            </Callout>
          )}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="qty" className="flex flex-col text-sm">
              <span className="font-medium">Quantity</span>
              <span className="text-xs text-muted">
                Up to <span className="num">{max}</span> per order
              </span>
            </label>
            <QtyStepper id="qty" value={q} onChange={setQty} max={max} />
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-4 py-2">
            <OrderSummary
              lines={[{ k: <>General admission × <span className="num">{q}</span></>, v: <span className="num">{formatMoney(event.priceMinor, { cents: true })} each</span> }]}
              subtotalMinor={subtotal}
            />
          </div>
          <p className="text-xs text-muted">
            Paying with Visa ending <span className="num">4242</span>. <Link to="/settings/payments" className="text-gold hover:underline">Change</Link>
          </p>
        </div>
      )}
    </Modal>
  );
}
