import { Link } from "react-router";
import { ArrowRight, BadgeCheck, Compass, FileText, LineChart, Scale } from "lucide-react";
import { Badge, Button, Callout, Card, Container, IconChip } from "@/components/brand";

/**
 * Source: Fan Profile Setup src/pages/kyc/KYCOutcomeApproved.tsx (wireframe).
 * Changes: "equity stakes", "equity holder perks", "voting rights" and "priority drops" removed —
 * perks are never tied to holding Units (CONSOLIDATION.md) and Pools are revenue-share, not equity.
 * Confetti dropped for a calm money-screen tone (Brand §7.2); the next step is setting a Reg CF limit.
 */
const UNLOCKED = [
  { icon: <Compass />, t: "Browse Pools", d: "See open Reg CF offerings with their full terms, risks and Form C." },
  { icon: <Scale />, t: "Invest within your limit", d: "Buy Units in a Pool, up to your 12-month Reg CF limit." },
  { icon: <LineChart />, t: "Track your Portfolio", d: "Units held, distributions received and lock-up dates in one place." },
  { icon: <FileText />, t: "Annual documents", d: "Issuer reports and tax forms for any Pools you hold." },
];

export default function KycOutcomeApproved() {
  return (
    <Container size="md" className="flex flex-col gap-8 py-10">
      <Link to="/settings" className="text-sm text-muted hover:text-fg">
        ← Settings
      </Link>

      <Card className="relative flex flex-col items-center gap-4 overflow-hidden py-12 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-success/10 blur-3xl" />
        <div className="relative flex size-16 items-center justify-center rounded-full border border-success/30 bg-success/12 text-success">
          <BadgeCheck className="size-8" aria-hidden />
        </div>
        <Badge tone="success">Identity verified</Badge>
        <h1 className="relative text-3xl font-bold">You're verified</h1>
        <p className="relative max-w-md text-muted">Thanks, Jordan. Investing is now open on your account. One more step: set your 12-month Reg CF limit.</p>
        <div className="relative mt-2 flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <Link to="/investor/certification">
              Set my investment limit <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/pools">Browse Pools</Link>
          </Button>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Now available to you</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {UNLOCKED.map((u) => (
            <Card key={u.t} className="flex gap-4 p-5">
              <IconChip>{u.icon}</IconChip>
              <div className="flex flex-col gap-1">
                <p className="font-semibold text-fg">{u.t}</p>
                <p className="text-sm text-muted">{u.d}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Callout tone="info" title="Investing is optional">
        Being verified doesn't commit you to anything. Every Pool is risky and illiquid — read its Form C and risk disclosures before you decide.
      </Callout>
    </Container>
  );
}
