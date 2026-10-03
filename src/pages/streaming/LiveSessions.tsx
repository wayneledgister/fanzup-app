import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CalendarClock, Clock, KeyRound, Radio, Users } from "lucide-react";
import { ArtistArt, Badge, Button, Card, Container, PageHeader, SectionHeading } from "@/components/brand";
import { Modal, OrderSummary, processingFeeMinor } from "@/components/fan/kit";
import { liveSessions, formatSessionTime, type LiveSession } from "@/components/fan/live-data";
import { artistById } from "@/lib/mock";
import { formatMoney, formatNumber } from "@/lib/format";
import { POLICY } from "@/config/policy";

/**
 * Source: FPS streaming/FanPurchaseStream.tsx.
 * Doc-driven: pay-per-view per PRD 01 §6.1 — a ticket to watch, not a backing or an investment. Price shown with
 * card processing pass-through only (platform fee TBD). Purchase hands off to /live/access with the new code.
 */
export default function LiveSessions() {
  const [buying, setBuying] = useState<LiveSession | null>(null);
  const live = liveSessions.filter((s) => s.status === "live");
  const upcoming = liveSessions.filter((s) => s.status === "upcoming");

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Live"
        title="Live sessions"
        description="Pay once, watch live. Your access code arrives the moment you buy."
        actions={
          <Button asChild variant="secondary">
            <Link to="/live/access">
              <KeyRound /> Enter access code
            </Link>
          </Button>
        }
      />

      {live.length > 0 && (
        <section className="mb-12">
          <SectionHeading eyebrow="Happening now" title="Live now" />
          <div className="grid gap-6">
            {live.map((s) => (
              <SessionCard key={s.id} s={s} featured onBuy={() => setBuying(s)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading title="Upcoming" />
        <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {upcoming.map((s) => (
            <li key={s.id}>
              <SessionCard s={s} onBuy={() => setBuying(s)} />
            </li>
          ))}
        </ul>
      </section>

      <PurchaseDialog s={buying} onClose={() => setBuying(null)} />
    </Container>
  );
}

function SessionCard({ s, featured, onBuy }: { s: LiveSession; featured?: boolean; onBuy: () => void }) {
  const a = artistById(s.artistId);
  const owned = !!s.code;
  return (
    <Card padded={false} interactive className={featured ? "grid overflow-hidden md:grid-cols-[1.2fr_1fr]" : "flex h-full flex-col overflow-hidden"}>
      <div className="relative">
        <ArtistArt seed={`live-${s.id}`} label={a.name} className={featured ? "aspect-video h-full w-full rounded-none" : "aspect-video w-full rounded-none"} />
        <div className="absolute inset-0 bg-scrim" />
        <div className="absolute left-4 top-4 flex gap-2">
          {s.status === "live" ? (
            <Badge tone="error" icon={<Radio />}>
              Live
            </Badge>
          ) : (
            <Badge icon={<CalendarClock />}>Upcoming</Badge>
          )}
          {owned && <Badge tone="success">Purchased</Badge>}
        </div>
        {s.viewers !== undefined && (
          <span className="absolute bottom-3 left-4 flex items-center gap-1.5 text-xs text-fg">
            <Users className="size-3.5" /> <span className="num">{formatNumber(s.viewers)}</span> watching
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div>
          <Link to={`/artist/${a.id}`} className="text-sm text-muted hover:text-fg">
            {a.name}
          </Link>
          <h3 className={featured ? "text-2xl font-bold" : "text-lg font-semibold"}>{s.title}</h3>
          <p className="mt-2 text-sm text-muted">{s.description}</p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <li className="flex items-center gap-1.5">
            <CalendarClock className="size-4" /> <span className="num">{formatSessionTime(s.startsAt)}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Clock className="size-4" /> <span className="num">{s.durationMin}</span> min
          </li>
        </ul>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="num text-xl font-medium">{formatMoney(s.priceMinor)}</span>
          {owned ? (
            <Button asChild size="sm" variant={featured ? "primary" : "secondary"}>
              <Link to={`/live/${s.id}`}>{s.status === "live" ? "Watch now" : "View access"}</Link>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onBuy}>
              Buy access
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function PurchaseDialog({ s, onClose }: { s: LiveSession | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!s) return <Modal open={false} onOpenChange={() => undefined} title="" />;
  const a = artistById(s.artistId);
  const total = s.priceMinor + processingFeeMinor(s.priceMinor);
  const pay = () => {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      onClose();
      const code = `FZP-${a.name.slice(0, 2).toUpperCase()}${s.id.toUpperCase().slice(-2)}-8N3P`;
      navigate(`/live/access?session=${s.id}&code=${code}`);
    }, 600);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Buy access"
      description={`${a.name} · ${s.title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={pay} disabled={busy}>
            {busy ? "Processing…" : <>Pay <span className="num">{formatMoney(total, { cents: true })}</span></>}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <CalendarClock className="size-4 text-gold" /> <span className="num">{formatSessionTime(s.startsAt)}</span>
        </p>
        <div className="rounded-lg border border-line bg-surface-2 px-4 py-2">
          <OrderSummary lines={[{ k: "One viewer pass", v: <span className="num">{formatMoney(s.priceMinor, { cents: true })}</span> }]} subtotalMinor={s.priceMinor} />
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Your access code works for this session on one device at a time.</li>
          <li>If the artist cancels, you're refunded automatically.</li>
          <li>A replay is available to pass holders for {POLICY.streaming.replayHours} hours after the stream ends.</li>
        </ul>
      </div>
    </Modal>
  );
}
