/** The DB mirrors rules from packages/shared. If either side changes alone, this fails. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIERS } from "@fanzup/shared/tiers";
import { CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS } from "@fanzup/shared/campaign";
import { POLICY } from "@fanzup/shared/policy";
import { n, type Sql } from "../src/db";
import { freshDb } from "./helpers";

let db: Awaited<ReturnType<typeof freshDb>>;
let sql: Sql;
beforeAll(async () => { db = await freshDb(); sql = db.sql; });
afterAll(async () => db?.drop());

describe("shared rules ⇄ database", () => {
  it("tier limits match PRD 01 §6.3 (packages/shared/tiers)", async () => {
    const rows = await sql<{ tier: string; campaign_cap_minor: bigint; reg_cf_cap_minor: bigint | null }[]>`select tier::text, campaign_cap_minor, reg_cf_cap_minor from public.tier_limits`;
    for (const t of TIERS) {
      const r = rows.find((x) => x.tier === t.name)!;
      expect(n(r.campaign_cap_minor)).toBe(t.campaignCapMinor);
      expect(r.reg_cf_cap_minor == null ? null : n(r.reg_cf_cap_minor)).toBe(t.regCfCapMinor);
    }
  });
  it("campaign statuses and transitions match packages/shared/campaign", async () => {
    const enumVals = await sql<{ v: string }[]>`select unnest(enum_range(null::public.campaign_status))::text v`;
    expect(enumVals.map((r) => r.v)).toEqual([...CAMPAIGN_STATUSES]);
    const rows = await sql<{ f: string; t: string }[]>`select from_status::text f, to_status::text t from public.campaign_transitions`;
    const db = new Set(rows.map((r) => `${r.f}>${r.t}`));
    const code = new Set(Object.entries(CAMPAIGN_TRANSITIONS).flatMap(([f, ts]) => ts.map((t) => `${f}>${t}`)));
    expect(db).toEqual(code);
  });
  it("campaign length bounds match POLICY", async () => {
    const [r] = await sql<{ def: string }[]>`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'campaigns_duration_days_check'`;
    expect(r.def).toContain(`>= ${POLICY.campaign.minDays}`);
    expect(r.def).toContain(`<= ${POLICY.campaign.maxDays}`);
  });
});
