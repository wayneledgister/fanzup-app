import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { FileText, Globe, Headphones, Image as ImageIcon, Lock, MessageCircle, Plus, Search, Upload, Users, Video, type LucideIcon } from "lucide-react";
import { Badge, Button, Card, Container, EmptyState, IconChip, PageHeader, Select, TextInput } from "@/components/brand";
import { Segmented, formatDay } from "@/components/creator/ui";
import { formatNumber } from "@/lib/format";

/**
 * Source: Fan Profile Setup ContentManagement + ContentManagementShowcase.
 * Doc-driven changes: "Investor" / "Pool Holders Only" gating replaced with Public / Subscribers / Backers of a
 * campaign — exclusive content is never unlocked by holding units (CONSOLIDATION: Backstage). Per-item
 * "Revenue" column dropped (content isn't sold individually in Layer 1). Empty state via `?state=empty`.
 */
type Visibility = "public" | "subscribers" | "backers";
type Status = "published" | "scheduled" | "draft";
type Kind = "audio" | "video" | "image" | "document";

interface ContentItem {
  id: string;
  title: string;
  kind: Kind;
  visibility: Visibility;
  campaign?: string;
  status: Status;
  date: string;
  views: number;
  comments: number;
}

const ITEMS: ContentItem[] = [
  { id: "c1", title: "Tour diary #3 — first full-band rehearsal", kind: "video", visibility: "backers", campaign: "Take the band on the road", status: "published", date: "2026-09-29", views: 388, comments: 41 },
  { id: "c2", title: "Midnight Horns (acoustic, one take)", kind: "audio", visibility: "subscribers", status: "published", date: "2026-09-22", views: 1204, comments: 87 },
  { id: "c3", title: "Tour poster — final artwork", kind: "image", visibility: "public", status: "published", date: "2026-09-18", views: 5310, comments: 112 },
  { id: "c4", title: "Tour diary #4 — booking the van", kind: "video", visibility: "backers", campaign: "Take the band on the road", status: "scheduled", date: "2026-10-06", views: 0, comments: 0 },
  { id: "c5", title: "Lyrics booklet — Midnight Horns", kind: "document", visibility: "backers", campaign: "Press Midnight Horns to vinyl", status: "published", date: "2026-05-14", views: 172, comments: 9 },
  { id: "c6", title: "Holiday set list vote", kind: "document", visibility: "subscribers", status: "draft", date: "2026-09-30", views: 0, comments: 0 },
  { id: "c7", title: "Studio session — horn arrangements", kind: "video", visibility: "subscribers", status: "published", date: "2026-08-30", views: 940, comments: 53 },
];

const KIND_ICON: Record<Kind, LucideIcon> = { audio: Headphones, video: Video, image: ImageIcon, document: FileText };
const VIS: Record<Visibility, { label: string; icon: LucideIcon }> = {
  public: { label: "Public", icon: Globe },
  subscribers: { label: "Subscribers", icon: Users },
  backers: { label: "Backers", icon: Lock },
};
const STATUS: Record<Status, { label: string; tone: "success" | "info" | "neutral" }> = {
  published: { label: "Published", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  draft: { label: "Draft", tone: "neutral" },
};

export default function Content() {
  const [params] = useSearchParams();
  const items = params.get("state") === "empty" ? [] : ITEMS;
  const [status, setStatus] = useState<"all" | Status>("all");
  const [vis, setVis] = useState<"all" | Visibility>("all");
  const [q, setQ] = useState("");

  const shown = useMemo(
    () => items.filter((i) => (status === "all" || i.status === status) && (vis === "all" || i.visibility === vis) && i.title.toLowerCase().includes(q.toLowerCase())),
    [items, status, vis, q],
  );
  const count = (s: Status) => items.filter((i) => i.status === s).length;

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Content"
        title="Content library"
        description="Posts, tracks and exclusives. Choose who sees each one: everyone, your subscribers, or backers of a campaign."
        actions={
          <Button asChild>
            <Link to="/creator/content/upload">
              <Upload /> Upload content
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Upload />}
          title="Nothing uploaded yet"
          action={
            <Button asChild>
              <Link to="/creator/content/upload">
                <Plus /> Upload your first post
              </Link>
            </Button>
          }
        >
          Share a demo, a rehearsal clip or a lyric sheet. Subscriber-only content is one of the best reasons for fans to subscribe.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Segmented
              label="Filter by status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: items.length },
                { value: "published", label: "Published", count: count("published") },
                { value: "scheduled", label: "Scheduled", count: count("scheduled") },
                { value: "draft", label: "Drafts", count: count("draft") },
              ]}
            />
            <div className="flex gap-2">
              <div className="relative flex-1 lg:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <TextInput aria-label="Search content" placeholder="Search content" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
              </div>
              <Select aria-label="Filter by visibility" value={vis} onChange={(e) => setVis(e.target.value as typeof vis)} className="w-40">
                <option value="all">Anyone</option>
                <option value="public">Public</option>
                <option value="subscribers">Subscribers</option>
                <option value="backers">Backers</option>
              </Select>
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState icon={<Search />} title="No content matches these filters" action={<Button variant="secondary" size="sm" onClick={() => { setQ(""); setVis("all"); setStatus("all"); }}>Clear filters</Button>}>
              Try a different search or visibility.
            </EmptyState>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {shown.map((i) => {
                  const K = KIND_ICON[i.kind];
                  const V = VIS[i.visibility];
                  return (
                    <li key={i.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:px-6">
                      <div className="flex min-w-0 items-start gap-4">
                        <IconChip tone="muted">
                          <K />
                        </IconChip>
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-sm font-medium text-fg">{i.title}</span>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                            <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                            <span className="inline-flex items-center gap-1">
                              <V.icon className="size-3.5" aria-hidden />
                              {i.visibility === "backers" ? `Backers of ${i.campaign}` : V.label}
                            </span>
                            <span>·</span>
                            <span>
                              {i.status === "scheduled" ? "Goes out " : i.status === "draft" ? "Edited " : ""}
                              <span className="num">{formatDay(i.date)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 pl-14 text-sm sm:pl-0">
                        <span className="flex flex-col sm:items-end">
                          <span className="num text-fg">{i.status === "published" ? formatNumber(i.views) : "—"}</span>
                          <span className="text-xs text-muted">views</span>
                        </span>
                        <span className="flex flex-col sm:items-end">
                          <span className="num inline-flex items-center gap-1 text-fg">
                            <MessageCircle className="size-3.5 text-muted" aria-hidden />
                            {i.status === "published" ? i.comments : "—"}
                          </span>
                          <span className="text-xs text-muted">comments</span>
                        </span>
                        <Button variant="ghost" size="sm" className="ml-auto sm:ml-0">
                          Edit
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </Container>
  );
}
