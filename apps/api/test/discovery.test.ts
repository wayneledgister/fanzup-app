/**
 * Public discovery and config (PR #9 review findings 2, 3 and design item 9):
 * FR-CMP-008 ordering "ending soonest then newest" with a keyset cursor on the full sort key (ties included),
 * the "Recently funded" tab listing only funded outcomes, and `GET /config.legal` (design §4.2/§3.7).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService } from "../src/db";
import { ids, kit, type Kit } from "./helpers";

let k: Kit;
type Card = { id: string; slug: string; endsAt: string; status: string };

const T = new Date(Date.now() + 10 * 86_400_000); // shared deadline for the tie group
const X = new Date(Date.now() - 3_600_000); // shared creation time inside the tie group

beforeAll(async () => {
  k = await kit();
  await asService(k.sql, async (tx) => {
    const live = async (slug: string, endsAt: Date, createdAt: Date, id: string = randomUUID()) => {
      await tx`insert into public.campaigns (id, artist_id, slug, title, type, goal_minor, status, ends_at, created_at)
               values (${id}, ${ids.novaArtist}, ${slug}, ${slug}, 'Show', 100000, 'live', ${endsAt}, ${createdAt})`;
    };
    // Same deadline: two share a creation time too (then id decides), one newer, one older; one ends earlier.
    await live("tie-same-a", T, X);
    await live("tie-same-b", T, X);
    await live("tie-newer", T, new Date(X.getTime() + 1000));
    await live("tie-older", T, new Date(X.getTime() - 1000));
    await live("tie-earlier", new Date(T.getTime() - 3_600_000), X);

    const settled = new Date(Date.now() - 86_400_000);
    const done = async (slug: string, status: string, releasedTranche: boolean) => {
      const id = randomUUID();
      await tx`insert into public.campaigns (id, artist_id, slug, title, type, goal_minor, status, ends_at, settled_at)
               values (${id}, ${ids.novaArtist}, ${slug}, ${slug}, 'Show', 100000, ${status}::public.campaign_status, ${settled}, ${settled})`;
      await tx`insert into public.campaign_tranches (campaign_id, seq, pct, status, released_minor, released_at)
               values (${id}, 1, 100, ${releasedTranche ? "released" : "pending"}::public.tranche_status,
                       ${releasedTranche ? 100000 : null}, ${releasedTranche ? settled : null})`;
    };
    await done("out-funded", "funded", true);
    await done("out-released", "released", true);
    await done("out-closed-after-release", "closed", true);
    await done("out-closed-after-refund", "closed", false);
    await done("out-refunded", "refunded", false);
    await done("out-failed", "failed", false);
  });
});
afterAll(async () => k?.close());

async function list(query: string) {
  const r = await k.app.inject({ method: "GET", url: `/api/v1/campaigns?${query}` });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { campaigns: Card[]; nextCursor: string | null };
}

async function allPages(query: string) {
  const seen: Card[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const page: { campaigns: Card[]; nextCursor: string | null } = await list(`${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    seen.push(...page.campaigns);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return seen;
}

describe("FR-CMP-008 live ordering: ending soonest, then newest (review finding 3)", () => {
  it("orders by ends_at asc, created_at desc, id — and pages through ties without repeats or gaps", async () => {
    const full = (await list("tab=live&limit=24")).campaigns;
    const rows = await asService(k.sql, (tx) => tx<{ id: string }[]>`
      select id from public.campaigns where status = 'live' and ends_at > now() order by ends_at asc, created_at desc, id asc`);
    expect(full.map((c) => c.id)).toEqual(rows.map((r) => r.id));

    const ours = full.map((c) => c.slug).filter((s) => s.startsWith("tie-"));
    const [sameA, sameB] = (await asService(k.sql, (tx) => tx<{ slug: string }[]>`
      select slug from public.campaigns where slug in ('tie-same-a', 'tie-same-b') order by id`)).map((r) => r.slug);
    expect(ours).toEqual(["tie-earlier", "tie-newer", sameA, sameB, "tie-older"]);

    // Every page size, including ones whose boundary falls between the two rows that tie on (ends_at, created_at).
    for (const size of [1, 2, 3]) {
      const paged = await allPages(`tab=live&limit=${size}`);
      expect(paged.map((c) => c.id), `limit=${size}`).toEqual(full.map((c) => c.id));
    }
  });

  it("rejects a cursor that doesn't carry the full sort key, and a page size over 24", async () => {
    const legacy = Buffer.from(JSON.stringify({ k: new Date().toISOString(), id: randomUUID() })).toString("base64url");
    expect((await k.app.inject({ method: "GET", url: `/api/v1/campaigns?cursor=${legacy}` })).statusCode).toBe(400);
    expect((await k.app.inject({ method: "GET", url: "/api/v1/campaigns?limit=25" })).statusCode).toBe(400);
  });
});

describe("Recently funded lists funded outcomes only (review finding 2)", () => {
  it("includes funded, released and closed-after-release; never closed-after-refund, refunded or failed", async () => {
    const slugs = (await allPages("tab=funded&limit=2")).map((c) => c.slug).filter((s) => s.startsWith("out-"));
    expect(slugs.sort()).toEqual(["out-closed-after-release", "out-funded", "out-released"]);
  });
});

describe("GET /config (design §4.2, §3.7)", () => {
  it("returns the current legal document versions the sign-up form sends", async () => {
    const r = await k.app.inject({ method: "GET", url: "/api/v1/config" });
    expect(r.json()).toMatchObject({ provider: "sandbox", testMode: true, legal: { termsVersion: POLICY.legal.termsVersion, privacyVersion: POLICY.legal.privacyVersion } });
  });
});
