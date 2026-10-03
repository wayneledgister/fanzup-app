import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowRight, CheckCircle2, Download, FileText, Landmark, Lock, Mail, RotateCcw, Undo2, XCircle } from "lucide-react";
import { Badge, Button, Callout, Card, Container, IconChip, KeyValue, RegulatoryFooter } from "@/components/brand";
import { CancellationNotice, OfferingEscrowNotice, PoolNotFound } from "@/components/invest/ui";
import { addHours, addMonths, day, DEMO_INVESTOR, TODAY } from "@/components/invest/data";
import { poolById, type Pool } from "@/lib/mock";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: Fan Profile Setup src/pages/investment/InvestmentConfirmation.tsx (wireframe).
 * Changes: "Investment complete" → "submitted" (funds sit in escrow until the offering closes);
 * "shares / cap table / ownership stake" replaced with Units recorded by the transfer agent; adds the
 * Reg CF 48-hour cancellation right with a working cancel flow (?state=cancelled shows the result).
 */
const fmtDateTime = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

export default function InvestmentConfirmation() {
  const { id = "" } = useParams();
  const pool = poolById(id);
  if (!pool) return <PoolNotFound />;
  return <Confirmation pool={pool} />;
}

function Confirmation({ pool }: { pool: Pool }) {
  const [params] = useSearchParams();
  const units = Math.max(1, Math.floor(Number(params.get("units")) || 1));
  const total = units * pool.unitPriceMinor;
  const ref = `INV-${pool.id.slice(0, 4).toUpperCase()}-${String(20261002 + units).slice(-6)}`;
  const cancelBy = fmtDateTime(addHours(pool.endsOn, -48));
  const [state, setState] = useState<"submitted" | "confirm-cancel" | "cancelled">(params.get("state") === "cancelled" ? "cancelled" : "submitted");

  if (state === "cancelled") {
    return (
      <Container size="md" className="flex flex-col gap-8 py-10">
        <Card className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full border border-line bg-surface-2 text-muted">
            <XCircle className="size-7" aria-hidden />
          </div>
          <Badge tone="neutral">Cancelled</Badge>
          <h1 className="text-3xl font-bold">Your investment is cancelled</h1>
          <p className="max-w-md text-muted">
            <span className="num text-fg">{formatMoney(total)}</span> is being returned to {DEMO_INVESTOR.paymentMethod}. Refunds usually arrive within 5–10 business days.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link to="/pools">Browse Pools</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/portfolio">Go to Portfolio</Link>
            </Button>
          </div>
        </Card>
        <p className="text-center text-sm text-muted">
          Reference <span className="num text-fg">{ref}</span>
        </p>
      </Container>
    );
  }

  return (
    <Container size="md" className="flex flex-col gap-8 py-10">
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-success/30 bg-success/12 text-success">
          <CheckCircle2 className="size-7" aria-hidden />
        </div>
        <Badge tone="warning">Held in escrow</Badge>
        <h1 className="text-3xl font-bold">Your investment is submitted</h1>
        <p className="max-w-md text-muted">
          Your money is held in escrow until <span className="text-fg">{pool.title}</span> closes. Nothing is final until then.
        </p>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Receipt</h2>
        <Card>
          <dl className="divide-y divide-line">
            <KeyValue k="Pool" v={pool.title} />
            <KeyValue k="Units" v={<span className="num">{units}</span>} />
            <KeyValue k="Unit price" v={<span className="num">{formatMoney(pool.unitPriceMinor, { cents: true })}</span>} />
            <KeyValue k="Total committed" v={<span className="num text-base font-medium">{formatMoney(total, { cents: true })}</span>} />
            <KeyValue k="Payment method" v={DEMO_INVESTOR.paymentMethod} />
            <KeyValue k="Submitted" v={<span className="num">{fmtDateTime(TODAY)}</span>} />
            <KeyValue k="Offering closes" v={<span className="num">{formatDate(day(pool.endsOn))}</span>} />
            <KeyValue k="Cancel by" v={<span className="num">{cancelBy}</span>} />
            <KeyValue k="Reference" v={<span className="num">{ref}</span>} />
          </dl>
        </Card>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Mail className="size-4 shrink-0" aria-hidden /> We've emailed this receipt and your signed documents.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">What happens next</h2>
        <ol className="flex flex-col gap-4">
          {[
            { i: <Landmark />, t: "Your money waits in escrow", d: "The intermediary's escrow agent holds it — not FanZuP and not the artist. Your payment may take 1–3 business days to clear." },
            { i: <Undo2 />, t: "You can still change your mind", d: `Cancel any time until ${cancelBy} and get a full refund.` },
            {
              i: <RotateCcw />,
              t: "If the offering closes successfully",
              d: "Your Units are issued and recorded by the transfer agent, and they appear in your Portfolio. If it doesn't reach its target, you're refunded in full.",
            },
            { i: <Lock />, t: "The 12-month lock-up starts", d: `Your Units can't be resold until about ${formatDate(day(addMonths(pool.endsOn, 12)))}, and there's no marketplace after that.` },
          ].map((s, n) => (
            <li key={s.t} className="flex gap-4">
              <IconChip tone={n === 0 ? "gold" : "muted"}>{s.i}</IconChip>
              <div>
                <p className="font-medium text-fg">{s.t}</p>
                <p className="text-sm text-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <OfferingEscrowNotice />
      <CancellationNotice cancelBy={cancelBy} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your documents</h2>
        <Card padded={false} className="divide-y divide-line">
          {["Signed subscription agreement", "Form C", "Risk factors"].map((d) => (
            <div key={d} className="flex items-center gap-4 px-5 py-4">
              <FileText className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="flex-1 text-sm text-fg">{d}</span>
              <Button variant="ghost" size="sm" aria-label={`Download ${d}`}>
                <Download />
              </Button>
            </div>
          ))}
        </Card>
      </section>

      {state === "confirm-cancel" ? (
        <Callout tone="error" title="Cancel this investment?">
          <p>
            Your <span className="num text-fg">{formatMoney(total)}</span> will be returned in full and your Units won't be issued.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button variant="destructive" onClick={() => setState("cancelled")}>
              Yes, cancel investment
            </Button>
            <Button variant="secondary" onClick={() => setState("submitted")}>
              Keep my investment
            </Button>
          </div>
        </Callout>
      ) : (
        <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={() => setState("confirm-cancel")}>
            Cancel investment
          </Button>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="secondary">
              <Link to="/pools">Browse Pools</Link>
            </Button>
            <Button asChild>
              <Link to="/portfolio">
                View Portfolio <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      )}

      <RegulatoryFooter />
    </Container>
  );
}
