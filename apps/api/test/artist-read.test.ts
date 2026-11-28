/**
 * CR-006 / ADR-011 (FR-CMP-009): the artist owner read model. `GET /artist` and `GET /artist/campaigns/:id` return
 * exactly the shared contracts (`MyArtist`, `MyCampaign`), reflect live counters after a backing, include drafts the
 * public API hides, and never show one artist another artist's campaign.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MyArtist, MyCampaign } from "@fanzup/shared/schemas";
import { back, createUser, ids, kit, pay, tokenWith, type Kit } from "./helpers";

let k: Kit;
let nova: string;
beforeAll(async () => {
  k = await kit();
  nova = `Bearer ${await tokenWith(ids.nova)}`;
});
afterAll(async () => k?.close());

const get = (url: string, auth?: string) => k.app.inject({ method: "GET", url, headers: auth ? { authorization: auth } : {} });

describe("GET /api/v1/artist (MyArtist)", () => {
  it("returns the profile and campaigns in the shared contract", async () => {
    const r = await get("/api/v1/artist", nova);
    expect(r.statusCode).toBe(200);
    const a = MyArtist.strict().parse(r.json());
    expect(a.slug).toBe("nova-reyes");
    expect(a.tier).toBe("Rising");
    const live = a.campaigns.find((c) => c.id === ids.novaCampaign)!;
    expect(live).toMatchObject({ status: "live", type: "Tour", milestoneRelease: true });
    expect(Date.parse(live.endsAt!)).toBeGreaterThan(Date.now()); // seed dates are relative to now: never stale
    for (const c of a.campaigns) MyCampaign.omit({ perks: true, tranches: true }).strict().parse(c);
  });

  it("includes drafts, which the public list never shows", async () => {
    const created = await k.app.inject({
      method: "POST", url: "/api/v1/artist/campaigns", headers: { authorization: nova },
      payload: { slug: "nova-draft-cr006", title: "Holiday horns special", type: "Show", goalMinor: 300_000, durationDays: 30, milestoneRelease: false },
    });
    expect(created.statusCode).toBe(201);
    const a = MyArtist.parse((await get("/api/v1/artist", nova)).json());
    expect(a.campaigns[0]).toMatchObject({ slug: "nova-draft-cr006", status: "draft", backers: 0, raisedMinor: 0, endsAt: null });
    const pub = await get("/api/v1/campaigns/nova-draft-cr006");
    expect(pub.statusCode).toBe(404);
  });

  it("is 404 no_artist for a verified user with no profile, and 401 signed out", async () => {
    const f = await createUser(k.sql);
    const r = await get("/api/v1/artist", f.auth);
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe("no_artist");
    expect((await get("/api/v1/artist")).statusCode).toBe(401);
  });
});

describe("GET /api/v1/artist/campaigns/:id (MyCampaign)", () => {
  it("returns perks with units claimed and milestones, and reflects a paid backing", async () => {
    const before = MyCampaign.strict().parse((await get(`/api/v1/artist/campaigns/${ids.novaCampaign}`, nova)).json());
    expect(before.perks.length).toBeGreaterThan(0);
    expect(before.tranches.map((t) => t.seq)).toEqual([...before.tranches.map((t) => t.seq)].sort());
    for (const p of before.perks) expect(p.fulfillBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const fan = await createUser(k.sql);
    const b = await back(k, fan.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkTickets, quantity: 2 });
    expect(b.statusCode).toBe(201);
    await pay(k, b.json().backingId);

    const after = MyCampaign.parse((await get(`/api/v1/artist/campaigns/${ids.novaCampaign}`, nova)).json());
    expect(after.backers).toBe(before.backers + 1);
    expect(after.raisedMinor).toBe(before.raisedMinor + b.json().amountMinor);
    const perk = (c: MyCampaign) => c.perks.find((p) => p.id === ids.novaPerkTickets)!;
    expect(perk(after).claimed).toBe(perk(before).claimed + 2);
  });

  it("never returns another artist's campaign", async () => {
    const r = await get(`/api/v1/artist/campaigns/${ids.solCampaign}`, nova);
    expect(r.statusCode).toBe(404);
  });
});
