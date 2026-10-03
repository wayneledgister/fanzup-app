import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, Clock, MapPin, Plus, Ticket } from "lucide-react";
import { Badge, Button, Card, Container, EmptyState, Money, PageHeader, ProgressBar } from "@/components/brand";
import { KpiCard, Segmented, Toggle, formatDay } from "@/components/creator/ui";
import { creatorEvents, type CreatorEvent } from "@/components/creator/data";
import { formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup EventManagement + EventManagementShowcase.
 * Doc-driven changes: livestream controls moved to /creator/streaming; this page is ticketed shows.
 * "Exclusive for subscribers/pool holders" → backer presale for campaign backers and subscribers only
 * (never tied to holding units — CONSOLIDATION /tickets). Empty state via `?state=empty`.
 */
type Tab = "upcoming" | "past";

export default function Events() {
  const [params] = useSearchParams();
  const all = params.get("state") === "empty" ? [] : creatorEvents;
  const [tab, setTab] = useState<Tab>("upcoming");
  const [presale, setPresale] = useState<Record<string, boolean>>(Object.fromEntries(all.map((e) => [e.id, e.presale])));

  const upcoming = all.filter((e) => e.status !== "past").sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter((e) => e.status === "past").sort((a, b) => b.date.localeCompare(a.date));
  const list = tab === "upcoming" ? upcoming : past;
  const sold = upcoming.reduce((a, e) => a + e.sold, 0);
  const cap = upcoming.reduce((a, e) => a + e.capacity, 0);
  const gross = upcoming.reduce((a, e) => a + e.sold * e.priceMinor, 0);

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Events"
        title="Shows and tickets"
        description="Sell tickets to your shows and give backers and subscribers first access with a presale."
        actions={
          <Button asChild>
            <Link to="/creator/events/new">
              <Plus /> Create event
            </Link>
          </Button>
        }
      />

      {all.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="No events yet" action={<Button asChild><Link to="/creator/events/new"><Plus /> Create your first event</Link></Button>}>
          Add a show, set ticket prices and capacity, and open a presale for the fans who backed you.
        </EmptyState>
      ) : (
        <>
          <section aria-label="Ticket sales" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <KpiCard label="Tickets sold" icon={<Ticket />} value={`${sold.toLocaleString()}`} hint={<>of <span className="num">{cap.toLocaleString()}</span> across upcoming shows</>} />
            <KpiCard label="Ticket sales" value={formatMoney(gross)} hint="gross, upcoming shows" />
            <KpiCard label="Presales open" value={String(upcoming.filter((e) => presale[e.id]).length)} hint="backer or subscriber access" className="col-span-2 lg:col-span-1" />
          </section>

          <Segmented
            label="Show events"
            className="mb-4"
            value={tab}
            onChange={setTab}
            options={[
              { value: "upcoming", label: "Upcoming", count: upcoming.length },
              { value: "past", label: "Past", count: past.length },
            ]}
          />

          <ul className="flex flex-col gap-4">
            {list.map((e) => (
              <li key={e.id}>
                <EventRow e={e} presale={presale[e.id]} onPresale={(v) => setPresale((p) => ({ ...p, [e.id]: v }))} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Container>
  );
}

function EventRow({ e, presale, onPresale }: { e: CreatorEvent; presale: boolean; onPresale: (v: boolean) => void }) {
  const d = new Date(`${e.date}T12:00:00`);
  const isPast = e.status === "past";
  const soldOut = e.sold >= e.capacity;
  return (
    <Card className="grid gap-5 md:grid-cols-[auto_1fr_260px] md:items-center md:gap-6">
      <div className="flex items-center gap-4 md:block">
        <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-surface-2">
          <span className="text-xs font-medium uppercase text-muted">{d.toLocaleString("en-US", { month: "short" })}</span>
          <span className="num text-2xl font-medium text-fg">{d.getDate()}</span>
        </div>
        <h2 className="text-lg font-semibold md:hidden">{e.title}</h2>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {e.status === "draft" && <Badge>Draft</Badge>}
          {e.status === "presale" && <Badge tone="info">Presale only</Badge>}
          {e.status === "onsale" && <Badge tone="success">On sale</Badge>}
          {isPast && <Badge>Played</Badge>}
          {soldOut && <Badge tone="gold">Sold out</Badge>}
        </div>
        <h2 className="hidden text-lg font-semibold md:block">{e.title}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" /> {e.venue}, {e.city}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" /> <span className="num">{formatDay(e.date)}</span> · {e.time}
          </span>
          <span>
            <Money minor={e.priceMinor} /> per ticket
          </span>
        </div>
        {!isPast && (
          <div className="mt-2 max-w-md rounded-md border border-line bg-surface-2 p-3">
            <Toggle
              checked={presale}
              onChange={onPresale}
              label="Backer & subscriber presale"
              description={presale ? `Open to ${e.presaleAudience || "tour backers + subscribers"} before general sale.` : "Off — everyone gets access at the same time."}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Sold</span>
          <span className="num text-fg">
            {e.sold}/{e.capacity}
          </span>
        </div>
        <ProgressBar value={e.sold} max={e.capacity} tone={soldOut ? "success" : "info"} label={`${e.title} tickets sold`} />
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Gross</span>
          <Money minor={e.sold * e.priceMinor} className="text-fg" />
        </div>
        <Button variant="secondary" size="sm" className="mt-2">
          {isPast ? "View report" : e.status === "draft" ? "Finish setup" : "Manage tickets"}
        </Button>
      </div>
    </Card>
  );
}
