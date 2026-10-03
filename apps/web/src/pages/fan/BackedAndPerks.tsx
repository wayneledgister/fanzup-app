import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertCircle, ArrowRight, Download, ExternalLink, Gem, HandCoins, PackageCheck, RotateCcw, Truck } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, EscrowNotice, Field, FundingProgress, PageHeader, Select, Stat, TextArea } from "@/components/brand";
import { Chip, CopyCode, FulfillmentBadge, Modal, SegmentedTabs, type Fulfillment, formatDay } from "@/components/fan/kit";
import { artistById, campaignById } from "@/lib/mock";
import { daysUntil, formatMoney } from "@/lib/format";

/**
 * Source: FanZuP MerchBag.tsx perk vault + backing history (new).
 * Doc-driven: "Genesis Merch Bag", "First Flight" bundle and "FanZuP Protocol" authentication copy removed;
 * perks come only from backed campaigns (Mechanism 05). Live backings show the escrow / auto-refund promise.
 */

type CampaignState = "live" | "funded" | "refunded";

interface Backing {
  id: string;
  campaignId?: string;
  artistId: string;
  title: string;
  perk: string;
  amountMinor: number;
  backedOn: string;
  state: CampaignState;
  refundedOn?: string;
}

const BACKINGS: Backing[] = [
  { id: "b1", campaignId: "nova-live-band-tour", artistId: "nova-reyes", title: "Take the band on the road", perk: "Two tickets + soundcheck", amountMinor: 15000, backedOn: "2026-09-12", state: "live" },
  { id: "b2", campaignId: "nova-live-band-tour", artistId: "nova-reyes", title: "Take the band on the road", perk: "Digital thank-you + tour diary", amountMinor: 1000, backedOn: "2026-08-30", state: "live" },
  { id: "b3", campaignId: "low-ends-debut-lp", artistId: "the-low-ends", title: "Press our debut LP to vinyl", perk: "Vinyl + digital", amountMinor: 3500, backedOn: "2026-07-21", state: "funded" },
  { id: "b4", artistId: "june-ash", title: "Record the porch sessions", perk: "Handwritten lyric sheet", amountMinor: 2500, backedOn: "2026-05-14", state: "refunded", refundedOn: "2026-06-30" },
];

interface VaultItem {
  id: string;
  backingId: string;
  title: string;
  kind: "digital" | "physical" | "experience";
  status: Fulfillment;
  detail: string;
  code?: string;
  download?: { label: string; size: string };
  tracking?: { carrier: string; number: string; eta: string };
}

const VAULT: VaultItem[] = [
  { id: "v1", backingId: "b2", title: "Tour diary #3: Rehearsal week", kind: "digital", status: "Delivered", detail: "New entries every Friday while the campaign is live.", download: { label: "Tour diary #3 (PDF)", size: "4.2 MB" } },
  { id: "v2", backingId: "b1", title: "Two tickets + soundcheck", kind: "experience", status: "Scheduled", detail: "Choose your tour stop by Jan 15, 2027. Your tickets will be issued to you in Tickets.", code: "NOVA-SC-7Q4M" },
  { id: "v3", backingId: "b3", title: "Vinyl + digital", kind: "physical", status: "Preparing", detail: "Test pressings approved. Records ship in April 2027." },
  { id: "v4", backingId: "b3", title: "Early digital download", kind: "digital", status: "Delivered", detail: "Lossless download, released to backers first.", download: { label: "Debut LP (FLAC, 10 tracks)", size: "312 MB" } },
  { id: "v5", backingId: "b3", title: "Band sticker pack", kind: "physical", status: "Shipped", detail: "Sent separately ahead of the vinyl.", tracking: { carrier: "USPS", number: "9400 1118 9922 3456 7810 42", eta: "Oct 6, 2026" } },
  { id: "v6", backingId: "b3", title: "Merch store discount", kind: "digital", status: "Delivered", detail: "15% off anything in The Low Ends store, once.", code: "LOWENDS-BACKER-15" },
];

const STATE_BADGE: Record<CampaignState, React.ReactNode> = {
  live: <Badge tone="info">Live</Badge>,
  funded: <Badge tone="success">Funded</Badge>,
  refunded: <Badge tone="neutral" icon={<RotateCcw />}>Refunded</Badge>,
};

type Tab = "backed" | "perks";

export default function BackedAndPerks() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "perks" ? "perks" : "backed";
  const setTab = (t: Tab) => setParams(t === "perks" ? { tab: "perks" } : {}, { replace: true });
  const [statusFilter, setStatusFilter] = useState<Fulfillment | "all">("all");
  const [dispute, setDispute] = useState<VaultItem | null>(null);

  const live = BACKINGS.filter((b) => b.state === "live");
  const totalBacked = BACKINGS.filter((b) => b.state !== "refunded").reduce((s, b) => s + b.amountMinor, 0);
  const vault = statusFilter === "all" ? VAULT : VAULT.filter((v) => v.status === statusFilter);

  return (
    <Container size="lg" className="py-8 sm:py-10">
      <PageHeader eyebrow="Your support" title="Backed & perks" description="Every campaign you've backed and every perk you've earned, in one place." />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <Stat label="Campaigns backed" value={new Set(BACKINGS.map((b) => b.title)).size} />
        </Card>
        <Card className="p-5">
          <Stat label="Total backed" value={formatMoney(totalBacked)} hint="Excludes refunds" />
        </Card>
        <Card className="col-span-2 p-5 sm:col-span-1">
          <Stat label="Perks delivered" value={`${VAULT.filter((v) => v.status === "Delivered").length} of ${VAULT.length}`} />
        </Card>
      </div>

      <SegmentedTabs
        label="Backed and perks"
        value={tab}
        onChange={setTab}
        className="mb-6 self-start"
        tabs={[
          { id: "backed", label: "Backing history", count: BACKINGS.length },
          { id: "perks", label: "My perks", count: VAULT.length },
        ]}
      />

      {tab === "backed" ? (
        <div className="flex flex-col gap-6">
          {live.length > 0 && <EscrowNotice />}
          <ul className="flex flex-col gap-4">
            {BACKINGS.map((b) => (
              <li key={b.id}>
                <BackingRow b={b} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by status">
            {(["all", "Preparing", "Scheduled", "Shipped", "Delivered"] as const).map((s) => (
              <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s === "all" ? "All perks" : s}
              </Chip>
            ))}
          </div>
          {vault.length === 0 ? (
            <EmptyState icon={<Gem />} title={`No perks ${statusFilter.toLowerCase()} right now`}>
              Perks show up here as soon as a campaign you backed starts delivering them.
            </EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {vault.map((v) => (
                <li key={v.id}>
                  <PerkCard v={v} onReport={() => setDispute(v)} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted">
            Perks are delivered by the artist. If something's late or wrong, use <span className="text-fg">Report a problem</span> on the perk and our
            support team will follow up with the artist for you.
          </p>
        </div>
      )}

      <DisputeDialog item={dispute} onClose={() => setDispute(null)} />
    </Container>
  );
}

function BackingRow({ b }: { b: Backing }) {
  const a = b.artistId === "june-ash" ? { id: "june-ash", name: "June Ash" } : artistById(b.artistId);
  const c = b.campaignId ? campaignById(b.campaignId) : undefined;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
      <ArtistArt seed={a.id} label={a.name} className="size-16 shrink-0" rounded="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{c ? <Link to={`/campaigns/${c.id}`} className="hover:underline">{b.title}</Link> : b.title}</h3>
            <p className="text-sm text-muted">{a.name}</p>
          </div>
          {STATE_BADGE[b.state]}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Perk</dt>
            <dd>{b.perk}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Amount</dt>
            <dd className="num">{formatMoney(b.amountMinor, { cents: true })}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Backed on</dt>
            <dd className="num">{formatDay(b.backedOn)}</dd>
          </div>
        </dl>
        {b.state === "live" && c && (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-4">
            <FundingProgress raisedMinor={c.raisedMinor} goalMinor={c.goalMinor} backers={c.backers} daysLeft={daysUntil(c.endsOn)} />
            <p className="text-xs text-muted">
              Held in escrow. If the goal isn't met by <span className="num">{formatDay(c.endsOn)}</span>, you're refunded automatically.
            </p>
          </div>
        )}
        {b.state === "funded" && <p className="text-sm text-muted">Goal reached. Funds were released to the artist and your perks are on the way.</p>}
        {b.state === "refunded" && (
          <p className="text-sm text-muted">
            This campaign didn't reach its goal. <span className="num">{formatMoney(b.amountMinor, { cents: true })}</span> was returned to your
            original payment method on <span className="num">{formatDay(b.refundedOn!)}</span>.
          </p>
        )}
      </div>
    </Card>
  );
}

function PerkCard({ v, onReport }: { v: VaultItem; onReport: () => void }) {
  const b = BACKINGS.find((x) => x.id === v.backingId)!;
  const icon = v.kind === "physical" ? <PackageCheck className="size-4" /> : v.kind === "experience" ? <HandCoins className="size-4" /> : <Download className="size-4" />;
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs capitalize text-muted">
            {icon} {v.kind} perk
          </p>
          <h3 className="text-base font-semibold">{v.title}</h3>
          <p className="truncate text-sm text-muted">{b.title}</p>
        </div>
        <FulfillmentBadge status={v.status} />
      </div>
      <p className="text-sm text-muted">{v.detail}</p>
      {v.code && <CopyCode code={v.code} label="Perk code" />}
      {v.download && (
        <Button variant="secondary" className="justify-between" onClick={() => undefined}>
          <span className="flex items-center gap-2">
            <Download /> {v.download.label}
          </span>
          <span className="num text-xs text-muted">{v.download.size}</span>
        </Button>
      )}
      {v.tracking && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Truck className="size-4 text-info" /> {v.tracking.carrier} · Arrives {v.tracking.eta}
          </span>
          <span className="num text-xs text-muted">{v.tracking.number}</span>
          <a href="#tracking" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
            Track package <ExternalLink className="size-3" />
          </a>
        </div>
      )}
      <div className="mt-auto flex justify-end border-t border-line pt-3">
        <Button variant="ghost" size="sm" onClick={onReport}>
          <AlertCircle /> Report a problem
        </Button>
      </div>
    </Card>
  );
}

function DisputeDialog({ item, onClose }: { item: VaultItem | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const close = () => {
    onClose();
    window.setTimeout(() => {
      setReason("");
      setDetails("");
      setError(null);
      setSent(false);
    }, 200);
  };
  const submit = () => {
    if (!reason) return setError("Choose what went wrong.");
    if (details.trim().length < 10) return setError("Tell us a little more so we can help — at least a sentence.");
    setError(null);
    setSent(true);
  };
  return (
    <Modal
      open={!!item}
      onOpenChange={(o) => !o && close()}
      title={sent ? "We're on it" : "Report a problem"}
      description={item && !sent ? item.title : undefined}
      footer={
        sent ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit}>Send report</Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <Callout tone="success" title="Report received">
            Case <span className="num text-fg">FZP-SUP-20417</span>. We'll reply by email within 2 business days and loop in the artist if needed.
          </Callout>
          <p className="text-sm text-muted">If the perk can't be delivered, you can request a refund for it as part of this case.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Field label="What went wrong?" htmlFor="dispute-reason" error={error && !reason ? error : undefined}>
            <Select id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error && !reason}>
              <option value="">Select a reason</option>
              <option>It hasn't arrived</option>
              <option>It arrived damaged</option>
              <option>It's not what was promised</option>
              <option>The code or download doesn't work</option>
              <option>Something else</option>
            </Select>
          </Field>
          <Field label="Details" htmlFor="dispute-details" hint="Order dates, photos you can share later, anything that helps." error={error && reason ? error : undefined}>
            <TextArea id="dispute-details" value={details} onChange={(e) => setDetails(e.target.value)} aria-invalid={!!error && !!reason} />
          </Field>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            Need help with a payment instead? <Link to="/settings/payments" className="inline-flex items-center gap-1 text-gold hover:underline">Payments <ArrowRight className="size-3" /></Link>
          </p>
        </div>
      )}
    </Modal>
  );
}
