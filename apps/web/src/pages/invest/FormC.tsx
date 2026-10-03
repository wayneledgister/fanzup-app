import { Link, useParams } from "react-router";
import { ArrowLeft, FileText } from "lucide-react";
import { Badge, Card, Container, KeyValue, PageHeader, RegulatoryFooter } from "@/components/brand";
import { LoadGate, useLoad } from "@/components/invest/l2ui";
import { l2 } from "@/lib/l2";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Source: (new) CR-002 FR-L2-CR-005. The mock Form C generated from the Pool's data at submission, with its version
 * and SHA-256. It says on its face that it's a demo and was never filed.
 */
export default function FormC() {
  const { id = "" } = useParams();
  const load = useLoad(() => l2.formC(id), [id]);
  return (
    <Container size="lg" className="flex flex-col gap-6 py-8">
      <Link to={`/pools/${id}`} className="flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back to the Pool
      </Link>
      <LoadGate load={load} what="the Form C">
        {(d) => <Doc d={d} />}
      </LoadGate>
      <RegulatoryFooter />
    </Container>
  );
}

type Body = {
  notice?: string; issuer?: { name: string; creatorTier: string }; intermediary?: string;
  offering?: Record<string, string | number>; project?: { album: string; artist: string; plannedRelease: string | null; tracklist: string[]; story: string };
  useOfFunds?: { label: string; amountMinor: number }[]; milestones?: { seq: number; pct: number; milestone: string | null; targetDate: string | null }[];
  revenueShare?: { revenueTypes: { label: string; note: string | null }[]; split: { fansBps: number; creatorBps: number; platformBps: number; platformNote: string }; returnCapMultiple: number; maturityMonths: number; distributions: string };
  collection?: { mechanism: string; badge: string; explanation: string }; tax?: { characterization: string }; riskFactors?: string[];
};

function Doc({ d }: { d: { title: string; version: number; sha256: string; createdAt: string; body: Record<string, unknown> } }) {
  const b = d.body as Body;
  const money = (k: string) => (typeof b.offering?.[k] === "number" ? formatMoney(b.offering[k] as number) : "—");
  return (
    <>
      <PageHeader eyebrow="Form C (mock)" title={d.title} description={b.notice ?? "Demo document. Not filed."} />
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="warning" icon={<FileText />}>Not filed — demo</Badge>
        <Badge tone="neutral">Version <span className="num">{d.version}</span></Badge>
        <Badge tone="neutral">Created <span className="num">{formatDate(d.createdAt)}</span></Badge>
        <span className="num break-all text-muted">SHA-256 {d.sha256}</span>
      </div>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Issuer and intermediary</h2>
        <dl className="divide-y divide-line">
          <KeyValue k="Issuer" v={b.issuer?.name ?? "—"} />
          <KeyValue k="Creator tier" v={b.issuer?.creatorTier ?? "—"} />
          <KeyValue k="Intermediary" v={b.intermediary ?? "—"} />
        </dl>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">The offering</h2>
        <dl className="divide-y divide-line">
          <KeyValue k="Security" v={String(b.offering?.securityType ?? "")} />
          <KeyValue k="Units" v={<span className="num">{String(b.offering?.units ?? "")}</span>} />
          <KeyValue k="Unit price" v={<span className="num">{money("unitPriceMinor")}</span>} />
          <KeyValue k="Target / maximum" v={<span className="num">{money("targetMinor")} / {money("maximumMinor")}</span>} />
          <KeyValue k="If the target isn't met" v={String(b.offering?.targetOrRefund ?? "")} />
          <KeyValue k="Cancellation" v={String(b.offering?.cancellation ?? "")} />
          <KeyValue k="Resale" v={String(b.offering?.resale ?? "")} />
        </dl>
      </Card>
      {b.revenueShare && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Revenue share</h2>
          <dl className="divide-y divide-line">
            <KeyValue k="Covered revenue" v={b.revenueShare.revenueTypes.map((t) => t.label + (t.note ? ` (${t.note})` : "")).join(", ")} />
            <KeyValue k="Split (fans / artist / platform)" v={<span className="num">{b.revenueShare.split.fansBps / 100}% / {b.revenueShare.split.creatorBps / 100}% / {b.revenueShare.split.platformBps / 100}%</span>} />
            <KeyValue k="Return cap" v={<span className="num">{b.revenueShare.returnCapMultiple}×</span>} />
            <KeyValue k="Maturity" v={<span className="num">{b.revenueShare.maturityMonths} months</span>} />
            <KeyValue k="Distributions" v={b.revenueShare.distributions} />
          </dl>
          <p className="mt-2 text-xs text-muted">{b.revenueShare.split.platformNote}</p>
        </Card>
      )}
      {b.collection && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Collection</h2>
          <p className="text-sm text-muted">{b.collection.explanation}</p>
        </Card>
      )}
      {b.useOfFunds && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Use of funds and milestones</h2>
          <dl className="divide-y divide-line">
            {b.useOfFunds.map((u) => <KeyValue key={u.label} k={u.label} v={<span className="num">{formatMoney(u.amountMinor)}</span>} />)}
          </dl>
          <ul className="mt-3 list-disc pl-5 text-sm text-muted">
            {(b.milestones ?? []).map((m) => <li key={m.seq}><span className="num">{m.pct}%</span> — {m.milestone}</li>)}
          </ul>
        </Card>
      )}
      {b.riskFactors && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Risk factors</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{b.riskFactors.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
      )}
      {b.tax && <p className="text-sm text-muted">Tax: {b.tax.characterization}</p>}
    </>
  );
}
