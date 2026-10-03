import { Link } from "react-router";
import { ArrowRight, Bell, Compass, Gift, PartyPopper } from "lucide-react";
import { Button, Card, IconChip } from "@/components/brand";
import { CampaignCard } from "@/components/public/cards";
import { OnboardingHeader } from "@/components/public/onboarding";
import { campaigns } from "@/lib/mock";

/**
 * Source: routes.tsx stub — celebration + "Go to your feed" CTA.
 * Adds three next steps and one live campaign suggestion (Layer 1 only).
 */
export default function Complete() {
  const pick = campaigns.find((c) => c.status === "live")!;
  return (
    <div>
      <OnboardingHeader step={6} />
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative">
          <div aria-hidden className="absolute inset-0 rounded-full bg-gold/20 blur-2xl" />
          <IconChip className="relative size-16 [&_svg]:size-8">
            <PartyPopper />
          </IconChip>
        </div>
        <h1 className="text-3xl font-bold sm:text-4xl">You're in.</h1>
        <p className="max-w-md text-muted">Your FanZuP account is ready. Here's where to start.</p>
        <Button asChild size="lg" className="mt-2">
          <Link to="/home">
            Go to your feed <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { icon: <Compass />, t: "Discover", d: "Browse live campaigns by sound and city.", to: "/explore" },
          { icon: <Bell />, t: "Follow artists", d: "Hear first when they launch or drop tickets.", to: "/explore" },
          { icon: <Gift />, t: "Track perks", d: "Everything you back lives in Backed & perks.", to: "/backed" },
        ].map((x) => (
          <Link key={x.t} to={x.to} className="group">
            <Card interactive className="flex h-full flex-col gap-3 p-5">
              <IconChip tone="muted">{x.icon}</IconChip>
              <p className="font-semibold">{x.t}</p>
              <p className="text-sm text-muted">{x.d}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mx-auto mt-12 max-w-sm">
        <p className="eyebrow mb-3 text-center">A campaign to start with</p>
        <CampaignCard campaign={pick} />
      </div>
    </div>
  );
}
