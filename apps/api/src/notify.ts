/**
 * Transactional notifications (FR-NTF-001, M1 slice; FR-PLT-006 test-money notice). Outbox `notify.*` topics
 * become `notifications` rows (template + version, user id — never the address) and are sent through a transport.
 * M1 ships the log transport; an email provider is a setup step for Wayne (design §12.3).
 *
 * Copy rules: Layer 1 never says invest/returns/ownership, and no message says "escrow" or names a custodian
 * while none exists (FR-PLT-006). `pnpm lint:copy` scans this file.
 */
import { asService, n, type Sql } from "./db";
import { log } from "./log";
import { formatUsd } from "./lib/format";

export type NotifyHandler = (sql: Sql, topic: string, payload: Record<string, unknown>) => Promise<void>;

export const TEST_MODE_FOOTER =
  "Test mode: no real money moves during the FanZuP beta. Backings use test cards, and artists don't owe perks for test backings.";

export interface Rendered {
  subject: string;
  text: string;
}

/** Template id → version. Bump the version whenever the wording changes (every send records it). */
export const TEMPLATES = {
  backing_receipt: 1,
  campaign_funded: 1,
  campaign_failed_refund_started: 1,
  refund_started: 1,
  refund_completed: 1,
  milestone_released: 1,
} as const;
export type TemplateId = keyof typeof TEMPLATES;

const REFUND_REASONS: Record<string, string> = {
  campaign_failed: "the campaign didn't reach its goal by the deadline",
  campaign_closed: "your payment arrived after the campaign had closed",
  hold_expired: "your payment arrived after your checkout had expired",
  amount_mismatch: "the amount charged didn't match your backing",
  staff_refund: "our support team refunded it",
};

export function render(t: TemplateId, v: Record<string, string | number | null>): Rendered {
  const footer = `\n\n${TEST_MODE_FOOTER}`;
  switch (t) {
    case "backing_receipt":
      return {
        subject: `You backed ${v.campaign}`,
        text: `Thanks for backing ${v.campaign} with ${v.perk}. You paid ${v.amount}.\n\nIf the campaign reaches its goal by ${v.deadline}, the artist starts receiving the money in milestones. If it doesn't, you're refunded in full automatically.${footer}`,
      };
    case "campaign_funded":
      return {
        subject: `${v.campaign} is funded`,
        text: `${v.campaign} reached its goal. The money is released to the artist in milestones as each one is verified. You'll get an email when each milestone is released.${footer}`,
      };
    case "campaign_failed_refund_started":
      return {
        subject: `${v.campaign} didn't reach its goal — your refund has started`,
        text: `${v.campaign} didn't reach its goal by the deadline, so every backer is refunded in full. Your refund of ${v.amount} has started and should reach your card within 5 business days.${footer}`,
      };
    case "refund_started":
      return {
        subject: `Your refund for ${v.campaign} has started`,
        text: `We're refunding ${v.amount} for your backing of ${v.campaign} because ${v.reason}. It should reach your card within 5 business days.${footer}`,
      };
    case "refund_completed":
      return {
        subject: `Refund complete: ${v.campaign}`,
        text: `Your refund of ${v.amount} for ${v.campaign} is complete. Reference: ${v.ref}.${footer}`,
      };
    case "milestone_released":
      return {
        subject: `Milestone released: ${v.campaign}`,
        text: `Milestone ${v.seq} of ${v.campaign} was verified and ${v.amount} was released to the artist.${footer}`,
      };
  }
}

export type Transport = (msg: { userId: string; template: TemplateId; rendered: Rendered }) => Promise<void>;

/** M1 transport: records the send in the structured log (subject only; never the body or the address). */
export const logTransport: Transport = async ({ template, rendered }) => {
  log("info", "notify.sent", { template, subject: rendered.subject });
};

interface Recipient {
  userId: string;
  vars: Record<string, string | number | null>;
}

async function enqueue(sql: Sql, transport: Transport, template: TemplateId, subjectId: string, recipients: Recipient[]) {
  for (const r of recipients) {
    const dedupe = `${template}:${subjectId}:${r.userId}`;
    const [row] = await asService(sql, (tx) => tx<{ id: string }[]>`
      insert into public.notifications (template, template_version, user_id, subject_id, dedupe_key, transport)
      values (${template}, ${TEMPLATES[template]}, ${r.userId}, ${subjectId}, ${dedupe}, 'log')
      on conflict (dedupe_key) do nothing returning id`);
    if (!row) continue; // already sent (outbox redelivery)
    try {
      await transport({ userId: r.userId, template, rendered: render(template, r.vars) });
      await asService(sql, (tx) => tx`update public.notifications set status = 'sent', sent_at = now() where id = ${row.id}`);
    } catch (e) {
      await asService(sql, (tx) => tx`update public.notifications set status = 'failed', error = ${String((e as Error).message).slice(0, 300)} where id = ${row.id}`);
    }
  }
}

type BackingInfo = { backer_id: string; campaign: string; perk: string; amount: bigint; captured: bigint | null; ends_at: Date | null; refund_ref: string | null };
async function backing(sql: Sql, id: string) {
  const [b] = await asService(sql, (tx) => tx<BackingInfo[]>`
    select b.backer_id, c.title as campaign, p.title as perk, b.amount_minor as amount, b.captured_minor as captured, c.ends_at, b.refund_ref
      from public.backings b join public.campaigns c on c.id = b.campaign_id join public.perks p on p.id = b.perk_id where b.id = ${id}`);
  return b;
}

export function createNotifier(transport: Transport = logTransport): NotifyHandler {
  return async (sql, topic, payload) => {
    switch (topic) {
      case "notify.backing_receipt": {
        const b = await backing(sql, String(payload.backing_id));
        return enqueue(sql, transport, "backing_receipt", String(payload.backing_id), [
          { userId: b.backer_id, vars: { campaign: b.campaign, perk: b.perk, amount: formatUsd(n(b.captured ?? b.amount)), deadline: b.ends_at?.toUTCString() ?? "" } },
        ]);
      }
      case "notify.refund_started": {
        const b = await backing(sql, String(payload.backing_id));
        return enqueue(sql, transport, "refund_started", String(payload.backing_id), [
          { userId: b.backer_id, vars: { campaign: b.campaign, amount: formatUsd(n(b.captured ?? b.amount)), reason: REFUND_REASONS[String(payload.reason)] ?? "it couldn't be applied" } },
        ]);
      }
      case "notify.refund_completed": {
        const b = await backing(sql, String(payload.backing_id));
        return enqueue(sql, transport, "refund_completed", String(payload.backing_id), [
          { userId: b.backer_id, vars: { campaign: b.campaign, amount: formatUsd(n(b.captured ?? b.amount)), ref: b.refund_ref } },
        ]);
      }
      case "notify.campaign_funded":
      case "notify.campaign_failed": {
        const id = String(payload.campaign_id);
        const rows = await asService(sql, (tx) => tx<{ user_id: string; campaign: string; amount: bigint }[]>`
          select b.backer_id as user_id, c.title as campaign, sum(b.captured_minor) as amount
            from public.backings b join public.campaigns c on c.id = b.campaign_id
           where b.campaign_id = ${id} and b.captured_minor is not null and b.status in ('held', 'released')
           group by b.backer_id, c.title
          union
          select a.owner_id, c.title, 0 from public.campaigns c join public.artists a on a.id = c.artist_id where c.id = ${id} and ${topic} = 'notify.campaign_funded'`);
        const template: TemplateId = topic === "notify.campaign_funded" ? "campaign_funded" : "campaign_failed_refund_started";
        return enqueue(sql, transport, template, id, rows.map((r) => ({ userId: r.user_id, vars: { campaign: r.campaign, amount: formatUsd(n(r.amount)) } })));
      }
      case "notify.milestone_released": {
        const id = String(payload.tranche_id);
        const rows = await asService(sql, (tx) => tx<{ user_id: string; campaign: string; seq: number; amount: bigint }[]>`
          select distinct b.backer_id as user_id, c.title as campaign, t.seq, t.released_minor as amount
            from public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id join public.backings b on b.campaign_id = c.id and b.counted
           where t.id = ${id}
          union
          select a.owner_id, c.title, t.seq, t.released_minor
            from public.campaign_tranches t join public.campaigns c on c.id = t.campaign_id join public.artists a on a.id = c.artist_id where t.id = ${id}`);
        return enqueue(sql, transport, "milestone_released", id, rows.map((r) => ({ userId: r.user_id, vars: { campaign: r.campaign, seq: r.seq, amount: formatUsd(n(r.amount)) } })));
      }
      default:
        log("warn", "notify.unknown_topic", { topic });
    }
  };
}

/** Kept for callers that want no notifications (unit tests of the money path). */
export const logOnlyNotify: NotifyHandler = async (_sql, topic) => {
  log("info", "notify.skipped", { topic });
};
