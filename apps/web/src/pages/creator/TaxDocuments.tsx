import { useState } from "react";
import { BadgeCheck, CalendarClock, Download, FileText, Info, Package, PencilLine } from "lucide-react";
import { Badge, Button, Callout, Card, Container, KeyValue, Money, PageHeader, Select } from "@/components/brand";
import { TableShell } from "@/components/creator/ui";
import { SOURCES, revenueByMonth } from "@/components/creator/data";
import { formatMoney } from "@/lib/format";

/**
 * Source: FanZuP TaxCenter.tsx, rebuilt for artists (CONSOLIDATION "/settings/tax", Mechanism 05 §4).
 * Doc-driven changes: removed "Automated Revenue Harvesting", "Run Annual Harvest", "Institutional Tax Center" and
 * "Compliance Automated" claims; 1099-MISC → 1099-NEC (or 1099-K from the payment processor, depending on how
 * you're paid) for platform payouts of $600+. Added W-9 status, monthly statements and a sales-tax note for
 * physical perks/merch. Copy is product guidance, not tax advice.
 */
const FORMS = [
  { year: 2026, form: "1099-NEC", status: "in_progress" as const, amountMinor: null, available: "By Jan 31, 2027" },
  { year: 2025, form: "1099-NEC", status: "ready" as const, amountMinor: 4_318_600, available: "Issued Jan 28, 2026" },
  { year: 2024, form: "1099-NEC", status: "ready" as const, amountMinor: 1_942_250, available: "Issued Jan 30, 2025" },
];

export default function TaxDocuments() {
  const [year, setYear] = useState("2026");
  const months = revenueByMonth.filter((m) => m.month.startsWith(year));

  return (
    <Container size="xl" className="py-8 sm:py-10">
      <PageHeader
        eyebrow="Tax documents"
        title="Tax documents"
        description="Your tax forms, payout statements and the details we report to the IRS. We're not tax advisers — share these with yours."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Forms */}
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Year-end forms</h2>
              <p className="text-sm text-muted">
                If we paid you <span className="num">$600</span> or more in a calendar year, you'll get a 1099-NEC from FanZuP — or a 1099-K from our
                payment processor instead, depending on how you're paid. Campaign proceeds released to you count as income.
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {FORMS.map((f) => (
                <li key={f.year} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                      <FileText className="size-5" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-fg">
                        <span className="num">{f.year}</span> · Form {f.form}
                      </span>
                      <span className="text-xs text-muted">
                        {f.amountMinor !== null ? (
                          <>
                            Reported: <Money minor={f.amountMinor} cents className="text-fg" /> · {f.available}
                          </>
                        ) : (
                          f.available
                        )}
                      </span>
                    </div>
                  </div>
                  {f.status === "ready" ? (
                    <Button variant="secondary" size="sm" aria-label={`Download ${f.year} ${f.form}`}>
                      <Download /> Download PDF
                    </Button>
                  ) : (
                    <Badge tone="warning" icon={<CalendarClock />}>
                      Year in progress
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {/* Statements */}
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">Monthly statements</h2>
                <p className="text-sm text-muted">Gross sales, processing fees and payouts by month.</p>
              </div>
              <Select aria-label="Statement year" value={year} onChange={(e) => setYear(e.target.value)} className="sm:w-32">
                <option value="2026">2026</option>
                <option value="2025">2025</option>
              </Select>
            </div>
            <div className="hidden sm:block">
              <TableShell>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Gross</th>
                    <th className="text-right">Sources</th>
                    <th className="text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((m) => (
                    <tr key={m.month}>
                      <td className="text-fg">
                        {m.label} <span className="num">{m.month.slice(0, 4)}</span>
                      </td>
                      <td className="num text-right text-fg">{formatMoney(m.total)}</td>
                      <td className="num text-right text-muted">{SOURCES.filter((s) => m.bySource[s] > 0).length}</td>
                      <td className="text-right">
                        <span className="inline-flex gap-1">
                          <Button variant="ghost" size="sm" aria-label={`Download ${m.label} ${m.month.slice(0, 4)} statement as PDF`}>
                            PDF
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={`Download ${m.label} ${m.month.slice(0, 4)} statement as CSV`}>
                            CSV
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
            <ul className="flex flex-col divide-y divide-line sm:hidden">
              {[...months].reverse().map((m) => (
                <li key={m.month} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex flex-col">
                    <span className="text-sm text-fg">
                      {m.label} <span className="num">{m.month.slice(0, 4)}</span>
                    </span>
                    <span className="num text-xs text-muted">{formatMoney(m.total)}</span>
                  </span>
                  <Button variant="ghost" size="sm" aria-label={`Download ${m.label} statement`}>
                    <Download /> PDF
                  </Button>
                </li>
              ))}
            </ul>
            {year === "2025" && <p className="text-xs text-muted">Statements before October 2025 are available on request from support.</p>}
          </Card>

          <Callout tone="info" icon={<Package />} title="Sales tax on physical perks and merch">
            Physical perks (posters, vinyl) and merch can be subject to sales tax in the state they ship to. Your statements break out shipped items
            by destination state so you or your accountant can work out what's owed. Digital perks and experiences may be treated differently — check
            the rules where you operate.
          </Callout>
        </div>

        <aside className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Tax information</h2>
              <Badge tone="success" icon={<BadgeCheck />}>
                W-9 on file
              </Badge>
            </div>
            <div>
              <KeyValue k="Legal name" v="Nova Reyes Music LLC" />
              <KeyValue k="Tax classification" v="Single-member LLC" />
              <KeyValue k="EIN" v={<span className="num">••-•••4410</span>} />
              <KeyValue k="Address" v="Atlanta, GA" />
              <KeyValue k="Submitted" v={<span className="num">Mar 3, 2026</span>} />
            </div>
            <Button variant="secondary" size="sm">
              <PencilLine /> Update W-9
            </Button>
            <p className="text-xs text-muted">Changes to your legal name or EIN apply to the current tax year's form.</p>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Key dates</h2>
            <KeyValue k="2026 forms available" v={<span className="num">Jan 31, 2027</span>} />
            <KeyValue k="W-9 last confirmed" v={<span className="num">Mar 3, 2026</span>} />
          </Card>

          <Callout tone="gold" icon={<Info />} title="Backers don't get tax forms">
            Fans who back your reward campaigns are buying perks, so they don't receive tax forms from FanZuP for it.
          </Callout>
        </aside>
      </div>
    </Container>
  );
}
