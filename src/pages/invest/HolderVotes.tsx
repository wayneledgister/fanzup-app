import { useState } from "react";
import { Link } from "react-router";
import { CalendarClock, CheckCircle2, FileText, Info, Megaphone, Vote } from "lucide-react";
import { Badge, Button, Callout, Card, Container, EmptyState, PageHeader, RegulatoryFooter, SectionHeading } from "@/components/brand";
import { day, holdingViews, SPV_POOLS, TODAY } from "@/components/invest/data";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Source: FanZuP GovernancePortal.tsx — rebuilt as "Holder communications & votes" (Mechanism 03).
 * Changes: on-chain execution, delegation/proxies, slashing, tier-weighted (Galaxy/Supernova) voting,
 * treasury audit log, trustee leaderboard and AI forecasting removed. Only Pools issued through an SPV
 * that passes voting rights through to holders appear; one vote per Unit; For / Against / Abstain.
 * Open question for Wayne (CONSOLIDATION.md): keep this in scope at all.
 */
type Choice = "for" | "against" | "abstain";

const OPEN_VOTE = {
  id: "v-2026-03",
  poolId: "kai-marlo-catalog",
  title: "Approve moving the catalog to a new distributor",
  summary:
    "The SPV manager proposes moving Kai Marlo's catalog to a new distributor from January 2027. The distributor redirect would move with it, so the Pool's share would still be paid directly. No change to the revenue share, cap or maturity.",
  opens: "2026-09-28",
  closes: "2026-10-16",
  notice: "Notice of holder vote — distributor change (PDF, 310 KB)",
};

const NOTICES = [
  { date: "2026-09-28", poolId: "kai-marlo-catalog", title: "Holder vote opened: distributor change", body: "Voting is open until Oct 16, 2026. The official notice explains the proposal and the manager's reasons." },
  { date: "2026-07-03", poolId: "kai-marlo-catalog", title: "Q2 statement and distribution", body: "The Q2 distribution was paid on June 30. The distributor statement is in your documents." },
  { date: "2026-04-15", poolId: "kai-marlo-catalog", title: "SPV annual meeting materials", body: "The SPV's annual report and manager letter for 2025 are available." },
];

const PAST = [{ title: "Appoint the SPV's independent accountant for 2026", closed: "2026-04-30", outcome: "Approved", forPct: 91, againstPct: 4, abstainPct: 5 }];

export default function HolderVotes() {
  const spvHoldings = holdingViews().filter((v) => SPV_POOLS[v.pool.id]);
  const holding = spvHoldings.find((v) => v.pool.id === OPEN_VOTE.poolId);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [submitted, setSubmitted] = useState<Choice | null>(null);
  const [touched, setTouched] = useState(false);
  const daysToClose = Math.ceil((new Date(day(OPEN_VOTE.closes)).getTime() - TODAY.getTime()) / 86_400_000);

  return (
    <Container size="lg" className="flex flex-col gap-10 py-8 sm:py-10">
      <PageHeader
        eyebrow="Holders"
        title="Holder communications & votes"
        description="Notices from the managers of the Pool SPVs you hold, and the occasional vote they're required to put to holders."
        className="pb-0"
      />

      <Callout tone="info" icon={<Info />} title="This only applies to Pools structured through an SPV">
        Some Pools are issued through a special purpose vehicle (SPV) that passes voting rights through to holders. Other Pools don't carry voting
        rights, so they won't appear here. Votes are one vote per Unit and cover only the matters set out in the SPV's documents.
      </Callout>

      {spvHoldings.length === 0 ? (
        <EmptyState icon={<Vote />} title="None of your Pools have holder votes">
          You'll see notices and votes here if you hold Units in an SPV-structured Pool.
        </EmptyState>
      ) : (
        <>
          <section>
            <SectionHeading eyebrow="Open vote" title="Your vote is requested" />
            <Card className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{SPV_POOLS[OPEN_VOTE.poolId]}</Badge>
                  <Badge tone="warning" icon={<CalendarClock />}>
                    Closes {formatDate(day(OPEN_VOTE.closes))} · <span className="num">{daysToClose}d</span> left
                  </Badge>
                </div>
                <h3 className="text-xl font-semibold">{OPEN_VOTE.title}</h3>
                <p className="text-sm text-muted">{OPEN_VOTE.summary}</p>
                <a href="#notice" className="flex w-fit items-center gap-2 text-sm font-medium text-gold hover:underline">
                  <FileText className="size-4" aria-hidden /> {OPEN_VOTE.notice}
                </a>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-surface-2 px-4 py-3 text-sm">
                <span className="text-muted">Your voting power</span>
                <span className="text-fg">
                  <span className="num">{holding?.holding.units ?? 0}</span> Units = <span className="num">{holding?.holding.units ?? 0}</span> votes
                </span>
              </div>

              {submitted ? (
                <div className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success/8 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-fg">
                    <CheckCircle2 className="size-5 text-success" aria-hidden /> You voted <strong className="capitalize">{submitted}</strong>. You can change
                    your vote until the deadline.
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setSubmitted(null)}>
                    Change vote
                  </Button>
                </div>
              ) : (
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-3 text-sm font-medium text-fg">Cast your vote</legend>
                  <div role="radiogroup" aria-label="Your vote" className="grid gap-3 sm:grid-cols-3">
                    {(["for", "against", "abstain"] as Choice[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={choice === c}
                        onClick={() => setChoice(c)}
                        className={cn(
                          "h-12 rounded-md border text-sm font-medium capitalize transition-colors",
                          choice === c ? "border-gold bg-surface-2 text-fg shadow-gold" : "border-line text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {touched && !choice && <p className="text-sm text-error">Choose For, Against or Abstain.</p>}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted">Read the official notice before voting. The result is decided by votes cast before the deadline.</p>
                    <Button
                      onClick={() => {
                        setTouched(true);
                        if (choice) setSubmitted(choice);
                      }}
                    >
                      Submit vote
                    </Button>
                  </div>
                </fieldset>
              )}
            </Card>
          </section>

          <section>
            <SectionHeading eyebrow="Notices" title="From the SPV manager" />
            <ol className="flex flex-col gap-3">
              {NOTICES.map((n) => (
                <li key={n.title}>
                  <Card className="flex gap-4 p-5">
                    <Megaphone className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                    <div className="flex flex-col gap-1">
                      <p className="font-medium text-fg">{n.title}</p>
                      <p className="text-xs text-muted">
                        <span className="num">{formatDate(day(n.date))}</span> · {SPV_POOLS[n.poolId]}
                      </p>
                      <p className="text-sm text-muted">{n.body}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <SectionHeading eyebrow="History" title="Past votes" />
            <Card padded={false} className="divide-y divide-line">
              {PAST.map((p) => (
                <div key={p.title} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-fg">{p.title}</p>
                    <p className="text-xs text-muted">
                      Closed <span className="num">{formatDate(day(p.closed))}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                    <Badge tone="success">{p.outcome}</Badge>
                    <span>
                      For <span className="num text-fg">{p.forPct}%</span> · Against <span className="num text-fg">{p.againstPct}%</span> · Abstain{" "}
                      <span className="num text-fg">{p.abstainPct}%</span>
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        </>
      )}

      <p className="text-sm text-muted">
        Looking for statements or tax forms?{" "}
        <Link to="/portfolio" className="font-medium text-gold hover:underline">
          Go to your Portfolio
        </Link>
      </p>
      <RegulatoryFooter />
    </Container>
  );
}
