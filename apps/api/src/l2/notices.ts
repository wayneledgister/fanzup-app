/**
 * Layer 2 notices (CR-002). Outbox topic `l2.notify` → notifications rows (template + version + user id, never the
 * address) → transport. Copy follows Brand §7.4: payouts are "potential" and paired with risk; nothing implies
 * liquidity or a guaranteed outcome. `pnpm lint:copy` scans this file with the Layer 2 rule set.
 * Every message carries the demo footer while Layer 2 runs on mock rails.
 */
import { asService, n, type Sql } from "../db";
import { formatUsd } from "../lib/format";
import { log } from "../log";

export const L2_DEMO_FOOTER = "Demo — not an offer of securities. Mock escrow and data. No real money moved.";

export const L2_TEMPLATES = {
  l2_kyc_result: 1,
  l2_investment_funded: 1,
  l2_funding_returned: 1,
  l2_pool_funded: 1,
  l2_pool_failed: 1,
  l2_refund_completed: 1,
  l2_collection_state: 1,
  l2_distribution_paid: 1,
} as const;
export type L2TemplateId = keyof typeof L2_TEMPLATES;

const STATE_COPY: Record<string, string> = {
  COLLECTING: "Royalties are being collected as expected.",
  AT_RISK: "A royalty payment is late or short. The artist has been contacted, and potential payouts may be smaller or delayed.",
  DEFAULT: "Royalties weren't paid within the cure period. The Pool is in default. Your claim is unsecured and recovery isn't assured.",
  REMEDIATION: "The Pool is in remediation: a plan to resume payments is being worked out with the artist.",
  CHARGED_OFF: "Collection has stopped and the claim has been written off. Further payouts are unlikely.",
};

export function renderL2(t: L2TemplateId, v: Record<string, string | number | null>) {
  const footer = `\n\n${L2_DEMO_FOOTER}`;
  switch (t) {
    case "l2_kyc_result":
      return {
        subject: v.status === "approved" ? "Your identity is verified" : v.status === "manual_review" ? "Your identity check needs a closer look" : "We couldn't verify your identity",
        text: `Your investor identity check result: ${v.status}.${footer}`,
      };
    case "l2_investment_funded":
      return {
        subject: `Your money for ${v.pool} is in escrow`,
        text: `Your ${v.amount} for ${v.units} Units of ${v.pool} is held in the offering's escrow account, not by FanZuP or the artist. If the offering reaches its target by the deadline, your Units are issued; if not, you're refunded in full. You can cancel until 48 hours before the deadline.\n\nThis is a risky investment. You could lose all of it, and Units can't be resold for 12 months.${footer}`,
      };
    case "l2_funding_returned":
      return { subject: `Your payment for ${v.pool} was returned`, text: `Your bank returned the ${v.amount} payment for ${v.pool}, so no Units were reserved for you. Nothing was charged.${footer}` };
    case "l2_pool_funded":
      return {
        subject: `${v.pool} reached its target`,
        text: `${v.pool} closed at its target and Units have been issued. Units can't be resold for 12 months. Any payouts are potential: they depend on royalties actually collected, are capped, and may be zero.${footer}`,
      };
    case "l2_pool_failed":
      return { subject: `${v.pool} didn't reach its target — you're being refunded`, text: `${v.pool} didn't reach its target by the deadline, so every investor is refunded in full from escrow. Your refund of ${v.amount} has started.${footer}` };
    case "l2_refund_completed":
      return { subject: `Refund complete: ${v.pool}`, text: `Your refund of ${v.amount} for ${v.pool} is complete. Reference: ${v.ref}.${footer}` };
    case "l2_collection_state":
      return { subject: `${v.pool}: collection status is now ${v.state}`, text: `${STATE_COPY[String(v.state)] ?? ""}${footer}` };
    case "l2_distribution_paid":
      return {
        subject: `A distribution from ${v.pool} was paid`,
        text: `${v.amount} from ${v.pool} (${v.label}) was paid to you. Past distributions don't predict future ones; the Pool's total payouts are capped and may stop at any time.${footer}`,
      };
  }
}

async function send(sql: Sql, template: L2TemplateId, subjectId: string, recipients: { userId: string; vars: Record<string, string | number | null> }[], dedupeSuffix = "") {
  for (const r of recipients) {
    const [row] = await asService(sql, (tx) => tx<{ id: string }[]>`
      insert into public.notifications (template, template_version, user_id, subject_id, dedupe_key, transport)
      values (${template}, ${L2_TEMPLATES[template]}, ${r.userId}, ${subjectId}, ${`${template}:${subjectId}${dedupeSuffix}:${r.userId}`}, 'log')
      on conflict (dedupe_key) do nothing returning id`);
    if (!row) continue;
    const rendered = renderL2(template, r.vars);
    log("info", "notify.sent", { template, subject: rendered.subject });
    await asService(sql, (tx) => tx`update public.notifications set status = 'sent', sent_at = now() where id = ${row.id}`);
  }
}

type InvRow = { investor_id: string; pool: string; amount: bigint; units: number; refund_ref: string | null };
const inv = async (sql: Sql, id: string) =>
  (await asService(sql, (tx) => tx<InvRow[]>`
    select i.investor_id, p.title as pool, i.amount_minor as amount, i.units, i.refund_ref
      from public.investments i join public.pools p on p.id = i.pool_id where i.id = ${id}`))[0];

export async function handleL2Notify(sql: Sql, payload: Record<string, unknown>) {
  const t = String(payload.template);
  switch (t) {
    case "kyc_result":
      return send(sql, "l2_kyc_result", String(payload.user_id), [{ userId: String(payload.user_id), vars: { status: String(payload.status) } }], `:${payload.status}`);
    case "investment_funded":
    case "funding_returned":
    case "refund_completed": {
      const i = await inv(sql, String(payload.investment_id));
      if (!i) return;
      const id: L2TemplateId = t === "investment_funded" ? "l2_investment_funded" : t === "funding_returned" ? "l2_funding_returned" : "l2_refund_completed";
      return send(sql, id, String(payload.investment_id), [{ userId: i.investor_id, vars: { pool: i.pool, amount: formatUsd(n(i.amount)), units: i.units, ref: i.refund_ref } }]);
    }
    case "pool_funded":
    case "pool_failed": {
      const id = String(payload.pool_id);
      const rows = await asService(sql, (tx) => tx<{ user_id: string; pool: string; amount: bigint }[]>`
        select i.investor_id as user_id, p.title as pool, sum(i.amount_minor) as amount
          from public.investments i join public.pools p on p.id = i.pool_id
         where i.pool_id = ${id} and i.status in ('issued', 'refund_pending', 'refunded') group by i.investor_id, p.title
        union
        select a.owner_id, p.title, 0 from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${id}`);
      return send(sql, t === "pool_funded" ? "l2_pool_funded" : "l2_pool_failed", id, rows.map((r) => ({ userId: r.user_id, vars: { pool: r.pool, amount: formatUsd(n(r.amount)) } })));
    }
    case "collection_state": {
      const id = String(payload.pool_id);
      const rows = await asService(sql, (tx) => tx<{ user_id: string; pool: string }[]>`
        select distinct i.investor_id as user_id, p.title as pool from public.investments i join public.pools p on p.id = i.pool_id
         where i.pool_id = ${id} and i.status = 'issued'
        union
        select a.owner_id, p.title from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${id}`);
      return send(sql, "l2_collection_state", id, rows.map((r) => ({ userId: r.user_id, vars: { pool: r.pool, state: String(payload.to) } })), `:${payload.to}:${payload.at}`);
    }
    case "distribution_paid": {
      const [r] = await asService(sql, (tx) => tx<{ user_id: string; pool: string; amount: bigint; label: string }[]>`
        select d.investor_id as user_id, p.title as pool, d.amount_minor as amount, r.label
          from public.distribution_payouts d join public.pools p on p.id = d.pool_id join public.distribution_runs r on r.id = d.run_id
         where d.id = ${String(payload.payout_id)}`);
      if (!r) return;
      return send(sql, "l2_distribution_paid", String(payload.payout_id), [{ userId: r.user_id, vars: { pool: r.pool, amount: formatUsd(n(r.amount)), label: r.label } }]);
    }
    case "distribution_committed":
      return; // investors are told when their payout is paid, not when it's allocated
    default:
      log("warn", "notify.unknown_l2_template", { template: t });
  }
}
