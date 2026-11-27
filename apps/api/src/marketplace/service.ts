/**
 * Marketplace writes shared by routes and staff executors (CR-005). Kept apart from routes.ts so staff.ts can import it
 * without an import cycle. No money (NFR-MKT-01).
 */
import { asService, type Sql, type Tx } from "../db";
import { HttpError } from "../lib/auth";

export const audit = (tx: Tx, actor: string | null, action: string, entity: string, id: string, data: Record<string, unknown> = {}) =>
  tx`insert into public.audit_events (actor_id, action, entity, entity_id, data) values (${actor}, ${action}, ${entity}, ${id}, ${tx.json(data as never)})`;

/** Executor for the `provider.review` privileged action (staff.ts). Suspension declines open requests (FR-MKT-008). */
export async function executeProviderReview(sql: Sql, subjectId: string, actorId: string, p: { decision: string; note: string | null }) {
  await asService(sql, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      update public.service_providers
         set status = ${p.decision}, review_note = ${p.note}, reviewed_at = now(), reviewed_by = ${actorId},
             listed_at = case when ${p.decision} = 'listed' then now() else listed_at end
       where id = ${subjectId} returning id`;
    if (!row) throw new HttpError(404, "not_found", "We couldn't find that.");
    if (p.decision === "suspended") {
      const closed = await tx`
        update public.service_requests set status = 'declined', provider_note = 'This provider is no longer listed.', responded_at = now()
         where provider_id = ${subjectId} and status = 'sent' returning id`;
      await audit(tx, actorId, "marketplace.provider.suspended", "service_provider", subjectId, { declined_requests: closed.length });
    }
  });
}
