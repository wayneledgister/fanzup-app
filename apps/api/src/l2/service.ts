/**
 * Layer 2 sequencing (design §4–§7). Money state changes happen only inside the SQL functions; this module calls them
 * in order with the Reg CF provider. The one computation done here is the Waterfall allocation (pure, shared), which
 * the SQL commit re-verifies (collected-only, conservation, cap, split).
 */
import { createHash } from "node:crypto";
import { allocateWaterfall, canonicalJson, type CertificationRequest, type InvestRequest, type KycStartRequest, type PoolDraftRequest, type StatementRequest } from "@fanzup/shared";
import { CertificationRequest as CertSchema, PoolDraftRequest as DraftSchema } from "@fanzup/shared/l2schemas";
import { POLICY } from "@fanzup/shared/policy";
import { asService, n, type Sql, type Tx } from "../db";
import { currentCtx, newCorrelationId, runWithCtx } from "../context";
import { HttpError } from "../lib/auth";
import { log, redact } from "../log";
import { RegCfError, type RegCfProvider } from "../regcf";
import { buildFormC } from "./formc";
import { runDuePoolOps } from "./ops";
import { regcfOf, type L2Deps } from "./gate";

const providerDown = (e: unknown) => {
  if (e instanceof HttpError) return e;
  if (e instanceof RegCfError && e.cls === "permanent") return new HttpError(409, `provider_${e.code}`, e.message);
  return new HttpError(502, "provider_unavailable", "We couldn't reach the escrow provider. Nothing was charged — try again.");
};

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

export async function certify(sql: Sql, userId: string, raw: CertificationRequest) {
  const b = CertSchema.parse(raw);
  await asService(sql, async (tx) => {
    await tx`
      insert into public.investor_profiles (user_id, annual_income_minor, net_worth_minor, accredited, elsewhere_12m_minor, certified_at, state)
      values (${userId}, ${b.annualIncomeMinor}, ${b.netWorthMinor}, ${b.accredited}, ${b.elsewhereMinor}, now(), ${b.state ?? null})
      on conflict (user_id) do update set annual_income_minor = excluded.annual_income_minor, net_worth_minor = excluded.net_worth_minor,
             accredited = excluded.accredited, elsewhere_12m_minor = excluded.elsewhere_12m_minor, certified_at = now(),
             state = coalesce(excluded.state, public.investor_profiles.state)`;
    // Audit holds flags only — never the figures (L2 gate condition 6).
    await tx`insert into public.audit_events (action, entity, entity_id, data) values ('investor.certified', 'investor', ${userId}, ${tx.json({ accredited: b.accredited })})`;
  });
  return investorMe(sql, userId);
}

export async function investorMe(sql: Sql, userId: string) {
  const [r] = await asService(sql, (tx) => tx<{ kyc_status: string | null; state: string | null; certified: boolean; accredited: boolean; lim: bigint | null; used: bigint }[]>`
    select ip.kyc_status::text, ip.state, ip.certified_at is not null as certified, coalesce(ip.accredited, false) as accredited,
           public.regcf_investor_limit(${userId}) as lim, public.regcf_usage(${userId}) as used
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

// ── Purchase (FR-L2-INV-004): claim-first idempotency (M1 pattern) ─────
type Claim = { request_hash: string; response: unknown; status_code: number | null; state: string; resource_id: string | null };

export async function invest(d: L2Deps, userId: string, poolId: string, key: string, body: InvestRequest) {
  const regcf = regcfOf(d);
  const hash = createHash("sha256").update(JSON.stringify({ u: userId, poolId, body })).digest("hex");
  const scoped = `investments:${userId}:${key}`;
  const [mine] = await asService(d.sql, (tx) => tx<{ key: string }[]>`
    insert into public.api_idempotency (key, user_id, request_hash, state) values (${scoped}, ${userId}, ${hash}, 'in_progress')
    on conflict (key) do nothing returning key`);
  let invId: string | null = null;
  if (!mine) {
    const [prior] = await asService(d.sql, (tx) => tx<Claim[]>`select request_hash, response, status_code, state, resource_id from public.api_idempotency where key = ${scoped}`);
    if (prior.request_hash !== hash) throw new HttpError(422, "idempotency_key_reused", "That Idempotency-Key was used for a different request.");
    if (prior.state === "done" && prior.response) return { status: prior.status_code ?? 201, body: prior.response };
    if (!prior.resource_id) throw new HttpError(409, "in_progress", "This purchase is already being processed. Wait a moment and try again.");
    invId = prior.resource_id;
  }
  if (!invId) {
    try {
      const [r] = await asService(d.sql, async (tx) => {
        const rows = await tx<{ investment_id: string }[]>`select * from public.reserve_investment(${userId}, ${poolId}, ${body.units}, ${body.riskAckVersion})`;
        await tx`update public.api_idempotency set resource_id = ${rows[0].investment_id} where key = ${scoped}`;
        return rows;
      });
      invId = r.investment_id;
    } catch (e) {
      await asService(d.sql, (tx) => tx`delete from public.api_idempotency where key = ${scoped} and resource_id is null`);
      throw e;
    }
  }
  const [i] = await asService(d.sql, (tx) => tx<{ status: string; units: number; amount: bigint; unit_price: bigint; offering: string; account: string }[]>`
    select i.status::text, i.units, i.amount_minor as amount, i.unit_price_minor as unit_price, p.provider_offering_ref as offering, ip.provider_account_ref as account
      from public.investments i join public.pools p on p.id = i.pool_id join public.investor_profiles ip on ip.user_id = i.investor_id
     where i.id = ${invId}`);
  if (i.status === "expired" || i.status === "cancelled") throw new HttpError(409, "reservation_expired", "Your reservation expired. Start again from the Pool page.");
  if (i.status === "reserved") {
    try {
      const trade = await regcf.createTrade({ offeringId: i.offering, accountId: i.account, units: i.units, unitPrice: n(i.unit_price), amount: n(i.amount), externalId: invId }, `trade:${invId}`);
      const fund = await regcf.fundTrade(trade.id, { amount: n(i.amount), externalId: invId }, `fund:${invId}`);
      await asService(d.sql, (tx) => tx`select public.mark_investment_funding(${invId}, ${trade.id}, ${fund.id})`);
    } catch (e) {
      throw providerDown(e);
    }
  }
  const [now] = await asService(d.sql, (tx) => tx<{ status: string }[]>`select status::text from public.investments where id = ${invId}`);
  const response = { investmentId: invId, status: now.status, amountMinor: n(i.amount), units: i.units };
  await asService(d.sql, (tx) => tx`update public.api_idempotency set response = ${tx.json(response as never)}, status_code = 201, state = 'done' where key = ${scoped}`);
  return { status: 201, body: response };
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

export async function updatePoolDraft(sql: Sql, userId: string, poolId: string, raw: PoolDraftRequest) {
  const pool = await ownPool(sql, userId, poolId);
  if (!["draft", "revisions_requested"].includes(pool.status)) throw new HttpError(409, "pool_not_editable", "Only drafts and Pools with requested revisions can be edited.");
  const { b, creatorBps, target } = validateDraft(raw);
  await asService(sql, async (tx) => {
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

export async function formCInput(sql: Sql, poolId: string) {
  const [p] = await asService(sql, (tx) => tx<{
    id: string; title: string; artist_display: string; artist_name: string; tier: string; release_date: Date | null; tracklist: string[]; story: string | null; risks: string | null;
    use_of_funds: { label: string; amountMinor: number }[]; revenue_types: string[]; fans_bps: number; creator_bps: number; platform_bps: number; units_total: number;
    unit_price_minor: bigint; min_units: number; target_minor: bigint; duration_days: number; return_cap_bps: number; maturity_months: number; collection_mechanism: string;
  }[]>`
    select p.id, p.title, p.artist_display, a.name as artist_name, a.tier::text, p.release_date, p.tracklist, p.story, p.risks, p.use_of_funds,
           p.revenue_types::text[] as revenue_types, p.fans_bps, p.creator_bps, p.platform_bps, p.units_total, p.unit_price_minor, p.min_units, p.target_minor,
           p.duration_days, p.return_cap_bps, p.maturity_months, p.collection_mechanism::text
      from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId}`);
  const tranches = await asService(sql, (tx) => tx<{ seq: number; pct: number; milestone: string | null; target_date: Date | null }[]>`
    select seq, pct, milestone, target_date from public.pool_tranches where pool_id = ${poolId} order by seq`);
  return buildFormC({
    poolId: p.id, title: p.title, artistDisplay: p.artist_display, artistName: p.artist_name, tier: p.tier,
    releaseDate: p.release_date ? p.release_date.toISOString().slice(0, 10) : null, tracklist: p.tracklist, story: p.story, risks: p.risks,
    useOfFunds: p.use_of_funds, revenueTypes: p.revenue_types as never, fansBps: p.fans_bps, creatorBps: p.creator_bps, platformBps: p.platform_bps,
    unitsTotal: p.units_total, unitPriceMinor: n(p.unit_price_minor), minUnits: p.min_units, targetMinor: n(p.target_minor), durationDays: p.duration_days,
    returnCapBps: p.return_cap_bps, maturityMonths: p.maturity_months, collectionMechanism: p.collection_mechanism as never,
    tranches: tranches.map((t) => ({ seq: t.seq, pct: t.pct, milestone: t.milestone, targetDate: t.target_date ? t.target_date.toISOString().slice(0, 10) : null })),
  });
}

export async function submitPool(sql: Sql, userId: string, poolId: string) {
  await ownPool(sql, userId, poolId);
  const fc = await formCInput(sql, poolId);
  await asService(sql, (tx) => tx`select public.submit_pool(${poolId}, ${userId}, ${tx.json(fc.body as never)}, ${fc.sha256})`);
  return { status: "in_review", formC: { sha256: fc.sha256 }, reviewEstimate: POLICY.campaign.reviewEstimate };
}

export async function launchPool(d: L2Deps, userId: string, poolId: string) {
  const regcf = regcfOf(d);
  await ownPool(d.sql, userId, poolId);
  const [p] = await asService(d.sql, (tx) => tx<{ status: string; title: string; artist_id: string; artist_name: string; target: bigint; max: bigint; price: bigint; days: number; executed: boolean }[]>`
    select p.status::text, p.title, p.artist_id, a.name as artist_name, p.target_minor as target, p.max_minor as max, p.unit_price_minor as price, p.duration_days as days,
           exists (select 1 from public.collection_mechanisms m where m.pool_id = p.id and m.status = 'executed') as executed
      from public.pools p join public.artists a on a.id = p.artist_id where p.id = ${poolId}`);
  if (p.status !== "approved") throw new HttpError(409, "pool_not_approved", "A Pool must pass Form C review before it can go live.");
  if (!p.executed) throw new HttpError(409, "collection_not_executed", "The collection agreement must be executed before the Pool can go live.");
  const legalName = `${p.artist_name} Music LLC (demo issuer)`;
  let refs: { issuer: string; offering: string; collection: string };
  try {
    const issuer = await regcf.createIssuer({ name: legalName, entityType: "LLC", externalId: p.artist_id }, `issuer:${p.artist_id}`);
    const endDate = new Date(Date.now() + p.days * 86_400_000).toISOString().slice(0, 10);
    const offering = await regcf.createOffering({ issuerId: issuer.id, name: p.title, targetAmount: n(p.target), maxAmount: n(p.max), unitPrice: n(p.price), endDate, externalId: poolId }, `offering:${poolId}`);
    const ca = await regcf.createCollectionAccount({ offeringId: offering.id, externalId: poolId }, `collection:${poolId}`);
    refs = { issuer: issuer.id, offering: offering.id, collection: ca.id };
  } catch (e) {
    throw providerDown(e);
  }
  const [r] = await asService(d.sql, (tx) => tx<{ ends: Date }[]>`select public.launch_pool(${poolId}, ${userId}, ${refs.issuer}, ${refs.offering}, ${refs.collection}, ${legalName}) as ends`);
  return { status: "live", endsAt: r.ends.toISOString() };
}

export async function addStatement(sql: Sql, userId: string, poolId: string, b: StatementRequest) {
  const own = await ownPool(sql, userId, poolId);
  if (own.status !== "funded") throw new HttpError(409, "pool_not_funded", "Royalty statements are added once the Pool has funded.");
  const [p] = await asService(sql, (tx) => tx<{ revenue_types: string[]; mechanism: string }[]>`
    select revenue_types::text[] as revenue_types, collection_mechanism::text as mechanism from public.pools where id = ${poolId}`);
  if (b.periodEnd <= b.periodStart) throw new HttpError(400, "invalid_period", "The period must end after it starts.");
  const gross = b.lines.reduce((s, l) => s + l.amountMinor, 0);
  const covered = b.lines.filter((l) => p.revenue_types.includes(l.revenueType)).reduce((s, l) => s + l.amountMinor, 0);
  const verification = p.mechanism === "SELF_REPORT" ? "SELF_REPORTED" : "API_VERIFIED";
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

// ── Ledger ⇄ provider (AC-E1 / collection mirror) ─────────────────────
export async function reconcileL2Ledger(d: L2Deps, poolId?: string) {
  const regcf = regcfOf(d);
  const pools = await asService(d.sql, (tx) => tx<{ id: string; offering: string; collection: string | null; escrow: bigint; coll: bigint }[]>`
    select id, provider_offering_ref as offering, provider_collection_ref as collection,
           public.pool_balance('pool_escrow', id) as escrow, public.pool_balance('pool_collection', id) as coll
      from public.pools where provider_offering_ref is not null and (${poolId ?? null}::uuid is null or id = ${poolId ?? null}::uuid)`);
  const out: { poolId: string; escrow: { ledgerMinor: number; providerMinor: number; diffMinor: number }; collection: { ledgerMinor: number; providerMinor: number; diffMinor: number } }[] = [];
  for (const p of pools) {
    const esc = await regcf.getEscrow(p.offering);
    const col = p.collection ? await regcf.getCollectionAccount(p.collection) : { balance: 0 };
    const row = {
      poolId: p.id,
      escrow: { ledgerMinor: n(p.escrow), providerMinor: esc.balance, diffMinor: esc.balance - n(p.escrow) },
      collection: { ledgerMinor: n(p.coll), providerMinor: col.balance, diffMinor: col.balance - n(p.coll) },
    };
    out.push(row);
    await asService(d.sql, async (tx) => {
      for (const [kind, diff] of [["escrow_diff", row.escrow.diffMinor], ["collection_diff", row.collection.diffMinor]] as const) {
        const key = `${kind}:${p.id}`;
        if (diff !== 0) {
          await tx`insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs) values (${p.id}, ${kind}, ${key}, ${diff}, ${tx.json(row as never)})
                   on conflict (dedupe_key) where resolved_at is null do update set amount_minor = excluded.amount_minor, refs = excluded.refs`;
        } else {
          await tx`update public.pool_breaks set resolved_at = now(), resolution = 'cleared_by_run' where dedupe_key = ${key} and resolved_at is null`;
        }
      }
    });
  }
  return { pools: out, diffMinor: out.reduce((s, r) => s + Math.abs(r.escrow.diffMinor) + Math.abs(r.collection.diffMinor), 0) };
}

// ── Worker step (design §5) ───────────────────────────────────────────
export async function l2Tick(d: L2Deps & { regcf?: RegCfProvider }, now = new Date()) {
  if (!d.regcf) return null;
  const [on] = await asService(d.sql, (tx) => tx<{ on: boolean }[]>`select public.l2_enabled() as on`);
  if (!on.on) return null;
  return runWithCtx({ actorId: null, actorKind: "system:worker", aal: null }, async () => {
    const [{ expired }] = await asService(d.sql, (tx) => tx<{ expired: number }[]>`select public.expire_investment_reservations(${now}) as expired`);
    const due = await asService(d.sql, (tx) => tx<{ id: string }[]>`select id from public.pools where status = 'live' and ends_at <= ${now} order by ends_at limit 50`);
    const settled: { id: string; outcome: string }[] = [];
    for (const { id } of due) {
      try {
        const [r] = await runWithCtx({ correlationId: newCorrelationId() }, () => asService(d.sql, (tx) => tx<{ o: string }[]>`select public.settle_pool(${id}, ${now})::text as o`));
        settled.push({ id, outcome: r.o });
      } catch (e) {
        log("alert", "pool.settlement_failed", { poolId: id, error: redact(String((e as Error).message ?? e)) });
      }
    }
    const ops = await runDuePoolOps({ sql: d.sql, regcf: d.regcf! });
    const funded = await asService(d.sql, (tx) => tx<{ id: string }[]>`select id from public.pools where status = 'funded'`);
    for (const { id } of funded) {
      try {
        await asService(d.sql, (tx) => tx`select public.reconcile_pool_revenue(${id}, ${now})`);
      } catch (e) {
        log("warn", "pool.revenue_recon_failed", { poolId: id, error: redact(String((e as Error).message ?? e)) });
      }
    }
    return { expired, settled, ops, correlationId: currentCtx()?.correlationId };
  });
}
