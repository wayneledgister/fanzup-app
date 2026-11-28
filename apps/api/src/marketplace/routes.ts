/**
 * Services marketplace, Phase MKT-1 (CR-005; specs/marketplace/02-design.md §3). FR-MKT-001…010.
 *
 * NO MONEY (NFR-MKT-01, ADR-010): nothing here calls the payment provider, writes the ledger or reads balances.
 * The tables grant nothing to anon/authenticated (NFR-MKT-03), so every query runs as the service role and checks
 * ownership against the verified user in its own `where` clause. Contact details appear only for the counterpart of an
 * accepted request (NFR-MKT-04).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { POLICY } from "@fanzup/shared/policy";
import {
  AudienceInput, InviteInput, JoinInput, type InviteView, type MarketplaceAccess, type MarketplaceMetrics, type MemberView,
  Category, ListingsInput, ProviderProfileInput, ProviderReviewInput, RespondInput, ServiceRequestInput,
  type ListingView, type MyProvider, type ProviderPage, type ServiceList, type ServiceRequestView,
} from "@fanzup/shared/marketplace";
import { asService, n, type Claims, type Tx } from "../db";
import { HttpError, requireVerifiedUser } from "../lib/auth";
import { privileged, requireStaff } from "../staff";
import type { Deps } from "../app";
import { audit, INVITE_EXISTS, PROVIDER_CHANGED, REVIEW_FROM, VERSION } from "./service";
import { accessFor, hasProviderTerms, INVITE_ONLY, requireProviderTerms, viewer, type Access } from "./access";

const M = POLICY.marketplace;

export async function marketplaceOn(d: Pick<Deps, "sql">): Promise<boolean> {
  const [r] = await asService(d.sql, (tx) => tx<{ on: boolean }[]>`select public.marketplace_enabled() as on`);
  return r.on;
}
const DISABLED = () => new HttpError(404, "marketplace_disabled", "The services marketplace isn't open yet.");
const NOT_FOUND = () => new HttpError(404, "not_found", "We couldn't find that.");
const gate = (d: Deps) => async (_req: FastifyRequest) => {
  if (!(await marketplaceOn(d))) throw DISABLED();
};
/** FR-MKT-021 / NFR-MKT-09: signed out → 401 (so clients can offer sign-in), signed in but outside the audience → 403. */
function need(a: Access, what: "canBrowse" | "canRequest" | "canProvide") {
  if (a[what]) return;
  if (!a.signedIn) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  throw INVITE_ONLY();
}
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
const uuid = (id: string) => {
  if (!z.string().uuid().safeParse(id).success) throw NOT_FOUND();
  return id;
};

interface ListingRow {
  id: string; category: string; title: string; description: string | null; price_from_minor: bigint | null;
  price_unit: string; turnaround_days: number | null; active: boolean;
}
const listingView = (l: ListingRow): ListingView => ({
  id: l.id, category: l.category as ListingView["category"], title: l.title, description: l.description,
  priceFromMinor: l.price_from_minor == null ? null : n(l.price_from_minor), priceUnit: l.price_unit as ListingView["priceUnit"],
  turnaroundDays: l.turnaround_days, active: l.active,
});
const listingsOf = (tx: Tx, providerId: string, activeOnly: boolean) => tx<ListingRow[]>`
  select id, category, title, description, price_from_minor, price_unit, turnaround_days, active
    from public.service_listings where provider_id = ${providerId} and (${!activeOnly} or active) order by position`;

interface ProviderRow {
  id: string; owner_id: string; slug: string; display_name: string; headline: string; bio: string | null; city: string | null;
  remote_ok: boolean; categories: string[]; links: string[]; contact_email: string; status: string; review_note: string | null;
}
const pageView = (p: ProviderRow, listings: ListingRow[]): ProviderPage => ({
  slug: p.slug, displayName: p.display_name, headline: p.headline, bio: p.bio, city: p.city, remoteOk: p.remote_ok,
  categories: p.categories as ProviderPage["categories"], links: p.links, listings: listings.map(listingView),
});

interface RequestRow {
  id: string; status: string; brief: string; budget_minor: bigint | null; needed_by: string | null; created_at: Date;
  responded_at: Date | null; provider_note: string | null; listing_id: string | null; listing_title: string; listing_category: string;
  provider_slug: string; provider_name: string; provider_email: string; artist_name: string; campaign_id: string | null;
  campaign_title: string | null; requester_email: string | null;
}
const requestSelect = (tx: Tx) => tx`
  select r.id, r.status, r.brief, r.budget_minor, r.needed_by::text, r.created_at, r.responded_at, r.provider_note,
         r.listing_id, r.listing_title, r.listing_category, p.slug::text as provider_slug, p.display_name as provider_name,
         p.contact_email as provider_email, a.name as artist_name, r.campaign_id, c.title as campaign_title, r.requester_email
    from public.service_requests r
    join public.service_providers p on p.id = r.provider_id
    join public.artists a on a.id = r.artist_id
    left join public.campaigns c on c.id = r.campaign_id`;
function requestView(r: RequestRow, viewer: "artist" | "provider"): ServiceRequestView {
  const accepted = r.status === "accepted";
  return {
    id: r.id, status: r.status as ServiceRequestView["status"], brief: r.brief, budgetMinor: r.budget_minor == null ? null : n(r.budget_minor),
    neededBy: r.needed_by, createdAt: r.created_at.toISOString(), respondedAt: r.responded_at?.toISOString() ?? null, providerNote: r.provider_note,
    listing: { id: r.listing_id ?? "", title: r.listing_title, category: r.listing_category as ServiceRequestView["listing"]["category"] },
    provider: { slug: r.provider_slug, displayName: r.provider_name },
    artist: { name: r.artist_name },
    campaign: r.campaign_id && r.campaign_title ? { id: r.campaign_id, title: r.campaign_title } : null,
    // FR-MKT-009 / NFR-MKT-04: the counterpart's contact, only once accepted (and the requester's only with consent).
    ...(viewer === "artist" ? { providerContactEmail: accepted ? r.provider_email : null } : { requesterEmail: accepted ? r.requester_email : null }),
  };
}


/** Public browse + provider page + the artist's requests (`/v1/services`). */
export const marketplaceRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", gate(d));

  // FR-MKT-005. Most recently listed first; never ranked by money (no paid placement in MKT-1).
  app.get("/", async (req): Promise<ServiceList> => {
    need(await accessFor(d.sql, await viewer(req, d.verify)), "canBrowse");
    const q = z.object({
      category: Category.optional(),
      q: z.string().trim().max(80).optional(),
      remote: z.enum(["true", "false"]).optional(),
      cursor: z.string().regex(/^\d+$/).optional(),
    }).parse(req.query);
    const offset = Number(q.cursor ?? 0);
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await asService(d.sql, (tx) => tx<(ListingRow & { slug: string; display_name: string; headline: string; city: string | null; remote_ok: boolean })[]>`
      select l.id, l.category, l.title, l.description, l.price_from_minor, l.price_unit, l.turnaround_days, l.active,
             p.slug::text, p.display_name, p.headline, p.city, p.remote_ok
        from public.service_listings l join public.service_providers p on p.id = l.provider_id
       where p.status = 'listed' and l.active
         and (${q.category ?? null}::text is null or l.category = ${q.category ?? null})
         and (${q.remote !== "true"} or p.remote_ok)
         and (${like}::text is null or l.title ilike ${like} or p.headline ilike ${like} or p.display_name ilike ${like})
       order by p.listed_at desc, p.id, l.position
       limit ${M.pageSize + 1} offset ${offset}`);
    const more = rows.length > M.pageSize;
    return {
      items: rows.slice(0, M.pageSize).map((r) => ({
        ...listingView(r),
        provider: { slug: r.slug, displayName: r.display_name, headline: r.headline, city: r.city, remoteOk: r.remote_ok },
      })),
      nextCursor: more ? String(offset + M.pageSize) : null,
    };
  });

  // FR-MKT-006.
  app.get<{ Params: { slug: string } }>("/providers/:slug", async (req): Promise<ProviderPage> => {
    need(await accessFor(d.sql, await viewer(req, d.verify)), "canBrowse");
    const slug = z.string().regex(/^[a-z0-9-]{3,60}$/).safeParse(req.params.slug);
    if (!slug.success) throw NOT_FOUND();
    return asService(d.sql, async (tx) => {
      const [p] = await tx<ProviderRow[]>`select * from public.service_providers where slug = ${slug.data} and status = 'listed'`;
      if (!p) throw NOT_FOUND();
      return pageView(p, await listingsOf(tx, p.id, true));
    });
  });

  // FR-MKT-007.
  app.post("/requests", async (req, reply) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    need(await accessFor(d.sql, u), "canRequest");
    const b = ServiceRequestInput.parse(req.body);
    // The client sends its local calendar date; allow "tomorrow" anywhere west of UTC (review finding 3).
    const yesterdayUtc = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (b.neededBy && b.neededBy <= yesterdayUtc) throw new HttpError(400, "invalid_request", "Pick a needed-by date in the future.");
    const row = await asService(d.sql, async (tx) => {
      const [artist] = await tx<{ id: string }[]>`select id from public.artists where owner_id = ${u.sub} order by created_at limit 1`;
      if (!artist) throw new HttpError(403, "no_artist", "Create your artist profile first, then you can request services.");
      const [l] = await tx<{ id: string; title: string; category: string; provider_id: string; owner_id: string }[]>`
        select l.id, l.title, l.category, l.provider_id, p.owner_id from public.service_listings l
          join public.service_providers p on p.id = l.provider_id
         where l.id = ${b.listingId} and l.active and p.status = 'listed'`;
      if (!l) throw NOT_FOUND();
      if (l.owner_id === u.sub) throw new HttpError(409, "own_listing", "That's your own listing.");
      if (b.campaignId) {
        const [c] = await tx`select 1 from public.campaigns where id = ${b.campaignId} and artist_id = ${artist.id}`;
        if (!c) throw new HttpError(400, "invalid_request", "Pick one of your own campaigns.");
      }
      // Daily limit: check and insert under one per-user lock so two requests can't both fit (FR-MKT-007).
      await tx`select pg_advisory_xact_lock(hashtext(${"service_requests:" + u.sub}))`;
      const [day] = await tx<{ c: bigint }[]>`
        select count(*) as c from public.service_requests
         where requester_id = ${u.sub} and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
      if (n(day.c) >= M.requestsPerDay) throw new HttpError(429, "daily_limit", "You've sent today's maximum of service requests. Try again tomorrow.");
      const [open] = await tx`select 1 from public.service_requests where artist_id = ${artist.id} and listing_id = ${l.id} and status = 'sent'`;
      if (open) throw new HttpError(409, "already_requested", "You already have an open request for this service.");
      const [email] = b.shareEmail ? await tx<{ email: string | null }[]>`select public.marketplace_requester_email(${u.sub}) as email` : [{ email: null }];
      const [r] = await tx<{ id: string }[]>`
        insert into public.service_requests (listing_id, listing_title, listing_category, provider_id, requester_id, artist_id, campaign_id,
                                             brief, budget_minor, needed_by, share_email, requester_email)
        values (${l.id}, ${l.title}, ${l.category}, ${l.provider_id}, ${u.sub}, ${artist.id}, ${b.campaignId ?? null},
                ${b.brief}, ${b.budgetMinor ?? null}, ${b.neededBy ?? null}, ${b.shareEmail}, ${b.shareEmail ? email?.email ?? null : null})
        returning id`;
      await audit(tx, u.sub, "marketplace.request.sent", "service_request", r.id, { provider_id: l.provider_id });
      const [view] = await tx<RequestRow[]>`${requestSelect(tx)} where r.id = ${r.id}`;
      return view;
    });
    return reply.status(201).send(requestView(row, "artist"));
  });

  // FR-MKT-024 (CR-007): what the caller may do. Behind the flag only; clients hide entry points with it.
  app.get("/access", async (req): Promise<MarketplaceAccess> => {
    const u = await viewer(req, d.verify);
    const a = await accessFor(d.sql, u);
    const accepted = u ? await asService(d.sql, (tx) => hasProviderTerms(tx, u.sub)) : false;
    return {
      audience: a.audience, signedIn: a.signedIn, member: a.member, canBrowse: a.canBrowse, canRequest: a.canRequest, canProvide: a.canProvide,
      providerTerms: { version: POLICY.legal.providerTerms.version, approved: POLICY.legal.providerTerms.approved, accepted },
    };
  });

  // FR-MKT-023 (CR-007): redeem a single-use invite bound to the account's email.
  app.post("/join", async (req) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    const parsed = JoinInput.safeParse(req.body);
    const INVALID = () => new HttpError(410, "invite_invalid", "This invite link doesn't work any more. Ask the FanZuP team for a new one.");
    if (!parsed.success) throw INVALID();
    return asService(d.sql, async (tx) => {
      const [inv] = await tx<{ id: string; email: string; kind: "provider" | "artist"; open: boolean }[]>`
        select id, email::text, kind, (redeemed_at is null and revoked_at is null and expires_at > now()) as open
          from public.marketplace_invites where code_hash = ${hashCode(parsed.data.code)} for update`;
      if (!inv?.open) throw INVALID();
      const [me] = await tx<{ email: string | null }[]>`select public.marketplace_requester_email(${u.sub}) as email`;
      if (!me?.email || me.email.toLowerCase() !== inv.email.toLowerCase()) {
        throw new HttpError(403, "invite_email_mismatch", "This invite was sent to a different email address. Sign in with the account that got the invite.");
      }
      await tx`update public.marketplace_invites set redeemed_at = now(), redeemed_by = ${u.sub} where id = ${inv.id}`;
      // A provider invite upgrades an artist member; an artist invite never downgrades a provider. Re-joining clears a removal.
      const [m] = await tx<{ kind: "provider" | "artist" }[]>`
        insert into public.marketplace_members (user_id, kind, invite_id) values (${u.sub}, ${inv.kind}, ${inv.id})
        on conflict (user_id) do update
          set kind = case when public.marketplace_members.kind = 'provider' and public.marketplace_members.removed_at is null then 'provider' else excluded.kind end,
              invite_id = excluded.invite_id, removed_at = null, removed_by = null,
              joined_at = case when public.marketplace_members.removed_at is null then public.marketplace_members.joined_at else now() end
        returning kind`;
      await audit(tx, u.sub, "marketplace.member.joined", "marketplace_invite", inv.id, { kind: m.kind });
      return { member: { kind: m.kind } };
    });
  });

  // FR-MKT-010.
  app.get("/requests", async (req) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    const rows = await asService(d.sql, (tx) => tx<RequestRow[]>`${requestSelect(tx)} where r.requester_id = ${u.sub} order by r.created_at desc limit 100`);
    return { items: rows.map((r) => requestView(r, "artist")) };
  });

  app.post<{ Params: { id: string } }>("/requests/:id/withdraw", async (req) => {
    const u = await requireVerifiedUser(req, d.verify, d.sql);
    const id = uuid(req.params.id);
    return asService(d.sql, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        update public.service_requests set status = 'withdrawn' where id = ${id} and requester_id = ${u.sub} and status = 'sent' returning id`;
      if (!r) throw new HttpError(409, "not_open", "Only requests still waiting for the provider can be withdrawn.");
      await audit(tx, u.sub, "marketplace.request.withdrawn", "service_request", id);
      const [view] = await tx<RequestRow[]>`${requestSelect(tx)} where r.id = ${id}`;
      return requestView(view, "artist");
    });
  });
};

/** The provider's own profile, listings and inbox (`/v1/provider`). FR-MKT-003/004/009. */
export const providerRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", gate(d));
  app.addHook("preHandler", async (req) => {
    (req as unknown as { fzUser: Claims }).fzUser = await requireVerifiedUser(req, d.verify, d.sql);
  });
  const userOf = (req: unknown) => (req as { fzUser: Claims }).fzUser;

  async function mine(tx: Tx, userId: string): Promise<ProviderRow> {
    const [p] = await tx<ProviderRow[]>`select * from public.service_providers where owner_id = ${userId} for update`;
    if (!p) throw new HttpError(404, "no_provider", "Create your provider profile first.");
    return p;
  }
  const myView = async (tx: Tx, p: ProviderRow): Promise<MyProvider> => ({
    ...pageView(p, await listingsOf(tx, p.id, false)),
    id: p.id, status: p.status as MyProvider["status"], reviewNote: p.review_note, contactEmail: p.contact_email,
  });
  // Editing what staff vetted takes a listed profile back to review (design §3).
  const REVIEWED = ["display_name", "headline", "bio", "categories", "links"] as const;

  app.get("/", async (req) => {
    const u = userOf(req);
    return asService(d.sql, async (tx) => {
      const [p] = await tx<ProviderRow[]>`select * from public.service_providers where owner_id = ${u.sub}`;
      return { provider: p ? await myView(tx, p) : null };
    });
  });

  // Create or update (FR-MKT-003).
  app.put("/", async (req) => {
    const u = userOf(req);
    const b = ProviderProfileInput.parse(req.body);
    // Creating a profile needs provider access and the current Provider Terms (CR-007, FR-MKT-021/025); editing an
    // existing one needs only ownership (design §12.2).
    const [has] = await asService(d.sql, (tx) => tx`select 1 from public.service_providers where owner_id = ${u.sub}`);
    if (!has) {
      need(await accessFor(d.sql, u), "canProvide");
      await asService(d.sql, (tx) => requireProviderTerms(tx, u.sub));
    }
    return saveProfile(u, b).catch((e: { code?: string; constraint_name?: string }) => {
      // Two saves racing past the checks below hit the unique constraints (review finding 5).
      if (e.code === "23505" && e.constraint_name === "service_providers_slug_key") throw new HttpError(409, "slug_taken", "That profile address is taken. Try another.");
      if (e.code === "23505" && e.constraint_name === "service_providers_owner_id_key") throw new HttpError(409, "already_exists", "Your profile was just created. Reload the page.");
      throw e;
    });
  });
  const saveProfile = (u: Claims, b: ReturnType<typeof ProviderProfileInput.parse>) =>
    asService(d.sql, async (tx) => {
      const [existing] = await tx<ProviderRow[]>`select * from public.service_providers where owner_id = ${u.sub} for update`;
      const [taken] = await tx`select 1 from public.service_providers where slug = ${b.slug} and owner_id <> ${u.sub}`;
      if (taken) throw new HttpError(409, "slug_taken", "That profile address is taken. Try another.");
      if (!existing) {
        await requireProviderTerms(tx, u.sub);
        const [p] = await tx<ProviderRow[]>`
          insert into public.service_providers (owner_id, slug, display_name, headline, bio, city, remote_ok, categories, links, contact_email)
          values (${u.sub}, ${b.slug}, ${b.displayName}, ${b.headline}, ${b.bio ?? null}, ${b.city ?? null}, ${b.remoteOk},
                  ${b.categories}, ${b.links}, ${b.contactEmail})
          returning *`;
        await audit(tx, u.sub, "marketplace.provider.created", "service_provider", p.id);
        return { provider: await myView(tx, p) };
      }
      if (existing.status === "suspended") throw new HttpError(409, "suspended", "This profile isn't listed. Contact FanZuP support.");
      const next = { display_name: b.displayName, headline: b.headline, bio: b.bio ?? null, categories: b.categories, links: b.links };
      const changed = REVIEWED.some((k) => JSON.stringify(existing[k]) !== JSON.stringify(next[k]));
      const status = existing.status === "listed" && changed ? "in_review" : existing.status;
      const [p] = await tx<ProviderRow[]>`
        update public.service_providers
           set slug = ${b.slug}, display_name = ${b.displayName}, headline = ${b.headline}, bio = ${b.bio ?? null}, city = ${b.city ?? null},
               remote_ok = ${b.remoteOk}, categories = ${b.categories}, links = ${b.links}, contact_email = ${b.contactEmail},
               status = ${status}, submitted_at = case when ${status !== existing.status} then now() else submitted_at end
         where id = ${existing.id} returning *`;
      // A listing may no longer match the provider's categories; deactivate those rather than reject the edit.
      await tx`update public.service_listings set active = false where provider_id = ${p.id} and active and not (category = any (${b.categories}))`;
      if (status !== existing.status) await audit(tx, u.sub, "marketplace.provider.resubmitted", "service_provider", p.id, { reason: "edited_while_listed" });
      return { provider: await myView(tx, p) };
    });

  // FR-MKT-004: the provider sends the full list. Rows carrying an `id` are updated in place (ids stay stable, so open
  // requests keep their listing and the one-open-request rule holds; review finding 1); rows without one are new; rows
  // left out are deleted.
  app.put("/listings", async (req) => {
    const u = userOf(req);
    const ls = ListingsInput.parse(req.body);
    return asService(d.sql, async (tx) => {
      const p = await mine(tx, u.sub);
      if (p.status === "suspended") throw new HttpError(409, "suspended", "This profile isn't listed. Contact FanZuP support.");
      const bad = ls.find((l) => !p.categories.includes(l.category));
      if (bad) throw new HttpError(400, "invalid_request", "Each listing's category must be one of your profile's categories.");
      const before = await listingsOf(tx, p.id, false);
      const known = new Set(before.map((l) => l.id));
      const ids = ls.map((l) => l.id).filter((x): x is string => !!x);
      if (ids.some((x) => !known.has(x)) || new Set(ids).size !== ids.length) throw new HttpError(400, "invalid_request", "One of those services isn't yours. Reload the page.");
      await tx`delete from public.service_listings where provider_id = ${p.id} and not (id = any (${ids}::uuid[]))`;
      for (const [i, l] of ls.entries()) {
        if (l.id) {
          await tx`update public.service_listings
                      set position = ${i}, category = ${l.category}, title = ${l.title}, description = ${l.description ?? null},
                          price_from_minor = ${l.priceFromMinor ?? null}, price_unit = ${l.priceUnit}, turnaround_days = ${l.turnaroundDays ?? null}, active = ${l.active}
                    where id = ${l.id} and provider_id = ${p.id}`;
        } else {
          await tx`insert into public.service_listings (provider_id, position, category, title, description, price_from_minor, price_unit, turnaround_days, active)
                   values (${p.id}, ${i}, ${l.category}, ${l.title}, ${l.description ?? null}, ${l.priceFromMinor ?? null}, ${l.priceUnit}, ${l.turnaroundDays ?? null}, ${l.active})`;
        }
      }
      const after = await listingsOf(tx, p.id, false);
      const norm = (x: ListingRow[]) => JSON.stringify(x.map((r) => ({ ...r, price_from_minor: r.price_from_minor == null ? null : n(r.price_from_minor) })));
      let status = p.status;
      if (norm(before) !== norm(after)) {
        if (p.status === "listed") {
          status = "in_review";
          await tx`update public.service_providers set status = 'in_review', submitted_at = now() where id = ${p.id}`;
          await audit(tx, u.sub, "marketplace.provider.resubmitted", "service_provider", p.id, { reason: "listings_changed" });
        } else {
          // Bump the profile's version, so a staff decision on what they read before this change is refused.
          await tx`update public.service_providers set updated_at = now() where id = ${p.id}`;
        }
      }
      // A deleted listing's open requests keep their own title/category copy (listing_id becomes null).
      return { provider: await myView(tx, { ...p, status }) };
    });
  });

  app.post("/submit", async (req) => {
    const u = userOf(req);
    need(await accessFor(d.sql, u), "canProvide");
    return asService(d.sql, async (tx) => {
      await requireProviderTerms(tx, u.sub);
      const p = await mine(tx, u.sub);
      if (!["draft", "changes_requested"].includes(p.status)) throw new HttpError(409, "not_submittable", "Only drafts and profiles with requested changes can be submitted.");
      const [active] = await tx`select 1 from public.service_listings where provider_id = ${p.id} and active limit 1`;
      if (!active) throw new HttpError(409, "no_listings", "Add at least one active listing before you submit.");
      const [row] = await tx<ProviderRow[]>`update public.service_providers set status = 'in_review', submitted_at = now() where id = ${p.id} returning *`;
      await audit(tx, u.sub, "marketplace.provider.submitted", "service_provider", p.id);
      return { provider: await myView(tx, row) };
    });
  });

  // FR-MKT-009.
  app.get("/requests", async (req) => {
    const u = userOf(req);
    const rows = await asService(d.sql, (tx) => tx<RequestRow[]>`${requestSelect(tx)} where p.owner_id = ${u.sub} order by r.created_at desc limit 100`);
    return { items: rows.map((r) => requestView(r, "provider")) };
  });

  app.post<{ Params: { id: string } }>("/requests/:id/respond", async (req) => {
    const u = userOf(req);
    const id = uuid(req.params.id);
    const b = RespondInput.parse(req.body);
    return asService(d.sql, async (tx) => {
      await requireProviderTerms(tx, u.sub);
      const [r] = await tx<{ id: string }[]>`
        update public.service_requests r set status = ${b.decision}, provider_note = ${b.note ?? null}, responded_at = now()
          from public.service_providers p
         where r.id = ${id} and p.id = r.provider_id and p.owner_id = ${u.sub} and p.status <> 'suspended' and r.status = 'sent'
         returning r.id`;
      if (!r) {
        const [exists] = await tx`select 1 from public.service_requests r join public.service_providers p on p.id = r.provider_id where r.id = ${id} and p.owner_id = ${u.sub}`;
        if (!exists) throw NOT_FOUND();
        throw new HttpError(409, "already_answered", "This request has already been answered or withdrawn.");
      }
      await audit(tx, u.sub, `marketplace.request.${b.decision}`, "service_request", id);
      const [view] = await tx<RequestRow[]>`${requestSelect(tx)} where r.id = ${id}`;
      return requestView(view, "provider");
    });
  });
};

/** Staff vetting (`/v1/staff/marketplace`). FR-MKT-008. */
export const marketplaceStaffRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.addHook("preHandler", gate(d));
  app.addHook("preHandler", async (req) => {
    await requireStaff(req, d);
  });

  app.get("/providers", async (req) => {
    const q = z.object({ status: z.enum(["draft", "in_review", "changes_requested", "listed", "suspended"]).default("in_review") }).parse(req.query);
    return asService(d.sql, async (tx) => {
      const ps = await tx<(ProviderRow & { submitted_at: Date | null; version: string })[]>`
        select *, ${tx.unsafe(VERSION)} as version from public.service_providers where status = ${q.status} order by submitted_at nulls last, created_at limit 100`;
      const items = [];
      for (const p of ps) {
        items.push({ ...pageView(p, await listingsOf(tx, p.id, false)), id: p.id, status: p.status, reviewNote: p.review_note, submittedAt: p.submitted_at?.toISOString() ?? null, version: p.version });
      }
      return { items };
    });
  });

  app.post<{ Params: { id: string } }>("/providers/:id/review", async (req) => {
    const id = uuid(req.params.id);
    const b = ProviderReviewInput.parse(req.body);
    const [p] = await asService(d.sql, (tx) => tx<{ status: string; version: string }[]>`select status, ${tx.unsafe(VERSION)} as version from public.service_providers where id = ${id}`);
    if (!p) throw NOT_FOUND();
    if (!REVIEW_FROM[b.decision].includes(p.status)) throw new HttpError(409, "invalid_transition", `A ${p.status.replace("_", " ")} profile can't be ${b.decision.replace("_", " ")}.`);
    // Staff decide on the version they read (review finding 2): an edit since then, or another decision, refuses this one.
    if (p.version !== b.version) throw PROVIDER_CHANGED();
    return { action: await privileged(d, { action: "provider.review", subjectId: id, reason: b.reason, params: { decision: b.decision, note: b.note ?? null, version: b.version } }) };
  });

  // ── Closed beta (CR-007, design §12.5) ──
  /** FR-MKT-021. */
  app.post("/audience", async (req) => {
    const b = AudienceInput.parse(req.body);
    const action = await privileged(d, { action: "marketplace.audience", subjectId: null, reason: b.reason, params: { audience: b.audience } });
    return { action, audience: b.audience };
  });

  const inviteSelect = (tx: Tx) => tx`
    select id, email::text, name, kind, note, created_at, expires_at, redeemed_at,
           case when redeemed_at is not null then 'redeemed' when revoked_at is not null then 'revoked'
                when expires_at <= now() then 'expired' else 'open' end as status
      from public.marketplace_invites`;
  type InviteRow = { id: string; email: string; name: string | null; kind: InviteView["kind"]; note: string | null; status: InviteView["status"]; created_at: Date; expires_at: Date; redeemed_at: Date | null };
  const inviteView = (r: InviteRow): InviteView => ({
    id: r.id, email: r.email, name: r.name, kind: r.kind, note: r.note, status: r.status,
    createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString(), redeemedAt: r.redeemed_at?.toISOString() ?? null,
  });

  /** FR-MKT-022. */
  app.get("/invites", async () => {
    const rows = await asService(d.sql, (tx) => tx<InviteRow[]>`${inviteSelect(tx)} order by created_at desc limit 200`);
    return { items: rows.map(inviteView) };
  });

  /** FR-MKT-022. The code is answered once and only its hash is stored or passed on (NFR-MKT-08). */
  app.post("/invites", async (req, reply) => {
    const b = InviteInput.parse(req.body);
    const email = b.email.toLowerCase();
    // Checked before privileged() so a duplicate doesn't leave a failed action; the unique index decides a race.
    const [open] = await asService(d.sql, (tx) => tx`
      select 1 from public.marketplace_invites where email = ${email} and redeemed_at is null and revoked_at is null and expires_at > now()`);
    if (open) throw INVITE_EXISTS();
    const code = randomBytes(18).toString("base64url");
    const inviteId = randomUUID();
    const action = await privileged(d, {
      action: "marketplace.invite", subjectId: inviteId, reason: b.reason,
      params: { inviteId, codeHash: hashCode(code), email, kind: b.kind, name: b.name || null, note: b.note || null, days: M.inviteDays },
    });
    const [row] = await asService(d.sql, (tx) => tx<InviteRow[]>`${inviteSelect(tx)} where id = ${inviteId}`);
    return reply.status(201).send({ action: { ...action, result: undefined }, invite: inviteView(row), code });
  });

  app.post<{ Params: { id: string } }>("/invites/:id/revoke", async (req) => {
    const id = uuid(req.params.id);
    const b = z.object({ reason: z.string() }).parse(req.body);
    const [inv] = await asService(d.sql, (tx) => tx<{ open: boolean }[]>`
      select (redeemed_at is null and revoked_at is null) as open from public.marketplace_invites where id = ${id}`);
    if (!inv) throw NOT_FOUND();
    if (!inv.open) throw new HttpError(409, "invite_not_open", "Only open invites can be revoked.");
    const action = await privileged(d, { action: "marketplace.invite_revoke", subjectId: id, reason: b.reason });
    const [row] = await asService(d.sql, (tx) => tx<InviteRow[]>`${inviteSelect(tx)} where id = ${id}`);
    return { action, invite: inviteView(row) };
  });

  /** FR-MKT-027. */
  app.get("/members", async () => {
    const rows = await asService(d.sql, (tx) => tx<{ user_id: string; display_name: string; kind: MemberView["kind"]; joined_at: Date; removed_at: Date | null; provider_status: MemberView["providerStatus"] }[]>`
      select m.user_id, p.display_name, m.kind, m.joined_at, m.removed_at, sp.status as provider_status
        from public.marketplace_members m join public.profiles p on p.id = m.user_id
        left join public.service_providers sp on sp.owner_id = m.user_id
       order by m.removed_at nulls first, m.joined_at desc limit 500`);
    return {
      items: rows.map((r): MemberView => ({
        userId: r.user_id, displayName: r.display_name, kind: r.kind, joinedAt: r.joined_at.toISOString(),
        removedAt: r.removed_at?.toISOString() ?? null, providerStatus: r.provider_status,
      })),
    };
  });

  app.post<{ Params: { userId: string } }>("/members/:userId/remove", async (req) => {
    const userId = uuid(req.params.userId);
    const b = z.object({ reason: z.string() }).parse(req.body);
    const [m] = await asService(d.sql, (tx) => tx`select 1 from public.marketplace_members where user_id = ${userId} and removed_at is null`);
    if (!m) throw new HttpError(409, "not_member", "That person isn't a current beta member.");
    return { action: await privileged(d, { action: "marketplace.member_remove", subjectId: userId, reason: b.reason }), ok: true };
  });

  /** FR-MKT-028 (discovery E1/E2). Counts only, no names or contact data. */
  app.get("/metrics", async (): Promise<MarketplaceMetrics> => {
    return asService(d.sql, async (tx) => {
      const count = async (q: ReturnType<Tx>) => Object.fromEntries((await q as unknown as { k: string; c: bigint }[]).map((r) => [r.k, n(r.c)]));
      const members = await count(tx`select kind as k, count(*) as c from public.marketplace_members where removed_at is null group by kind`);
      const invites = await count(tx`
        select case when redeemed_at is not null then 'redeemed' when revoked_at is not null then 'revoked'
                    when expires_at <= now() then 'expired' else 'open' end as k, count(*) as c
          from public.marketplace_invites group by 1`);
      const providers = await count(tx`select status as k, count(*) as c from public.service_providers group by status`);
      const listedByCategory = await count(tx`
        select c as k, count(*) as c from public.service_providers, unnest(categories) c where status = 'listed' group by c`);
      const requests = await count(tx`select status as k, count(*) as c from public.service_requests group by status`);
      const [t] = await tx<{ median_h: number | null; d7: bigint; d30: bigint }[]>`
        select percentile_cont(0.5) within group (order by extract(epoch from responded_at - created_at) / 3600.0)
                 filter (where responded_at is not null and status in ('accepted', 'declined') and provider_note is distinct from 'This provider is no longer listed.') as median_h,
               count(*) filter (where created_at > now() - interval '7 days') as d7,
               count(*) filter (where created_at > now() - interval '30 days') as d30
          from public.service_requests`;
      const zero = <K extends string>(keys: readonly K[], got: Record<string, number>) => Object.fromEntries(keys.map((k) => [k, got[k] ?? 0])) as Record<K, number>;
      const req = zero(["sent", "accepted", "declined", "withdrawn"] as const, requests);
      const answered = req.accepted + req.declined;
      return {
        members: zero(["provider", "artist"] as const, members),
        invites: zero(["open", "redeemed", "revoked", "expired"] as const, invites),
        providers: zero(["draft", "in_review", "changes_requested", "listed", "suspended"] as const, providers),
        listedByCategory,
        requests: req,
        acceptanceRate: answered ? Math.round((req.accepted / answered) * 1000) / 1000 : null,
        medianResponseHours: t.median_h == null ? null : Math.round(Number(t.median_h) * 10) / 10,
        requestsLast7Days: n(t.d7),
        requestsLast30Days: n(t.d30),
      };
    });
  });
};
