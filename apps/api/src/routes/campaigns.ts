import type { FastifyPluginAsync } from "fastify";
import { asUser, n } from "../db";
import { optionalUser, HttpError } from "../lib/auth";
import type { Deps } from "../app";

type CardRow = {
  id: string; slug: string; title: string; type: string; blurb: string | null; status: string;
  goal_minor: bigint; raised_minor: bigint; backers_count: number; ends_at: Date | null; milestone_release: boolean;
  artist_id: string; artist_slug: string; artist_name: string; genre: string | null; city: string | null; tier: string;
};

const card = (r: CardRow) => ({
  id: r.id, slug: r.slug, title: r.title, type: r.type, blurb: r.blurb, status: r.status,
  goalMinor: n(r.goal_minor), raisedMinor: n(r.raised_minor), backers: r.backers_count,
  endsAt: r.ends_at?.toISOString() ?? null, milestoneRelease: r.milestone_release,
  artist: { id: r.artist_id, slug: r.artist_slug, name: r.artist_name, genre: r.genre, city: r.city, tier: r.tier },
});

/** Public discovery reads. Runs under RLS as anon or the signed-in user. Never sorted by anything return-like (PRD 02 §8). */
export const campaignRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/campaigns", async (req) => {
    const user = await optionalUser(req, d.verify);
    const rows = await asUser(d.sql, user, (tx) => tx<CardRow[]>`select * from public.campaign_cards order by ends_at nulls last, title`);
    return { campaigns: rows.map(card) };
  });

  app.get<{ Params: { slug: string } }>("/campaigns/:slug", async (req) => {
    const user = await optionalUser(req, d.verify);
    return asUser(d.sql, user, async (tx) => {
      const [c] = await tx<CardRow[]>`select * from public.campaign_cards where slug = ${req.params.slug}`;
      if (!c) throw new HttpError(404, "not_found", "We couldn't find that campaign.");
      const perks = await tx<{ id: string; title: string; description: string | null; kind: string; price_minor: bigint; quantity_limit: number | null; claimed: number; fulfill_by: Date }[]>`
        select id, title, description, kind, price_minor, quantity_limit, claimed, fulfill_by from public.perks where campaign_id = ${c.id} order by sort, price_minor`;
      const tranches = await tx<{ seq: number; pct: number; milestone: string | null; status: string }[]>`
        select seq, pct, milestone, status from public.campaign_tranches where campaign_id = ${c.id} order by seq`;
      return {
        campaign: card(c),
        perks: perks.map((p) => ({
          id: p.id, title: p.title, description: p.description, kind: p.kind, priceMinor: n(p.price_minor),
          remaining: p.quantity_limit == null ? null : p.quantity_limit - p.claimed,
          fulfillBy: p.fulfill_by.toISOString().slice(0, 10),
        })),
        tranches,
      };
    });
  });
};
