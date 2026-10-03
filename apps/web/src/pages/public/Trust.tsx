import { Link } from "react-router";
import { BadgeCheck, CircleCheck, CircleX, FileWarning, Landmark, Milestone, PackageCheck, RotateCcw, ShieldCheck, UserCheck } from "lucide-react";
import { Button, Card, Container, EscrowNotice, IconChip, PageHeader, SectionHeading } from "@/components/brand";

/**
 * Source: (new) — Mechanism 05 §2 (reward escrow) as summarized in docs/CONSOLIDATION.md + compliance.tsx copy.
 * Doc-driven notes: no custody/FDIC/"bank-grade" claims and no named escrow partner (none confirmed);
 * FanZuP never holds fan balances (Concerns #5).
 */

const FLOW = [
  { icon: <ShieldCheck />, t: "You back a campaign", d: "You pick a perk and pay. The money goes to our third-party escrow partner — not to FanZuP and not to the artist." },
  { icon: <Landmark />, t: "Funds wait in escrow", d: "Nobody can spend it while the campaign is running. You can see the campaign's progress and deadline the whole time." },
  { icon: <CircleCheck />, t: "Goal met by the deadline", d: "The escrow partner releases the funds for the project — all at once, or in milestones if the artist set them up." },
  { icon: <RotateCcw />, t: "Goal missed", d: "Every backer is refunded automatically to their original payment method. You don't need to ask." },
];

export default function Trust() {
  return (
    <>
      <section className="border-b border-line">
        <Container size="lg" className="py-12 sm:py-16">
          <PageHeader
            eyebrow="Trust & safety"
            title="How money moves on FanZuP"
            description="Backing an artist should feel safe. Here's exactly where your money goes, who can touch it, and what happens if things don't go to plan."
            className="pb-6"
          />
          <EscrowNotice />
        </Container>
      </section>

      <Container size="lg" className="flex flex-col gap-16 py-12 sm:py-16">
        <section>
          <SectionHeading eyebrow="Step by step" title="From your card to the artist's project" />
          <ol className="relative mt-6 grid gap-4 md:grid-cols-2">
            {FLOW.map((s, i) => (
              <li key={s.t}>
                <Card className="flex h-full gap-4">
                  <IconChip tone={i === 3 ? "info" : "gold"}>{s.icon}</IconChip>
                  <div className="flex flex-col gap-1">
                    <span className="num text-xs text-muted">0{i + 1}</span>
                    <h3 className="font-semibold">{s.t}</h3>
                    <p className="text-sm text-muted">{s.d}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <IconChip tone="info">
              <Milestone />
            </IconChip>
            <h2 className="text-xl font-semibold">Milestone release</h2>
            <p className="text-sm text-muted">
              For bigger projects, an artist can choose to have funds released in stages. They define the milestones before launch, and
              each release happens only when that milestone is confirmed. Campaigns using it are labeled on their page.
            </p>
          </Card>
          <Card className="flex flex-col gap-3">
            <IconChip>
              <PackageCheck />
            </IconChip>
            <h2 className="text-xl font-semibold">Perk delivery and disputes</h2>
            <p className="text-sm text-muted">
              Every perk has a delivery estimate you can track from your account. If a perk is late or doesn't arrive, open a dispute from
              Backed & perks — our team reviews it with the artist and steps in when they can't resolve it.
            </p>
          </Card>
        </section>

        <section>
          <SectionHeading eyebrow="Verified artists" title="Who can raise money" />
          <Card className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
            <IconChip className="size-14 [&_svg]:size-7">
              <UserCheck />
            </IconChip>
            <div className="flex flex-col gap-2">
              <p className="text-muted">
                Before an artist can launch a campaign, they verify their identity with our identity-verification partner, confirm their
                email and phone, complete their profile and link at least one released track. Verified artists carry a{" "}
                <span className="inline-flex items-center gap-1 text-success">
                  <BadgeCheck className="size-4" /> Verified
                </span>{" "}
                badge.
              </p>
              <Link to="/for-artists#tiers" className="text-sm font-medium text-gold hover:underline">
                See creator tier requirements →
              </Link>
            </div>
          </Card>
        </section>

        <section>
          <SectionHeading eyebrow="Know what you're getting" title="What backing is — and isn't" />
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2 font-semibold text-success">
                <CircleCheck className="size-5" /> Backing is
              </h3>
              <ul className="flex flex-col gap-2 text-sm text-muted">
                <li>Paying for a perk the artist has promised to deliver</li>
                <li>All-or-nothing: charged only if the goal is met</li>
                <li>Protected by escrow and automatic refunds</li>
                <li>A direct way to fund the work you want to exist</li>
              </ul>
            </Card>
            <Card className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2 font-semibold text-error">
                <CircleX className="size-5" /> Backing isn't
              </h3>
              <ul className="flex flex-col gap-2 text-sm text-muted">
                <li>An investment or a security</li>
                <li>A share of the artist's earnings or ownership of their music</li>
                <li>Money stored in a FanZuP balance — we don't hold balances</li>
                <li>A donation with nothing promised in return</li>
              </ul>
            </Card>
          </div>
        </section>

        <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <IconChip tone="warning">
              <FileWarning />
            </IconChip>
            <div>
              <h2 className="font-semibold">Something not right?</h2>
              <p className="text-sm text-muted">Report a campaign, a missing perk or a suspicious account. A person reviews every report.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button asChild variant="secondary">
              <Link to="/fees">See fees</Link>
            </Button>
            <Button asChild>
              <Link to="/explore">Find campaigns</Link>
            </Button>
          </div>
        </Card>
      </Container>
    </>
  );
}
