/**
 * Builds the mock escrow fixture (apps/mock-escrow/fixtures/layer2-seed.json) from a database loaded with
 * supabase/seed_layer2.sql, so the provider's balances match the ledger exactly (NFR-L2-05).
 * Usage (local DB already reset with both seeds):  DATABASE_URL=… pnpm --filter @fanzup/api exec tsx scripts/l2-fixture.ts
 * A test (test/l2-seed.test.ts) regenerates it from a fresh database and asserts it equals the committed file.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

type Obj = Record<string, unknown> & { id: string };
const N = (v: unknown) => Number(v);
const byId = (a: Obj, b: Obj) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function buildFixture(sql: postgres.Sql) {
  const pools = await sql`select id, title, provider_offering_ref, provider_collection_ref, target_minor, max_minor, unit_price_minor, status::text, issuer_id
                            from public.pools where provider_offering_ref is not null`;
  const issuers = await sql`select id, artist_id, legal_name, entity_type, provider_issuer_ref from public.issuers`;
  const parties = await sql`select user_id, kyc_status::text, provider_party_ref, provider_account_ref, provider_link_ref, state from public.investor_profiles where provider_party_ref is not null`;
  const inv = await sql`select i.provider_trade_ref, i.provider_fund_ref, i.units, i.unit_price_minor, i.amount_minor, i.status::text, i.refund_ref,
                               p.provider_offering_ref as offering, ip.provider_account_ref as account
                          from public.investments i join public.pools p on p.id = i.pool_id join public.investor_profiles ip on ip.user_id = i.investor_id
                         where i.provider_trade_ref is not null`;
  const disb = await sql`select o.provider_ref, p.provider_offering_ref as offering, t.released_minor
                           from public.pool_ops o join public.pool_tranches t on t.id = o.subject_id join public.pools p on p.id = o.pool_id
                          where o.kind = 'disburse' and t.status = 'released'`;
  const deps = await sql`select s.provider_ref, s.amount_minor, s.reference, s.pool_id, p.provider_collection_ref as ca from public.settlement_lines s join public.pools p on p.id = s.pool_id`;
  const pays = await sql`select d.provider_ref, d.kind, d.amount_minor, p.provider_collection_ref as ca, ip.provider_account_ref as account, i2.provider_issuer_ref as issuer
                           from public.distribution_payouts d join public.pools p on p.id = d.pool_id left join public.issuers i2 on i2.id = p.issuer_id
                           left join public.investor_profiles ip on ip.user_id = d.investor_id where d.status = 'paid'`;
  const kyc = (s: string) => (s === "approved" ? ["approved", "cleared"] : s === "rejected" ? ["rejected", "rejected"] : s === "manual_review" ? ["manual_review", "hold"] : ["pending", "pending"]);
  const objects: Record<string, Obj[]> = {
    issuer: issuers.filter((i) => i.provider_issuer_ref).map((i) => ({ id: i.provider_issuer_ref, name: i.legal_name, entityType: i.entity_type, externalId: i.artist_id, status: "active" })),
    offering: pools.map((p) => ({
      id: p.provider_offering_ref, issuerId: issuers.find((i) => i.id === p.issuer_id)?.provider_issuer_ref, name: p.title, targetAmount: N(p.target_minor), maxAmount: N(p.max_minor),
      unitPrice: N(p.unit_price_minor), endDate: "seed", externalId: p.id, status: ["funded", "matured"].includes(p.status) ? "closed" : p.status === "live" ? "open" : "cancelled",
      escrowAccount: `esc_${p.provider_offering_ref}`,
    })),
    collectionAccount: pools.filter((p) => p.provider_collection_ref).map((p) => ({ id: p.provider_collection_ref, offeringId: p.provider_offering_ref, externalId: p.id })),
    party: parties.map((p) => ({ id: p.provider_party_ref, externalId: p.user_id, state: p.state, kycStatus: kyc(p.kyc_status)[0], amlStatus: kyc(p.kyc_status)[1], lastNameUpper: "SEED" })),
    account: parties.map((p) => ({ id: p.provider_account_ref, partyId: p.provider_party_ref, externalId: p.user_id, type: "individual" })),
    link: parties.map((p) => ({ id: p.provider_link_ref, accountId: p.provider_account_ref, partyId: p.provider_party_ref, relationship: "owner" })),
    trade: inv.map((i) => ({
      id: i.provider_trade_ref, offeringId: i.offering, accountId: i.account, units: i.units, unitPrice: N(i.unit_price_minor), amount: N(i.amount_minor),
      externalId: i.provider_trade_ref, status: i.status === "refunded" ? "refunded" : "funded", fundMoveId: i.provider_fund_ref,
    })),
    fundMove: inv.map((i) => ({ id: i.provider_fund_ref, tradeId: i.provider_trade_ref, offeringId: i.offering, amount: N(i.amount_minor), externalId: i.provider_trade_ref, status: "settled" })),
    refund: inv.filter((i) => i.refund_ref).map((i) => ({ id: i.refund_ref, tradeId: i.provider_trade_ref, offeringId: i.offering, amount: N(i.amount_minor), externalId: "seed", status: "settled" })),
    disbursement: disb.map((d) => ({ id: d.provider_ref, offeringId: d.offering, amount: N(d.released_minor), externalId: "seed", status: "settled" })),
    deposit: deps.map((d) => ({ id: d.provider_ref, collectionAccountId: d.ca, amount: N(d.amount_minor), reference: d.reference, externalId: d.pool_id, status: "settled" })),
    payout: pays.map((p) => ({
      id: p.provider_ref, collectionAccountId: p.ca, recipientType: p.kind === "creator" ? "issuer" : p.kind, recipientRef: p.kind === "investor" ? p.account : p.kind === "creator" ? p.issuer : "fanzup-platform",
      amount: N(p.amount_minor), externalId: "seed", status: "settled",
    })),
  };
  for (const k of Object.keys(objects)) objects[k] = objects[k].sort(byId);
  return { note: "Generated from supabase/seed_layer2.sql by apps/api/scripts/l2-fixture.ts. Do not edit by hand.", objects };
}

if (process.argv[1]?.endsWith("l2-fixture.ts")) {
  const sql = postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres", { max: 1 });
  const f = await buildFixture(sql);
  const out = join(import.meta.dirname, "../../mock-escrow/fixtures/layer2-seed.json");
  writeFileSync(out, `${JSON.stringify(f, null, 2)}\n`);
  console.log(`wrote ${out}`);
  await sql.end();
}
