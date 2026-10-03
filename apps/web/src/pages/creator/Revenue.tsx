import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Info, Receipt, Repeat, Wallet } from "lucide-react";
import { Button, Callout, Card, Checkbox, Container, PageHeader } from "@/components/brand";
import { CHART, ChartCard, KpiCard, MoneyTooltip, Segmented, TableShell, axisProps } from "@/components/creator/ui";
import { SOURCES, SOURCE_LABEL, processingFee, revenueByMonth } from "@/components/creator/data";
import { formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup RevenueAnalytics + RevenueAnalyticsShowcase.
 * Doc-driven changes: "Pool Units" / "Pool Distribution" sources removed (Layer 1 — Brand §7.4); sources are
 * subscriptions, tickets, merch, live streams, tips and campaign proceeds. Fee lines show only the Stripe
 * pass-through (2.9% + $0.30); the platform fee is labelled TBD per docs/brand/fees.html. Pie chart dropped
 * in favour of a ranked bar (one hue, labelled) so identity never depends on color alone.
 */
type Range = "3m" | "6m" | "12m" | "ytd";
const RANGE_LABEL: Record<Range, string> = { "3m": "Last 3 months", "6m": "Last 6 months", "12m": "Last 12 months", ytd: "Year to date" };

export default function Revenue() {
  const [range, setRange] = useState<Range>("12m");
  const [includeCampaigns, setIncludeCampaigns] = useState(true);

  const months = useMemo(() => {
    if (range === "ytd") return revenueByMonth.filter((m) => m.month.startsWith("2026"));
    const n = { "3m": 3, "6m": 6, "12m": 12 }[range];
    return revenueByMonth.slice(-n);
  }, [range]);

  const rows = useMemo(() => {
    const r = SOURCES.map((s) => {
      const gross = months.reduce((a, m) => a + m.bySource[s], 0);
      const fee = months.reduce((a, m) => a + processingFee(s, m.bySource[s]), 0);
      return { source: s, label: SOURCE_LABEL[s], gross, fee, net: gross - fee };
    });
    return r;
  }, [months]);

  const gross = rows.reduce((a, r) => a + r.gross, 0);
  const fees = rows.reduce((a, r) => a + r.fee, 0);
  const net = gross - fees;
  const lastMonth = months[months.length - 1];
  const prevSubs = revenueByMonth[revenueByMonth.length - 2].bySource.subscriptions;
  const mrr = revenueByMonth[revenueByMonth.length - 1].bySource.subscriptions;
  const ranked = [...rows].sort((a, b) => b.gross - a.gross);
  const chartData = months.map((m) => ({ label: m.label, month: m.month, value: includeCampaigns ? m.total : m.totalExCampaigns }));

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Revenue"
        title="Revenue"
        description="Everything fans paid you, by source, with the fees taken out. Campaign proceeds count once they're released from escrow."
        actions={
          <Button variant="secondary">
            <Download /> Export CSV
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Date range"
          value={range}
          onChange={setRange}
          options={[
            { value: "3m", label: "3M" },
            { value: "6m", label: "6M" },
            { value: "12m", label: "12M" },
            { value: "ytd", label: "YTD" },
          ]}
        />
        <p className="text-sm text-muted">
          {RANGE_LABEL[range]} · <span className="num">{months[0].label} – {lastMonth.label} {lastMonth.month.slice(0, 4)}</span>
        </p>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="Gross revenue" icon={<Wallet />} value={formatMoney(gross)} hint={RANGE_LABEL[range].toLowerCase()} />
        <KpiCard label="Processing fees" icon={<Receipt />} value={`−${formatMoney(fees)}`} hint="2.9% + $0.30 per payment" />
        <KpiCard label="Net before platform fee" value={formatMoney(net)} hint="Platform fee: TBD" />
        <KpiCard label="Subscription MRR" icon={<Repeat />} value={formatMoney(mrr)} delta={(mrr - prevSubs) / prevSubs} hint="vs August" />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ChartCard
          title="Revenue by month"
          subtitle="Gross, before fees"
          actions={
            <Checkbox id="inc-camp" checked={includeCampaigns} onChange={setIncludeCampaigns}>
              Include campaign proceeds
            </Checkbox>
          }
        >
          <div className="h-64 w-full sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
                <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatMoney(v, { compact: true })} />
                <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--color-surface-2)" }} />
                <Bar dataKey="value" name="Revenue" fill={CHART.gold} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="By source" subtitle={`${RANGE_LABEL[range]}, gross`}>
          <div className="w-full" style={{ height: ranked.length * 44 + 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ranked} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={12}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="label" {...axisProps} tick={{ fill: "var(--color-fg)", fontSize: 13 }} width={124} />
                <Tooltip content={<MoneyTooltip />} cursor={{ fill: "var(--color-surface-2)" }} />
                <Bar dataKey="gross" name="Gross" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                  {ranked.map((r) => (
                    <Cell key={r.source} fill={r.source === "campaigns" ? CHART.teal : CHART.cyan} />
                  ))}
                  <LabelList dataKey="gross" position="right" formatter={(v: number) => formatMoney(v, { compact: true })} style={{ fill: "var(--color-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="size-2 rounded-full bg-accent-teal" aria-hidden /> Campaign proceeds are one-time releases from escrow.
          </p>
        </ChartCard>
      </div>

      {/* Table */}
      <Card className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Breakdown and fees</h2>
          <p className="text-sm text-muted">{RANGE_LABEL[range]}. Processing fees are estimated from your payment count until the statement closes.</p>
        </div>

        <div className="hidden md:block">
          <TableShell>
            <thead>
              <tr>
                <th>Source</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Processing</th>
                <th className="text-right">Platform fee</th>
                <th className="text-right">Net</th>
                <th className="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source}>
                  <td className="text-fg">{r.label}</td>
                  <td className="num text-right text-fg">{formatMoney(r.gross)}</td>
                  <td className="num text-right text-muted">{r.fee ? `−${formatMoney(r.fee, { cents: true })}` : "—"}</td>
                  <td className="text-right text-muted">TBD</td>
                  <td className="num text-right text-fg">{formatMoney(r.net)}</td>
                  <td className="num text-right text-muted">{gross ? Math.round((r.gross / gross) * 100) : 0}%</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="font-semibold text-fg">Total</td>
                <td className="num text-right font-semibold text-fg">{formatMoney(gross)}</td>
                <td className="num text-right text-muted">−{formatMoney(fees, { cents: true })}</td>
                <td className="text-right text-muted">TBD</td>
                <td className="num text-right font-semibold text-gold">{formatMoney(net)}</td>
                <td className="num text-right text-muted">100%</td>
              </tr>
            </tbody>
          </TableShell>
        </div>

        <ul className="flex flex-col divide-y divide-line md:hidden">
          {rows.map((r) => (
            <li key={r.source} className="flex flex-col gap-1 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-fg">{r.label}</span>
                <span className="num text-sm text-fg">{formatMoney(r.net)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span>
                  Gross <span className="num">{formatMoney(r.gross)}</span> · Processing <span className="num">{r.fee ? `−${formatMoney(r.fee)}` : "—"}</span>
                </span>
                <span>Platform TBD</span>
              </div>
            </li>
          ))}
          <li className="flex items-baseline justify-between py-3">
            <span className="text-sm font-semibold text-fg">Net before platform fee</span>
            <span className="num text-sm font-semibold text-gold">{formatMoney(net)}</span>
          </li>
        </ul>

        <Callout tone="info" icon={<Info />} title="How fees work">
          Card processing (2.9% + $0.30 per payment) is passed through at cost — FanZuP doesn't keep any of it. Platform fee rates haven't been set yet;
          you'll see them here, and get notice, before any apply.{" "}
          <Link to="/fees" className="font-medium text-gold hover:underline">
            See fees
          </Link>
        </Callout>
      </Card>
    </Container>
  );
}

