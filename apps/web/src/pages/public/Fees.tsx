import { Link } from "react-router";
import { CreditCard, Gift, Heart, Landmark, Coffee, Shirt, ExternalLink, Info } from "lucide-react";
import { Badge, Callout, Card, Container, IconChip, KeyValue, PageHeader, SectionHeading, WhenFlag } from "@/components/brand";
import { formatMoney } from "@/lib/format";

/**
 * Source: FanZuP PlatformFeeTransparency.tsx, rebuilt with numbers from docs/brand/fees.html.
 * Doc-driven changes: the mockup's $99 / 2.5% / 1.5% / $10 rates and USDC / cold-storage / smart-contract copy are
 * dropped. Only the Stripe pass-through (2.9% + $0.30) is known; every platform rate is "Being finalized".
 * Broker-dealer fees appear only behind `layer2`. Competitor benchmarks and internal next steps are not shown publicly.
 */

const FEES = [
  { icon: <Gift />, name: "Campaign platform fee", rate: null, who: "Artist", d: "A percentage of a successfully funded campaign, taken when funds are released from escrow. Never charged on campaigns that miss their goal." },
  { icon: <Heart />, name: "Subscriptions", rate: null, who: "Artist", d: "A share of subscription payments. The artist receives the rest, minus card processing." },
  { icon: <Coffee />, name: "Tips", rate: null, who: "Artist", d: "A small processing fee on tips may apply. We're considering waiving it for Starter artists." },
  { icon: <Shirt />, name: "Merch sold on FanZuP", rate: null, who: "Artist", d: "A commission on merch sold through FanZuP checkout. Print-on-demand costs are passed through at cost." },
  { icon: <ExternalLink />, name: "Link-out merch", rate: "No commission", who: "—", d: "When an artist links to their own store, the sale happens there. FanZuP takes nothing." },
  { icon: <CreditCard />, name: "Card processing", rate: "2.9% + $0.30", who: "Artist, at cost", d: "Our payment processor's standard rate, passed through at cost on every payment. Not FanZuP revenue." },
] as const;

export default function Fees() {
  const example = 5000; // $50 backing
  const processing = Math.round(example * 0.029 + 30);

  return (
    <Container size="lg" className="py-12 sm:py-16">
      <PageHeader
        eyebrow="Fees"
        title="What FanZuP costs — in plain numbers"
        description="We'd rather tell you a number is still being decided than publish one we'll change later. Here's what's set and what isn't."
      />

      <Callout tone="warning" icon={<Info />} title="Platform fees are being finalized">
        Our finance and legal teams are still setting FanZuP's platform rates. Every fee will be shown to artists before they launch and
        to fans before they pay. No fee will ever be added after a payment.
      </Callout>

      <section className="mt-12">
        <SectionHeading eyebrow="Fee schedule" title="Every fee, in one place" />
        <div className="grid gap-4 md:grid-cols-2">
          {FEES.map((f) => (
            <Card key={f.name} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <IconChip tone={f.rate ? "gold" : "muted"}>{f.icon}</IconChip>
                  <h3 className="font-semibold">{f.name}</h3>
                </div>
                {f.rate ? <span className={f.rate.includes("%") ? "num shrink-0 text-right text-lg font-medium text-fg" : "shrink-0 text-right font-semibold text-success"}>{f.rate}</span> : <Badge tone="warning">Being finalized</Badge>}
              </div>
              <p className="text-sm text-muted">{f.d}</p>
              <p className="text-xs text-muted">
                Paid by: <span className="text-fg">{f.who}</span>
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <SectionHeading eyebrow="Example" title="A fan backs a campaign with $50" className="mb-2" />
          <KeyValue k="Fan pays" v={<span className="num">{formatMoney(example, { cents: true })}</span>} />
          <KeyValue k="Card processing (2.9% + $0.30)" v={<span className="num">−{formatMoney(processing, { cents: true })}</span>} />
          <KeyValue k="FanZuP platform fee" v={<span className="text-warning">Being finalized</span>} />
          <KeyValue k="Artist receives (if the goal is met)" v={<span className="num">{formatMoney(example - processing, { cents: true })} minus platform fee</span>} />
          <p className="mt-2 text-sm text-muted">
            Fans pay the perk price shown — nothing is added at checkout. If the campaign misses its goal, the full amount is refunded
            automatically and no fees are taken.
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <SectionHeading eyebrow="What we never charge" title="No surprises" className="mb-2" />
          <ul className="flex flex-col gap-2 text-sm text-muted">
            <li>No fee on campaigns that don't reach their goal.</li>
            <li>No commission on merch sold through an artist's own store.</li>
            <li>No fee to create an account, follow artists, or browse.</li>
            <li>No stored balance — so no withdrawal or account fees.</li>
          </ul>
          <Link to="/trust" className="mt-auto text-sm font-medium text-gold hover:underline">
            How money moves on FanZuP →
          </Link>
        </Card>
      </section>

      <WhenFlag flag="layer2">
        <section className="mt-12">
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <IconChip tone="info">
                <Landmark />
              </IconChip>
              <h2 className="text-xl font-semibold">Investment Pools (Regulation Crowdfunding)</h2>
            </div>
            <p className="text-sm text-muted">
              Pools are offered through a FINRA-registered intermediary, which charges its own fee separate from FanZuP's. Every fee for a
              Pool — FanZuP's, the intermediary's, any referral compensation and card processing — is disclosed in that Pool's Form C
              before it opens.
            </p>
          </Card>
        </section>
      </WhenFlag>

      <p className="mt-12 text-xs text-muted">
        Last reviewed October 2026. Rates marked "Being finalized" will be published here before launch.
      </p>
    </Container>
  );
}
