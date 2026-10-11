/**
 * PR #8 review fixes: privileged-action claiming, failed-action audit, single-operator limits under concurrency,
 * refunds that would outlive the campaign, the payouts queue, notifications on failed campaigns and staff refunds,
 * the staff-owner trigger, and the trusted proxy hop.
 * FR-ID-002/007, FR-DSP-001, FR-NTF-001, FR-PRV-001, NFR-SEC-02 (slice); design §3.5.2, §9.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, asUser } from "../src/db";
import { createNotifier, type Transport } from "../src/notify";
import { executeDueActions } from "../src/staff";
import { afterDeadline, back, createUser, ids, kit, one, pay, tick, tokenWith, type Kit } from "./helpers";

let k: Kit;
let staff: string;
let artist: string;

beforeAll(async () => {
  k = await kit();
  staff = `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}`;
  artist = `Bearer ${await tokenWith(ids.nova)}`;
});
afterAll(async () => k?.close());

const api = (method: "GET" | "POST", url: string, auth?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  k.app.inject({ method, url: `/api/v1${url}`, headers: { ...(auth ? { authorization: auth } : {}), ...headers }, payload: payload as never });
const afterDelay = () => new Date(Date.now() + (POLICY.singleOperator.delayHours + 1) * 3_600_000);
const statusOf = async (id: string) => (await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.privileged_actions where id = ${id}`)).status;
const auditCount = async (id: string, action: string) =>
  (await asService(k.sql, (tx) => tx`select 1 from public.audit_events where entity_id = ${id} and action = ${action}`)).length;
/** A recon override is always delayed in single-operator mode and moves no money: a clean subject for claim tests. */
const scheduleOverride = async () => {
  const r = await api("POST", "/staff/recon/override", staff, { reason: "Known timing difference at the processor" });
  expect(r.json().action.status).toBe("scheduled");
  return r.json().action.id as string;
};
const heldBacking = async (perkId: string, campaignId: string) => {
  const f = await createUser(k.sql);
  const r = await back(k, f.auth, { campaignId, perkId });
  expect(r.statusCode).toBe(201);
  await pay(k, r.json().backingId);
  return { fan: f, backingId: r.json().backingId as string };
};

describe("review fix 1: privileged actions are claimed atomically", () => {
  it("a cancelled action is never executed", async () => {
    const id = await scheduleOverride();
    expect((await api("POST", `/staff/actions/${id}/cancel`, staff, { reason: "Changed my mind about this" })).statusCode).toBe(200);
    await executeDueActions(k.deps, afterDelay());
    expect(await statusOf(id)).toBe("cancelled");
    expect(await auditCount(id, "staff.recon.override.executed")).toBe(0);
  });

  it("once the executor has claimed an action (executing), cancel is refused and it runs exactly once", async () => {
    const id = await scheduleOverride();
    await k.sql`update public.privileged_actions set status = 'executing' where id = ${id}`; // the claim's state
    const c = await api("POST", `/staff/actions/${id}/cancel`, staff, { reason: "Too late to cancel this" });
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toBe("not_cancellable");
    // An executing row is not picked up again by the worker.
    expect(await executeDueActions(k.deps, afterDelay())).toBe(0);
    await k.sql`update public.privileged_actions set status = 'cancelled' where id = ${id}`;
  });

  it("cancel racing the executor: exactly one of them wins", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await scheduleOverride();
      const [, cancel] = await Promise.all([
        executeDueActions(k.deps, afterDelay()),
        api("POST", `/staff/actions/${id}/cancel`, staff, { reason: "Racing the worker on purpose" }),
      ]);
      const status = await statusOf(id);
      const executed = await auditCount(id, "staff.recon.override.executed");
      if (cancel.statusCode === 200) {
        expect(status).toBe("cancelled");
        expect(executed).toBe(0);
      } else {
        expect(cancel.statusCode).toBe(409);
        expect(status).toBe("executed");
        expect(executed).toBe(1);
      }
    }
  });

  it("two concurrent executeDueActions run a due action once", async () => {
    const id = await scheduleOverride();
    const [a, b] = await Promise.all([executeDueActions(k.deps, afterDelay()), executeDueActions(k.deps, afterDelay())]);
    expect(a + b).toBe(1);
    expect(await statusOf(id)).toBe("executed");
    expect(await auditCount(id, "staff.recon.override.executed")).toBe(1);
  });

  it("an immediate action is recorded already claimed and ends executed", async () => {
    const { backingId } = await heldBacking(ids.solPerkGA, ids.solCampaign);
    const r = (await api("POST", `/staff/backings/${backingId}/refund`, staff, { reason: "Fan asked to cancel by email" })).json().action;
    expect(r).toEqual({ id: r.id, status: "executed", executeAfter: null });
    expect(await statusOf(r.id)).toBe("executed");
  });
});

describe("review fix 4 + 3: a failed action is audited", () => {
  it("failed → staff.<action>.failed audit event with the error code", async () => {
    const r = await api("POST", `/staff/outbound-ops/${randomUUID()}/replay`, staff, { reason: "Replaying a missing operation" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("not_replayable");
    const a = await one(k.sql, (tx) => tx<{ id: string; status: string; error: string }[]>`
      select id, status, error from public.privileged_actions where action = 'outbound_op.replay' order by created_at desc limit 1`);
    expect(a.status).toBe("failed");
    const audit = await one(k.sql, (tx) => tx<{ data: { error_code: string } }[]>`
      select data from public.audit_events where entity_id = ${a.id} and action = 'staff.outbound_op.replay.failed'`);
    expect(audit.data).toEqual({ error_code: "not_replayable" });
    expect(await auditCount(a.id, "staff.outbound_op.replay.executed")).toBe(0);
  });
});

describe("review fix 5: single-operator mode is visible", () => {
  it("GET /staff/queue reports singleOperatorMode and rejects unknown queue types", async () => {
    expect((await api("GET", "/staff/queue", staff)).json().singleOperatorMode).toBe(true);
    expect((await api("GET", "/staff/queue?type=nonsense", staff)).statusCode).toBe(400);
  });
});

describe("review fix 6: staff can't create an artist directly through Supabase REST", () => {
  it("the artists insert trigger refuses a staff owner while single-operator mode is on; others are unaffected", async () => {
    const reviewer = { sub: ids.reviewer, role: "authenticated" };
    await expect(asUser(k.sql, reviewer, (tx) => tx`insert into public.artists (owner_id, slug, name) values (${ids.reviewer}, 'rest-staff-band', 'REST Staff Band')`))
      .rejects.toThrow(/staff_cannot_own/);
    const u = await createUser(k.sql);
    await asUser(k.sql, { sub: u.id, role: "authenticated" }, (tx) => tx`insert into public.artists (owner_id, slug, name) values (${u.id}, ${`fan-band-${u.id.slice(0, 6)}`}, 'Fan Band')`);
    const r = await api("POST", "/artist", staff, { slug: "reviewer-band", name: "Reviewer Band" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("staff_cannot_own");
  });
});

describe("tracked change 13: a delayed staff refund must not outlive the campaign", () => {
  it("409 refund_after_deadline when the delay reaches ends_at (no action row); scheduled when it doesn't", async () => {
    const perk = randomUUID();
    await k.sql`insert into public.perks (id, campaign_id, title, kind, price_minor, fulfill_by) values (${perk}, ${ids.solCampaign}, 'Patron night', 'experience', ${POLICY.singleOperator.delayAboveMinor + 50_000}, '2027-01-23')`;
    const { backingId } = await heldBacking(perk, ids.solCampaign);
    const original = await one(k.sql, (tx) => tx<{ ends_at: Date }[]>`select ends_at from public.campaigns where id = ${ids.solCampaign}`);
    try {
      await k.sql`update public.campaigns set ends_at = now() + make_interval(hours => ${POLICY.singleOperator.delayHours - 2}) where id = ${ids.solCampaign}`;
      const before = (await asService(k.sql, (tx) => tx`select 1 from public.privileged_actions where subject_id = ${backingId}`)).length;
      const late = await api("POST", `/staff/backings/${backingId}/refund`, staff, { reason: "Fan asked to cancel by email" });
      expect(late.statusCode).toBe(409);
      expect(late.json().error).toBe("refund_after_deadline");
      expect((await asService(k.sql, (tx) => tx`select 1 from public.privileged_actions where subject_id = ${backingId}`)).length).toBe(before);

      await k.sql`update public.campaigns set ends_at = now() + make_interval(hours => ${POLICY.singleOperator.delayHours + 24}) where id = ${ids.solCampaign}`;
      const ok = (await api("POST", `/staff/backings/${backingId}/refund`, staff, { reason: "Fan asked to cancel by email" })).json().action;
      expect(ok.status).toBe("scheduled");
      expect((await api("POST", `/staff/actions/${ok.id}/cancel`, staff, { reason: "Test cleanup, not needed" })).statusCode).toBe(200);
    } finally {
      await k.sql`update public.campaigns set ends_at = ${original.ends_at} where id = ${ids.solCampaign}`;
    }
  });
});

describe("tracked change 14: payouts waiting are on the staff queue", () => {
  it("GET /staff/queue?type=payouts lists initiated payout ops with a waiting reason", async () => {
    const opId = randomUUID();
    await k.sql`insert into public.outbound_ops (id, kind, subject_id, campaign_id, amount_minor, idempotency_key, waiting)
                values (${opId}, 'payout', ${randomUUID()}, ${ids.solCampaign}, 1000, ${`release:test-${opId}`}, 'payout_account')`;
    const items = (await api("GET", "/staff/queue?type=payouts", staff)).json().items;
    expect(items).toEqual([expect.objectContaining({ type: "payouts", id: opId, summary: "Payout waiting (payout_account)" })]);
    await k.sql`update public.outbound_ops set waiting = null where id = ${opId}`;
    expect((await api("GET", "/staff/queue?type=payouts", staff)).json().items).toEqual([]);
    await k.sql`update public.outbound_ops set status = 'failed' where id = ${opId}`;
  });
});

describe("review fix 3: notifications on refunds", () => {
  it("a staff refund sends refund_started (reason: staff) and refund_completed", async () => {
    const { fan, backingId } = await heldBacking(ids.solPerkGA, ids.solCampaign);
    expect((await api("POST", `/staff/backings/${backingId}/refund`, staff, { reason: "Fan asked to cancel by phone" })).json().action.status).toBe("executed");
    await tick(k);
    await tick(k);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${backingId}`)).status).toBe("refunded");
    const rows = await asService(k.sql, (tx) => tx<{ template: string; status: string }[]>`
      select template, status from public.notifications where user_id = ${fan.id} and subject_id = ${backingId} order by template`);
    expect(rows).toEqual([
      { template: "backing_receipt", status: "sent" },
      { template: "refund_completed", status: "sent" },
      { template: "refund_started", status: "sent" },
    ]);
  });

  it("a failed campaign tells its backers (campaign_failed_refund_started), then refund_completed — not a backer refunded earlier", async () => {
    const lowEnds = "a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e";
    const digitalAlbum = "378df26e-40c3-5fb4-8e8d-bea06ef84257";
    const a = await heldBacking(digitalAlbum, lowEnds);
    const b = await heldBacking(digitalAlbum, lowEnds);
    const early = await heldBacking(digitalAlbum, lowEnds); // refunded by staff before the deadline
    expect((await api("POST", `/staff/backings/${early.backingId}/refund`, staff, { reason: "Fan asked to cancel early" })).json().action.status).toBe("executed");
    await tick(k);
    const at = await afterDeadline(k.sql, lowEnds);
    await tick(k, at);
    await tick(k, at);
    await tick(k, at);
    const c = await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaigns where id = ${lowEnds}`);
    expect(c.status).toBe("refunded");
    for (const x of [a, b]) {
      const rows = await asService(k.sql, (tx) => tx<{ template: string; status: string }[]>`
        select template, status from public.notifications where user_id = ${x.fan.id} and template in ('campaign_failed_refund_started', 'refund_completed')
         order by template`);
      expect(rows).toEqual([{ template: "campaign_failed_refund_started", status: "sent" }, { template: "refund_completed", status: "sent" }]);
    }
    expect(await asService(k.sql, (tx) => tx`select 1 from public.notifications where user_id = ${early.fan.id} and template = 'campaign_failed_refund_started'`)).toHaveLength(0);
  });

  it("review fix 8: a redelivered notification is re-sent when the earlier attempt didn't reach sent", async () => {
    const { fan, backingId } = await heldBacking(ids.solPerkGA, ids.solCampaign);
    await tick(k);
    await k.sql`update public.notifications set status = 'failed', error = 'smtp down' where user_id = ${fan.id} and template = 'backing_receipt'`;
    let sends = 0;
    const counting: Transport = async () => { sends++; };
    await createNotifier(counting)(k.sql, "notify.backing_receipt", { backing_id: backingId });
    expect(sends).toBe(1);
    const row = await one(k.sql, (tx) => tx<{ status: string; error: string | null }[]>`select status, error from public.notifications where user_id = ${fan.id} and template = 'backing_receipt'`);
    expect(row).toEqual({ status: "sent", error: null });
    await createNotifier(counting)(k.sql, "notify.backing_receipt", { backing_id: backingId });
    expect(sends).toBe(1); // already sent: not again
  });
});

describe("review fix 3: a milestone verification above the delay threshold waits", () => {
  it("is scheduled for delayHours, then executes and verifies the tranche", async () => {
    const big = randomUUID();
    await k.sql`insert into public.perks (id, campaign_id, title, kind, price_minor, fulfill_by) values (${big}, ${ids.novaCampaign}, 'Patron of the tour', 'experience', 2500000, '2027-03-31')`;
    await heldBacking(big, ids.novaCampaign);
    await tick(k, await afterDeadline(k.sql, ids.novaCampaign));
    const t2 = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches where campaign_id = ${ids.novaCampaign} and seq = 2`);
    expect((await api("POST", `/artist/tranches/${t2.id}/evidence`, artist, { notes: "Settlement sheet from the first show", links: ["https://example.com/s.pdf"] })).statusCode).toBe(201);
    const amount = await one(k.sql, (tx) => tx<{ a: bigint }[]>`select public.tranche_release_amount(${t2.id}) as a`);
    expect(Number(amount.a)).toBeGreaterThan(POLICY.singleOperator.delayAboveMinor);
    const v = (await api("POST", `/staff/tranches/${t2.id}/verify`, staff, { reason: "Settlement sheet matches the show" })).json().action;
    expect(v.status).toBe("scheduled");
    expect(new Date(v.executeAfter).getTime() - Date.now()).toBeGreaterThan((POLICY.singleOperator.delayHours - 1) * 3_600_000);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaign_tranches where id = ${t2.id}`)).status).toBe("evidence_submitted");
    await executeDueActions(k.deps, afterDelay());
    expect(await statusOf(v.id)).toBe("executed");
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.campaign_tranches where id = ${t2.id}`)).status).not.toBe("evidence_submitted");
  });
});

describe("review fix 12: req.ip trusts exactly one proxy hop", () => {
  it("records the address the platform's proxy saw, not one the client wrote further left", async () => {
    const u = await createUser(k.sql);
    const r = await api("POST", "/me/acceptances", u.auth, { documents: [{ kind: "privacy", version: POLICY.legal.privacyVersion }] },
      { "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(r.statusCode).toBe(201);
    const c = await one(k.sql, (tx) => tx<{ ip: string }[]>`select host(ip) as ip from public.consents where user_id = ${u.id} and method = 'api'`);
    expect(c.ip).toBe("203.0.113.9");
  });
});

// Last: it fills today's refund limit.
describe("review fix 7: the daily limit holds under concurrent requests", () => {
  it("two concurrent refunds that each fit, but not together → one executes, one daily_limit", async () => {
    const x = await heldBacking(ids.solPerkGA, ids.solCampaign);
    const y = await heldBacking(ids.solPerkGA, ids.solCampaign);
    const [day] = await asService(k.sql, (tx) => tx<{ used: bigint }[]>`
      select coalesce(sum(amount_minor), 0) as used from public.privileged_actions
       where action = 'backing.refund' and status in ('scheduled', 'executing', 'executed') and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`);
    const fill = POLICY.singleOperator.dailyLimits.refundsMinor - Number(day.used) - 3000; // room for exactly one GA refund
    await k.sql`insert into public.privileged_actions (action, actor_id, aal, reason, amount_minor, status)
                values ('backing.refund', ${ids.reviewer}, 'aal2', 'seeded for limit test', ${fill}, 'executed')`;
    const rs = await Promise.all([x, y].map((b) => api("POST", `/staff/backings/${b.backingId}/refund`, staff, { reason: "Concurrent refund for the limit test" })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.statusCode === 409)!.json().error).toBe("daily_limit");
  });
});
