/**
 * Exit test 4 (NFR-OPS-04; ADR-005), PR #9 review finding 8: each settlement's correlation id (returned by the tick) follows it through
 * settlement → tranche-1 payout op → release on the funded campaign, and through the backer's refund on the failed
 * one. The Playwright golden journey asserts the same trace against the real stack; this is the fast version.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService } from "../src/db";
import { back, campaignEnds, createUser, ids, kit, pay, tokenWith, type Kit } from "./helpers";

let k: Kit;
let staff: string;

beforeAll(async () => {
  k = await kit();
  staff = `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}`;
  await asService(k.sql, async (tx) => {
    await tx`update public.artists set payout_account_ref = 'sbx_acct_' || id`;
    await tx`update public.campaigns set goal_minor = 50000 where id = ${ids.novaCampaign}`; // 4 × $150 funds it; Sol's $6,000 goal isn't met
  });
  await k.provider.topUp(1_000_000); // FanZuP's float for the fees it absorbs on refunds (design §12.1)
});
afterAll(async () => k?.close());

type Trace = {
  audit: { action: string; entity_id: string | null }[];
  outboundOps: { kind: string; status: string }[];
  ledger: { kind: string; campaign_id: string | null }[];
};

describe("exit test 4: correlation ids trace both settlement outcomes", () => {
  it("settlement → tranche-1 payout → release (funded) and refund (failed), each under its settlement's correlation id", async () => {
    for (const [campaignId, perkId, quantity] of [[ids.novaCampaign, ids.novaPerkTickets, 4], [ids.solCampaign, ids.solPerkGA, 1]] as const) {
      const fan = await createUser(k.sql);
      const r = await back(k, fan.auth, { campaignId, perkId, quantity });
      expect(r.statusCode, r.body).toBe(201);
      expect((await pay(k, r.json().backingId)).json().status).toBe("succeeded");
    }
    const at = new Date(Math.max((await campaignEnds(k.sql, ids.novaCampaign)).getTime(), (await campaignEnds(k.sql, ids.solCampaign)).getTime()) + 3_600_000);
    const tick = await k.app.inject({ method: "POST", url: `/api/v1/dev/sandbox/tick?now=${encodeURIComponent(at.toISOString())}` });
    expect(tick.statusCode, tick.body).toBe(200);
    // Each settlement gets its own correlation id (apps/api/src/money.ts settleDueCampaigns), returned by the tick.
    const settled = tick.json().settled as { id: string; outcome: string; correlationId: string }[];
    const nova = settled.find((s) => s.id === ids.novaCampaign)!;
    const sol = settled.find((s) => s.id === ids.solCampaign)!;
    expect([nova.outcome, sol.outcome]).toEqual(["funded", "failed"]);

    const trace = async (cid: string) => (await k.app.inject({ method: "GET", url: `/api/v1/staff/trace/${cid}`, headers: { authorization: staff } })).json() as Trace;
    const f = await trace(nova.correlationId);
    expect(f.audit.filter((a) => a.action === "campaign.settled").map((a) => a.entity_id)).toEqual([ids.novaCampaign]);
    expect(f.outboundOps).toEqual([expect.objectContaining({ kind: "payout", status: "confirmed" })]);
    expect(f.ledger.map((l) => l.kind)).toEqual(expect.arrayContaining(["campaign.funded", "tranche.released"]));

    const r = await trace(sol.correlationId);
    expect(r.audit.filter((a) => a.action === "campaign.settled").map((a) => a.entity_id)).toEqual([ids.solCampaign]);
    expect(r.outboundOps).toEqual([expect.objectContaining({ kind: "refund", status: "confirmed" })]);
    expect(r.ledger.map((l) => l.kind)).toEqual(["backing.refunded"]);
  });
});
