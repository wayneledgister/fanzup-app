/**
 * supabase/seed_layer2.sql ⇄ apps/mock-escrow/fixtures/layer2-seed.json (NFR-L2-05; L2 gate condition 8): the seed
 * loads, the committed fixture is exactly what the seed implies, the ledger reconciles to the provider to the cent,
 * and the demo can carry on from the seeded state (invest, cancel, KYC review, milestone release).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asService, n } from "../src/db";
import { reconcileL2Ledger } from "../src/l2/service";
import { buildFixture } from "../scripts/l2-fixture";
import { ids, tick, tokenWith } from "./helpers";
import { advance, buy, l2kit, poolLedger, type L2Kit } from "./l2-helpers";

const FIXTURE = join(import.meta.dirname, "../../mock-escrow/fixtures/layer2-seed.json");
const auth = async (id: string) => `Bearer ${await tokenWith(id)}`;
const AVA = "5a1e0000-0000-4000-8000-00000000a1a1";
const DEV = "5a1e0000-0000-4000-8000-00000000d4d4";
const P = { night: "9001a000-0000-4000-8000-000000000001", sol: "9001a000-0000-4000-8000-000000000002", velvet: "9001a000-0000-4000-8000-000000000003", demo: "9001a000-0000-4000-8000-000000000004" };

describe("Layer 2 demo seed + mock escrow fixture", () => {
  let k: L2Kit;
  beforeAll(async () => {
    k = await l2kit({ seed: true });
    k.engine.loadFixture(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
  afterAll(async () => { await k?.close(); });

  it("the committed fixture is exactly what the seed implies", async () => {
    const generated = await buildFixture(k.sql as never);
    expect(generated).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });

  it("ledger ⇄ provider: every Pool's escrow and collection mirror reconcile to zero", async () => {
    const r = await reconcileL2Ledger(k.deps);
    expect(r.pools).toHaveLength(4);
    expect(r.diffMinor).toBe(0);
  });

  it("seeded states: one Pool per badge; live, funded with two paid quarters, failed and refunded, matured at the cap", async () => {
    const rows = await asService(k.sql, (tx) => tx<{ slug: string; status: string; risk_badge: string; matured_reason: string | null }[]>`
      select slug::text, status::text, risk_badge::text, matured_reason from public.pools order by slug`);
    expect(rows).toEqual([
      { slug: "afterhours-lp", status: "refunded", risk_badge: "TRUST_BASED", matured_reason: null },
      { slug: "demo-tape-ep", status: "matured", risk_badge: "SECURED_ISH", matured_reason: "cap_reached" },
      { slug: "night-bloom", status: "live", risk_badge: "SECURED_ISH", matured_reason: null },
      { slug: "sol-sessions-vol-1", status: "funded", risk_badge: "VERIFIED", matured_reason: null },
    ]);
    const pf = await k.app.inject({ method: "GET", url: "/api/v1/portfolio", headers: { authorization: await auth(ids.fan) } });
    const byPool = Object.fromEntries(pf.json().investments.map((i: { poolSlug: string }) => [i.poolSlug, i]));
    expect(byPool["sol-sessions-vol-1"]).toMatchObject({ status: "issued", units: 40, amountMinor: 2_000_00, receivedMinor: 24_000 + 36_000 });
    expect(byPool["afterhours-lp"]).toMatchObject({ status: "refunded" });
    expect(pf.json().investor).toMatchObject({ kycStatus: "approved", limitMinor: 7_500_00, usedMinor: 2_000_00, remainingMinor: 5_500_00 });
    const ava = await k.app.inject({ method: "GET", url: "/api/v1/investor/me", headers: { authorization: await auth(AVA) } });
    expect(ava.json()).toMatchObject({ limitMinor: 3_000_00, usedMinor: 2_000_00, remainingMinor: 1_000_00 });
    const list = await k.app.inject({ method: "GET", url: "/api/v1/pools" });
    expect(list.json().pools.map((p: { slug: string }) => p.slug)).toEqual(["night-bloom"]);
    const closed = await k.app.inject({ method: "GET", url: "/api/v1/pools?tab=closed" });
    expect(closed.json().pools).toHaveLength(3);
  });

  it("the demo continues from the seed: invest, cancel, KYC review, milestone release — and still reconciles", async () => {
    const jordan = await auth(ids.fan);
    const r = await buy(k, { auth: jordan }, P.night, 10);
    expect(r.statusCode, r.body).toBe(201);
    const [ava] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.investments where investor_id = ${AVA} and pool_id = ${P.night}`);
    const c = await k.app.inject({ method: "POST", url: `/api/v1/investments/${ava.id}/cancel`, headers: { authorization: await auth(AVA) } });
    expect(c.json().status, c.body).toBe("refund_pending");
    const kyc = await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/investors/${DEV}/kyc`, headers: { authorization: k.staff }, payload: { decision: "approved", reason: "Manual review cleared (demo)" } });
    expect(kyc.json().action.status, kyc.body).toBe("executed");
    const [t2] = await asService(k.sql, (tx) => tx<{ id: string }[]>`select id from public.pool_tranches where pool_id = ${P.sol} and seq = 2`);
    const sol = await auth("f147ba23-d0a1-562d-9140-267bc300c8c2");
    expect((await k.app.inject({ method: "POST", url: `/api/v1/creator/pool-tranches/${t2.id}/evidence`, headers: { authorization: sol }, payload: { notes: "Released on all platforms (demo)" } })).statusCode).toBe(201);
    await k.app.inject({ method: "POST", url: `/api/v1/staff/l2/pool-tranches/${t2.id}/verify`, headers: { authorization: k.staff }, payload: { reason: "Release report checked" } });
    await tick(k, new Date(Date.now() + 25 * 3_600_000)); // single-operator delay on a $4,000 release
    await advance(k, 3);
    expect((await poolLedger(k.sql, P.sol)).pool_escrow).toBe(0);
    expect(n((await asService(k.sql, (tx) => tx<{ s: bigint }[]>`select sum(amount_minor) as s from public.investments where pool_id = ${P.night} and status = 'funded'`))[0].s)).toBe(5_000_00 + 500_00);
    expect((await reconcileL2Ledger(k.deps)).diffMinor).toBe(0);
  });
});
