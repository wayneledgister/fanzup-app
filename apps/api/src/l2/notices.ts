/**
 * Layer 2 notices (CR-002; design §5.2). Outbox topic `l2.notify` (queued by the SQL money functions in the same
 * transaction as the event, or by the API) → notifications rows (template + version + user id, never the address) →
 * transport. Copy follows Brand §7.4: payouts are "potential" and paired with risk; nothing implies liquidity or a
 * guaranteed outcome. Every template ends with `L2_DEMO_FOOTER`, which carries the D-2 sentence verbatim (round 5,
 * finding 6; checked by `lint:copy` in PR #13 and by the API tests).
 *
 * In production these obligations (227.303(d) commitment notice, 227.303(f) confirmation, 227.304 cancellation and
 * failed-offering notices) are the intermediary's (L2-Q3, L2-Q9); the demo performs them through this one path.
 */
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql } from "../db";
import { formatUsd } from "../lib/format";
import { log } from "../log";

/** The D-2 demo sentence, verbatim (design §5.2). */
export const L2_DEMO_LINE = "Demo — not an offer of securities. Mock escrow and data.";
export const L2_DEMO_FOOTER = `${L2_DEMO_LINE} No real money moved.`;

export const L2_TEMPLATES = {
  l2_kyc_result: 1,
  l2_commitment_received: 1,
  l2_investment_funded: 1,
  l2_cancel_pending: 1,
  l2_investment_cancelled: 1,
  l2_payment_refunded_unapplied: 1,
  l2_funding_returned: 1,
  l2_units_issued: 1,
  l2_pool_funded: 1,
  l2_pool_failed: 1,
  l2_pool_failed_creator: 1,
  l2_refund_completed: 1,
  l2_collection_state: 1,
  l2_pool_matured: 1,
  l2_distribution_paid: 1,
} as const;
export type L2TemplateId = keyof typeof L2_TEMPLATES;
type Vars = Record<string, string | number | boolean | null | undefined>;

const STATE_COPY: Record<string, string> = {
  COLLECTING: "Royalties are being collected as expected.",
  AT_RISK: "A royalty payment is late or short. The artist has been contacted, and potential payouts may be smaller or delayed.",
  DEFAULT: "Royalties weren't paid within the cure period. The Pool is in default. Your claim is unsecured and recovery isn't assured.",
  REMEDIATION: "The Pool is in remediation: a plan to resume payments is being worked out with the artist.",
  CHARGED_OFF: "Collection has stopped and the claim has been written off. Further payouts are unlikely.",
};

const UNAPPLIED_REASON: Record<string, string> = {
  reservation_expired: "your reservation had expired before the payment arrived",
  reservation_cancelled: "the reservation had been cancelled before the payment arrived",
  offering_closed: "the offering had already closed when the payment arrived",
  amount_mismatch: "the amount received didn't match your commitment",
};

const when = (iso: unknown) => {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? String(iso ?? "") : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const day = (iso: unknown) => {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? String(iso ?? "") : d.toISOString().slice(0, 10);
};

export function renderL2(t: L2TemplateId, v: Vars): { subject: string; text: string } {
  const footer = `\n\n${L2_DEMO_FOOTER}`;
  switch (t) {
    case "l2_kyc_result":
      return {
        subject: v.status === "approved" ? "Your identity is verified" : v.status === "manual_review" ? "Your identity check needs a closer look" : "We couldn't verify your identity",
        text: `Your investor identity check result: ${v.status}.${footer}`,
      };
    // 17 CFR 227.303(d): amount, price, Units, issuer, and the date and time until which it can be cancelled.
    case "l2_commitment_received":
      return {
        subject: `We received your commitment to ${v.pool}`,
        text:
          `Commitment: ${v.amount} for ${v.units} Units of ${v.pool} at ${v.price} per Unit.\n` +
          `Issuer: ${v.issuer} (issuer entity pending — L2-Q2).\n` +
          `You can cancel until ${v.cancelBy}. After that your commitment is final unless the offering doesn't reach its target, in which case you're refunded in full.\n\n` +
          `This is a risky investment. You could lose all of it, and Units can't be resold for ${POLICY.l2.lockupMonths} months.${footer}`,
      };
    case "l2_investment_funded":
      return {
        subject: `Your money for ${v.pool} is in escrow`,
        text: `Your ${v.amount} for ${v.units} Units of ${v.pool} is held in the offering's escrow account, not by FanZuP or the artist. If the offering reaches its target by the deadline, your Units are issued; if not, you're refunded in full. You can cancel until ${POLICY.l2.cancelCutoffHours} hours before the deadline.\n\nThis is a risky investment. You could lose all of it, and Units can't be resold for ${POLICY.l2.lockupMonths} months.${footer}`,
      };
    case "l2_cancel_pending":
      return {
        subject: `Cancellation received: ${v.pool}`,
        text: v.status === "funding"
          ? `Cancellation received — we'll refund your payment in full as soon as it arrives.${footer}`
          : `Cancellation received — if any payment was taken it will be refunded in full.${footer}`,
      };
    case "l2_investment_cancelled":
      return {
        subject: `Your investment in ${v.pool} is cancelled`,
        text: v.nothingCharged
          ? `Your reservation for ${v.pool} is cancelled at your request. Nothing was charged.${footer}`
          : `Your investment in ${v.pool} is cancelled at your request. Your refund of ${v.refund} has started and goes back to your bank account.${footer}`,
      };
    case "l2_payment_refunded_unapplied":
      return {
        subject: `Your payment for ${v.pool} is being refunded`,
        text: `We received ${v.refund} for ${v.pool}, but we couldn't apply it: ${UNAPPLIED_REASON[String(v.reason)] ?? "it couldn't be matched to an open commitment"}. No Units were issued for it, and the full ${v.refund} is being refunded to you.${footer}`,
      };
    case "l2_funding_returned":
      return { subject: `Your payment for ${v.pool} was returned`, text: `Your bank returned the ${v.amount} payment for ${v.pool}, so no Units were reserved for you. Nothing was charged.${footer}` };
    // 17 CFR 227.303(f)(1)(i)–(vi), pending items labelled (L2-Q2, L2-Q3, L2-Q7, L2-Q9).
    case "l2_units_issued":
      return {
        subject: `Confirmation: your ${v.units} Units of ${v.pool}`,
        text:
          `Transaction date: ${day(v.date)}.\n` +
          `Security: revenue-share Units (pending — L2-Q2). Issuer: ${v.issuer}.\n` +
          `Your purchase: ${v.units} Units at ${v.price} per Unit (${v.amount}).\n` +
          `The offering sold ${v.unitsSold} Units at ${v.offeringPrice} per Unit.\n` +
          `Return cap: ${v.capMultiple}× your investment; maturity date: ${day(v.maturesAt)} (no interest rate applies; pending — L2-Q9). Units are not callable.\n` +
          `Remuneration: platform royalty share ${v.platformPct}% (pending fee schedule — L2-Q7); intermediary compensation: pending — L2-Q3.\n\n` +
          `Any payouts are potential: they depend on royalties actually collected, are capped, and may be zero. Units can't be resold for ${POLICY.l2.lockupMonths} months.${footer}`,
      };
    case "l2_pool_funded":
      return {
        subject: `${v.pool} reached its target`,
        text: `${v.pool} closed at its target and Units have been issued. Units can't be resold for ${POLICY.l2.lockupMonths} months. Any payouts are potential: they depend on royalties actually collected, are capped, and may be zero.${footer}`,
      };
    // 17 CFR 227.304(d): the reason, the refund amount expected and when.
    case "l2_pool_failed":
      return {
        subject: `${v.pool} didn't reach its target — you're being refunded`,
        text: `${v.pool} didn't reach its target by the deadline, so the offering is cancelled and every investor is refunded in full from escrow. Your refund of ${v.refund} has started and should arrive within ${v.days} business days.${footer}`,
      };
    case "l2_pool_failed_creator":
      return {
        subject: `${v.pool} didn't reach its target`,
        text: `Your Pool ${v.pool} didn't reach its funding target by the deadline, so the offering is cancelled. Every investor is refunded in full from escrow; no money is released to you. You can start a new Pool when you're ready.${footer}`,
      };
    case "l2_refund_completed":
      return { subject: `Refund complete: ${v.pool}`, text: `Your refund of ${v.amount} for ${v.pool} is complete. Reference: ${v.ref}.${footer}` };
    case "l2_collection_state":
      return { subject: `${v.pool}: collection status is now ${v.state}`, text: `${STATE_COPY[String(v.state)] ?? ""}${footer}` };
    case "l2_pool_matured":
      return {
        subject: `${v.pool} has reached its maturity date`,
        text: `${v.pool} has reached its maturity date. Royalties for periods up to maturity that are collected later may still be distributed; no new periods are added.${footer}`,
      };
    case "l2_distribution_paid":
      return {
        subject: `A distribution from ${v.pool} was paid`,
        text: `${v.amount} from ${v.pool} (${v.label}) was paid to you. Past distributions don't predict future ones; the Pool's total payouts are capped and may stop at any time.${footer}`,
      };
  }
}

async function send(sql: Sql, template: L2TemplateId, subjectId: string, recipients: { userId: string; vars: Vars }[], dedupeSuffix = "") {
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

type InvRow = { investor_id: string; pool: string; pool_id: string; amount: bigint; units: number; refund_ref: string | null; price: bigint };
const inv = async (sql: Sql, id: string) =>
  (await asService(sql, (tx) => tx<InvRow[]>`
    select i.investor_id, p.title as pool, p.id as pool_id, i.amount_minor as amount, i.units, i.refund_ref, i.unit_price_minor as price
      from public.investments i join public.pools p on p.id = i.pool_id where i.id = ${id}`))[0];
const poolTitle = async (sql: Sql, id: string) =>
  (await asService(sql, (tx) => tx<{ title: string; owner: string; issuer: string }[]>`
    select p.title, a.owner_id as owner, coalesce(i.legal_name, p.artist_display) as issuer
      from public.pools p join public.artists a on a.id = p.artist_id left join public.issuers i on i.id = p.issuer_id where p.id = ${id}`))[0];
const usd = (v: unknown) => formatUsd(n(v as number));

export async function handleL2Notify(sql: Sql, payload: Record<string, unknown>) {
  const t = String(payload.template);
  const invId = String(payload.investment_id ?? "");
  switch (t) {
    case "kyc_result":
      return send(sql, "l2_kyc_result", String(payload.user_id), [{ userId: String(payload.user_id), vars: { status: String(payload.status) } }], `:${payload.status}`);
    case "commitment_received": {
      const i = await inv(sql, invId);
      if (!i) return;
      return send(sql, "l2_commitment_received", invId, [{ userId: i.investor_id, vars: {
        pool: i.pool, amount: usd(payload.amount_minor), units: Number(payload.units), price: usd(payload.unit_price_minor),
        issuer: String(payload.issuer_name ?? ""), cancelBy: when(payload.cancel_by),
      } }]);
    }
    case "investment_funded":
    case "funding_returned":
    case "refund_completed": {
      const i = await inv(sql, invId);
      if (!i) return;
      const id: L2TemplateId = t === "investment_funded" ? "l2_investment_funded" : t === "funding_returned" ? "l2_funding_returned" : "l2_refund_completed";
      const amount = payload.amount_minor != null ? usd(payload.amount_minor) : usd(i.amount);
      return send(sql, id, invId, [{ userId: i.investor_id, vars: { pool: i.pool, amount, units: i.units, ref: i.refund_ref } }]);
    }
    case "cancel_pending": {
      const i = await inv(sql, invId);
      if (!i) return;
      return send(sql, "l2_cancel_pending", invId, [{ userId: i.investor_id, vars: { pool: i.pool, status: String(payload.status ?? "") } }]);
    }
    case "investment_cancelled": {
      const i = await inv(sql, invId);
      if (!i) return;
      return send(sql, "l2_investment_cancelled", invId, [{ userId: i.investor_id, vars: {
        pool: i.pool, refund: usd(payload.refund_minor), nothingCharged: payload.nothing_charged === true || n(payload.refund_minor as number) === 0,
      } }]);
    }
    case "payment_refunded_unapplied": {
      const i = await inv(sql, invId);
      if (!i) return;
      return send(sql, "l2_payment_refunded_unapplied", invId, [{ userId: i.investor_id, vars: { pool: i.pool, refund: usd(payload.refund_minor), reason: String(payload.reason ?? "") } }]);
    }
    case "units_issued": {
      const i = await inv(sql, invId);
      if (!i) return;
      const p = await poolTitle(sql, i.pool_id);
      return send(sql, "l2_units_issued", invId, [{ userId: i.investor_id, vars: {
        pool: i.pool, issuer: p?.issuer ?? i.pool, date: String(payload.transaction_date ?? ""), units: Number(payload.units), price: usd(payload.unit_price_minor),
        amount: usd(payload.amount_minor), unitsSold: Number(payload.offering_units_sold), offeringPrice: usd(payload.offering_unit_price_minor),
        capMultiple: n(payload.return_cap_bps as number) / 10_000, maturesAt: String(payload.matures_at ?? ""), platformPct: n(payload.platform_bps as number) / 100,
      } }]);
    }
    case "pool_funded": {
      const id = String(payload.pool_id);
      const rows = await asService(sql, (tx) => tx<{ user_id: string; pool: string }[]>`
        select distinct i.investor_id as user_id, p.title as pool from public.investments i join public.pools p on p.id = i.pool_id
         where i.pool_id = ${id} and i.status = 'issued'
        union
        select a.owner_id, p.title from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${id}`);
      return send(sql, "l2_pool_funded", id, rows.map((r) => ({ userId: r.user_id, vars: { pool: r.pool } })));
    }
    case "pool_failed": {
      // Queued per investor by settle_pool's failed branch, with the refund amount (investor-cancelled investments are
      // not part of it: they got their own cancellation notice).
      const id = String(payload.pool_id);
      const p = await poolTitle(sql, id);
      if (!p || !payload.user_id) return;
      return send(sql, "l2_pool_failed", id, [{ userId: String(payload.user_id), vars: {
        pool: p.title, refund: usd(payload.refund_minor), days: n(payload.refund_within_business_days as number) || POLICY.l2.refundDirectBusinessDays,
      } }]);
    }
    case "pool_failed_creator": {
      const id = String(payload.pool_id);
      const p = await poolTitle(sql, id);
      if (!p) return;
      return send(sql, "l2_pool_failed_creator", id, [{ userId: p.owner, vars: { pool: p.title } }]);
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
    case "pool_matured": {
      const id = String(payload.pool_id);
      const rows = await asService(sql, (tx) => tx<{ user_id: string; pool: string }[]>`
        select distinct i.investor_id as user_id, p.title as pool from public.investments i join public.pools p on p.id = i.pool_id
         where i.pool_id = ${id} and i.status = 'issued'
        union
        select a.owner_id, p.title from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${id}`);
      return send(sql, "l2_pool_matured", id, rows.map((r) => ({ userId: r.user_id, vars: { pool: r.pool } })));
    }
    case "distribution_paid": {
      const [r] = await asService(sql, (tx) => tx<{ user_id: string; pool: string; amount: bigint; label: string }[]>`
        select d.investor_id as user_id, p.title as pool, d.amount_minor as amount, r.label
          from public.distribution_payouts d join public.pools p on p.id = d.pool_id join public.distribution_runs r on r.id = d.run_id
         where d.id = ${String(payload.payout_id)}`);
      if (!r) return;
      return send(sql, "l2_distribution_paid", String(payload.payout_id), [{ userId: r.user_id, vars: { pool: r.pool, amount: usd(r.amount), label: r.label } }]);
    }
    case "distribution_committed":
      return; // investors are told when their payout is paid, not when it's allocated
    default:
      log("warn", "notify.unknown_l2_template", { template: t });
  }
}
