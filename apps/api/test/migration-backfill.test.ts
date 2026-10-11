/**
 * PR #7 review round 2, item 4: rows that exist before the M1 migrations run get the counter-rule columns backfilled
 * (counted, units_held, captured_minor, settled_* figures, live counters). Applies the pre-M1 migrations, writes
 * pre-M1-shaped data, then applies the M1 migrations and checks the result.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";

const ROOT = join(import.meta.dirname, "../../..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const M1_FIRST = "20261004000100";

const name = `fz_backfill_${randomBytes(4).toString("hex")}`;
let db: postgres.Sql;

const fan = randomUUID();
const fan2 = randomUUID();
const owner = randomUUID();
const artist = randomUUID();
const live = randomUUID();
const failed = randomUUID();
const funded = randomUUID();
const livePerk = randomUUID();
const failedPerk = randomUUID();
const fundedPerk = randomUUID();
const b = { liveHeld: randomUUID(), liveHeld2: randomUUID(), livePending: randomUUID(), liveRefunded: randomUUID(), failedHeld: randomUUID(), fundedReleased: randomUUID() };

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  db = postgres(ADMIN_URL.replace(/\/[^/]*$/, `/${name}`), { max: 1, onnotice: () => {} });
  await db.unsafe(readFileSync(join(ROOT, "apps/api/test/supabase-shim.sql"), "utf8"));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((f) => f < M1_FIRST)) await db.unsafe(readFileSync(join(MIGRATIONS, f), "utf8"));

  // Pre-M1 state, as the walking-skeleton functions left it: units claimed at capture and given back at refund;
  // raised_minor/backers_count never lowered after settlement; a failed campaign's held backings await refunds.
  for (const u of [fan, fan2, owner]) await db`insert into auth.users (id, email) values (${u}, ${u + "@example.com"})`;
  await db`insert into public.artists (id, owner_id, slug, name) values (${artist}, ${owner}, 'backfill-artist', 'Backfill')`;
  const ends = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  await db`insert into public.campaigns (id, artist_id, slug, title, type, goal_minor, status, ends_at, raised_minor, backers_count)
           values (${live}, ${artist}, 'bf-live', 'Live one', 'Album', 100000, 'live', ${ends}, 3000, 2)`;
  await db`insert into public.campaigns (id, artist_id, slug, title, type, goal_minor, status, ends_at, settled_at, raised_minor, backers_count)
           values (${failed}, ${artist}, 'bf-failed', 'Failed one', 'Album', 100000, 'failed', ${past}, ${past}, 2000, 1)`;
  await db`insert into public.campaigns (id, artist_id, slug, title, type, goal_minor, status, ends_at, settled_at, raised_minor, backers_count)
           values (${funded}, ${artist}, 'bf-funded', 'Funded one', 'Album', 50000, 'funded', ${past}, ${past}, 60000, 1)`;
  await db`insert into public.perks (id, campaign_id, title, kind, price_minor, quantity_limit, claimed, fulfill_by)
           values (${livePerk}, ${live}, 'Live perk', 'digital', 1000, 10, 3, '2027-01-01'),
                  (${failedPerk}, ${failed}, 'Failed perk', 'digital', 2000, 10, 1, '2027-01-01'),
                  (${fundedPerk}, ${funded}, 'Funded perk', 'digital', 60000, 10, 1, '2027-01-01')`;
  await db`insert into public.backings (id, campaign_id, perk_id, backer_id, quantity, amount_minor, processing_fee_minor, status, payment_ref)
           values (${b.liveHeld}, ${live}, ${livePerk}, ${fan}, 2, 2000, 88, 'held', 'pi_live_1'),
                  (${b.liveHeld2}, ${live}, ${livePerk}, ${fan2}, 1, 1000, 59, 'held', 'pi_live_2'),
                  (${b.livePending}, ${live}, ${livePerk}, ${fan}, 1, 1000, 0, 'pending_payment', null),
                  (${b.liveRefunded}, ${live}, ${livePerk}, ${fan2}, 1, 1000, 59, 'refunded', 'pi_live_3'),
                  (${b.failedHeld}, ${failed}, ${failedPerk}, ${fan}, 1, 2000, 88, 'held', 'pi_failed_1'),
                  (${b.fundedReleased}, ${funded}, ${fundedPerk}, ${fan}, 1, 60000, 1770, 'released', 'pi_funded_1')`;
  // Pre-M1 capture postings were keyed capture:<backing_id> (M1 keys them capture:<payment_ref>).
  for (const [backing, campaign, ref, amount, fee] of [[b.liveHeld, live, "pi_live_1", 2000, 88], [b.failedHeld, failed, "pi_failed_1", 2000, 88]] as const) {
    await db`select public.ledger_post('backing.captured', ${"capture:" + backing}, ${db.json([
      { account: (await db<{ id: string }[]>`select public.ledger_account('escrow_cash', ${campaign}) as id`)[0].id, amount: amount - fee },
      { account: (await db<{ id: string }[]>`select public.ledger_account('processing_fees') as id`)[0].id, amount: fee },
      { account: (await db<{ id: string }[]>`select public.ledger_account('backer_liability', ${campaign}) as id`)[0].id, amount: -amount },
    ])}, ${campaign}, ${backing}, ${ref}, null)`;
  }

  for (const f of files.filter((f) => f >= M1_FIRST)) await db.unsafe(readFileSync(join(MIGRATIONS, f), "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.end({ timeout: 2 });
  const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await a.unsafe(`drop database if exists ${name} with (force)`);
  await a.end();
});

describe("M1 migration backfill of pre-M1 rows (review round 2, item 4)", () => {
  it("backings: counted / units_held follow the pre-M1 status; captures carry captured_minor; pending rows get an expiry", async () => {
    const rows = await db<{ id: string; status: string; counted: boolean; units_held: boolean; captured_minor: string | null; captured_currency: string | null; hold_expires_at: Date | null }[]>`
      select id, status::text, counted, units_held, captured_minor, captured_currency, hold_expires_at from public.backings`;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[b.liveHeld]).toMatchObject({ status: "held", counted: true, units_held: true, captured_minor: "2000", captured_currency: "usd" });
    expect(by[b.liveHeld2]).toMatchObject({ status: "held", counted: true, units_held: true });
    expect(by[b.fundedReleased]).toMatchObject({ status: "released", counted: true, units_held: true, captured_minor: "60000" });
    // Pre-M1 pending rows reserved no units (claimed at capture); they get an expiry so the worker closes them.
    expect(by[b.livePending]).toMatchObject({ status: "pending_payment", counted: false, units_held: false, captured_minor: null });
    expect(by[b.livePending].hold_expires_at).not.toBeNull();
    expect(by[b.liveRefunded]).toMatchObject({ status: "refunded", counted: false, units_held: false, captured_minor: "1000" });
    // A failed campaign's still-held backing moves to refund_pending (counter rule), units given back.
    expect(by[b.failedHeld]).toMatchObject({ status: "refund_pending", counted: false, units_held: false, captured_minor: "2000" });
  });

  it("campaigns: settled figures keep the deadline totals; live counters follow held + released only", async () => {
    const rows = await db<{ id: string; raised_minor: string; backers_count: number; settled_raised_minor: string | null; settled_backers_count: number | null }[]>`
      select id, raised_minor, backers_count, settled_raised_minor, settled_backers_count from public.campaigns`;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[live]).toMatchObject({ raised_minor: "3000", backers_count: 2, settled_raised_minor: null });
    expect(by[failed]).toMatchObject({ raised_minor: "0", backers_count: 0, settled_raised_minor: "2000", settled_backers_count: 1 });
    expect(by[funded]).toMatchObject({ raised_minor: "60000", backers_count: 1, settled_raised_minor: "60000", settled_backers_count: 1 });
  });

  it("perks: claimed still equals the units of backings whose units are held", async () => {
    const rows = await db<{ id: string; claimed: number; held: number }[]>`
      select p.id, p.claimed, coalesce((select sum(quantity) from public.backings b where b.perk_id = p.id and b.units_held), 0)::int as held
        from public.perks p`;
    for (const r of rows) expect(r.claimed, r.id).toBe(r.held);
    expect(rows.find((r) => r.id === failedPerk)?.claimed).toBe(0);
  });

  it("a replayed capture of a pre-M1 backing (posted under capture:<backing_id>) is a duplicate, not a second posting (review round 3)", async () => {
    const count = async () => (await db<{ c: number }[]>`select count(*)::int as c from public.ledger_transactions`)[0].c;
    const before = await count();
    const held = await db<{ r: string }[]>`select public.apply_payment_captured(${b.liveHeld}, 'pi_live_1', 2000, 'usd', 88, 'capture:pi_live_1') as r`;
    const pending = await db<{ r: string }[]>`select public.apply_payment_captured(${b.failedHeld}, 'pi_failed_1', 2000, 'usd', 88, 'capture:pi_failed_1') as r`;
    const released = await db<{ r: string }[]>`select public.apply_payment_captured(${b.fundedReleased}, 'pi_funded_1', 60000, 'usd', 1770, 'capture:pi_funded_1') as r`;
    expect([held[0].r, pending[0].r, released[0].r]).toEqual(["duplicate", "duplicate", "duplicate"]);
    expect(await count()).toBe(before);
    const [c] = await db<{ raised_minor: string }[]>`select raised_minor from public.campaigns where id = ${live}`;
    expect(c.raised_minor).toBe("3000");
    const statuses = await db<{ status: string }[]>`select status::text from public.backings where id in (${b.liveHeld}, ${b.failedHeld}) order by status`;
    expect(statuses.map((r) => r.status)).toEqual(["held", "refund_pending"]);
  });
});
