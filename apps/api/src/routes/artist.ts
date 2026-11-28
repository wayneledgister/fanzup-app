/**
 * Artist API (FR-CMP-001/002, FR-PAY-005 evidence, FR-ID-004 payout onboarding). Thin by design (G2 condition 9):
 * drafts are written as the artist under RLS and column grants (money/status fields can't be set); perks and
 * tranches are replaced wholesale; submit/publish call the workflow functions as the verified actor.
 * The web wizard is wired to this at M2.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { POLICY } from "@fanzup/shared/policy";
import { asService, asUser, n, type Claims } from "../db";
import { HttpError, requireVerifiedUser } from "../lib/auth";
import { singleOperatorMode } from "../staff";
import type { Deps } from "../app";
import type { CampaignStatus } from "@fanzup/shared/campaign";
import type { MyArtist, MyCampaign, MyCampaignSummary, MyPerk } from "@fanzup/shared/schemas";

/** Columns behind `MyCampaignSummary` (CR-006). Constant text, never user input. */
const SUMMARY_COLS = "id, slug, title, type::text, blurb, status::text, goal_minor, raised_minor, backers_count, milestone_release, starts_at, ends_at, created_at, updated_at";
type SummaryRow = {
  id: string; slug: string; title: string; type: string; blurb: string | null; status: CampaignStatus; goal_minor: bigint; raised_minor: bigint;
  backers_count: number; milestone_release: boolean; starts_at: Date | null; ends_at: Date | null; created_at: Date; updated_at: Date;
};
const summary = (c: SummaryRow): MyCampaignSummary => ({
  id: c.id, slug: c.slug, title: c.title, type: c.type, blurb: c.blurb, status: c.status, goalMinor: n(c.goal_minor), raisedMinor: n(c.raised_minor),
  backers: c.backers_count, milestoneRelease: c.milestone_release, startsAt: c.starts_at?.toISOString() ?? null, endsAt: c.ends_at?.toISOString() ?? null,
  createdAt: c.created_at.toISOString(), updatedAt: c.updated_at.toISOString(),
});
/** A Postgres `date` arrives as midnight UTC; send the calendar day. */
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const Slug = z.string().regex(/^[a-z0-9-]{3,60}$/);
const CampaignFields = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  title: z.string().min(3).max(90),
  type: z.enum(["Show", "Tour", "Album", "Music Video", "Documentary"]),
  blurb: z.string().max(160).nullish(),
  story: z.string().max(20000).nullish(),
  risks: z.string().max(5000).nullish(),
  goalMinor: z.number().int().min(50_000),
  durationDays: z.number().int().min(POLICY.campaign.minDays).max(POLICY.campaign.maxDays),
  milestoneRelease: z.boolean(),
});
const Perk = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(2000).nullish(),
  kind: z.enum(["digital", "physical", "experience"]),
  priceMinor: z.number().int().min(100),
  quantityLimit: z.number().int().positive().nullish(),
  fulfillBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shipsTo: z.enum(["us", "na", "world"]).nullish(),
});
const Tranche = z.object({
  seq: z.number().int().min(1).max(3),
  pct: z.number().int().min(1).max(100),
  milestone: z.string().max(200).nullish(),
  evidenceRequired: z.string().max(500).nullish(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export const artistRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  // The verified user is stored on the request (never in a shared variable: requests run concurrently).
  app.addHook("preHandler", async (req) => {
    (req as unknown as { fzUser: Claims }).fzUser = await requireVerifiedUser(req, d.verify, d.sql);
  });
  const userOf = (req: unknown) => (req as { fzUser: Claims }).fzUser;

  async function myArtist(user: Claims) {
    const [a] = await asService(d.sql, (tx) => tx<{ id: string; slug: string; name: string; tier: string; identity_status: string; payout_account_ref: string | null }[]>`
      select id, slug, name, tier::text, identity_status::text, payout_account_ref from public.artists where owner_id = ${user.sub} order by created_at limit 1`);
    if (!a) throw new HttpError(404, "no_artist", "Create your artist profile first.");
    return a;
  }
  async function myCampaign(user: Claims, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
    const [c] = await asUser(d.sql, user, (tx) => tx<{ id: string; status: string }[]>`
      select c.id, c.status::text from public.campaigns c join public.artists a on a.id = c.artist_id where c.id = ${id} and a.owner_id = ${user.sub}`);
    if (!c) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
    return c;
  }
  const editable = (status: string) => {
    if (!["draft", "revisions_requested"].includes(status)) throw new HttpError(409, "not_editable", "Only drafts and campaigns with requested revisions can be edited.");
  };

  app.post("/", async (req, reply) => {
    const user = userOf(req);
    const body = z.object({ slug: Slug, name: z.string().min(1).max(80), genre: z.string().max(40).nullish(), city: z.string().max(80).nullish(), bio: z.string().max(500).nullish() }).parse(req.body);
    // FR-ID-007: the single operator can't own or be linked to any campaign.
    const [s] = await asService(d.sql, (tx) => tx`select 1 from public.staff where user_id = ${user.sub}`);
    if (s && (await singleOperatorMode(d.sql))) throw new HttpError(403, "staff_cannot_own", "Staff can't own artist profiles while single-operator mode is on.");
    try {
      const [a] = await asUser(d.sql, user, (tx) => tx<{ id: string }[]>`
        insert into public.artists (owner_id, slug, name, genre, city, bio) values (${user.sub}, ${body.slug}, ${body.name}, ${body.genre ?? null}, ${body.city ?? null}, ${body.bio ?? null}) returning id`);
      return reply.status(201).send({ id: a.id, slug: body.slug });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "slug_taken", "That profile address is taken. Try another.");
      throw e;
    }
  });

  /** Owner read model (CR-006, ADR-011): profile, payout status and every campaign, newest first. Contract `MyArtist`. */
  app.get("/", async (req): Promise<MyArtist> => {
    const user = userOf(req);
    const a = await myArtist(user);
    const campaigns = await asUser(d.sql, user, (tx) => tx<SummaryRow[]>`
      select ${tx.unsafe(SUMMARY_COLS)} from public.campaigns where artist_id = ${a.id} order by created_at desc, id`);
    return {
      id: a.id, slug: a.slug, name: a.name, tier: a.tier, identityStatus: a.identity_status as MyArtist["identityStatus"],
      payoutAccount: { status: a.payout_account_ref ? "connected" : "none" },
      campaigns: campaigns.map(summary),
    };
  });

  /**
   * FR-ID-004 (M1): identity and payout account through the provider's hosted onboarding (Stripe Connect Express in
   * test mode; the sandbox connects a test account at once). When the provider reports the account ready, the
   * artist's identity counts as verified for submitting campaigns. FanZuP stores only the reference and status.
   */
  app.post("/payout-account", async (req) => {
    const user = userOf(req);
    const a = await myArtist(user);
    const r = await d.provider.payoutOnboarding({
      artistId: a.id, existingRef: a.payout_account_ref,
      // CR-006: Stripe's hosted onboarding returns to the artist home, which calls this again to read the new status.
      returnUrl: `${d.env.PUBLIC_WEB_URL}/creator?payout=done`, refreshUrl: `${d.env.PUBLIC_WEB_URL}/creator?payout=retry`,
    });
    const ready = await d.provider.payoutAccountReady(r.accountRef);
    await asService(d.sql, async (tx) => {
      await tx`update public.artists set payout_account_ref = ${r.accountRef}, identity_status = ${ready ? "verified" : "pending"}::public.verification_status where id = ${a.id}`;
      await tx`insert into public.audit_events (action, entity, entity_id, data) values ('artist.payout_onboarding', 'artist', ${a.id}, ${tx.json({ ready })})`;
    });
    return { status: ready ? "verified" : "pending", onboardingUrl: ready ? null : r.onboardingUrl };
  });

  app.post("/campaigns", async (req, reply) => {
    const user = userOf(req);
    const a = await myArtist(user);
    const b = CampaignFields.parse(req.body);
    try {
      const [c] = await asUser(d.sql, user, (tx) => tx<{ id: string }[]>`
        insert into public.campaigns (artist_id, slug, title, type, blurb, story, risks, goal_minor, milestone_release, duration_days)
        values (${a.id}, ${b.slug}, ${b.title}, ${b.type}, ${b.blurb ?? null}, ${b.story ?? null}, ${b.risks ?? null}, ${b.goalMinor}, ${b.milestoneRelease}, ${b.durationDays})
        returning id`);
      return reply.status(201).send({ id: c.id, slug: b.slug, status: "draft" });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "slug_taken", "That campaign address is taken. Try another.");
      throw e;
    }
  });

  /** One of the artist's campaigns with its perks and milestones (milestone ids are needed to submit evidence). Contract `MyCampaign`. */
  app.get<{ Params: { id: string } }>("/campaigns/:id", async (req): Promise<MyCampaign> => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    return asUser(d.sql, user, async (tx) => {
      const [row] = await tx<SummaryRow[]>`select ${tx.unsafe(SUMMARY_COLS)} from public.campaigns where id = ${c.id}`;
      const perks = await tx<{ id: string; title: string; description: string | null; kind: MyPerk["kind"]; price_minor: bigint; quantity_limit: number | null; claimed: number; fulfill_by: Date }[]>`
        select id, title, description, kind::text, price_minor, quantity_limit, claimed, fulfill_by from public.perks where campaign_id = ${c.id} order by sort, price_minor, id`;
      const tranches = await tx<{ id: string; seq: number; pct: number; milestone: string | null; status: string; target_date: Date | null; released_minor: bigint | null }[]>`
        select id, seq, pct, milestone, status::text, target_date, released_minor from public.campaign_tranches where campaign_id = ${c.id} order by seq`;
      return {
        ...summary(row),
        perks: perks.map((p) => ({
          id: p.id, title: p.title, description: p.description, kind: p.kind, priceMinor: n(p.price_minor),
          limit: p.quantity_limit, claimed: p.claimed, fulfillBy: dateOnly(p.fulfill_by),
        })),
        tranches: tranches.map((t) => ({
          id: t.id, seq: t.seq, pct: t.pct, milestone: t.milestone, status: t.status,
          targetDate: t.target_date ? dateOnly(t.target_date) : null, releasedMinor: t.released_minor == null ? null : n(t.released_minor),
        })),
      };
    });
  });

  app.patch<{ Params: { id: string } }>("/campaigns/:id", async (req) => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    editable(c.status);
    const b = CampaignFields.partial().parse(req.body);
    const cols: Record<string, unknown> = {
      slug: b.slug, title: b.title, type: b.type, blurb: b.blurb, story: b.story, risks: b.risks,
      goal_minor: b.goalMinor, duration_days: b.durationDays, milestone_release: b.milestoneRelease,
    };
    const set = Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined));
    if (!Object.keys(set).length) return { id: c.id };
    await asUser(d.sql, user, (tx) => tx`update public.campaigns set ${tx(set)} where id = ${c.id}`);
    return { id: c.id };
  });

  app.delete<{ Params: { id: string } }>("/campaigns/:id", async (req, reply) => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    if (c.status !== "draft") throw new HttpError(409, "not_editable", "Only drafts can be deleted.");
    await asUser(d.sql, user, (tx) => tx`delete from public.campaigns where id = ${c.id}`);
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>("/campaigns/:id/perks", async (req) => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    editable(c.status);
    const perks = z.array(Perk).min(1).max(20).parse(req.body);
    await asUser(d.sql, user, async (tx) => {
      await tx`delete from public.perks where campaign_id = ${c.id}`;
      for (const [i, p] of perks.entries()) {
        await tx`insert into public.perks (campaign_id, title, description, kind, price_minor, quantity_limit, fulfill_by, ships_to, sort)
                 values (${c.id}, ${p.title}, ${p.description ?? null}, ${p.kind}, ${p.priceMinor}, ${p.quantityLimit ?? null}, ${p.fulfillBy}, ${p.shipsTo ?? null}, ${i})`;
      }
    });
    return { count: perks.length };
  });

  app.put<{ Params: { id: string } }>("/campaigns/:id/tranches", async (req) => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    editable(c.status);
    const ts = z.array(Tranche).min(POLICY.campaign.minTranches).max(POLICY.campaign.maxTranches).parse(req.body);
    const seqs = ts.map((t) => t.seq).sort();
    if (seqs.some((s, i) => s !== i + 1)) throw new HttpError(400, "invalid_tranches", "Number milestones 1, 2, 3 in order.");
    if (ts.reduce((s, t) => s + t.pct, 0) !== 100) throw new HttpError(400, "invalid_tranches", "Milestone shares must add up to 100%.");
    if (ts.some((t) => t.seq > 1 && !t.milestone)) throw new HttpError(400, "invalid_tranches", "Describe the milestone for every release after the first.");
    await asUser(d.sql, user, async (tx) => {
      await tx`update public.campaigns set milestone_release = true where id = ${c.id}`;
      await tx`delete from public.campaign_tranches where campaign_id = ${c.id}`;
      for (const t of ts) {
        await tx`insert into public.campaign_tranches (campaign_id, seq, pct, milestone, evidence_required, target_date)
                 values (${c.id}, ${t.seq}, ${t.pct}, ${t.seq === 1 ? null : t.milestone ?? null}, ${t.evidenceRequired ?? null}, ${t.targetDate ?? null})`;
      }
    });
    return { count: ts.length };
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/submit", async (req) => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    await asService(d.sql, (tx) => tx`select public.submit_campaign(${c.id})`);
    return { status: "in_review", reviewEstimate: POLICY.campaign.reviewEstimate };
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/publish", async (req) => {
    const user = userOf(req);
    const c = await myCampaign(user, req.params.id);
    const [r] = await asService(d.sql, (tx) => tx<{ ends: Date }[]>`select public.publish_campaign(${c.id}) as ends`);
    return { status: "live", endsAt: r.ends.toISOString() };
  });

  app.post<{ Params: { id: string } }>("/tranches/:id/evidence", async (req, reply) => {
    const user = userOf(req);
    if (!z.string().uuid().safeParse(req.params.id).success) throw new HttpError(404, "not_found", "We couldn't find that milestone.");
    const b = z.object({ notes: z.string().min(10).max(4000), links: z.array(z.string().url().startsWith("https://")).max(10).default([]) }).parse(req.body);
    const [r] = await asService(d.sql, (tx) => tx<{ id: string }[]>`select public.submit_tranche_evidence(${req.params.id}, ${user.sub}, ${b.notes}, ${b.links}) as id`);
    return reply.status(201).send({ evidenceId: r.id });
  });
};
