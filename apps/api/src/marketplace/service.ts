/**
 * Marketplace writes shared by routes and staff executors (CR-005). Kept apart from routes.ts so staff.ts can import it
 * without an import cycle. No money (NFR-MKT-01).
 */
import { asService, type Sql, type Tx } from "../db";
import { HttpError } from "../lib/auth";

/** A provider row's version token: its `updated_at` in microseconds (exact; JS dates would drop the last 3 digits). */
export const VERSION = "(extract(epoch from updated_at) * 1000000)::bigint::text";
/** Which statuses each staff decision may start from (FR-MKT-008). */
export const REVIEW_FROM: Record<string, string[]> = {
  listed: ["in_review"], changes_requested: ["in_review"], suspended: ["in_review", "listed", "changes_requested", "draft"],
};
export const PROVIDER_CHANGED = () => new HttpError(409, "provider_changed", "This profile changed since you opened it. Reload and review it again.");

export const audit = (tx: Tx, actor: string | null, action: string, entity: string, id: string, data: Record<string, unknown> = {}) =>
  tx`insert into public.audit_events (actor_id, action, entity, entity_id, data) values (${actor}, ${action}, ${entity}, ${id}, ${tx.json(data as never)})`;

/** Executor for the `provider.review` privileged action (staff.ts). Suspension declines open requests (FR-MKT-008). */
export async function executeProviderReview(sql: Sql, subjectId: string, actorId: string, p: { decision: string; note: string | null; version: string }) {
  await asService(sql, async (tx) => {
    // Conditional on the status and the version staff reviewed, so a concurrent edit or decision can't slip through.
    const [row] = await tx<{ id: string }[]>`
      update public.service_providers
         set status = ${p.decision}, review_note = ${p.note}, reviewed_at = now(), reviewed_by = ${actorId},
             listed_at = case when ${p.decision} = 'listed' then now() else listed_at end
       where id = ${subjectId} and status = any (${REVIEW_FROM[p.decision] ?? []}::text[])
         and ${tx.unsafe(VERSION)} = ${p.version}
       returning id`;
    if (!row) throw PROVIDER_CHANGED();
    if (p.decision === "suspended") {
      const closed = await tx`
        update public.service_requests set status = 'declined', provider_note = 'This provider is no longer listed.', responded_at = now()
         where provider_id = ${subjectId} and status = 'sent' returning id`;
      await audit(tx, actorId, "marketplace.provider.suspended", "service_provider", subjectId, { declined_requests: closed.length });
    }
  });
}

// ── Closed beta (CR-007, design §12). Executors for the privileged staff actions; none moves money. ──
export const INVITE_EXISTS = () => new HttpError(409, "invite_exists", "This email already has an open invite. Revoke it first to send a new one.");

/** `marketplace.audience` (FR-MKT-021). */
export async function executeAudience(sql: Sql, actorId: string, p: { audience: string }) {
  await asService(sql, async (tx) => {
    await tx`insert into public.platform_settings (key, value, updated_by) values ('marketplace.audience', ${tx.json(p.audience)}, ${actorId})
             on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
  });
  return { audience: p.audience };
}

/**
 * `marketplace.invite` (FR-MKT-022). Params hold the code's hash, never the code (NFR-MKT-08). An expired open
 * invite for the same email is revoked in the same transaction, so a fresh one can take its place.
 */
export async function executeInvite(sql: Sql, actorId: string, p: { inviteId: string; codeHash: string; email: string; kind: string; name: string | null; note: string | null; days: number }) {
  return asService(sql, async (tx) => {
    await tx`update public.marketplace_invites set revoked_at = now(), revoked_by = ${actorId}
              where email = ${p.email} and redeemed_at is null and revoked_at is null and expires_at <= now()`;
    try {
      await tx.savepoint((s) => s`
        insert into public.marketplace_invites (id, code_hash, email, name, kind, note, created_by, expires_at)
        values (${p.inviteId}, ${p.codeHash}, ${p.email}, ${p.name}, ${p.kind}, ${p.note}, ${actorId}, now() + make_interval(days => ${p.days}))`);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw INVITE_EXISTS();
      throw e;
    }
    await audit(tx, actorId, "marketplace.invite.created", "marketplace_invite", p.inviteId, { kind: p.kind });
    return { inviteId: p.inviteId };
  });
}

/** `marketplace.invite_revoke` (FR-MKT-022). */
export async function executeInviteRevoke(sql: Sql, subjectId: string, actorId: string) {
  await asService(sql, async (tx) => {
    const [r] = await tx`update public.marketplace_invites set revoked_at = now(), revoked_by = ${actorId}
                          where id = ${subjectId} and redeemed_at is null and revoked_at is null returning id`;
    if (!r) throw new HttpError(409, "invite_not_open", "Only open invites can be revoked.");
    await audit(tx, actorId, "marketplace.invite.revoked", "marketplace_invite", subjectId);
  });
}

/** `marketplace.member_remove` (FR-MKT-027). Data stays; a listed provider is suspended separately (FR-MKT-008). */
export async function executeMemberRemove(sql: Sql, subjectId: string, actorId: string) {
  await asService(sql, async (tx) => {
    const [r] = await tx`update public.marketplace_members set removed_at = now(), removed_by = ${actorId}
                          where user_id = ${subjectId} and removed_at is null returning user_id`;
    if (!r) throw new HttpError(409, "not_member", "That person isn't a current beta member.");
    await audit(tx, actorId, "marketplace.member.removed", "profile", subjectId);
  });
}
