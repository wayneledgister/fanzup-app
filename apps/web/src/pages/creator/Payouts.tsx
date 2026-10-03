import { useState } from "react";
import { Link } from "react-router";
import { BadgeCheck, CalendarClock, CheckCircle2, Info, Landmark, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge, Button, Callout, Card, ChoiceCard, Container, KeyValue, Money, PageHeader } from "@/components/brand";
import { KpiCard, TableShell, formatDay } from "@/components/creator/ui";
import { creatorCampaigns, milestoneSchedule } from "@/components/creator/data";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FanZuP BankingSystem.tsx, rebuilt for creators (CONSOLIDATION "Selected FanZuP features").
 * Doc-driven changes: dropped stored "Available Balance", virtual card, cashback, auto-sweep, Galaxy tier and the
 * "Apex Clearing / FDIC pass-through" custody claims (Concerns #5, Brand §7.4). FanZuP never holds funds: payouts
 * go from the payment processor to the creator's bank, and campaign money sits with the escrow partner until the
 * goal is met. Account verification is done by the processor.
 */
type Schedule = "weekly" | "monthly";

const HISTORY = [
  { id: "po_8812", date: "2026-10-05", amountMinor: 168_420, status: "scheduled" as const, period: "Sep 28 – Oct 4" },
  { id: "po_8790", date: "2026-09-28", amountMinor: 152_310, status: "in_transit" as const, period: "Sep 21 – 27" },
  { id: "po_8761", date: "2026-09-21", amountMinor: 141_980, status: "paid" as const, period: "Sep 14 – 20" },
  { id: "po_8733", date: "2026-09-14", amountMinor: 238_650, status: "paid" as const, period: "Sep 7 – 13" },
  { id: "po_8702", date: "2026-09-07", amountMinor: 118_240, status: "paid" as const, period: "Aug 31 – Sep 6" },
  { id: "po_8671", date: "2026-08-31", amountMinor: 126_015, status: "paid" as const, period: "Aug 24 – 30" },
];

const PAYOUT_STATUS = {
  scheduled: { label: "Scheduled", tone: "neutral" as const },
  in_transit: { label: "In transit", tone: "info" as const },
  paid: { label: "Paid", tone: "success" as const },
};

export default function Payouts() {
  const [schedule, setSchedule] = useState<Schedule>("weekly");
  const [saved, setSaved] = useState(false);
  const live = creatorCampaigns.find((c) => c.status === "live")!;
  const released = creatorCampaigns.filter((c) => c.releasedMinor);
  const refunded = creatorCampaigns.filter((c) => c.status === "refunded");
  const paidRecent = HISTORY.filter((h) => h.status === "paid").reduce((a, h) => a + h.amountMinor, 0);

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Payouts"
        title="Payouts"
        description="Money from subscriptions, tickets, merch, streams and tips goes straight from our payment processor to your bank. FanZuP never holds it."
      />

      <section aria-label="Payout summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="Next payout" icon={<CalendarClock />} value={formatMoney(HISTORY[0].amountMinor)} hint={<>on <span className="num">{formatDay(HISTORY[0].date)}</span></>} />
        <KpiCard label="In transit" value={formatMoney(HISTORY[1].amountMinor)} hint="on its way to your bank" />
        <KpiCard label="Paid last 4 weeks" value={formatMoney(paidRecent)} hint="to Checking ••4821" />
        <KpiCard label="Campaign funds in escrow" icon={<Lock />} value={formatMoney(live.raisedMinor)} hint="not yours until the goal is met" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Campaign funds */}
          <Card className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Campaign funds</h2>
              <p className="text-sm text-muted">
                Backers' money is held by our escrow partner — not by FanZuP and not by you — until a campaign hits its goal. If it doesn't, every
                backer is refunded automatically and nothing is paid out.
              </p>
            </div>

            <div className="flex flex-col gap-4 rounded-md border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/creator/campaigns/${live.id}`} className="text-sm font-medium text-fg hover:text-gold">
                  {live.title}
                </Link>
                <Badge tone="info" icon={<Lock />}>
                  In escrow
                </Badge>
              </div>
              <p className="text-sm text-muted">
                <Money minor={live.raisedMinor} className="text-fg" /> held. Released when the <Money minor={live.goalMinor} /> goal is met by{" "}
                <span className="num">{formatDay(live.endsOn)}</span>, in three milestones:
              </p>
              <ol className="grid gap-2 sm:grid-cols-3">
                {milestoneSchedule.map((m, i) => (
                  <li key={m.id} className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
                    <span className="flex items-baseline justify-between">
                      <span className="num text-xs text-muted">0{i + 1}</span>
                      <span className="num text-sm text-fg">{m.sharePct}%</span>
                    </span>
                    <span className="text-xs text-fg">{m.label}</span>
                    <span className="text-xs text-muted">Milestone pending</span>
                  </li>
                ))}
              </ol>
            </div>

            <ul className="flex flex-col divide-y divide-line">
              {released.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-fg">{c.title}</span>
                  <span className="flex items-center gap-3">
                    <Money minor={c.releasedMinor!} className="text-sm text-fg" />
                    <Badge tone="success" icon={<CheckCircle2 />}>
                      Released {formatDay(c.statusDate)}
                    </Badge>
                  </span>
                </li>
              ))}
              {refunded.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-fg">{c.title}</span>
                  <span className="flex items-center gap-3">
                    <Money minor={c.raisedMinor} className="text-sm text-muted line-through" />
                    <Badge tone="error" icon={<RotateCcw />}>
                      Refunded to backers
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {/* History */}
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Payout history</h2>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/creator/tax">Statements</Link>
              </Button>
            </div>
            <div className="hidden sm:block">
              <TableShell>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Earnings period</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {HISTORY.map((h) => (
                    <tr key={h.id}>
                      <td className="num text-fg">{formatDay(h.date)}</td>
                      <td className="text-muted">{h.period}</td>
                      <td className="num text-muted">{h.id}</td>
                      <td>
                        <Badge tone={PAYOUT_STATUS[h.status].tone}>{PAYOUT_STATUS[h.status].label}</Badge>
                      </td>
                      <td className="num text-right text-fg">{formatMoney(h.amountMinor, { cents: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
            <ul className="flex flex-col divide-y divide-line sm:hidden">
              {HISTORY.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="num text-sm text-fg">{formatDay(h.date)}</span>
                    <span className="text-xs text-muted">{h.period}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="num text-sm text-fg">{formatMoney(h.amountMinor, { cents: true })}</span>
                    <Badge tone={PAYOUT_STATUS[h.status].tone}>{PAYOUT_STATUS[h.status].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Amounts are after card processing fees. Platform fee: TBD.</p>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          {/* Bank */}
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Payout account</h2>
              <Landmark className="size-5 text-gold" aria-hidden />
            </div>
            <div className="flex items-center gap-3 rounded-md border border-line bg-surface-2 p-4">
              <div className="flex size-10 items-center justify-center rounded-md bg-surface text-muted">
                <Landmark className="size-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg">Business checking</span>
                <span className="num text-xs text-muted">Routing ••0210 · Account ••4821</span>
              </div>
              <Badge tone="success" icon={<BadgeCheck />}>
                Verified
              </Badge>
            </div>
            <KeyValue k="Account holder" v="Nova Reyes Music LLC" />
            <KeyValue k="Verified by" v="Our payment processor" />
            <Button variant="secondary" size="sm">
              Change account
            </Button>
            <p className="text-xs text-muted">Changing your account pauses payouts until our payment processor verifies the new one.</p>
          </Card>

          {/* Schedule */}
          <Card className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Payout schedule</h2>
            <div role="radiogroup" aria-label="Payout schedule" className="flex flex-col gap-3">
              {([
                ["weekly", "Weekly", "Every Monday, for the previous week"],
                ["monthly", "Monthly", "On the 1st, for the previous month"],
              ] as const).map(([v, l, d]) => (
                <ChoiceCard key={v} selected={schedule === v} onSelect={() => { setSchedule(v); setSaved(false); }} className="p-4">
                  <span className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-fg">{l}</span>
                    <span className={cn("size-4 rounded-full border", schedule === v ? "border-4 border-gold" : "border-line")} aria-hidden />
                  </span>
                  <span className="text-sm text-muted">{d}</span>
                </ChoiceCard>
              ))}
            </div>
            <Button size="sm" onClick={() => setSaved(true)}>
              Save schedule
            </Button>
            {saved && (
              <p className="flex items-center gap-1.5 text-sm text-success" role="status">
                <CheckCircle2 className="size-4" /> Saved. Takes effect from your next payout.
              </p>
            )}
          </Card>

          <Callout tone="gold" icon={<ShieldCheck />} title="Where your money is">
            FanZuP doesn't keep a balance for you. Sales are paid out by our payment processor on your schedule; campaign money stays with the
            escrow partner until your goal is met.
          </Callout>
          <Callout tone="info" icon={<Info />}>
            Questions about a payout? Include the reference number when you contact support.
          </Callout>
        </aside>
      </div>
    </Container>
  );
}
