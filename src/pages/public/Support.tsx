import { LifeBuoy, Mail, RotateCcw, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { Card, Container, IconChip, PageHeader } from "@/components/brand";

/** Source: new. Help entry point for refunds, perk problems, verification and account issues. */
const TOPICS = [
  { icon: <RotateCcw />, t: "Refunds", d: "If a campaign misses its goal, every backer is refunded automatically. Questions about a refund?", to: "/trust" },
  { icon: <LifeBuoy />, t: "A perk hasn't arrived", d: "Report a missing or damaged perk from Backed & perks, and we'll follow up with the artist.", to: "/backed?tab=perks" },
  { icon: <ShieldCheck />, t: "Identity verification", d: "Help with verifying your identity or a rejected verification.", to: "/trust" },
];

export default function Support() {
  return (
    <Container size="lg" className="py-16">
      <PageHeader eyebrow="Support" title="How can we help?" description="Pick a topic, or email us and a person will get back to you." />
      <div className="grid gap-6 md:grid-cols-3">
        {TOPICS.map((x) => (
          <Card key={x.t} interactive>
            <Link to={x.to} className="flex flex-col gap-3">
              <IconChip>{x.icon}</IconChip>
              <h2 className="text-lg font-semibold">{x.t}</h2>
              <p className="text-sm text-muted">{x.d}</p>
            </Link>
          </Card>
        ))}
      </div>
      <Card className="mt-8 flex items-center gap-4">
        <IconChip>
          <Mail />
        </IconChip>
        <p className="text-sm text-muted">
          Email <span className="text-fg">support@fanzup.example</span> — support address to be confirmed before launch.
        </p>
      </Card>
    </Container>
  );
}
