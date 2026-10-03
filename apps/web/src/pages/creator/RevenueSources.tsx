import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Clock, Disc3, FileUp, Film, Plug, RefreshCw, ShoppingBag, Ticket, TriangleAlert, Unplug, XCircle, type LucideIcon } from "lucide-react";
import { Badge, Button, Callout, Card, Container, IconChip, PageHeader, RegulatoryFooter } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * Source: FanZuP IntegrationsPanel (inside CreatorApp), rebuilt per PRD 01b connection model. Gated `layer2` by router.
 * Doc-driven changes: no named third-party partners (Brand §7.4 "invented partners"); sources are described by
 * category. Connection states PENDING / ACTIVE / STALE / REVOKED / ERROR and modes PULL / PUSH / MANUAL shown
 * verbatim as codes with plain-language labels. Explains that Pools pay out only from revenue actually collected.
 */
type State = "PENDING" | "ACTIVE" | "STALE" | "REVOKED" | "ERROR";
type Mode = "PULL" | "PUSH" | "MANUAL";

interface Source {
  id: string;
  name: string;
  category: string;
  icon: LucideIcon;
  state: State;
  mode: Mode;
  lastSync: string | null;
  detail: string;
  usedBy?: string;
}

const STATE: Record<State, { label: string; tone: "success" | "warning" | "error" | "info" | "neutral"; icon: LucideIcon; help: string }> = {
  ACTIVE: { label: "Active", tone: "success", icon: CheckCircle2, help: "Reports are arriving on schedule." },
  PENDING: { label: "Pending", tone: "info", icon: Clock, help: "Connected — waiting for the first report." },
  STALE: { label: "Stale", tone: "warning", icon: AlertTriangle, help: "No new report in longer than expected." },
  REVOKED: { label: "Revoked", tone: "neutral", icon: Unplug, help: "Access was removed. Nothing is being collected." },
  ERROR: { label: "Error", tone: "error", icon: XCircle, help: "The last report couldn't be read." },
};

const MODE: Record<Mode, string> = {
  PULL: "We fetch reports from the source",
  PUSH: "The source sends reports to us",
  MANUAL: "You upload statements",
};

const SOURCES_INIT: Source[] = [
  { id: "dist", name: "Music distributor", category: "Streaming & downloads", icon: Disc3, state: "ACTIVE", mode: "PULL", lastSync: "2 hours ago", detail: "Royalty reports for 2 EPs and 9 singles", usedBy: "Creator Pool (draft)" },
  { id: "merch", name: "Merch store", category: "Merch", icon: ShoppingBag, state: "STALE", mode: "PULL", lastSync: "9 days ago", detail: "Orders and payouts from your storefront" },
  { id: "tix", name: "Ticketing", category: "Tickets", icon: Ticket, state: "PENDING", mode: "PUSH", lastSync: null, detail: "Settlement reports for shows you sell outside FanZuP" },
  { id: "sync", name: "Sync licensing", category: "Sync & licensing", icon: Film, state: "ERROR", mode: "MANUAL", lastSync: "Sep 12", detail: "Statement upload — Q2 2026 file couldn't be read" },
  { id: "old-dist", name: "Previous distributor", category: "Streaming & downloads", icon: Disc3, state: "REVOKED", mode: "PULL", lastSync: "Jan 4", detail: "Disconnected after you moved your catalog" },
];

const AVAILABLE = [
  { id: "pub", name: "Publishing administrator", category: "Publishing", icon: FileUp },
  { id: "venue", name: "Venue settlements", category: "Live", icon: Ticket },
];

export default function RevenueSources() {
  const [sources, setSources] = useState(SOURCES_INIT);
  const [syncing, setSyncing] = useState<string | null>(null);

  const resync = (id: string) => {
    setSyncing(id);
    window.setTimeout(() => {
      setSources((s) => s.map((x) => (x.id === id ? { ...x, state: "ACTIVE", lastSync: "Just now", detail: x.id === "sync" ? "Q2 2026 statement imported" : x.detail } : x)));
      setSyncing(null);
    }, 900);
  };

  const active = sources.filter((s) => s.state === "ACTIVE").length;
  const needsAttention = sources.filter((s) => s.state === "STALE" || s.state === "ERROR").length;

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Revenue sources"
        title="Connected revenue sources"
        description="Connect where your money comes from. Investment Pools need these so payouts to investors only ever come from revenue you've actually collected."
        actions={
          <Button>
            <Plug /> Connect a source
          </Button>
        }
      />

      <Callout tone="info" icon={<Info />} title="Why Pools need connected sources" className="mb-6">
        A Pool's potential payouts are a share of specific revenue. We only distribute what's reported by a connected source and actually collected —
        never projections. If a source goes stale or errors, distributions from it pause until it's fixed.
      </Callout>

      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <Card className="flex flex-col gap-1 p-5">
          <span className="eyebrow">Connected</span>
          <span className="num text-2xl font-medium text-fg">{sources.filter((s) => s.state !== "REVOKED").length}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <span className="eyebrow">Active</span>
          <span className="num text-2xl font-medium text-success">{active}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <span className="eyebrow">Need attention</span>
          <span className={cn("num text-2xl font-medium", needsAttention ? "text-warning" : "text-fg")}>{needsAttention}</span>
        </Card>
      </div>

      <ul className="flex flex-col gap-4">
        {sources.map((s) => {
          const st = STATE[s.state];
          const fixable = s.state === "STALE" || s.state === "ERROR";
          return (
            <li key={s.id}>
              <Card className={cn("grid gap-4 md:grid-cols-[1fr_auto] md:items-center", s.state === "REVOKED" && "opacity-70")}>
                <div className="flex min-w-0 gap-4">
                  <IconChip tone={s.state === "ACTIVE" ? "gold" : "muted"}>
                    <s.icon />
                  </IconChip>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{s.name}</h2>
                      <Badge tone={st.tone} icon={<st.icon />}>
                        {st.label}
                      </Badge>
                      <span className="num rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-muted" title={MODE[s.mode]}>
                        {s.mode}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {s.category} · {s.detail}
                    </p>
                    <p className="text-xs text-muted">
                      {st.help} {MODE[s.mode]}. Last sync: <span className="num text-fg">{s.lastSync ?? "never"}</span>
                      {s.usedBy && <> · Used by {s.usedBy}</>}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 md:justify-end">
                  {fixable && (
                    <Button size="sm" variant="secondary" onClick={() => resync(s.id)} disabled={syncing === s.id}>
                      <RefreshCw className={cn(syncing === s.id && "animate-spin")} />
                      {s.mode === "MANUAL" ? "Upload again" : syncing === s.id ? "Syncing…" : "Sync now"}
                    </Button>
                  )}
                  {s.state === "REVOKED" ? (
                    <Button size="sm" variant="ghost">
                      Reconnect
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost">
                      Manage
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <h2 className="mb-4 mt-10 text-xl font-semibold">Add another source</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {AVAILABLE.map((a) => (
          <Card key={a.id} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <IconChip tone="muted">
                <a.icon />
              </IconChip>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-fg">{a.name}</span>
                <span className="text-xs text-muted">{a.category}</span>
              </div>
            </div>
            <Button size="sm" variant="secondary">
              Connect
            </Button>
          </Card>
        ))}
      </div>

      <div className="mt-10 border-t border-line pt-6">
        <RegulatoryFooter />
      </div>
    </Container>
  );
}
