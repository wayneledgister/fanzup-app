import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, CalendarClock, Gift, Lock, Maximize, Radio, Send, Users, Volume2 } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Container, EmptyState, Field, TextInput } from "@/components/brand";
import { Modal, OrderSummary, processingFeeMinor } from "@/components/fan/kit";
import { formatSessionTime, sessionById } from "@/components/fan/live-data";
import { artistById, fan } from "@/lib/mock";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FPS streaming/LiveStreamView.tsx.
 * Doc-driven: tips are a gift to the artist, not a backing or investment — no perks, no share of earnings, and no
 * leaderboard of top tippers (no money-ranked lists, PRD 02 §8). Player is a placeholder until the video vendor lands.
 */

interface Msg {
  id: number;
  user: string;
  text: string;
  tipMinor?: number;
  artist?: boolean;
  me?: boolean;
}

const SEED: Msg[] = [
  { id: 1, user: "maya.d", text: "Made it! Corktown represent" },
  { id: 2, user: "brokenrecord", text: "that bassline is unreal" },
  { id: 3, user: "Velvet Circuit", text: "Thanks for being here. Next patch is one we've never played out.", artist: true },
  { id: 4, user: "jules_ok", text: "sent a little something for the van fund", tipMinor: 500 },
  { id: 5, user: "techno_tuesdays", text: "volume up, lights off" },
];

const TIP_PRESETS = [300, 500, 1000, 2000];

export default function LiveView() {
  const { id = "" } = useParams();
  const s = sessionById(id);
  const [params] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>(SEED);
  const [draft, setDraft] = useState("");
  const [tipOpen, setTipOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  if (!s)
    return (
      <Container size="md" className="py-20">
        <EmptyState icon={<Radio />} title="We can't find that session" action={<Button asChild><Link to="/live">See live sessions</Link></Button>}>
          The link may be old, or the artist may have cancelled. If you paid, you've been refunded automatically.
        </EmptyState>
      </Container>
    );

  const a = artistById(s.artistId);
  const hasAccess = !!s.code || params.get("pass") === "1";
  const isLive = s.status === "live";

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMsgs((m) => [...m, { id: Date.now(), user: fan.handle.replace("@", ""), text, me: true }]);
    setDraft("");
  };

  if (!hasAccess)
    return (
      <Container size="md" className="py-16">
        <EmptyState
          icon={<Lock />}
          title="You need an access code for this session"
          action={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link to="/live">Buy access · <span className="num">{formatMoney(s.priceMinor)}</span></Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/live/access">I have a code</Link>
              </Button>
            </div>
          }
        >
          {a.name} — {s.title}. Starts <span className="num">{formatSessionTime(s.startsAt)}</span>.
        </EmptyState>
      </Container>
    );

  return (
    <Container size="xl" className="py-6 sm:py-8">
      <Link to="/live" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Live sessions
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Player + meta */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="relative overflow-hidden rounded-lg border border-line bg-canvas">
            <ArtistArt seed={`live-${s.id}`} label={`${a.name} live stream`} className="aspect-video w-full rounded-none" />
            <div className="absolute inset-0 flex items-center justify-center">
              {isLive ? (
                <span className="rounded-md bg-canvas/70 px-4 py-2 text-sm text-muted backdrop-blur">Stream player</span>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-lg bg-canvas/80 px-6 py-4 text-center backdrop-blur">
                  <CalendarClock className="size-6 text-gold" />
                  <p className="text-sm font-medium">Starts {formatSessionTime(s.startsAt)}</p>
                  <p className="text-xs text-muted">This page will start playing automatically.</p>
                </div>
              )}
            </div>
            <div className="absolute left-4 top-4 flex gap-2">
              {isLive ? (
                <Badge tone="error" icon={<Radio />}>
                  Live
                </Badge>
              ) : (
                <Badge>Upcoming</Badge>
              )}
              {s.viewers !== undefined && (
                <Badge icon={<Users />}>
                  <span className="num">{formatNumber(s.viewers)}</span>
                </Badge>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-scrim p-2">
              <Button variant="ghost" size="icon" aria-label="Volume">
                <Volume2 />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Full screen">
                <Maximize />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-12 shrink-0" />
              <div>
                <h1 className="text-xl font-bold sm:text-2xl">{s.title}</h1>
                <Link to={`/artist/${a.id}`} className="text-sm text-muted hover:text-fg">
                  {a.name}
                </Link>
              </div>
            </div>
            <Button onClick={() => setTipOpen(true)}>
              <Gift /> Send a tip
            </Button>
          </div>
          <p className="text-sm text-muted">{s.description}</p>
        </div>

        {/* Chat */}
        <section aria-label="Live chat" className="flex h-[520px] flex-col rounded-lg border border-line bg-surface lg:h-auto lg:max-h-[calc(100dvh-8rem)]">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Live chat</h2>
            <span className="text-xs text-muted">Be kind. Artists can remove messages.</span>
          </header>
          <ol ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {msgs.map((m) => (
              <li key={m.id} className={cn("text-sm", m.tipMinor && "rounded-md border border-gold/30 bg-gold/8 px-3 py-2")}>
                <span className={cn("mr-1.5 font-semibold", m.artist ? "text-gold" : m.me ? "text-info" : "text-fg")}>{m.user}</span>
                {m.artist && <Badge tone="gold" className="mr-1.5">Artist</Badge>}
                {m.tipMinor && (
                  <span className="mr-1.5 text-xs text-muted">
                    tipped <span className="num text-fg">{formatMoney(m.tipMinor)}</span>
                  </span>
                )}
                <span className="text-muted">{m.text}</span>
              </li>
            ))}
          </ol>
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <label htmlFor="chat" className="sr-only">
              Message
            </label>
            <TextInput id="chat" placeholder={isLive ? "Say something" : "Chat opens when the stream starts"} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!isLive} maxLength={200} />
            <Button type="submit" variant="secondary" size="icon" aria-label="Send message" disabled={!isLive || !draft.trim()}>
              <Send />
            </Button>
          </form>
        </section>
      </div>

      <TipDialog
        open={tipOpen}
        artist={a.name}
        onClose={() => setTipOpen(false)}
        onTip={(amt, note) => setMsgs((m) => [...m, { id: Date.now(), user: fan.handle.replace("@", ""), text: note || "Thank you!", tipMinor: amt, me: true }])}
      />
    </Container>
  );
}

function TipDialog({ open, artist, onClose, onTip }: { open: boolean; artist: string; onClose: () => void; onTip: (minor: number, note: string) => void }) {
  const [amount, setAmount] = useState<number | "custom">(500);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const minor = amount === "custom" ? Math.round(parseFloat(custom || "0") * 100) : amount;
  const reset = () => window.setTimeout(() => (setAmount(500), setCustom(""), setNote(""), setError(null)), 200);
  const submit = () => {
    if (!minor || minor < 100) return setError("Tips start at $1.");
    if (minor > 50000) return setError("Tips are capped at $500 per stream.");
    onTip(minor, note.trim());
    onClose();
    reset();
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && (onClose(), reset())}
      title={`Tip ${artist}`}
      description="Show some love while they play."
      footer={
        <>
          <Button variant="secondary" onClick={() => (onClose(), reset())}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!minor}>
            Send <span className="num">{formatMoney(minor + processingFeeMinor(minor), { cents: true })}</span>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Tip amount">
          {TIP_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={amount === p}
              onClick={() => (setAmount(p), setError(null))}
              className={cn("num h-12 rounded-md border text-base", amount === p ? "border-gold bg-gold/10 text-fg" : "border-line text-muted hover:text-fg")}
            >
              {formatMoney(p)}
            </button>
          ))}
        </div>
        <Field label="Or enter an amount" htmlFor="tip-custom" error={error}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <TextInput
              id="tip-custom"
              inputMode="decimal"
              className="num pl-7"
              value={custom}
              onFocus={() => setAmount("custom")}
              onChange={(e) => (setCustom(e.target.value.replace(/[^0-9.]/g, "")), setAmount("custom"), setError(null))}
              aria-invalid={!!error}
            />
          </div>
        </Field>
        <Field label="Message" htmlFor="tip-note" optional>
          <TextInput id="tip-note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown in chat with your tip" />
        </Field>
        {minor > 0 && (
          <div className="rounded-lg border border-line bg-surface-2 px-4 py-2">
            <OrderSummary subtotalMinor={minor} />
          </div>
        )}
        <Callout tone="info" title="A tip is a gift">
          Tips go to {artist}. They don't come with perks and they aren't an investment or a share of anything the artist earns.
        </Callout>
      </div>
    </Modal>
  );
}
