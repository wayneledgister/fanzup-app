/**
 * Services marketplace, Phase MKT-1 (CR-005). FR-MKT-001…010, NFR-MKT-01/03/04/07.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { CATEGORY_KEYS, MKT_OFF_PLATFORM_NOTICE } from "@fanzup/shared/marketplace";
import { POLICY } from "@fanzup/shared/policy";
import { asService } from "../src/db";
import { createUser, ids, kit, tokenWith, type Kit } from "./helpers";

let k: Kit;
let staff: string;
let staffAal1: string;
let artist: string; // nova: owns an artist profile
let fan: string; // no artist profile
let provider: { id: string; auth: string };
let providerId: string;

const api = (method: "GET" | "POST" | "PUT", url: string, auth?: string, payload?: unknown) =>
  k.app.inject({ method, url: `/api/v1${url}`, headers: auth ? { authorization: auth } : {}, payload: payload as never });
const setFlag = (on: boolean) => api("POST", "/staff/flags/marketplace", staff, { on, reason: on ? "Open the marketplace for the test" : "Close the marketplace again" });
/** CR-007: providers accept the current Provider Terms first (FR-MKT-025). The beta tests are in marketplace-beta.test.ts. */
const acceptTerms = (auth: string) => api("POST", "/me/acceptances", auth, { documents: [{ kind: "provider_terms", version: POLICY.legal.providerTerms.version }] });
const profile = (over: Record<string, unknown> = {}) => ({
  slug: "ada-mixes", displayName: "Ada Mixes", headline: "Mixing and mastering for indie records", bio: "Ten years in the studio.",
  city: "Austin", remoteOk: true, categories: ["mixing_mastering", "production"], links: ["https://example.com/ada"], contactEmail: "ada@example.com", ...over,
});
const listings = [
  { category: "mixing_mastering", title: "Mix and master one song", priceFromMinor: 25_000, priceUnit: "song", turnaroundDays: 7 },
  { category: "production", title: "Full production", description: "Beat, arrangement, stems.", priceFromMinor: 120_000, priceUnit: "project" },
];
/** The version staff read in the queue (review finding 2: decisions are made on what staff saw). */
const versionOf = async (id: string) => {
  for (const s of ["in_review", "listed", "changes_requested", "draft", "suspended"]) {
    const hit = (await api("GET", `/staff/marketplace/providers?status=${s}`, staff)).json().items?.find((p: { id: string }) => p.id === id);
    if (hit) return hit.version as string;
  }
  throw new Error(`provider ${id} not in any queue`);
};
const review = async (id: string, decision: string, note?: string, auth = staff, version?: string) =>
  api("POST", `/staff/marketplace/providers/${id}/review`, auth, { decision, note, reason: `Vetted the profile: ${decision}`, version: version ?? (await versionOf(id)) });
const providerStatus = async () => (await api("GET", "/provider", provider.auth)).json().provider.status as string;

beforeAll(async () => {
  k = await kit();
  staff = `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}`;
  staffAal1 = `Bearer ${await tokenWith(ids.reviewer)}`;
  artist = `Bearer ${await tokenWith(ids.nova)}`;
  fan = `Bearer ${await tokenWith(ids.fan)}`;
  provider = await createUser(k.sql, { name: "Ada" });
  for (const a of [provider.auth, staff]) expect((await acceptTerms(a)).statusCode).toBe(201);
});
afterAll(async () => k?.close());

describe("FR-MKT-001: flag off by default", () => {
  it("answers 404 marketplace_disabled everywhere and the config says off", async () => {
    for (const [m, u, a] of [["GET", "/services"], ["GET", "/services/providers/ada-mixes"], ["GET", "/provider", fan], ["GET", "/staff/marketplace/providers", staff]] as const) {
      const r = await api(m, u, a);
      expect(r.statusCode, u).toBe(404);
      expect(r.json().error).toBe("marketplace_disabled");
    }
    expect((await api("GET", "/config")).json().flags.marketplace).toBe(false);
  });
  it("needs aal2 staff to turn on", async () => {
    expect((await api("POST", "/staff/flags/marketplace", staffAal1, { on: true, reason: "Open the marketplace" })).statusCode).toBe(403);
    expect((await api("POST", "/staff/flags/marketplace", artist, { on: true, reason: "Open the marketplace" })).statusCode).toBe(403);
    expect((await setFlag(true)).statusCode).toBe(200);
    expect((await api("GET", "/config")).json().flags.marketplace).toBe(true);
    // These MKT-1 tests run with the beta audience opened to everyone (CR-007, FR-MKT-021).
    expect((await api("POST", "/staff/marketplace/audience", staff, { audience: "everyone", reason: "Run the MKT-1 tests open to all" })).statusCode).toBe(200);
  });
});

describe("FR-MKT-002: categories match the database", () => {
  it("shared list = marketplace_categories()", async () => {
    const [r] = await asService(k.sql, (tx) => tx<{ c: string[] }[]>`select public.marketplace_categories() as c`);
    expect(r.c).toEqual([...CATEGORY_KEYS]);
  });
});

describe("FR-MKT-003/004/008: provider lifecycle", () => {
  it("creates a draft that nobody else can see", async () => {
    const r = await api("PUT", "/provider", provider.auth, profile());
    expect(r.statusCode).toBe(200);
    providerId = r.json().provider.id;
    expect(r.json().provider.status).toBe("draft");
    expect((await api("GET", "/services/providers/ada-mixes")).statusCode).toBe(404);
  });
  it("refuses a taken slug, a bad link and listings outside the profile's categories", async () => {
    const other = await createUser(k.sql);
    await acceptTerms(other.auth);
    expect((await api("PUT", "/provider", other.auth, profile({ contactEmail: "x@example.com" }))).json().error).toBe("slug_taken");
    expect((await api("PUT", "/provider", provider.auth, profile({ links: ["http://example.com"] }))).statusCode).toBe(400);
    expect((await api("PUT", "/provider", other.auth, profile({ slug: "requests", contactEmail: "x@example.com" }))).statusCode).toBe(400);
    expect((await api("PUT", "/provider/listings", provider.auth, [{ category: "video", title: "Music video" }])).statusCode).toBe(400);
  });
  it("needs an active listing to submit", async () => {
    expect((await api("POST", "/provider/submit", provider.auth)).json().error).toBe("no_listings");
    expect((await api("PUT", "/provider/listings", provider.auth, listings)).statusCode).toBe(200);
    const s = await api("POST", "/provider/submit", provider.auth);
    expect(s.json().provider.status).toBe("in_review");
    expect((await api("POST", "/provider/submit", provider.auth)).json().error).toBe("not_submittable");
  });
  it("staff see the queue, need aal2, a note to request changes, and then list", async () => {
    const q = await api("GET", "/staff/marketplace/providers?status=in_review", staff);
    expect(q.json().items.map((p: { id: string }) => p.id)).toContain(providerId);
    expect((await review(providerId, "listed", undefined, staffAal1)).statusCode).toBe(403);
    expect((await review(providerId, "changes_requested")).statusCode).toBe(400);
    expect((await review(providerId, "changes_requested", "Add a portfolio link that works.")).statusCode).toBe(200);
    expect(await providerStatus()).toBe("changes_requested");
    expect((await api("POST", "/provider/submit", provider.auth)).statusCode).toBe(200);
    const l = await review(providerId, "listed");
    expect(l.statusCode).toBe(200);
    expect(l.json().action.status).toBe("executed");
    expect(await providerStatus()).toBe("listed");
    const [audit] = await asService(k.sql, (tx) => tx`select 1 from public.privileged_actions where action = 'provider.review' and subject_id = ${providerId}`);
    expect(audit).toBeTruthy();
  });
  it("staff can't vet their own provider profile", async () => {
    const own = await api("PUT", "/provider", staff, profile({ slug: "staff-own", contactEmail: "s@example.com", categories: ["video"] }));
    expect(own.statusCode).toBe(200);
    await api("PUT", "/provider/listings", staff, [{ category: "video", title: "Music video" }]);
    await api("POST", "/provider/submit", staff);
    expect((await review(own.json().provider.id, "listed")).json().error).toBe("reviewer_is_owner");
  });
});

describe("FR-MKT-005/006: browse and provider page", () => {
  it("lists active listings of listed providers, filters, and never leaks contact", async () => {
    const all = await api("GET", "/services");
    expect(all.statusCode).toBe(200);
    const items = all.json().items as { title: string; provider: Record<string, unknown> }[];
    expect(items.map((i) => i.title).sort()).toEqual(["Full production", "Mix and master one song"]);
    expect(JSON.stringify(all.json())).not.toContain("ada@example.com");
    expect((await api("GET", "/services?category=production")).json().items).toHaveLength(1);
    expect((await api("GET", "/services?q=full")).json().items).toHaveLength(1);
    expect((await api("GET", "/services?q=%25")).json().items).toHaveLength(0);
    expect((await api("GET", "/services?category=video")).json().items).toHaveLength(0);
    const page = await api("GET", "/services/providers/ada-mixes");
    expect(page.json().listings).toHaveLength(2);
    expect(JSON.stringify(page.json())).not.toContain("ada@example.com");
  });
});

let requestId: string;
let listingId: string;
describe("FR-MKT-007/009/010: requests", () => {
  const brief = "Mix four songs for an EP we're funding on FanZuP. Due in March.";
  it("needs a verified artist and refuses your own listing", async () => {
    listingId = (await api("GET", "/services?category=mixing_mastering")).json().items[0].id;
    expect((await api("POST", "/services/requests", undefined, { listingId, brief, shareEmail: true })).statusCode).toBe(401);
    expect((await api("POST", "/services/requests", fan, { listingId, brief, shareEmail: true })).json().error).toBe("no_artist");
    const unverified = await createUser(k.sql, { confirmed: false });
    expect((await api("POST", "/services/requests", unverified.auth, { listingId, brief, shareEmail: true })).json().error).toBe("email_unverified");
  });
  it("sends a request, refuses a duplicate and a foreign campaign", async () => {
    expect((await api("POST", "/services/requests", artist, { listingId, brief, shareEmail: true, campaignId: ids.solCampaign })).statusCode).toBe(400);
    const r = await api("POST", "/services/requests", artist, { listingId, brief, shareEmail: true, campaignId: ids.novaCampaign, budgetMinor: 80_000 });
    expect(r.statusCode).toBe(201);
    requestId = r.json().id;
    expect(r.json().status).toBe("sent");
    expect(r.json().campaign.id).toBe(ids.novaCampaign);
    expect(r.json().providerContactEmail).toBeNull();
    expect((await api("POST", "/services/requests", artist, { listingId, brief, shareEmail: false })).json().error).toBe("already_requested");
  });
  it("the provider sees it without the artist's email until they accept", async () => {
    const inbox = await api("GET", "/provider/requests", provider.auth);
    const mine = inbox.json().items.find((i: { id: string }) => i.id === requestId);
    expect(mine.requesterEmail).toBeNull();
    expect(mine.budgetMinor).toBe(80_000);
    // Someone else can't answer it.
    expect((await api("POST", `/provider/requests/${requestId}/respond`, staff, { decision: "accepted" })).statusCode).toBe(404);
    const acc = await api("POST", `/provider/requests/${requestId}/respond`, provider.auth, { decision: "accepted", note: "Happy to. Email me." });
    expect(acc.statusCode).toBe(200);
    expect(acc.json().requesterEmail).toMatch(/@/);
    expect((await api("POST", `/provider/requests/${requestId}/respond`, provider.auth, { decision: "declined" })).json().error).toBe("already_answered");
    const mineNow = (await api("GET", "/services/requests", artist)).json().items.find((i: { id: string }) => i.id === requestId);
    expect(mineNow.providerContactEmail).toBe("ada@example.com");
    expect(mineNow.providerNote).toBe("Happy to. Email me.");
  });
  it("keeps the artist's email private when they don't share it", async () => {
    const other = (await api("GET", "/services?category=production")).json().items[0].id;
    const r = await api("POST", "/services/requests", artist, { listingId: other, brief, shareEmail: false });
    const [row] = await asService(k.sql, (tx) => tx<{ requester_email: string | null }[]>`select requester_email from public.service_requests where id = ${r.json().id}`);
    expect(row.requester_email).toBeNull();
    const acc = await api("POST", `/provider/requests/${r.json().id}/respond`, provider.auth, { decision: "accepted" });
    expect(acc.json().requesterEmail).toBeNull();
  });
  it("lets the artist withdraw an open request only", async () => {
    const r = await api("POST", "/services/requests", artist, { listingId, brief, shareEmail: false });
    expect((await api("POST", `/services/requests/${r.json().id}/withdraw`, fan)).statusCode).toBe(409);
    expect((await api("POST", `/services/requests/${r.json().id}/withdraw`, artist)).json().status).toBe("withdrawn");
    expect((await api("POST", `/services/requests/${requestId}/withdraw`, artist)).json().error).toBe("not_open");
  });
  it("keeps open requests linked when the provider edits a listing in place", async () => {
    const r = await api("POST", "/services/requests", artist, { listingId, brief, shareEmail: false, neededBy: new Date().toISOString().slice(0, 10) });
    expect(r.statusCode).toBe(201);
    const mine = (await api("GET", "/provider", provider.auth)).json().provider;
    const edited = mine.listings.map((l: { id: string; title: string }) => (l.id === listingId ? { ...l, title: "Mix and master one song, stems included" } : l));
    const saved = await api("PUT", "/provider/listings", provider.auth, edited);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().provider.listings.map((l: { id: string }) => l.id)).toEqual(mine.listings.map((l: { id: string }) => l.id));
    const [row] = await asService(k.sql, (tx) => tx<{ listing_id: string | null }[]>`select listing_id from public.service_requests where id = ${r.json().id}`);
    expect(row.listing_id).toBe(listingId);
    // An id from someone else's listing is refused.
    expect((await api("PUT", "/provider/listings", provider.auth, [{ ...edited[0], id: "00000000-0000-4000-8000-000000000000" }])).statusCode).toBe(400);
    await api("POST", `/services/requests/${r.json().id}/withdraw`, artist);
    // Put the listings back and relist, so later tests see the provider as listed.
    await api("PUT", "/provider/listings", provider.auth, mine.listings);
    if ((await providerStatus()) === "in_review") await review(providerId, "listed");
  });
  it("applies the daily limit", async () => {
    await asService(k.sql, (tx) => tx`
      insert into public.service_requests (listing_title, listing_category, provider_id, requester_id, artist_id, brief, share_email, status)
      select 'x', 'other', ${providerId}, ${ids.nova}, ${ids.novaArtist}, repeat('b', 20), false, 'withdrawn' from generate_series(1, 10)`);
    const r = await api("POST", "/services/requests", artist, { listingId, brief, shareEmail: false });
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toBe("daily_limit");
  });
  it("the off-platform notice is the shared copy", () => {
    expect(MKT_OFF_PLATFORM_NOTICE).toContain("directly with the provider");
  });
});

describe("FR-MKT-003: editing a listed profile goes back to review", () => {
  it("contact changes don't; headline and listing changes do", async () => {
    expect((await api("PUT", "/provider", provider.auth, profile({ contactEmail: "ada2@example.com" }))).json().provider.status).toBe("listed");
    expect((await api("PUT", "/provider", provider.auth, profile({ contactEmail: "ada2@example.com", headline: "Now also vocal production" }))).json().provider.status).toBe("in_review");
    expect((await api("GET", "/services/providers/ada-mixes")).statusCode).toBe(404);
    // Staff read it, then the provider edits again before the decision: the stale decision is refused.
    const seen = await versionOf(providerId);
    await api("PUT", "/provider", provider.auth, profile({ contactEmail: "ada2@example.com", headline: "Now also vocal production", bio: "Changed after staff looked." }));
    expect((await review(providerId, "listed", undefined, staff, seen)).json().error).toBe("provider_changed");
    const seen2 = await versionOf(providerId);
    const mine = (await api("GET", "/provider", provider.auth)).json().provider;
    await api("PUT", "/provider/listings", provider.auth, mine.listings.map((l: Record<string, unknown>) => ({ ...l, title: `${l.title} (edited)` })));
    expect((await review(providerId, "listed", undefined, staff, seen2)).json().error).toBe("provider_changed");
    await api("PUT", "/provider/listings", provider.auth, mine.listings);
    await review(providerId, "listed");
    expect(await providerStatus()).toBe("listed");
    expect((await api("PUT", "/provider/listings", provider.auth, listings.slice(0, 1))).json().provider.status).toBe("in_review");
    await review(providerId, "listed");
  });
});

describe("FR-MKT-008: suspension", () => {
  it("hides the provider and declines open requests", async () => {
    const lid = (await api("GET", "/services")).json().items[0].id;
    await asService(k.sql, (tx) => tx`delete from public.service_requests where requester_id = ${ids.nova} and listing_title = 'x'`);
    const r = await api("POST", "/services/requests", artist, { listingId: lid, brief: "Please mix our live album, twelve tracks.", shareEmail: false });
    expect(r.statusCode).toBe(201);
    expect((await review(providerId, "suspended", "Portfolio links were not the provider's work.")).statusCode).toBe(200);
    expect((await api("GET", "/services/providers/ada-mixes")).statusCode).toBe(404);
    const mine = (await api("GET", "/services/requests", artist)).json().items.find((i: { id: string }) => i.id === r.json().id);
    expect(mine.status).toBe("declined");
    expect(mine.providerNote).toBe("This provider is no longer listed.");
    expect((await api("PUT", "/provider", provider.auth, profile())).json().error).toBe("suspended");
  });
});

describe("NFR-MKT-01/03: no money, no direct client access", () => {
  it("the migrations have no money objects (MKT-1 and the CR-007 closed beta)", () => {
    for (const f of ["20261127000100_marketplace.sql", "20261128000100_marketplace_beta.sql"]) {
      const sqlText = readFileSync(join(import.meta.dirname, "../../../supabase/migrations", f), "utf8")
        .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      expect(sqlText, f).not.toMatch(/ledger|backings|outbound_ops|provider_events|account_kind|balance/i);
    }
  });
  it("anon and authenticated can't read or write the tables directly", async () => {
    const raw = postgres(k.db.url, { max: 1, onnotice: () => {} });
    try {
      for (const role of ["anon", "authenticated"]) {
        for (const t of ["service_providers", "service_listings", "service_requests", "marketplace_invites", "marketplace_members"]) {
          await expect(raw.begin(async (tx) => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(`select * from public.${t} limit 1`); }), `${role} ${t}`).rejects.toThrow(/permission denied/);
        }
      }
    } finally {
      await raw.end();
    }
  });
  it("turning the flag off closes everything again", async () => {
    expect((await setFlag(false)).statusCode).toBe(200);
    expect((await api("GET", "/services")).statusCode).toBe(404);
  });
});
