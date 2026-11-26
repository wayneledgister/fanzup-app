/**
 * Layer 2 sequencing (design §4–§7). Money state changes happen only inside the SQL functions; this module calls them
 * in order with the Reg CF provider, passing ONE clock (`now`, the request's or the worker tick's) into every money
 * function (design §4.2). The one computation done here is the Waterfall allocation (pure, shared), which the SQL
 * commit re-verifies (collected-only, conservation, cap, split).
 *
 * Purchase and reservation expiry: ./purchase.ts. Ledger ⇄ provider reconciliation: ./recon.ts.
 */
import { createHash } from "node:crypto";
import { allocateWaterfall, canonicalJson, type CertificationRequest, type KycStartRequest, type PoolDraftRequest, type StatementRequest } from "@fanzup/shared";
import { CertificationRequest as CertSchema, PoolDraftRequest as DraftSchema } from "@fanzup/shared/l2schemas";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql, type Tx } from "../db";
import { currentCtx, newCorrelationId, runWithCtx } from "../context";
import { HttpError } from "../lib/auth";
import { log, redact } from "../log";
import type { RegCfProvider } from "../regcf";
import { buildFormC } from "./formc";
import { runDuePoolOps } from "./ops";
import { regcfOf, type L2Deps } from "./gate";
import { expireReservations, providerDown } from "./purchase";
import { reconcileL2Ledger } from "./recon";

export { invest, expireReservations } from "./purchase";
export { reconcileL2Ledger } from "./recon";

// ── Investor onboarding ──────────────────────────────────────────────
export async function startKyc(d: L2Deps, userId: string, body: KycStartRequest) {
  const regcf = regcfOf(d);
  const [cur] = await asService(d.sql, (tx) => tx<{ kyc_status: string; provider_party_ref: string | null }[]>`
    insert into public.investor_profiles (user_id, state) values (${userId}, ${body.state})
    on conflict (user_id) do update set state = coalesce(public.investor_profiles.state, excluded.state)
    returning kyc_status::text, provider_party_ref`);
  if (cur.provider_party_ref) return { kycStatus: cur.kyc_status };
  try {
    // Legal names go to the provider only (design §12); FanZuP keeps the party/account references.
    const party = await regcf.createParty({ firstName: body.firstName, lastName: body.lastName, state: body.state, externalId: userId }, `party:${userId}`);
    const account = await regcf.createAccount({ partyId: party.id, externalId: userId }, `account:${userId}`);
    const link = await regcf.createLink({ accountId: account.id, partyId: party.id }, `link:${userId}`);
    await asService(d.sql, async (tx) => {
      await tx`update public.investor_profiles set provider_party_ref = ${party.id}, provider_account_ref = ${account.id}, provider_link_ref = ${link.id},
                      kyc_status = 'pending', kyc_updated_at = now(), state = ${body.state}
                where user_id = ${userId} and provider_party_ref is null`;
      await tx`insert into public.audit_events (action, entity, entity_id, data) values ('investor.kyc_started', 'investor', ${userId}, ${tx.json({ party_ref: party.id })})`;
    });
    return { kycStatus: "pending" };
  } catch (e) {
    throw providerDown(e);
  }
}

/**
 * Income / net-worth attestation (FR-L2-INV-002). The state of residence is the one the identity check was started
 * with: once the provider party exists, the certification can't change it (round-1 review, PR #12).
 */
export async function certify(sql: Sql, userId: string, raw: CertificationRequest) {
  const b = CertSchema.parse(raw);
  await asService(sql, async (tx) => {
    const [cur] = await tx<{ state: string | null; party: string | null }[]>`
      select state, provider_party_ref as party from public.investor_profiles where user_id = ${userId} for update`;
    if (cur?.party && b.state && b.state !== cur.state) {
      throw new HttpError(409, "state_locked", "Your state of residence was set when your identity check started. Contact support to change it.");
    }
    await tx`
      insert into public.investor_profiles (user_id, annual_income_minor, net_worth_minor, accredited, elsewhere_12m_minor, certified_at, state)
      values (${userId}, ${b.annualIncomeMinor}, ${b.netWorthMinor}, ${b.accredited}, ${b.elsewhereMinor}, now(), ${b.state ?? null})
      on conflict (user_id) do update set annual_income_minor = excluded.annual_income_minor, net_worth_minor = excluded.net_worth_minor,
             accredited = excluded.accredited, elsewhere_12m_minor = excluded.elsewhere_12m_minor, certified_at = now(),
             state = case when public.investor_profiles.provider_party_ref is null then coalesce(excluded.state, public.investor_profiles.state)
                          else public.investor_profiles.state end`;
    // Audit holds flags only — never the figures (L2 gate condition 6).
    await tx`insert into public.audit_events (action, entity, entity_id, data) values ('investor.certified', 'investor', ${userId}, ${tx.json({ accredited: b.accredited })})`;
  });
  return investorMe(sql, userId);
}

export async function investorMe(sql: Sql, userId: string, now = new Date()) {
  const [r] = await asService(sql, (tx) => tx<{ kyc_status: string | null; state: string | null; certified: boolean; accredited: boolean; lim: bigint | null; used: bigint }[]>`
    select ip.kyc_status::text, ip.state, ip.certified_at is not null as certified, coalesce(ip.accredited, false) as accredited,
           public.regcf_investor_limit(${userId}) as lim, public.regcf_usage(${userId}, ${now}) as used
      from (select ${userId}::uuid as id) u left join public.investor_profiles ip on ip.user_id = u.id`);
  const limit = r.lim == null ? null : n(r.lim);
  const used = n(r.used);
  return {
    kycStatus: (r.kyc_status ?? "not_started") as never,
    state: r.state,
    certified: r.certified,
    accredited: r.accredited,
    limitMinor: r.certified ? limit : 0,
    usedMinor: used,
    remainingMinor: !r.certified ? 0 : limit == null ? null : Math.max(0, limit - used),
    regCf: { verifiedOn: POLICY.regCf.verifiedOn },
  };
}

// ── Creator: drafts, submit, launch (FR-L2-CR-001…005) ───────────────
export async function myArtist(sql: Sql, userId: string) {
  const [a] = await asService(sql, (tx) => tx<{ id: string; name: string; tier: string; slug: string }[]>`
    select id, name, tier::text, slug from public.artists where owner_id = ${userId} order by created_at limit 1`);
  if (!a) throw new HttpError(404, "no_artist", "Create your artist profile first.");
  return a;
}

async function writeDraft(tx: Tx, poolId: string, b: ReturnType<typeof DraftSchema.parse>) {
  await tx`delete from public.pool_tranches where pool_id = ${poolId}`;
  for (const t of b.tranches) {
    await tx`insert into public.pool_tranches (pool_id, seq, pct, milestone, evidence_required, target_date)
             values (${poolId}, ${t.seq}, ${t.pct}, ${t.seq === 1 ? null : t.milestone ?? null}, ${t.evidenceRequired ?? null}, ${t.targetDate ?? null})`;
  }
  await tx`insert into public.collection_mechanisms (pool_id, mechanism, revenue_types, badge, details)
           values (${poolId}, ${b.collectionMechanism}, ${b.revenueTypes}::public.revenue_type[], public.l2_risk_badge(${b.collectionMechanism}, ${b.revenueTypes}::public.revenue_type[]), ${tx.json(b.collectionDetails as never)})
           on conflict (pool_id) do update set mechanism = excluded.mechanism, revenue_types = excluded.revenue_types, badge = excluded.badge, details = excluded.details, status = 'submitted', executed_by = null, executed_at = null`;
}

function validateDraft(raw: PoolDraftRequest) {
  const b = DraftSchema.parse(raw);
  const seqs = b.tranches.map((t) => t.seq).sort();
  if (seqs.some((s, i) => s !== i + 1)) throw new HttpError(400, "tranches_invalid", "Number milestones 1, 2, 3 in order.");
  if (b.tranches.reduce((s, t) => s + t.pct, 0) !== 100) throw new HttpError(400, "tranches_invalid", "Milestone shares must add up to 100%.");
  if (b.tranches.some((t) => t.seq > 1 && !t.milestone)) throw new HttpError(400, "tranches_invalid", "Describe every milestone after the first.");
  const creatorBps = 10_000 - b.fansBps - b.platformBps;
  if (creatorBps < 0) throw new HttpError(400, "split_invalid", "Fans, creator and platform shares must add up to 100%.");
  const target = b.useOfFunds.reduce((s, x) => s + x.amountMinor, 0);
  if (target > b.unitsTotal * b.unitPriceMinor) throw new HttpError(400, "units_too_few", "Units × Unit price must cover the funding target.");
  if (target < 100_000) throw new HttpError(400, "target_too_small", "The funding target must be at least $1,000.");
  if (new Set(b.revenueTypes).size !== b.revenueTypes.length) throw new HttpError(400, "invalid_request", "List each revenue type once.");
  return { b, creatorBps, target };
}

export async function createPoolDraft(sql: Sql, userId: string, raw: PoolDraftRequest) {
  const a = await myArtist(sql, userId);
  if (a.tier === "Starter") throw new HttpError(403, "tier_not_eligible", "Revenue-share Pools open at Rising tier. Starter creators can run reward campaigns.");
  const { b, creatorBps, target } = validateDraft(raw);
  try {
    return await asService(sql, async (tx) => {
      const [p] = await tx<{ id: string }[]>`
        insert into public.pools (artist_id, slug, title, artist_display, genre, release_date, tracklist, story, risks, use_of_funds, revenue_types,
          fans_bps, creator_bps, platform_bps, units_total, unit_price_minor, min_units, target_minor, duration_days, return_cap_bps, maturity_months, collection_mechanism)
        values (${a.id}, ${b.slug}, ${b.title}, ${b.artistDisplay ?? a.name}, ${b.genre ?? null}, ${b.releaseDate ?? null}, ${tx.json(b.tracklist)}, ${b.story ?? null}, ${b.risks ?? null},
          ${tx.json(b.useOfFunds as never)}, ${b.revenueTypes}::public.revenue_type[], ${b.fansBps}, ${creatorBps}, ${b.platformBps}, ${b.unitsTotal}, ${b.unitPriceMinor},
          ${b.minUnits}, ${target}, ${b.durationDays}, ${b.returnCapBps}, ${b.maturityMonths}, ${b.collectionMechanism})
        returning id`;
      await writeDraft(tx, p.id, b);
      await tx`insert into public.audit_events (actor_id, action, entity, entity_id) values (${userId}, 'pool.draft_created', 'pool', ${p.id})`;
      return { id: p.id, slug: b.slug, status: "draft" };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "slug_taken", "That Pool address is taken. Try another.");
    throw e;
  }
}

/** Edits are conditional updates under the Pool row lock; the SQL terms guard refuses them outside draft/revisions. */
export async function updatePoolDraft(sql: Sql, userId: string, poolId: string, raw: PoolDraftRequest) {
  await ownPool(sql, userId, poolId);
  const { b, creatorBps, target } = validateDraft(raw);
  await asService(sql, async (tx) => {
    const [p] = await tx<{ status: string }[]>`select status::text from public.pools where id = ${poolId} for update`;
    if (!["draft", "revisions_requested"].includes(p.status)) throw new HttpError(409, "pool_not_editable", "Only drafts and Pools with requested revisions can be edited.");
    await tx`update public.pools set slug = ${b.slug}, title = ${b.title}, artist_display = coalesce(${b.artistDisplay ?? null}, artist_display), genre = ${b.genre ?? null},
               release_date = ${b.releaseDate ?? null}, tracklist = ${tx.json(b.tracklist)}, story = ${b.story ?? null}, risks = ${b.risks ?? null},
               use_of_funds = ${tx.json(b.useOfFunds as never)}, revenue_types = ${b.revenueTypes}::public.revenue_type[], fans_bps = ${b.fansBps}, creator_bps = ${creatorBps},
               platform_bps = ${b.platformBps}, units_total = ${b.unitsTotal}, unit_price_minor = ${b.unitPriceMinor}, min_units = ${b.minUnits}, target_minor = ${target},
               duration_days = ${b.durationDays}, return_cap_bps = ${b.returnCapBps}, maturity_months = ${b.maturityMonths}, collection_mechanism = ${b.collectionMechanism}
             where id = ${poolId}`;
    await writeDraft(tx, poolId, b);
  });
  return { id: poolId };
}

export async function ownPool(sql: Sql, userId: string, poolId: string) {
  if (!/^[0-9a-f-]{36}$/.test(poolId)) throw new HttpError(404, "pool_not_found", "We couldn't find that Pool.");
  const [p] = await asService(sql, (tx) => tx<{ id: string; status: string; artist_id: string }[]>`
    select p.id, p.status::text, p.artist_id from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId} and a.owner_id = ${userId}`);
  if (!p) throw new HttpError(404, "pool_not_found", "We couldn't find that Pool.");
  return p;
}

/** The mock Form C of a Pool, built from its current row (inside `tx` when given, e.g. under the submit locks). */
export async function formCInput(sqlOrTx: Sql | Tx, poolId: string) {
  const read = async (tx: Tx) => {
    const [p] = await tx<{
      id: string; title: string; artist_display: string; artist_name: string; tier: string; release_date: Date | null; tracklist: string[]; story: string | null; risks: string | null;
      use_of_funds: { label: string; amountMinor: number }[]; revenue_types: string[]; fans_bps: number; creator_bps: number; platform_bps: number; units_total: number;
      unit_price_minor: bigint; min_units: number; target_minor: bigint; duration_days: number; return_cap_bps: number; maturity_months: number; collection_mechanism: string;
    }[]>`
      select p.id, p.title, p.artist_display, a.name as artist_name, a.tier::text, p.release_date, p.tracklist, p.story, p.risks, p.use_of_funds,
             p.revenue_types::text[] as revenue_types, p.fans_bps, p.creator_bps, p.platform_bps, p.units_total, p.unit_price_minor, p.min_units, p.target_minor,
             p.duration_days, p.return_cap_bps, p.maturity_months, p.collection_mechanism::text
        from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId}`;
    const tranches = await tx<{ seq: number; pct: number; milestone: string | null; target_date: Date | null }[]>`
      select seq, pct, milestone, target_date from public.pool_tranches where pool_id = ${poolId} order by seq`;
    return { p, tranches };
  };
  const { p, tranches } = "savepoint" in (sqlOrTx as object) ? await read(sqlOrTx as Tx) : await asService(sqlOrTx as Sql, read);
  return buildFormC({
    poolId: p.id, title: p.title, artistDisplay: p.artist_display, artistName: p.artist_name, tier: p.tier,
    releaseDate: p.release_date ? p.release_date.toISOString().slice(0, 10) : null, tracklist: p.tracklist, story: p.story, risks: p.risks,
    useOfFunds: p.use_of_funds, revenueTypes: p.revenue_types as never, fansBps: p.fans_bps, creatorBps: p.creator_bps, platformBps: p.platform_bps,
    unitsTotal: p.units_total, unitPriceMinor: n(p.unit_price_minor), minUnits: p.min_units, targetMinor: n(p.target_minor), durationDays: p.duration_days,
    returnCapBps: p.return_cap_bps, maturityMonths: p.maturity_months, collectionMechanism: p.collection_mechanism as never,
    tranches: tranches.map((t) => ({ seq: t.seq, pct: t.pct, milestone: t.milestone, targetDate: t.target_date ? t.target_date.toISOString().slice(0, 10) : null })),
  });
}

/**
 * Submit for Form C review. The Form C is built INSIDE the transaction that holds the owner's artist locks and the Pool
 * lock (the same order submit_pool takes, §4.2), so the document and `terms_sha256` describe the same terms: a PATCH
 * racing the submit either lands before it (and is in both) or is refused by the terms guard (round-1 review, PR #12).
 */
export async function submitPool(sql: Sql, userId: string, poolId: string, otherRegCfSales12mMinor: number, now = new Date()) {
  await ownPool(sql, userId, poolId);
  const sha = await asService(sql, async (tx) => {
    await tx`select public.l2_lock_owner_artists(${poolId})`;
    await tx`select 1 from public.pools where id = ${poolId} for update`;
    const fc = await formCInput(tx, poolId);
    await tx`select public.submit_pool(${poolId}, ${userId}, ${tx.json(fc.body as never)}, ${fc.sha256}, ${otherRegCfSales12mMinor}, ${now})`;
    return fc.sha256;
  });
  return { status: "in_review", formC: { sha256: sha }, reviewEstimate: POLICY.campaign.reviewEstimate };
}

/**
 * Launch (design §5 "Launch"): provider issuer / offering / collection account with keys `issuer:<artist>`,
 * `offering:<pool>`, `collection:<pool>` and parameters derived only from stored rows — the offering's end date is the
 * Pool's planned deadline (`l2_plan_launch`, persisted before any provider call) and the same value is passed to
 * `launch_pool` as the Pool's `ends_at`, so a retried launch replays the same objects and both deadlines match
 * (round-1 review and review round 2, PR #12). A retry whose plan leaves less than `min_offering_days` (or has passed)
 * gets a new plan; the offering, looked up by our Pool id first (`findOffering`), is then moved to it with
 * `updateOffering` (key `offering_end:<pool>:<deadline>`), so every live Pool has ends_at − starts_at ≥ min_offering_days
 * and the provider's end date is still the Pool's (review round 3). `launch_pool` re-checks the cap with the
 * re-attested outside figure and refuses a short window (`launch_window_too_short`).
 */
export async function launchPool(d: L2Deps, userId: string, poolId: string, body: { otherRegCfSales12mMinor: number; legalName?: string }, now = new Date()) {
  const regcf = regcfOf(d);
  await ownPool(d.sql, userId, poolId);
  const [p] = await asService(d.sql, (tx) => tx<{ status: string; title: string; artist_id: string; artist_name: string; target: bigint; max: bigint; price: bigint; days: number; executed: boolean; legal_name: string | null }[]>`
    select p.status::text, p.title, p.artist_id, a.name as artist_name, p.target_minor as target, p.max_minor as max, p.unit_price_minor as price, p.duration_days as days,
           exists (select 1 from public.collection_mechanisms m where m.pool_id = p.id and m.status = 'executed') as executed,
           (select i.legal_name from public.issuers i where i.artist_id = p.artist_id) as legal_name
      from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId}`);
  if (p.status !== "approved") throw new HttpError(409, "pool_not_approved", "A Pool must pass Form C review before it can go live.");
  if (!p.executed) throw new HttpError(409, "collection_not_executed", "The collection agreement must be executed before the Pool can go live.");
  const legalName = p.legal_name ?? body.legalName ?? `${p.artist_name} Music LLC (demo issuer)`;
  // One stored deadline (review rounds 2–3, PR #12): planned (launch time + duration) and persisted before any provider
  // call, re-planned only when less than min_offering_days remain; the provider's end date and the Pool's ends_at are
  // this value, on the first try and on every retry.
  const [plan] = await asService(d.sql, (tx) => tx<{ ends: Date }[]>`select public.l2_plan_launch(${poolId}, ${userId}, ${now}) as ends`);
  const endsAt = plan.ends;
  const endDate = endsAt.toISOString();
  let refs: { issuer: string; offering: string; collection: string };
  try {
    const issuer = await regcf.createIssuer({ name: legalName, entityType: "LLC", externalId: p.artist_id }, `issuer:${p.artist_id}`);
    // Look the offering up first: an earlier attempt may have created it under an earlier plan (its end date then moves to
    // this plan). Not found: create it (a create under the same key replays the same body, since the plan is the same).
    const found = await regcf.findOffering({ externalId: poolId });
    const offering = found ?? await regcf.createOffering({ issuerId: issuer.id, name: p.title, targetAmount: n(p.target), maxAmount: n(p.max), unitPrice: n(p.price), endDate, externalId: poolId }, `offering:${poolId}`);
    if (found && Date.parse(found.endDate) !== endsAt.getTime()) await regcf.updateOffering(found.id, { endDate }, `offering_end:${poolId}:${endDate}`);
    const ca = await regcf.createCollectionAccount({ offeringId: offering.id, externalId: poolId }, `collection:${poolId}`);
    refs = { issuer: issuer.id, offering: offering.id, collection: ca.id };
  } catch (e) {
    throw providerDown(e);
  }
  const [r] = await asService(d.sql, (tx) => tx<{ ends: Date }[]>`
    select public.launch_pool(${poolId}, ${userId}, ${refs.issuer}, ${refs.offering}, ${refs.collection}, ${legalName}, ${body.otherRegCfSales12mMinor}, ${now}, ${endsAt}) as ends`);
  return { status: "live", endsAt: r.ends.toISOString() };
}

/**
 * Creator royalty statement (FR-L2-REV-001). Always `SELF_REPORTED` (round 2, finding 9): `API_VERIFIED` is reserved for
 * a distributor feed the demo doesn't build. Funded or matured Pools only; the SQL trigger requires the period to be
 * exactly one expected window (`period_not_expected`) ending before maturity (`pool_matured`).
 */
export async function addStatement(sql: Sql, userId: string, poolId: string, b: StatementRequest) {
  const own = await ownPool(sql, userId, poolId);
  if (own.status !== "funded" && own.status !== "matured") throw new HttpError(409, "pool_not_funded", "Royalty statements are added once the Pool has funded.");
  const [p] = await asService(sql, (tx) => tx<{ revenue_types: string[] }[]>`select revenue_types::text[] as revenue_types from public.pools where id = ${poolId}`);
  if (b.periodEnd <= b.periodStart) throw new HttpError(400, "invalid_period", "The period must end after it starts.");
  const gross = b.lines.reduce((s, l) => s + l.amountMinor, 0);
  const covered = b.lines.filter((l) => p.revenue_types.includes(l.revenueType)).reduce((s, l) => s + l.amountMinor, 0);
  const verification = "SELF_REPORTED";
  const sha = createHash("sha256").update(canonicalJson({ poolId, ...b })).digest("hex");
  try {
    const [s] = await asService(sql, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        insert into public.revenue_statements (pool_id, period_label, period_start, period_end, lines, gross_minor, covered_minor, verification, sha256, uploaded_by)
        values (${poolId}, ${b.periodLabel}, ${b.periodStart}, ${b.periodEnd}, ${tx.json(b.lines as never)}, ${gross}, ${covered}, ${verification}, ${sha}, ${userId}) returning id`;
      await tx`insert into public.audit_events (actor_id, action, entity, entity_id, data) values (${userId}, 'revenue.statement_added', 'pool', ${poolId}, ${tx.json({ period: b.periodLabel, covered_minor: covered, sha256: sha })})`;
      return rows;
    });
    return { id: s.id, coveredMinor: covered, grossMinor: gross, verification, sha256: sha, status: "reported" };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "statement_exists", "A statement for that period is already on file.");
    throw e;
  }
}

/** The Pool's expected royalty periods (statements must name one of them). */
export async function periodWindows(sql: Sql, poolId: string) {
  const rows = await asService(sql, (tx) => tx<{ seq: number; period_start: Date; period_end: Date; due_at: Date }[]>`
    select seq, period_start, period_end, due_at from public.l2_period_windows(${poolId})`);
  return rows.map((w) => ({ seq: w.seq, periodStart: w.period_start.toISOString().slice(0, 10), periodEnd: w.period_end.toISOString().slice(0, 10), dueAt: w.due_at.toISOString() }));
}

// ── Waterfall (design §7) ─────────────────────────────────────────────
export async function computeDistribution(sql: Sql, poolId: string, label: string) {
  const [p] = await asService(sql, (tx) => tx<{ status: string; fans_bps: number; creator_bps: number; platform_bps: number; unalloc: bigint }[]>`
    select status::text, fans_bps, creator_bps, platform_bps, -public.pool_balance('pool_revenue_unallocated', id) as unalloc from public.pools where id = ${poolId}`);
  if (!p) throw new HttpError(404, "pool_not_found", "We couldn't find that Pool.");
  const holdings = await asService(sql, (tx) => tx<{ id: string; units: number; cap: bigint; dist: bigint }[]>`
    select id, units, cap_minor as cap, distributed_minor as dist from public.investments where pool_id = ${poolId} and status = 'issued' order by id`);
  const input = {
    collectedMinor: n(p.unalloc), fansBps: p.fans_bps, creatorBps: p.creator_bps, platformBps: p.platform_bps,
    holdings: holdings.map((h) => ({ investmentId: h.id, units: h.units, capRemainingMinor: n(h.cap) - n(h.dist) })),
  };
  const result = allocateWaterfall(input);
  const allocation = {
    runTotalMinor: input.collectedMinor,
    payouts: result.payouts.map((x) => ({ investmentId: x.investmentId, amountMinor: x.amountMinor })),
    creatorMinor: result.creatorMinor,
    platformMinor: result.platformMinor,
    capOverflowMinor: result.capOverflowMinor,
  };
  const hash = createHash("sha256").update(canonicalJson({ poolId, label, input, allocation })).digest("hex");
  return { poolId, label, poolStatus: p.status, input, allocation, fanPoolMinor: result.fanPoolMinor, allCapped: result.allCapped, hash };
}

/**
 * Commit (design §7): recompute from current DB state with `allocateWaterfall()`; refuse `run_stale` unless the hash
 * equals the dry-run's (a replay of an already committed run with that label and hash returns it).
 */
export async function commitDistribution(sql: Sql, poolId: string, label: string, expectedHash: string, actorId: string, now = new Date()) {
  const run = await computeDistribution(sql, poolId, label);
  if (run.hash !== expectedHash) {
    const [prior] = await asService(sql, (tx) => tx<{ id: string }[]>`select id from public.distribution_runs where pool_id = ${poolId} and label = ${label} and input_hash = ${expectedHash}`);
    if (prior) return { runId: prior.id, hash: expectedHash, replayed: true };
    throw new HttpError(409, "run_stale", "Collected revenue or holdings changed since the dry-run. Run the dry-run again.");
  }
  const [r] = await asService(sql, (tx) => tx<{ id: string }[]>`
    select public.commit_distribution_run(${poolId}, ${label}, ${run.hash}, ${tx.json(run.allocation as never)}, ${actorId}, ${now}) as id`);
  return { runId: r.id, hash: run.hash, replayed: false };
}

// ── Worker step (design §2, §4.3, §5, §6, §7) ─────────────────────────
/**
 * One Layer 2 tick at `now`. Runs whenever a Reg CF provider is configured, flag on or off (completion paths, design §2):
 * reservation expiry (with provider lookups), settlement of due Pools, maturity, the `pool_ops` runner, revenue
 * reconciliation of funded and matured Pools, then L2 ledger ⇄ provider recon (after expiry, same `now`).
 */
export async function l2Tick(d: L2Deps & { regcf?: RegCfProvider }, now = new Date()) {
  if (!d.regcf) return null;
  const regcf = d.regcf;
  return runWithCtx({ actorId: null, actorKind: "system:worker", aal: null }, async () => {
    const expiry = await expireReservations({ sql: d.sql, regcf }, now);
    const due = await asService(d.sql, (tx) => tx<{ id: string }[]>`select id from public.pools where status = 'live' and ends_at <= ${now} order by ends_at limit 50`);
    const settled: { id: string; outcome: string }[] = [];
    for (const { id } of due) {
      try {
        const [r] = await runWithCtx({ correlationId: newCorrelationId() }, () => asService(d.sql, async (tx) => {
          const rows = await tx<{ o: string }[]>`select public.settle_pool(${id}, ${now})::text as o`;
          // The creator hears about a failed Pool with their own notice (round-1 review, PR #12).
          if (rows[0].o === "failed") await tx`select public.l2_notify('pool_failed_creator', ${tx.json({ pool_id: id })}, ${"pool_failed_creator:" + id})`;
          return rows;
        }));
        settled.push({ id, outcome: r.o });
      } catch (e) {
        log("alert", "pool.settlement_failed", { poolId: id, error: redact(String((e as Error).message ?? e)) });
      }
    }
    // Expiry again for rows on Pools that just settled (counted reservations wait for their lookup grace).
    if (settled.length) await expireReservations({ sql: d.sql, regcf }, now);
    const [{ matured }] = await asService(d.sql, (tx) => tx<{ matured: number }[]>`select public.mature_due_pools(${now}) as matured`);
    const ops = await runDuePoolOps({ sql: d.sql, regcf }, now);
    const collecting = await asService(d.sql, (tx) => tx<{ id: string }[]>`select id from public.pools where status in ('funded', 'matured') order by id`);
    for (const { id } of collecting) {
      try {
        await asService(d.sql, (tx) => tx`select public.reconcile_pool_revenue(${id}, ${now})`);
      } catch (e) {
        log("warn", "pool.revenue_recon_failed", { poolId: id, error: redact(String((e as Error).message ?? e)) });
      }
    }
    let recon: { diffMinor: number; breaks: number } | null = null;
    try {
      const r = await reconcileL2Ledger({ sql: d.sql, regcf }, { now });
      recon = { diffMinor: r.diffMinor, breaks: r.breaks.length };
    } catch (e) {
      log("warn", "l2_recon.failed", { error: redact(String((e as Error).message ?? e)) });
    }
    return { expiry, settled, matured, ops, recon, correlationId: currentCtx()?.correlationId };
  });
}
