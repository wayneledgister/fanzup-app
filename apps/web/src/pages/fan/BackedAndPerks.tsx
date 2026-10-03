import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CircleAlert, HandCoins, RefreshCw, RotateCcw } from "lucide-react";
import { ArtistArt, Badge, Button, Callout, Card, Container, EmptyState, PageHeader, ProgressBar, TestModeNotice } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { api, type MyBacking } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: FanZuP MerchBag.tsx backing history (new).
 * M1 (FR-BCK-005, FR-PAY-009 fan view, FR-PLT-006): every backing from the API with the campaign's status, where
 * the money is (derived from the ledger), the perk's status ("Not yet shipped" until fulfillment tracking ships,
 * FR-FUL-002) and the next expected event. Refunds show amount, date and reference. The perk vault, problem
 * reports (FR-DSP-003, P0b) and PDF receipts (P1) come later; nothing here is mock data.
 */

const MONEY: Record<MyBacking["moneyState"], { label: string; tone: "gold" | "success" | "info" | "warning" | "neutral"; help: string }> = {
  pending: { label: "Payment pending", tone: "warning", help: "We're waiting for your payment to be confirmed." },
  held: { label: "Held until the deadline", tone: "gold", help: "If the goal isn't reached by the deadline, you're refunded in full automatically." },
  with_artist: { label: "Released in stages", tone: "info", help: "The campaign is funded. The artist receives the money as each milestone is verified." },
  released: { label: "Released to the artist", tone: "success", help: "Every milestone has been released to the artist." },
  refunding: { label: "Refund on its way", tone: "warning", help: "Your refund has started. It usually reaches your card within 5 business days." },
  refunded: { label: "Refunded", tone: "neutral", help: "You were refunded in full." },
  canceled: { label: "Not completed", tone: "neutral", help: "This checkout wasn't completed. Nothing was charged." },
};

const CAMPAIGN: Record<string, string> = {
  live: "Live", funded: "Funded", released: "Funded · all milestones released", failed: "Didn't reach its goal", refunded: "Didn't reach its goal · refunded", closed: "Closed",
};

export default function BackedAndPerksPage() {
  return (
    <RequireAccount verified={false}>
      <BackedAndPerks />
    </RequireAccount>
  );
}

function BackedAndPerks() {
  const [items, setItems] = useState<MyBacking[] | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    api.myBackings().then((r) => setItems(r.backings)).catch(() => setError(true));
  };
  useEffect(load, []);

  return (
    <Container size="lg" className="flex flex-col gap-8 py-8">
      <PageHeader eyebrow="Your backings" title="Backed" description="Every campaign you've backed, where your money is, and what happens next." />
      <TestModeNotice />
      {error && (
        <Callout tone="error" icon={<CircleAlert />} title="We couldn't load your backings">
          Your money is safe — this is only a display problem. <Button variant="ghost" size="sm" onClick={load}><RefreshCw /> Retry</Button>
        </Callout>
      )}
      {!items && !error && <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Loading your backings" />}
      {items && items.length === 0 && (
        <EmptyState icon={<HandCoins />} title="You haven't backed anything yet" action={<Button asChild><Link to="/explore">Find a campaign <ArrowRight /></Link></Button>}>
          When you back a campaign, it shows up here with its status and your perk.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-4" data-testid="my-backings">
          {items.map((b) => <BackingRow key={b.id} b={b} />)}
        </ul>
      )}
    </Container>
  );
}

function BackingRow({ b }: { b: MyBacking }) {
  const m = MONEY[b.moneyState];
  return (
    <li>
      <Card className="flex flex-col gap-4" data-testid="backing-row" data-money-state={b.moneyState}>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <ArtistArt seed={b.campaign.slug} label={b.campaign.title} rounded="md" className="size-14 shrink-0" />
          <div className="min-w-0 flex-1 basis-48">
            <Link to={`/campaigns/${b.campaign.slug}`} className="font-semibold hover:underline">{b.campaign.title}</Link>
            <p className="text-sm text-muted">
              {b.perk.title}
              {b.quantity > 1 && <> × <span className="num">{b.quantity}</span></>} · <span className="num">{formatMoney(b.amountMinor, { cents: true })}</span> · backed <span className="num">{formatDate(b.createdAt.slice(0, 10))}</span>
            </p>
          </div>
          <Badge tone={m.tone}>{m.label}</Badge>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Campaign</p>
            <p>{CAMPAIGN[b.campaign.status] ?? b.campaign.status}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Your perk</p>
            <p>{b.perk.status} · due by <span className="num">{formatDate(b.perk.fulfillBy)}</span></p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Next</p>
            <p>{b.next ? <>{b.next.label}{b.next.at && <> · <span className="num">{formatDate(b.next.at.slice(0, 10))}</span></>}</> : "Nothing pending"}</p>
          </div>
        </div>

        {b.moneyState === "with_artist" && (
          <div className="flex flex-col gap-1.5">
            <ProgressBar value={b.releasedPct} max={100} tone="info" label="Share of the campaign released to the artist" />
            <p className="text-xs text-muted"><span className="num">{b.releasedPct}%</span> of the campaign's funds released to the artist so far.</p>
          </div>
        )}
        {b.refund && (
          <p className="text-sm text-muted [overflow-wrap:anywhere]">
            <RotateCcw className="mr-1.5 inline size-4 align-[-3px]" /> Refunded <span className="num">{formatMoney(b.refund.amountMinor, { cents: true })}</span> on{" "}
            <span className="num">{formatDate(b.refund.at.slice(0, 10))}</span>
            {b.refund.ref && <> · reference <span className="num">{b.refund.ref}</span></>}
          </p>
        )}
        <p className="text-xs text-muted">{m.help}</p>
      </Card>
    </li>
  );
}
