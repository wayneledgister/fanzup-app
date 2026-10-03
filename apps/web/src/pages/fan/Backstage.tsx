import { useState } from "react";
import { Link } from "react-router";
import { Camera, Clock, Film, Lock, Mic2, Play, Radio, Sparkles } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, PageHeader } from "@/components/brand";
import { Chip, Modal, formatDay } from "@/components/fan/kit";
import { artistById, campaignById, fan } from "@/lib/mock";

/**
 * Source: FanZuP BackstagePassGallery.tsx (+ BackstagePassClaim/Content concepts).
 * Doc-driven: "Unlock at Nebula Tier" / Star-tier blurred sneak peeks removed. Content unlocks only by
 * subscribing to the artist or by a campaign perk — never by units held (CONSOLIDATION, selected features).
 */

type Kind = "video" | "demo" | "photos" | "replay";

interface Content {
  id: string;
  artistId: string;
  title: string;
  kind: Kind;
  length: string;
  postedOn: string;
  unlock: { by: "subscription" } | { by: "perk"; campaignId: string; perk: string };
}

const CONTENT: Content[] = [
  { id: "c1", artistId: "nova-reyes", title: "Horn section rehearsal, take 4", kind: "video", length: "12:40", postedOn: "2026-09-28", unlock: { by: "subscription" } },
  { id: "c2", artistId: "nova-reyes", title: "\"Slow Burn\" — voice memo demo", kind: "demo", length: "2:58", postedOn: "2026-09-21", unlock: { by: "subscription" } },
  { id: "c3", artistId: "nova-reyes", title: "Tour diary: picking the van", kind: "photos", length: "24 photos", postedOn: "2026-09-15", unlock: { by: "perk", campaignId: "nova-live-band-tour", perk: "Digital thank-you + tour diary" } },
  { id: "c4", artistId: "sol-amara", title: "Listening party replay", kind: "replay", length: "58:12", postedOn: "2026-09-10", unlock: { by: "subscription" } },
  { id: "c5", artistId: "sol-amara", title: "Band rehearsal at The Rail Yard", kind: "video", length: "8:05", postedOn: "2026-09-26", unlock: { by: "perk", campaignId: "sol-amara-first-headline", perk: "Meet & greet" } },
  { id: "c6", artistId: "velvet-circuit", title: "Modular jam: 3am patch", kind: "demo", length: "14:33", postedOn: "2026-09-24", unlock: { by: "subscription" } },
  { id: "c7", artistId: "velvet-circuit", title: "Night Shift storyboard + 16mm tests", kind: "photos", length: "18 photos", postedOn: "2026-09-19", unlock: { by: "perk", campaignId: "velvet-circuit-video", perk: "Early premiere access" } },
  { id: "c8", artistId: "kai-marlo", title: "Studio session replay: sampling day", kind: "replay", length: "1:42:10", postedOn: "2026-09-12", unlock: { by: "subscription" } },
];

const KIND: Record<Kind, { label: string; icon: React.ReactNode }> = {
  video: { label: "Video", icon: <Film /> },
  demo: { label: "Demo", icon: <Mic2 /> },
  photos: { label: "Photos", icon: <Camera /> },
  replay: { label: "Livestream replay", icon: <Radio /> },
};

function isUnlocked(c: Content) {
  if (c.unlock.by === "subscription") return fan.subscriptions.includes(c.artistId);
  return fan.backed.includes(c.unlock.campaignId);
}

function unlockLabel(c: Content) {
  const a = artistById(c.artistId);
  if (c.unlock.by === "subscription") return `Subscribe to ${a.name}`;
  const camp = campaignById(c.unlock.campaignId);
  return `Back ${camp ? `the ${camp.type.toLowerCase()} campaign` : "the campaign"}`;
}

export default function Backstage() {
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [open, setOpen] = useState<Content | null>(null);

  const list = CONTENT.filter((c) => (filter === "all" || (filter === "unlocked") === isUnlocked(c)) && (kind === "all" || c.kind === kind));
  const unlockedCount = CONTENT.filter(isUnlocked).length;

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Backstage"
        title="Behind the music"
        description="Rehearsals, demos, photos and stream replays from the artists you support. Subscribe to an artist or back their campaign to unlock it."
      />

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Filter by access">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          <Chip active={filter === "unlocked"} onClick={() => setFilter("unlocked")}>
            Unlocked <span className="num ml-1.5 text-xs text-muted">{unlockedCount}</span>
          </Chip>
          <Chip active={filter === "locked"} onClick={() => setFilter("locked")}>
            Locked <span className="num ml-1.5 text-xs text-muted">{CONTENT.length - unlockedCount}</span>
          </Chip>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Filter by type">
          {(["all", "video", "demo", "photos", "replay"] as const).map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "Every type" : KIND[k].label}
            </Chip>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Sparkles />} title="Nothing in this view" action={<Button variant="secondary" onClick={() => (setFilter("all"), setKind("all"))}>Show everything</Button>}>
          Try another filter. New drops from your artists show up here as soon as they post.
        </EmptyState>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <li key={c.id}>
              <ContentCard c={c} onOpen={() => setOpen(c)} />
            </li>
          ))}
        </ul>
      )}

      <ContentDialog c={open} onClose={() => setOpen(null)} />
    </Container>
  );
}

function ContentCard({ c, onOpen }: { c: Content; onOpen: () => void }) {
  const a = artistById(c.artistId);
  const unlocked = isUnlocked(c);
  const k = KIND[c.kind];
  return (
    <Card padded={false} interactive className="h-full overflow-hidden">
      <button type="button" onClick={onOpen} className="flex h-full w-full flex-col text-left focus:outline-none" aria-label={`${c.title}${unlocked ? "" : " (locked)"}`}>
        <div className="relative">
          <ArtistArt seed={`bs-${c.id}`} label={c.title} className="aspect-video w-full rounded-none" />
          {unlocked ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full border border-fg/20 bg-canvas/70 backdrop-blur">
                {c.kind === "photos" ? <Camera className="size-6" /> : <Play className="ml-0.5 size-6" />}
              </span>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas/70 backdrop-blur-md">
              <Lock className="size-6 text-gold" />
              <span className="px-4 text-center text-sm font-medium">{unlockLabel(c)}</span>
            </div>
          )}
          <span className="absolute bottom-3 right-3 rounded-md bg-canvas/80 px-2 py-0.5 text-xs">
            <span className="num">{c.length}</span>
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-5">
          <div className="flex items-center justify-between gap-2">
            <Badge icon={k.icon}>{k.label}</Badge>
            {unlocked ? <Badge tone="success">Unlocked</Badge> : <Badge tone="neutral" icon={<Lock />}>Locked</Badge>}
          </div>
          <h3 className="text-base font-semibold leading-snug">{c.title}</h3>
          <p className="mt-auto text-xs text-muted">
            {a.name} · <span className="num">{formatDay(c.postedOn)}</span>
          </p>
        </div>
      </button>
    </Card>
  );
}

function ContentDialog({ c, onClose }: { c: Content | null; onClose: () => void }) {
  if (!c) return <Modal open={false} onOpenChange={() => undefined} title="" />;
  const a = artistById(c.artistId);
  const unlocked = isUnlocked(c);
  const camp = c.unlock.by === "perk" ? campaignById(c.unlock.campaignId) : undefined;

  if (unlocked)
    return (
      <Modal open size="lg" onOpenChange={(o) => !o && onClose()} title={c.title} description={`${a.name} · ${KIND[c.kind].label}`}>
        <div className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-lg">
            <ArtistArt seed={`bs-${c.id}`} label={c.title} className="aspect-video w-full" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-gold text-on-gold">
                {c.kind === "photos" ? <Camera className="size-7" /> : <Play className="ml-1 size-7" />}
              </span>
            </div>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted">
            <Clock className="size-4" /> <span className="num">{c.length}</span> · Posted <span className="num">{formatDay(c.postedOn)}</span>
          </p>
          <p className="text-sm text-muted">
            {c.unlock.by === "subscription"
              ? `Included with your ${a.name} subscription.`
              : `Unlocked by your perk from "${camp?.title}".`}{" "}
            Backstage content is for you only — please don't re-share it.
          </p>
        </div>
      </Modal>
    );

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Unlock this backstage drop"
      description={c.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button asChild>
            <Link to={c.unlock.by === "subscription" ? `/artist/${a.id}` : `/campaigns/${c.unlock.campaignId}`}>{unlockLabel(c)}</Link>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <ArtistArt seed={a.id} label={a.name} rounded="full" className="size-12" />
          <div>
            <p className="font-semibold">{a.name}</p>
            <p className="text-sm text-muted">{a.genre}</p>
          </div>
        </div>
        {c.unlock.by === "subscription" ? (
          <p className="text-sm text-muted">Subscribers to {a.name} get every rehearsal, demo, photo set and stream replay they post here, for as long as they're subscribed.</p>
        ) : (
          <Callout tone="info" title={`Included with the “${c.unlock.perk}” perk`}>
            Choose this perk when you back <span className="text-fg">{camp?.title}</span> to unlock it. If the campaign doesn't reach its goal, you're refunded automatically.
          </Callout>
        )}
      </div>
    </Modal>
  );
}
