import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, type Sql } from "../src/db";
import { freshDb, ids } from "./helpers";

let db: Awaited<ReturnType<typeof freshDb>>;
let sql: Sql;
const fan = { sub: ids.fan, role: "authenticated" };
const nova = { sub: ids.nova, role: "authenticated" };

beforeAll(async () => {
  db = await freshDb();
  sql = db.sql;
  // one backing for the fan so there's something to (not) see
  await asService(sql, (tx) => tx`insert into public.backings (campaign_id, perk_id, backer_id, amount_minor) values (${ids.novaCampaign}, ${ids.novaPerkDiary}, ${ids.fan}, 1000)`);
});
afterAll(async () => db?.drop());

describe("row level security", () => {
  it("anonymous visitors can read public campaigns but never backings or the ledger", async () => {
    expect((await asUser(sql, null, (tx) => tx`select * from public.campaign_cards`)).length).toBe(4);
    expect((await asUser(sql, null, (tx) => tx`select * from public.backings`)).length).toBe(0);
    await expect(asUser(sql, null, (tx) => tx`select * from public.ledger_entries`)).rejects.toThrow(/permission denied/);
  });
  it("a fan sees only their own backings; the artist sees backings on their campaign", async () => {
    expect((await asUser(sql, fan, (tx) => tx`select * from public.backings`)).length).toBe(1);
    expect((await asUser(sql, nova, (tx) => tx`select * from public.backings`)).length).toBe(1);
    const other = { sub: "00000000-0000-0000-0000-0000000000aa", role: "authenticated" };
    expect((await asUser(sql, other, (tx) => tx`select * from public.backings`)).length).toBe(0);
  });
  it("clients can't create backings or touch money fields", async () => {
    await expect(asUser(sql, fan, (tx) => tx`insert into public.backings (campaign_id, perk_id, backer_id, amount_minor) values (${ids.novaCampaign}, ${ids.novaPerkDiary}, ${ids.fan}, 1)`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, nova, (tx) => tx`update public.campaigns set raised_minor = 999999 where id = ${ids.novaCampaign}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, nova, (tx) => tx`update public.campaigns set status = 'funded' where id = ${ids.novaCampaign}`)).rejects.toThrow(/permission denied/);
  });
  it("clients can't call money functions", async () => {
    await expect(asUser(sql, fan, (tx) => tx`select public.settle_campaign(${ids.novaCampaign})`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, fan, (tx) => tx`select public.record_backing_captured(gen_random_uuid(), 'x', 0, 'x')`)).rejects.toThrow(/permission denied/);
  });
  it("artists can edit their own draft campaigns, not live ones", async () => {
    const [d] = await asUser(sql, nova, (tx) => tx<{ id: string }[]>`
      insert into public.campaigns (artist_id, slug, title, type, goal_minor) values (${ids.novaArtist}, 'nova-new-ep', 'New EP', 'Album', 100000) returning id`);
    expect(d.id).toBeTruthy();
    const upd = await asUser(sql, nova, (tx) => tx`update public.campaigns set title = 'Changed' where id = ${ids.novaCampaign} returning id`);
    expect(upd.length).toBe(0); // live campaign: RLS hides it from updates
    await expect(asUser(sql, fan, (tx) => tx`insert into public.campaigns (artist_id, slug, title, type, goal_minor) values (${ids.novaArtist}, 'hijack', 'Hijack', 'Album', 100000)`)).rejects.toThrow(/row-level security/);
  });
  it("submitting enforces identity, perks and the tier cap", async () => {
    const [d] = await asUser(sql, nova, (tx) => tx<{ id: string }[]>`
      insert into public.campaigns (artist_id, slug, title, type, goal_minor) values (${ids.novaArtist}, 'nova-too-big', 'Too big', 'Album', 20000000) returning id`);
    await asUser(sql, nova, (tx) => tx`insert into public.perks (campaign_id, title, kind, price_minor, fulfill_by) values (${d.id}, 'Thanks', 'digital', 500, '2027-06-01')`);
    await expect(asUser(sql, nova, (tx) => tx`select public.submit_campaign(${d.id})`)).rejects.toThrow(/Rising campaigns can raise up to 10000000/);
  });
});
