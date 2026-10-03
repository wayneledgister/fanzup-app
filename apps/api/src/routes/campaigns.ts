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
  cursor: z.string().max(200).optional(),
});
/** Opaque cursor: base64url of { k: sort key (ISO date), id } (G2 condition 14). */
const encodeCursor = (k: string, id: string) => Buffer.from(JSON.stringify({ k, id })).toString("base64url");
function decodeCursor(c: string | undefined): { k: string; id: string } | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (typeof v.k === "string" && typeof v.id === "string" && !Number.isNaN(Date.parse(v.k)) && /^[0-9a-f-]{36}$/.test(v.id)) return v;
  } catch { /* fall through */ }
  throw new HttpError(400, "invalid_cursor", "That page link is no longer valid.");
}

/**
 * Public discovery (FR-CMP-008, NFR-PERF-06): live campaigns ending soonest first, or recently funded ones.
 * Never ordered by money raised or anything return-like (PRD 02 §8). Runs under RLS as anon or the user.
 */
export const campaignRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/campaigns", async (req): Promise<CampaignList> => {
    const user = await optionalUser(req, d.verify);
    const q = ListQuery.parse(req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await asUser(d.sql, user, (tx) => {
      const base = tx`
        select c.id, c.slug, c.title, c.type::text, c.blurb, c.status::text, c.created_at, c.settled_at, c.goal_minor, c.raised_minor,
               c.backers_count, c.ends_at, c.milestone_release, a.id as artist_id, a.slug as artist_slug, a.name as artist_name,
               a.genre, a.city, a.tier::text
          from public.campaigns c join public.artists a on a.id = c.artist_id`;
      return q.tab === "live"
        ? tx<CardRow[]>`${base}
            where c.status = 'live' and c.ends_at > now() and (${q.type ?? null}::text is null or c.type::text = ${q.type ?? null})
              and (${cur?.k ?? null}::timestamptz is null or (c.ends_at, c.id) > (${cur?.k ?? null}::timestamptz, ${cur?.id ?? null}::uuid))
            order by c.ends_at, c.id limit ${PAGE + 1}`
        : tx<CardRow[]>`${base}
            where c.status in ('funded', 'released', 'closed') and (${q.type ?? null}::text is null or c.type::text = ${q.type ?? null})
              and (${cur?.k ?? null}::timestamptz is null or (c.settled_at, c.id) < (${cur?.k ?? null}::timestamptz, ${cur?.id ?? null}::uuid))
            order by c.settled_at desc, c.id desc limit ${PAGE + 1}`;
    });
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    const nextCursor = rows.length > PAGE && last ? encodeCursor(((q.tab === "live" ? last.ends_at : last.settled_at) as Date).toISOString(), last.id) : null;
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
