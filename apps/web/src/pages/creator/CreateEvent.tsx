import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CheckCircle2, Info, MapPin, Radio } from "lucide-react";
import { Button, Callout, Card, Checkbox, ChoiceCard, Container, Field, KeyValue, PageHeader, Select, TextArea, TextInput } from "@/components/brand";
import { FileDrop, Toggle, formatDay } from "@/components/creator/ui";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup CreateEvent.tsx.
 * Doc-driven changes: "Subscription Only" event type replaced by a backer/subscriber presale toggle on ticketed
 * shows (CONSOLIDATION /tickets — perks for backers and subscribers, never for unit holders). Livestream events
 * hand off to /creator/streaming. Fee preview shows only the Stripe pass-through; platform fee is TBD (fees.html).
 */
type Format = "inperson" | "livestream";

export default function CreateEvent() {
  const navigate = useNavigate();
  const [format, setFormat] = useState<Format>("inperson");
  const [f, setF] = useState({ title: "", desc: "", date: "", time: "20:00", venue: "", city: "", capacity: "", price: "" });
  const [cover, setCover] = useState<File | null>(null);
  const [presale, setPresale] = useState(true);
  const [presaleBackers, setPresaleBackers] = useState(true);
  const [presaleSubs, setPresaleSubs] = useState(true);
  const [presaleStart, setPresaleStart] = useState("");
  const [reminders, setReminders] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<null | "draft" | "publish">(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const priceMinor = Math.round(parseFloat(f.price || "0") * 100);
  const processing = priceMinor ? Math.round(priceMinor * 0.029 + 30) : 0;

  const submit = (mode: "draft" | "publish") => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "Name your event.";
    if (mode === "publish") {
      if (!f.date) e.date = "Pick a date.";
      else if (f.date <= "2026-10-02") e.date = "The show has to be in the future.";
      if (!f.venue.trim()) e.venue = "Add the venue.";
      if (!f.city.trim()) e.city = "Add the city.";
      const cap = parseInt(f.capacity, 10);
      if (!cap || cap < 1) e.capacity = "Enter how many tickets you can sell.";
      if (!f.price || isNaN(priceMinor) || priceMinor < 100) e.price = "Ticket price must be at least $1.";
      if (presale) {
        if (!presaleBackers && !presaleSubs) e.presale = "Choose who gets presale access.";
        if (!presaleStart) e.presaleStart = "Pick when the presale opens.";
        else if (f.date && presaleStart >= f.date) e.presaleStart = "The presale has to open before the show.";
      }
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaved(mode);
  };

  if (saved) {
    return (
      <Container size="md" className="py-16">
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <CheckCircle2 className="size-12 text-success" />
          <h1 className="text-3xl font-bold">{saved === "publish" ? "Your event is set" : "Draft saved"}</h1>
          <p className="max-w-md text-muted">
            {saved === "publish" ? (
              presale ? (
                <>
                  The presale for “{f.title}” opens on {formatDay(presaleStart)}. We'll email {presaleBackers && presaleSubs ? "your backers and subscribers" : presaleBackers ? "your backers" : "your subscribers"} their access link.
                </>
              ) : (
                <>Tickets for “{f.title}” are on sale now.</>
              )
            ) : (
              <>Only you can see “{f.title}”. Finish it from your events list.</>
            )}
          </p>
          <Button onClick={() => navigate("/creator/events")}>Back to events</Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="py-8 sm:py-10">
      <Link to="/creator/events" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Events
      </Link>
      <PageHeader eyebrow="New event" title="Create an event" description="Set the details, price and capacity. You can save a draft and come back." />

      <form className="flex flex-col gap-6" noValidate onSubmit={(e) => { e.preventDefault(); submit("publish"); }}>
        <div role="radiogroup" aria-label="Event format" className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard selected={format === "inperson"} onSelect={() => setFormat("inperson")} className="flex items-start gap-3 p-4">
            <MapPin className={cn("mt-0.5 size-5", format === "inperson" ? "text-gold" : "text-muted")} />
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-fg">In-person show</span>
              <span className="text-sm text-muted">Ticketed, at a venue</span>
            </span>
          </ChoiceCard>
          <ChoiceCard selected={format === "livestream"} onSelect={() => setFormat("livestream")} className="flex items-start gap-3 p-4">
            <Radio className={cn("mt-0.5 size-5", format === "livestream" ? "text-gold" : "text-muted")} />
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-fg">Pay-per-view livestream</span>
              <span className="text-sm text-muted">Streamed from FanZuP</span>
            </span>
          </ChoiceCard>
        </div>

        {format === "livestream" ? (
          <Callout tone="info" icon={<Radio />} title="Livestreams are set up in Live">
            Schedule the stream, set a price and get your stream key in one place.{" "}
            <Link to="/creator/streaming" className="font-medium text-gold hover:underline">
              Go to Live
            </Link>
          </Callout>
        ) : (
          <>
            <Card className="flex flex-col gap-5">
              <h2 className="text-lg font-semibold">Event details</h2>
              <Field label="Event title" htmlFor="title" error={errors.title}>
                <TextInput id="title" value={f.title} onChange={set("title")} placeholder="Hometown Night — Live EP Recording" aria-invalid={!!errors.title} />
              </Field>
              <Field label="Description" htmlFor="desc" optional>
                <TextArea id="desc" value={f.desc} onChange={set("desc")} placeholder="Who's on stage, doors and set times, age limits." />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="date" error={errors.date}>
                  <TextInput id="date" type="date" value={f.date} onChange={set("date")} aria-invalid={!!errors.date} />
                </Field>
                <Field label="Show time" htmlFor="time" hint="Venue's local time">
                  <TextInput id="time" type="time" value={f.time} onChange={set("time")} />
                </Field>
                <Field label="Venue" htmlFor="venue" error={errors.venue}>
                  <TextInput id="venue" value={f.venue} onChange={set("venue")} placeholder="The Earl" aria-invalid={!!errors.venue} />
                </Field>
                <Field label="City" htmlFor="city" error={errors.city}>
                  <TextInput id="city" value={f.city} onChange={set("city")} placeholder="Atlanta, GA" aria-invalid={!!errors.city} />
                </Field>
              </div>
              <Field label="Cover image" htmlFor="cover" optional>
                <FileDrop id="cover" accept="image/*" hint="JPG or PNG, 1920 × 1080 works best" file={cover} onFile={setCover} label="Drop a cover image" />
              </Field>
            </Card>

            <Card className="flex flex-col gap-5">
              <h2 className="text-lg font-semibold">Tickets</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ticket price (USD)" htmlFor="price" error={errors.price}>
                  <div className="relative">
                    <span className="num pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                    <TextInput id="price" inputMode="decimal" value={f.price} onChange={set("price")} placeholder="25" className="num pl-7" aria-invalid={!!errors.price} />
                  </div>
                </Field>
                <Field label="Capacity" htmlFor="cap" error={errors.capacity}>
                  <TextInput id="cap" inputMode="numeric" value={f.capacity} onChange={set("capacity")} placeholder="300" className="num" aria-invalid={!!errors.capacity} />
                </Field>
              </div>
              <div className="rounded-md border border-line bg-surface-2 px-4 py-2">
                <KeyValue k="Ticket price" v={<span className="num">{formatMoney(priceMinor || 0, { cents: true })}</span>} />
                <KeyValue k={<>Processing <span className="num">2.9% + $0.30</span></>} v={<span className="num whitespace-nowrap text-muted">−{formatMoney(processing, { cents: true })}</span>} />
                <KeyValue k="Platform fee" v={<span className="text-muted">TBD</span>} />
                <KeyValue className="border-t border-line" k={<span className="font-medium text-fg">You receive per ticket</span>} v={<span className="num whitespace-nowrap font-medium">{formatMoney(Math.max(0, priceMinor - processing), { cents: true })}</span>} />
              </div>
            </Card>

            <Card className="flex flex-col gap-5">
              <Toggle checked={presale} onChange={setPresale} label="Presale for backers and subscribers" description="Give your most committed fans first access before general sale." />
              {presale && (
                <div className="flex flex-col gap-4 border-t border-line pt-5">
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 text-sm font-medium text-fg">Who gets presale access</legend>
                    <Checkbox id="pb" checked={presaleBackers} onChange={setPresaleBackers}>
                      Backers of <span className="text-fg">Take the band on the road</span> (<span className="num">412</span>)
                    </Checkbox>
                    <Checkbox id="ps" checked={presaleSubs} onChange={setPresaleSubs}>
                      Your subscribers (<span className="num">1,240</span>)
                    </Checkbox>
                    {errors.presale && <p className="text-sm text-error">{errors.presale}</p>}
                  </fieldset>
                  <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Presale opens" htmlFor="ps-start" error={errors.presaleStart}>
                    <TextInput id="ps-start" type="date" value={presaleStart} onChange={(e) => setPresaleStart(e.target.value)} aria-invalid={!!errors.presaleStart} />
                  </Field>
                  <Field label="General sale starts" htmlFor="gen-sale">
                    <Select id="gen-sale" defaultValue="2d">
                      <option value="1d">1 day after presale opens</option>
                      <option value="2d">2 days after presale opens</option>
                      <option value="7d">1 week after presale opens</option>
                    </Select>
                  </Field>
                  </div>
                </div>
              )}
              <div className="border-t border-line pt-5">
                <Toggle checked={reminders} onChange={setReminders} label="Send reminders" description="Ticket holders get an email the week of the show and the day of." />
              </div>
            </Card>

            {Object.values(errors).some(Boolean) && (
              <Callout tone="error" icon={<Info />} title="A few things need fixing">
                Check the highlighted fields above.
              </Callout>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => submit("draft")}>
                Save draft
              </Button>
              <Button type="submit" size="lg">
                {presale ? "Schedule presale" : "Put tickets on sale"}
              </Button>
            </div>
          </>
        )}
      </form>
    </Container>
  );
}
