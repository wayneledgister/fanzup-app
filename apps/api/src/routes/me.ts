/**
 * The signed-in person: profile and verification state, legal acceptances (FR-PRV-001), My backings
 * (FR-BCK-005, FR-PAY-009 fan view), and first-party funnel events (FR-ANL-001; G2 condition 18).
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../db";
import { HttpError, requireUser } from "../lib/auth";
import type { Deps } from "../app";

export const meRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/me", async (req) => {
    const u = await requireUser(req, d.verify);
    const [p] = await asService(d.sql, (tx) => tx<{ display_name: string; email_verified: boolean; is_staff: boolean; is_artist: boolean; missing: string[] }[]>`
      select p.display_name, public.email_confirmed(p.id) as email_verified,
             exists (select 1 from public.staff s where s.user_id = p.id) as is_staff,
             exists (select 1 from public.artists a where a.owner_id = p.id) as is_artist,
             public.missing_acceptances(p.id) as missing
        from public.profiles p where p.id = ${u.sub}`);
    if (!p) throw new HttpError(404, "profile_not_found", "Your account isn't set up yet. Sign out and back in.");
    return {
      id: u.sub, email: typeof u.email === "string" ? u.email : null, displayName: p.display_name, emailVerified: p.email_verified,
      isStaff: p.is_staff, isArtist: p.is_artist, needsAcceptance: p.missing, legal: POLICY.legal,
    };
  });

  /** Re-acceptance (or first acceptance for accounts created before M1): records IP and user agent. */
  app.post("/me/acceptances", async (req, reply) => {
    const u = await requireUser(req, d.verify);
    const body = z.object({ documents: z.array(z.object({ kind: z.enum(["terms", "privacy", "adult_attestation"]), version: z.string().max(40) })).min(1).max(3) }).parse(req.body);
    for (const doc of body.documents) {
      const current = doc.kind === "terms" ? POLICY.legal.termsVersion : doc.kind === "privacy" ? POLICY.legal.privacyVersion : "v1";
      if (doc.version !== current) throw new HttpError(409, "version_not_current", "Those terms have changed. Reload the page and review the current version.");
    }
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 400) || null;
    await asService(d.sql, async (tx) => {
      for (const doc of body.documents) {
        await tx`insert into public.consents (user_id, kind, version, method, ip, user_agent) values (${u.sub}, ${doc.kind}, ${doc.version}, 'api', ${req.ip}, ${ua})`;
      }
      await tx`insert into public.audit_events (action, entity, entity_id, data) values ('consent.recorded', 'profile', ${u.sub}, ${tx.json({ kinds: body.documents.map((x) => x.kind) })})`;
    });
    return reply.status(201).send({ ok: true });
  });

  app.get("/me/backings", async (req) => {
    const u = await requireUser(req, d.verify);
    const rows = await asService(d.sql, (tx) => tx<{
      id: string; created_at: Date; amount_minor: bigint; quantity: number; status: string; money_state: string; released_pct: number;
      refund_minor: bigint | null; refunded_at: Date | null; refund_ref: string | null; campaign_id: string; campaign_slug: string; campaign_title: string;
      campaign_status: string; ends_at: Date | null; goal_minor: bigint; raised_minor: bigint; perk_title: string; perk_fulfill_by: Date; next_label: string | null; next_at: Date | null;
    }[]>`select * from public.fan_backings(${u.sub})`);
    return {
      backings: rows.map((r) => ({
        id: r.id, createdAt: r.created_at.toISOString(), amountMinor: n(r.amount_minor), quantity: r.quantity, status: r.status,
        moneyState: r.money_state, releasedPct: r.released_pct,
        refund: r.refunded_at ? { amountMinor: n(r.refund_minor), at: r.refunded_at.toISOString(), ref: r.refund_ref } : null,
        campaign: { id: r.campaign_id, slug: r.campaign_slug, title: r.campaign_title, status: r.campaign_status, endsAt: r.ends_at?.toISOString() ?? null, goalMinor: n(r.goal_minor), raisedMinor: n(r.raised_minor) },
        // Until fulfillment tracking ships (FR-FUL-002), perk status is always "Not yet shipped" (FR-BCK-005).
        perk: { title: r.perk_title, fulfillBy: r.perk_fulfill_by.toISOString().slice(0, 10), status: "Not yet shipped" },
        next: r.next_label ? { label: r.next_label, at: r.next_at?.toISOString() ?? null } : null,
      })),
    };
  });

  /** Client-side funnel event (only perk_selected / checkout_started; the rest are recorded by the server). */
  app.post("/events", { bodyLimit: 1024 }, async (req, reply) => {
    const body = z.object({
      name: z.enum(["perk_selected", "checkout_started"]),
      campaignId: z.string().uuid(),
      perkId: z.string().uuid().optional(),
      anonId: z.string().uuid(),
      source: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
    }).parse(req.body);
    const [c] = await asService(d.sql, (tx) => tx`select 1 from public.campaigns where id = ${body.campaignId} and public.campaign_is_public(status)`);
    if (!c) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
    await asService(d.sql, (tx) => tx`
      insert into public.funnel_events (name, campaign_id, perk_id, anon_id, source)
      select ${body.name}, ${body.campaignId}, p.id, ${body.anonId}, ${body.source ?? null}
        from (select ${body.perkId ?? null}::uuid as id) x left join public.perks p on p.id = x.id and p.campaign_id = ${body.campaignId}`);
    return reply.status(202).send();
  });
};
