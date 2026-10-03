import { useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, KeyRound, Plus, Radio, RefreshCw, Ticket, Users } from "lucide-react";
import { Badge, Button, Callout, Card, Container, Field, KeyValue, Money, PageHeader, Select, TextArea, TextInput } from "@/components/brand";
import { CopyField, TableShell, Toggle, formatDay } from "@/components/creator/ui";
import { formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup streaming/ArtistStreamDashboard.tsx.
 * Doc-driven changes: pay-per-view per PRD 01 §6.1; added stream key panel, comp access codes (format matches
 * fan-side FZP-XXXX-XXXX), free-for-subscribers option and past streams. Fees: Stripe pass-through only,
 * platform fee TBD (fees.html).
 */
interface Session {
  id: string;
  title: string;
  date: string;
  time: string;
  priceMinor: number;
  sold: number;
  subscribersFree: boolean;
}

const UPCOMING: Session[] = [
  { id: "ls2", title: "Acoustic set + horn arrangements", date: "2026-10-09", time: "8:00 PM ET", priceMinor: 1500, sold: 96, subscribersFree: false },
  { id: "ls9", title: "Tour rehearsal open session", date: "2026-11-06", time: "7:00 PM ET", priceMinor: 800, sold: 31, subscribersFree: true },
];

const PAST = [
  { id: "p1", title: "Midnight Horns release night", date: "2026-08-14", viewers: 512, peak: 448, grossMinor: 512 * 1200 },
  { id: "p2", title: "Studio Q&A", date: "2026-06-05", viewers: 214, peak: 190, grossMinor: 214 * 800 },
  { id: "p3", title: "Valentine's slow jams", date: "2026-02-14", viewers: 389, peak: 351, grossMinor: 389 * 1000 },
];

const CODES_INIT = [
  { sid: "ls2", code: "FZP-NR4K-T8W2", note: "Band — Dre", used: true },
  { sid: "ls2", code: "FZP-NR9P-2LXA", note: "Band — Kiana", used: false },
  { sid: "ls2", code: "FZP-NRQ7-H3MZ", note: "Press — Atlanta Weekly", used: false },
];

function randomCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join("");
  return `FZP-NR${pick(2)}-${pick(4)}`;
}

export default function StreamDashboard() {
  const [sessions, setSessions] = useState(UPCOMING);
  const [f, setF] = useState({ title: "", desc: "", date: "", time: "20:00", price: "" });
  const [subsFree, setSubsFree] = useState(false);
  const [record, setRecord] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<string | null>(null);

  const [codeFor, setCodeFor] = useState(UPCOMING[0].id);
  const [codes, setCodes] = useState(CODES_INIT);
  const [note, setNote] = useState("");

  const [key, setKey] = useState("live_nr_8f2c91d4a7e04b6f");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    const priceMinor = Math.round(parseFloat(f.price) * 100);
    if (!f.title.trim()) err.title = "Name your stream.";
    if (!f.date) err.date = "Pick a date.";
    else if (f.date <= "2026-10-02") err.date = "Pick a date after today.";
    if (!f.price || isNaN(priceMinor) || priceMinor < 100) err.price = "Price must be at least $1.";
    setErrors(err);
    if (Object.keys(err).length) return;
    const [h, m] = f.time.split(":").map(Number);
    const t = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
    setSessions((s) => [...s, { id: `new-${s.length}`, title: f.title.trim(), date: f.date, time: t, priceMinor, sold: 0, subscribersFree: subsFree }].sort((a, b) => a.date.localeCompare(b.date)));
    setCreated(f.title.trim());
    setF({ title: "", desc: "", date: "", time: "20:00", price: "" });
  };

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Live"
        title="Live streams"
        description="Schedule pay-per-view streams, hand out comp codes and get your stream key. Fans buy access and join with a code."
        actions={
          <Button asChild variant="secondary">
            <Link to="/live">
              <Radio /> See what fans see
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0 lg:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Upcoming */}
          <Card className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Upcoming streams</h2>
            <ul className="flex flex-col gap-3">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-fg">{s.title}</span>
                    <span className="text-xs text-muted">
                      <span className="num">{formatDay(s.date)}</span> · {s.time} · <Money minor={s.priceMinor} cents={s.priceMinor % 100 !== 0} />
                      {s.subscribersFree && " · free for subscribers"}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="inline-flex items-center gap-1.5 text-sm text-fg">
                      <Ticket className="size-4 text-muted" aria-hidden /> <span className="num">{s.sold}</span> <span className="text-muted">sold</span>
                    </span>
                    {s.id === "ls2" ? <Badge tone="info">Next up</Badge> : <Badge>Scheduled</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* Schedule */}
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Schedule a pay-per-view stream</h2>
              <p className="text-sm text-muted">Fans pay once to watch live. Each purchase gets a one-device access code by email.</p>
            </div>
            {created && (
              <Callout tone="success" icon={<CheckCircle2 />} title={`“${created}” is scheduled`}>
                It's on your page now. Share the link so fans can buy access early.
              </Callout>
            )}
            <form onSubmit={create} noValidate className="flex flex-col gap-4">
              <Field label="Stream title" htmlFor="s-title" error={errors.title}>
                <TextInput id="s-title" value={f.title} onChange={set("title")} placeholder="Holiday horns warm-up" aria-invalid={!!errors.title} />
              </Field>
              <Field label="Description" htmlFor="s-desc" optional>
                <TextArea id="s-desc" value={f.desc} onChange={set("desc")} placeholder="What you'll play, who's sitting in, how long you'll go." className="min-h-20" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Date" htmlFor="s-date" error={errors.date}>
                  <TextInput id="s-date" type="date" value={f.date} onChange={set("date")} aria-invalid={!!errors.date} />
                </Field>
                <Field label="Start time" htmlFor="s-time" hint="Eastern">
                  <TextInput id="s-time" type="time" value={f.time} onChange={set("time")} />
                </Field>
                <Field label="Price (USD)" htmlFor="s-price" error={errors.price}>
                  <div className="relative">
                    <span className="num pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                    <TextInput id="s-price" inputMode="decimal" value={f.price} onChange={set("price")} placeholder="12" className="num pl-7" aria-invalid={!!errors.price} />
                  </div>
                </Field>
              </div>
              <div className="flex flex-col gap-4 rounded-md border border-line bg-surface-2 p-4">
                <Toggle checked={subsFree} onChange={setSubsFree} label="Free for subscribers" description="Your subscribers get a code automatically; everyone else pays." />
                <Toggle checked={record} onChange={setRecord} label="Save a replay" description="Ticket holders can rewatch it after the stream ends." />
              </div>
              <p className="text-xs text-muted">
                Card processing (2.9% + $0.30 per purchase) is passed through at cost. Platform fee: TBD.
              </p>
              <Button type="submit" className="self-start">
                <Plus /> Schedule stream
              </Button>
            </form>
          </Card>

          {/* Past */}
          <Card className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Past streams</h2>
            <div className="hidden sm:block">
              <TableShell>
                <thead>
                  <tr>
                    <th>Stream</th>
                    <th className="text-right">Viewers</th>
                    <th className="text-right">Peak</th>
                    <th className="text-right">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {PAST.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="block text-fg">{p.title}</span>
                        <span className="num text-xs text-muted">{formatDay(p.date)}</span>
                      </td>
                      <td className="num text-right text-fg">{p.viewers}</td>
                      <td className="num text-right text-muted">{p.peak}</td>
                      <td className="num text-right text-fg">{formatMoney(p.grossMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
            <ul className="flex flex-col divide-y divide-line sm:hidden">
              {PAST.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm text-fg">{p.title}</span>
                    <span className="text-xs text-muted">
                      <span className="num">{formatDay(p.date)}</span> · <span className="num">{p.viewers}</span> viewers
                    </span>
                  </div>
                  <Money minor={p.grossMinor} className="text-sm text-fg" />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Side */}
        <aside className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Stream key</h2>
              <KeyRound className="size-5 text-gold" aria-hidden />
            </div>
            <p className="text-sm text-muted">Paste these into OBS or your streaming app. Keep the key private — anyone with it can stream to your page.</p>
            <CopyField label="Server URL" value="rtmps://live.fanzup.com:443/app" />
            <CopyField label="Stream key" value={key} secret />
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setKey(`live_nr_${Math.random().toString(16).slice(2, 18)}`)}>
              <RefreshCw /> Reset key
            </Button>
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Access codes</h2>
              <p className="text-sm text-muted">Comp codes for your band, crew and press. Each works on one device.</p>
            </div>
            <Field label="Stream" htmlFor="code-for">
              <Select id="code-for" value={codeFor} onChange={(e) => setCodeFor(e.target.value)}>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
            </Field>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setCodes((c) => [{ sid: codeFor, code: randomCode(), note: note.trim() || "Comp", used: false }, ...c]);
                setNote("");
              }}
            >
              <TextInput aria-label="Who is this code for" placeholder="Who's it for?" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="submit" variant="secondary">
                <Plus /> Create
              </Button>
            </form>
            <ul className="flex flex-col divide-y divide-line">
              {codes.filter((c) => c.sid === codeFor).length === 0 && <li className="py-3 text-sm text-muted">No codes for this stream yet.</li>}
              {codes.filter((c) => c.sid === codeFor).map((c) => (
                <li key={c.code} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="num text-sm text-fg">{c.code}</span>
                    <span className="truncate text-xs text-muted">{c.note}</span>
                  </div>
                  {c.used ? <Badge tone="success">Used</Badge> : <Badge>Unused</Badge>}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">This year</h2>
            <KeyValue k={<span className="inline-flex items-center gap-1.5"><Users className="size-4" /> Total viewers</span>} v={<span className="num">{PAST.reduce((a, p) => a + p.viewers, 0).toLocaleString()}</span>} />
            <KeyValue k="Gross from streams" v={<Money minor={PAST.reduce((a, p) => a + p.grossMinor, 0)} />} />
          </Card>
        </aside>
      </div>
    </Container>
  );
}
