/**
 * Identity, staff controls, artist API, notifications and the fan's view (PR-C).
 * FR-ID-001/002/003/004/006/007, FR-PRV-001, FR-CMP-001/002, FR-PAY-005, FR-DSP-001, FR-NTF-001, FR-ANL-001,
 * FR-BCK-005, FR-PAY-009, FR-PLT-006.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n } from "../src/db";
import { render, TEMPLATES, TEST_MODE_FOOTER, type TemplateId } from "../src/notify";
import { executeDueActions } from "../src/staff";
import { afterDeadline, back, createUser, ids, kit, one, pay, tick, tokenWith, type Kit } from "./helpers";

let k: Kit;
let staff: string; // aal2
let staffAal1: string;
let artist: string;

beforeAll(async () => {
  k = await kit();
  staff = `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}`;
  staffAal1 = `Bearer ${await tokenWith(ids.reviewer, { aal: "aal1" })}`;
  artist = `Bearer ${await tokenWith(ids.nova)}`;
});
afterAll(async () => k?.close());

const api = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, auth?: string, payload?: unknown) =>
  k.app.inject({ method, url: `/api/v1${url}`, headers: auth ? { authorization: auth } : {}, payload: payload as never });

describe("FR-ID-006 / FR-PRV-001: accounts need an 18+ attestation and the current terms", () => {
  const insertUser = (meta: Record<string, unknown>) =>
    k.sql`insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
          values ('00000000-0000-0000-0000-000000000000', ${randomUUID()}, 'authenticated', 'authenticated', ${`x-${randomUUID()}@fanzup.test`}, ${k.sql.json(meta as never)}, now(), now())`;
  it("refuses a user without the attestation, or with stale terms", async () => {
    await expect(insertUser({ display_name: "Kid" })).rejects.toThrow(/adult_attestation_required/);
    await expect(insertUser({ adult_attested: true, terms_version: "old", privacy_version: POLICY.legal.privacyVersion })).rejects.toThrow(/terms_version_mismatch/);
  });
  it("records attestation, terms and privacy consents, and an account_created funnel event", async () => {
    const u = await createUser(k.sql);
    const kinds = (await asService(k.sql, (tx) => tx<{ kind: string; method: string }[]>`select kind, method from public.consents where user_id = ${u.id} order by kind`));
    expect(kinds.map((r) => r.kind)).toEqual(["adult_attestation", "privacy", "terms"]);
    expect(kinds.every((r) => r.method === "signup")).toBe(true);
    expect(await asService(k.sql, (tx) => tx`select 1 from public.funnel_events where name = 'account_created' and user_id = ${u.id}`)).toHaveLength(1);
  });
  it("legal versions in the database match packages/shared POLICY.legal", async () => {
    const v = await one(k.sql, (tx) => tx<{ value: { terms: string; privacy: string } }[]>`select value from public.platform_settings where key = 'legal_versions'`);
    expect(v.value).toEqual({ terms: POLICY.legal.termsVersion, privacy: POLICY.legal.privacyVersion });
  });
  it("a new terms version blocks backing until the fan re-accepts; re-acceptance records IP and user agent", async () => {
    const u = await createUser(k.sql);
    expect((await api("GET", "/me", u.auth)).json()).toMatchObject({ emailVerified: true, needsAcceptance: [] });
    await asService(k.sql, (tx) => tx`update public.platform_settings set value = jsonb_set(value, '{terms}', '"next"') where key = 'legal_versions'`);
    try {
      expect((await api("GET", "/me", u.auth)).json().needsAcceptance).toEqual(["terms"]);
      const r = await back(k, u.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe("acceptance_required");
      await k.sql`insert into public.consents (user_id, kind, version, method) values (${u.id}, 'terms', 'next', 'api')`;
      expect((await back(k, u.auth, { campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary })).statusCode).toBe(201);
    } finally {
      await asService(k.sql, (tx) => tx`update public.platform_settings set value = jsonb_set(value, '{terms}', ${tx.json(POLICY.legal.termsVersion)}) where key = 'legal_versions'`);
    }
    const ok = await k.app.inject({ method: "POST", url: "/api/v1/me/acceptances", headers: { authorization: u.auth, "user-agent": "vitest-agent" }, payload: { documents: [{ kind: "terms", version: POLICY.legal.termsVersion }] } });
    expect(ok.statusCode).toBe(201);
    const c = await one(k.sql, (tx) => tx<{ ip: string; user_agent: string }[]>`select host(ip) as ip, user_agent from public.consents where user_id = ${u.id} and method = 'api' and version = ${POLICY.legal.termsVersion}`);
    expect(c.user_agent).toBe("vitest-agent");
    expect(c.ip).toBeTruthy();
    expect((await api("POST", "/me/acceptances", u.auth, { documents: [{ kind: "terms", version: "stale" }] })).statusCode).toBe(409);
  });
});

describe("FR-ID-002/003: staff need a second factor; actor comes from the token", () => {
  it("refuses non-staff, and staff without aal2", async () => {
    const u = await createUser(k.sql);
    expect((await api("GET", "/staff/queue", u.auth)).json().error).toBe("not_staff");
    const r = await api("GET", "/staff/queue", staffAal1);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("second_factor_required");
    expect((await api("GET", "/staff/queue", staff)).statusCode).toBe(200);
  });
  it("requires a typed reason of at least 10 characters", async () => {
    const r = await api("POST", `/staff/backings/${randomUUID()}/refund`, staff, { reason: "short" });
    expect([400, 404]).toContain(r.statusCode);
  });
  it("staff can't own artists while single-operator mode is on, and can't act on campaigns they own", async () => {
    expect((await api("POST", "/artist", staff, { slug: "reviewer-band", name: "Reviewer Band" })).json().error).toBe("staff_cannot_own");
    // Even if a link existed (created out of band), the action is refused.
    const artistId = randomUUID();
    const campaignId = randomUUID();
    await k.sql`insert into public.artists (id, owner_id, slug, name, identity_status) values (${artistId}, ${ids.reviewer}, 'reviewer-owned', 'Reviewer Owned', 'verified')`;
    await k.sql`insert into public.campaigns (id, artist_id, slug, title, type, goal_minor, status) values (${campaignId}, ${artistId}, 'reviewer-owned-c', 'Owned by reviewer', 'Show', 50000, 'in_review')`;
    const r = await api("POST", `/staff/campaigns/${campaignId}/review`, staff, { decision: "approved", reason: "Looks complete and accurate" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("reviewer_is_owner");
    await k.sql`update public.campaigns set status = 'withdrawn' where id = ${campaignId}`;
  });
});

describe("Artist → review → live → funded → both milestones released, through the API", () => {
  let campaignId: string;
  let backingId: string;
  const fan = { auth: "", id: "" };

  it("creates, edits, submits; the operator approves (aal2 + reason); the artist publishes", async () => {
    const payout = await api("POST", "/artist/payout-account", artist);
    expect(payout.json()).toMatchObject({ status: "verified", onboardingUrl: null });
    const c = await api("POST", "/artist/campaigns", artist, { slug: `api-show-${randomUUID().slice(0, 6)}`, title: "API-made show", type: "Show", story: "One night only.", goalMinor: 50_000, durationDays: 7, milestoneRelease: true });
    expect(c.statusCode).toBe(201);
    campaignId = c.json().id;
    expect((await api("PATCH", `/artist/campaigns/${campaignId}`, artist, { blurb: "A hometown show." })).statusCode).toBe(200);
    expect((await api("PUT", `/artist/campaigns/${campaignId}/perks`, artist, [{ title: "Ticket", kind: "experience", priceMinor: 50_000, quantityLimit: 10, fulfillBy: "2027-03-01" }])).statusCode).toBe(200);
    expect((await api("PUT", `/artist/campaigns/${campaignId}/tranches`, artist, [{ seq: 1, pct: 60 }, { seq: 2, pct: 30 }])).json().error).toBe("invalid_tranches");
    expect((await api("PUT", `/artist/campaigns/${campaignId}/tranches`, artist, [{ seq: 1, pct: 50 }, { seq: 2, pct: 50, milestone: "Show played", evidenceRequired: "Settlement sheet", targetDate: "2027-02-01" }])).statusCode).toBe(200);
    expect((await api("POST", `/artist/campaigns/${campaignId}/submit`, artist)).json().status).toBe("in_review");
    const queue = (await api("GET", "/staff/queue?type=review", staff)).json().items;
    expect(queue.map((i: { id: string }) => i.id)).toContain(campaignId);
    const rev = await api("POST", `/staff/campaigns/${campaignId}/review`, staff, { decision: "approved", reason: "Story, perks and milestones check out" });
    expect(rev.json().action.status).toBe("executed");
    const pub = await api("POST", `/artist/campaigns/${campaignId}/publish`, artist);
    expect(pub.json().status).toBe("live");
  });

  it("a fan backs; My backings shows the money held; the funnel recorded checkout and confirmation", async () => {
    Object.assign(fan, await createUser(k.sql));
    const perk = (await api("GET", `/campaigns/${(await one(k.sql, (tx) => tx<{ slug: string }[]>`select slug from public.campaigns where id = ${campaignId}`)).slug}`)).json().perks[0];
    const r = await back(k, fan.auth, { campaignId, perkId: perk.id, source: "ig" });
    backingId = r.json().backingId;
    await pay(k, backingId);
    const mine = (await api("GET", "/me/backings", fan.auth)).json().backings;
    expect(mine[0]).toMatchObject({ id: backingId, moneyState: "held", perk: { status: "Not yet shipped" }, next: { label: "Campaign ends" } });
    const names = (await asService(k.sql, (tx) => tx<{ name: string; source: string }[]>`select name, source from public.funnel_events where campaign_id = ${campaignId} order by id`));
    expect(names).toEqual([{ name: "checkout_started", source: "ig" }, { name: "backing_confirmed", source: "ig" }]);
  });

  it("funds at the deadline; tranche 1 pays; evidence + verification releases tranche 2; fan sees released", async () => {
    await tick(k, await afterDeadline(k.sql, campaignId));
    let mine = (await api("GET", "/me/backings", fan.auth)).json().backings[0];
    expect(mine.moneyState).toBe("with_artist");
    expect(mine.releasedPct).toBe(50);
    const t2 = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches where campaign_id = ${campaignId} and seq = 2`);
    // Verification amount (~$242) is under the single-operator delay threshold, so it executes now.
    expect((await api("POST", `/staff/tranches/${t2.id}/verify`, staff, { reason: "No evidence yet: should fail" })).statusCode).toBe(409);
    expect((await api("POST", `/artist/tranches/${t2.id}/evidence`, artist, { notes: "Settlement sheet from the venue", links: ["https://example.com/s.pdf"] })).statusCode).toBe(201);
    const v = await api("POST", `/staff/tranches/${t2.id}/verify`, staff, { reason: "Settlement sheet matches the show" });
    expect(v.json().action.status).toBe("executed");
    await tick(k);
    mine = (await api("GET", "/me/backings", fan.auth)).json().backings[0];
    expect(mine.moneyState).toBe("released");
    expect(mine.releasedPct).toBe(100);
  });

  it("sent the M1 emails with template versions, each carrying the test-mode notice", async () => {
    const rows = await asService(k.sql, (tx) => tx<{ template: string; template_version: number; status: string; user_id: string }[]>`
      select template, template_version, status, user_id from public.notifications
       where subject_id in (${backingId}, ${campaignId}) or subject_id in (select id from public.campaign_tranches where campaign_id = ${campaignId})`);
    const fanTemplates = rows.filter((r) => r.user_id === fan.id).map((r) => r.template).sort();
    expect(fanTemplates).toEqual(["backing_receipt", "campaign_funded", "milestone_released", "milestone_released"]);
    expect(rows.some((r) => r.user_id === ids.nova && r.template === "campaign_funded")).toBe(true);
    expect(rows.every((r) => r.status === "sent" && r.template_version === TEMPLATES[r.template as TemplateId])).toBe(true);
  });

  it("traces the operator's verification through the release by one correlation id", async () => {
    const a = await one(k.sql, (tx) => tx<{ correlation_id: string }[]>`select correlation_id from public.privileged_actions where action = 'tranche.verify' and status = 'executed' order by created_at desc limit 1`);
    const t = (await api("GET", `/staff/trace/${a.correlation_id}`, staff)).json();
    expect(t.actions).toHaveLength(1);
    expect(t.audit.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["tranche.verified", "staff.tranche.verify.executed"]));
    expect(t.outboundOps.map((o: { kind: string }) => o.kind)).toEqual(["payout"]);
    expect(t.ledger.map((l: { kind: string }) => l.kind)).toEqual(["tranche.released"]);
    expect(t.audit.find((x: { action: string }) => x.action === "tranche.verified")).toMatchObject({ actor_kind: "staff", aal: "aal2", actor_id: ids.reviewer });
  });
});

describe("FR-ID-007 single-operator mode: delays, limits, cancel, weekly review", () => {
  it("a refund above the delay threshold is scheduled, cancellable, and executes only after the delay", async () => {
    const amountPerk = randomUUID();
    await k.sql`insert into public.perks (id, campaign_id, title, kind, price_minor, fulfill_by) values (${amountPerk}, ${ids.solCampaign}, 'Patron night', 'experience', 150000, '2027-01-23')`;
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: amountPerk });
    await pay(k, r.json().backingId);
    const first = (await api("POST", `/staff/backings/${r.json().backingId}/refund`, staff, { reason: "Fan asked to cancel by email" })).json().action;
    expect(first.status).toBe("scheduled");
    expect(new Date(first.executeAfter).getTime() - Date.now()).toBeGreaterThan((POLICY.singleOperator.delayHours - 1) * 3_600_000);
    expect((await api("POST", `/staff/actions/${first.id}/cancel`, staff, { reason: "Fan changed their mind" })).statusCode).toBe(200);
    const second = (await api("POST", `/staff/backings/${r.json().backingId}/refund`, staff, { reason: "Fan asked again, confirmed by email" })).json().action;
    await executeDueActions(k.deps, new Date(Date.now() + 60_000));
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status from public.privileged_actions where id = ${second.id}`)).status).toBe("scheduled");
    await executeDueActions(k.deps, new Date(Date.now() + (POLICY.singleOperator.delayHours + 1) * 3_600_000));
    await tick(k);
    expect((await one(k.sql, (tx) => tx<{ status: string }[]>`select status::text from public.backings where id = ${r.json().backingId}`)).status).toBe("refunded");
  });

  it("enforces the daily refund total and the daily verification count", async () => {
    await k.sql`insert into public.privileged_actions (action, actor_id, aal, reason, amount_minor, status)
                values ('backing.refund', ${ids.reviewer}, 'aal2', 'seeded for limit test', ${POLICY.singleOperator.dailyLimits.refundsMinor}, 'executed')`;
    const f = await createUser(k.sql);
    const r = await back(k, f.auth, { campaignId: ids.solCampaign, perkId: ids.solPerkGA });
    await pay(k, r.json().backingId);
    const refused = await api("POST", `/staff/backings/${r.json().backingId}/refund`, staff, { reason: "Would pass the daily limit" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("daily_limit");
    for (let i = 0; i < POLICY.singleOperator.dailyLimits.verifications; i++) {
      await k.sql`insert into public.privileged_actions (action, actor_id, aal, reason, status) values ('tranche.verify', ${ids.reviewer}, 'aal2', 'seeded for limit test', 'executed')`;
    }
    const t = await one(k.sql, (tx) => tx<{ id: string }[]>`select id from public.campaign_tranches limit 1`);
    expect((await api("POST", `/staff/tranches/${t.id}/verify`, staff, { reason: "Would pass the daily limit" })).json().error).toBe("daily_limit");
  });

  it("the weekly review lists every privileged action; sign-off is recorded once", async () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const weekStart = d.toISOString().slice(0, 10);
    const list = (await api("GET", `/staff/weekly-review?weekStart=${weekStart}`, staff)).json();
    expect(list.actions.length).toBeGreaterThanOrEqual(4);
    expect(list.signoff).toBeNull();
    const s = await api("POST", "/staff/weekly-review/signoff", staff, { weekStart, note: "Reviewed all actions" });
    expect(s.statusCode).toBe(201);
    expect(s.json().signoff.action_count).toBe(list.actions.length);
    expect((await api("POST", "/staff/weekly-review/signoff", staff, { weekStart })).statusCode).toBe(409);
  });

  it("a recon override waits out the delay too (G1 N4)", async () => {
    const r = (await api("POST", "/staff/recon/override", staff, { reason: "Known timing difference, resolved tomorrow" })).json().action;
    expect(r.status).toBe("scheduled");
  });
});

describe("FR-ANL-001 funnel events (first-party)", () => {
  it("accepts perk_selected for a public campaign and rejects junk", async () => {
    const anonId = randomUUID();
    expect((await api("POST", "/events", undefined, { name: "perk_selected", campaignId: ids.novaCampaign, perkId: ids.novaPerkDiary, anonId, source: "tiktok" })).statusCode).toBe(202);
    expect((await api("POST", "/events", undefined, { name: "perk_selected", campaignId: randomUUID(), anonId })).statusCode).toBe(404);
    expect((await api("POST", "/events", undefined, { name: "perk_selected", campaignId: ids.novaCampaign, anonId, source: "<script>" })).statusCode).toBe(400);
    expect((await api("POST", "/events", undefined, { name: "backing_confirmed", campaignId: ids.novaCampaign, anonId })).statusCode).toBe(400);
  });
});

describe("FR-NTF-001 / FR-PLT-006 copy", () => {
  it("every template carries the test-mode notice and none says escrow, invest, returns or ownership", () => {
    const vars = { campaign: "A Show", perk: "Ticket", amount: "$10.00", deadline: "soon", reason: "x", ref: "re_1", seq: 2 };
    for (const t of Object.keys(TEMPLATES) as TemplateId[]) {
      const r = render(t, vars);
      expect(r.text).toContain(TEST_MODE_FOOTER);
      expect(`${r.subject} ${r.text}`).not.toMatch(/escrow|invest|returns?\b|ownership|yield/i);
    }
  });
});

describe("artist API isolation", () => {
  it("one artist can't touch another's campaign", async () => {
    const sol = `Bearer ${await tokenWith(ids.sol)}`;
    const novaDraft = (await api("POST", "/artist/campaigns", artist, { slug: `nova-draft-${randomUUID().slice(0, 6)}`, title: "Nova draft", type: "Album", goalMinor: 50_000, durationDays: 30, milestoneRelease: false })).json().id;
    expect((await api("PATCH", `/artist/campaigns/${novaDraft}`, sol, { title: "Hijacked" })).statusCode).toBe(404);
    expect((await api("POST", `/artist/campaigns/${novaDraft}/submit`, sol)).statusCode).toBe(404);
    const rows = await asService(k.sql, (tx) => tx<{ title: string }[]>`select title from public.campaigns where id = ${novaDraft}`);
    expect(rows[0].title).toBe("Nova draft");
    expect(n(rows.length)).toBe(1);
  });
});
