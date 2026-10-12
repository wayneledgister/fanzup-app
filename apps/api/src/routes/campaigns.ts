import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { CampaignCard, CampaignDetail, CampaignList } from "@fanzup/shared/schemas";
import { asUser, n } from "../db";
import { optionalUser, HttpError } from "../lib/auth";
import type { Deps } from "../app";

type CardRow = {
  id: string; slug: string; title: string; type: string; blurb: string | null; status: string; created_at: Date; settled_at: Date | null;
  goal_minor: bigint; raised_minor: bigint; backers_count: number; ends_at: Date | null; milestone_release: boolean;
  artist_id: string; artist_slug: string; artist_name: string; genre: string | null; city: string | null; tier: string;
};

const card = (r: CardRow): CampaignCard => ({
  id: r.id, slug: r.slug, title: r.title, type: r.type, blurb: r.blurb, status: r.status,
  goalMinor: n(r.goal_minor), raisedMinor: n(r.raised_minor), backers: r.backers_count,
  endsAt: r.ends_at?.toISOString() ?? null, milestoneRelease: r.milestone_release,
  artist: { id: r.artist_id, slug: r.artist_slug, name: r.artist_name, genre: r.genre, city: r.city, tier: r.tier },
});

const PAGE = 24;
const TYPES = ["Show", "Tour", "Album", "Music Video", "Documentary"] as const;
const ListQuery = z.object({
  tab: z.enum(["live", "funded"]).default("live"),
  type: z.enum(TYPES).optional(),
  cursor: z.string().max(300).optional(),
  /** Page size, at most 24 (design §4.2). */
  limit: z.coerce.number().int().min(1).max(PAGE).default(PAGE),
});
type Cursor = { k: string; c: string | null; id: string };
/** Postgres timestamptz text at full (microsecond) precision; JS Dates would truncate to milliseconds. */
const isDate = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/.test(v);
/**
 * Opaque cursor (G2 condition 14): base64url of the last row's full sort key, so a page boundary inside a run of
 * equal deadlines neither repeats nor skips a campaign. Live: `{ k: ends_at, c: created_at, id }`; funded:
 * `{ k: settled_at, c: null, id }`.
 */
const encodeCursor = (cur: Cursor) => Buffer.from(JSON.stringify(cur)).toString("base64url");
function decodeCursor(raw: string | undefined, tab: "live" | "funded"): Cursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (isDate(v.k) && typeof v.id === "string" && /^[0-9a-f-]{36}$/.test(v.id) && (tab === "funded" || isDate(v.c))) {
      return { k: v.k, c: tab === "live" ? v.c : null, id: v.id };
    }
  } catch { /* fall through */ }
  throw new HttpError(400, "invalid_cursor", "That page link is no longer valid.");
}

/**
 * Public discovery (FR-CMP-008, NFR-PERF-06): live campaigns ending soonest then newest, or recently funded ones.
 * Never ordered by money raised or anything return-like (PRD 02 §8). Runs under RLS as anon or the user.
 *
 * "Recently funded" lists campaigns whose outcome was funded: `funded`, `released`, or `closed` after a release.
 * A `closed` campaign that came from `refunded` (missed its goal) never appears (PR #9 review). Status moves
 * released → closed or refunded → closed only (`campaign_transitions`), and only a funded campaign ever releases a
 * tranche, so "closed with a released tranche" is exactly "closed from released".
 */
export const campaignRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/campaigns", async (req): Promise<CampaignList> => {
    const user = await optionalUser(req, d.verify);
    const q = ListQuery.parse(req.query);
    const cur = decodeCursor(q.cursor, q.tab);
    const rows = await asUser(d.sql, user, (tx) => {
      const base = tx`
        select c.id, c.slug, c.title, c.type::text, c.blurb, c.status::text, c.created_at, c.settled_at, c.goal_minor, c.raised_minor,
               c.backers_count, c.ends_at, c.milestone_release, a.id as artist_id, a.slug as artist_slug, a.name as artist_name,
               a.genre, a.city, a.tier::text,
               (case when c.status = 'live' then c.ends_at else c.settled_at end)::text as cursor_k, c.created_at::text as cursor_c
          from public.campaigns c join public.artists a on a.id = c.artist_id`;
      const type = q.type ?? null;
      // Cursor values are bound as text and cast in SQL: a parameter typed timestamptz would go through a JS Date and
      // lose microseconds, so a row would compare unequal to its own cursor and the page would repeat.
      return q.tab === "live"
        ? tx<(CardRow & { cursor_k: string; cursor_c: string })[]>`${base}
            where c.status = 'live' and c.ends_at > now() and (${type}::text is null or c.type::text = ${type})
              and (${cur?.k ?? null}::text::timestamptz is null
                   or c.ends_at > ${cur?.k ?? null}::text::timestamptz
                   or (c.ends_at = ${cur?.k ?? null}::text::timestamptz
                       and (c.created_at < ${cur?.c ?? null}::text::timestamptz
                            or (c.created_at = ${cur?.c ?? null}::text::timestamptz and c.id > ${cur?.id ?? null}::uuid))))
            order by c.ends_at asc, c.created_at desc, c.id asc limit ${q.limit + 1}`
        : tx<(CardRow & { cursor_k: string; cursor_c: string })[]>`${base}
            where (c.status in ('funded', 'released')
                   or (c.status = 'closed' and exists (select 1 from public.campaign_tranches t where t.campaign_id = c.id and t.status = 'released')))
              and (${type}::text is null or c.type::text = ${type})
              and (${cur?.k ?? null}::text::timestamptz is null or (c.settled_at, c.id) < (${cur?.k ?? null}::text::timestamptz, ${cur?.id ?? null}::uuid))
            order by c.settled_at desc, c.id desc limit ${q.limit + 1}`;
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > q.limit && last
      ? encodeCursor({ k: last.cursor_k, c: q.tab === "live" ? last.cursor_c : null, id: last.id })
      : null;
    return { campaigns: page.map(card), nextCursor };
  });

  app.get<{ Params: { slug: string } }>("/campaigns/:slug", async (req): Promise<CampaignDetail> => {
    const user = await optionalUser(req, d.verify);
    if (!/^[a-z0-9-]{3,80}$/i.test(req.params.slug)) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
    return asUser(d.sql, user, async (tx) => {
      const [c] = await tx<(CardRow & { story: string | null; risks: string | null; starts_at: Date | null })[]>`
        select c.id, c.slug, c.title, c.type::text, c.blurb, c.status::text, c.created_at, c.settled_at, c.goal_minor, c.raised_minor,
               c.backers_count, c.ends_at, c.milestone_release, c.story, c.risks, c.starts_at,
               a.id as artist_id, a.slug as artist_slug, a.name as artist_name, a.genre, a.city, a.tier::text
          from public.campaigns c join public.artists a on a.id = c.artist_id
         where c.slug = ${req.params.slug} and public.campaign_is_public(c.status)`;
      if (!c) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
      const perks = await tx<{ id: string; title: string; description: string | null; kind: "digital" | "physical" | "experience"; price_minor: bigint; quantity_limit: number | null; claimed: number; fulfill_by: Date }[]>`
        select id, title, description, kind::text, price_minor, quantity_limit, claimed, fulfill_by from public.perks where campaign_id = ${c.id} order by sort, price_minor`;
      const tranches = await tx<{ seq: number; pct: number; milestone: string | null; status: string; target_date: Date | null; verified_at: Date | null; released_at: Date | null }[]>`
        select seq, pct, milestone, status::text, target_date, verified_at, released_at from public.campaign_tranches where campaign_id = ${c.id} order by seq`;
      return {
        campaign: { ...card(c), story: c.story, risks: c.risks, startsAt: c.starts_at?.toISOString() ?? null },
        perks: perks.map((p) => ({
          id: p.id, title: p.title, description: p.description, kind: p.kind, priceMinor: n(p.price_minor),
          remaining: p.quantity_limit == null ? null : Math.max(0, p.quantity_limit - p.claimed), limit: p.quantity_limit,
          fulfillBy: p.fulfill_by.toISOString().slice(0, 10),
        })),
        tranches: tranches.map((t) => ({
          seq: t.seq, pct: t.pct, milestone: t.milestone, status: t.status,
          targetDate: t.target_date ? t.target_date.toISOString().slice(0, 10) : null,
          verifiedAt: t.verified_at?.toISOString() ?? null, releasedAt: t.released_at?.toISOString() ?? null,
        })),
      };
    });
  });
};
