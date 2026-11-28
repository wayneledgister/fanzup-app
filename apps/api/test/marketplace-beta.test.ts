/**
 * Services marketplace closed beta (CR-007, specs/marketplace/02-design.md §12, ADR-012).
 * FR-MKT-021…028, NFR-MKT-08/09.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { POLICY } from "@fanzup/shared/policy";
import { asService } from "../src/db";
import { createUser, ids, kit, tokenWith, type Kit } from "./helpers";

let k: Kit;
let staff: string;
let staffAal1: string;
let artist: string; // nova: owns an artist profile
let outsider: { id: string; auth: string };
let prov: { id: string; auth: string; email: string };
let providerCode: string;
let artistInviteId: string;

const api = (method: "GET" | "POST" | "PUT", url: string, auth?: string, payload?: unknown) =>
  k.app.inject({ method, url: `/api/v1${url}`, headers: auth ? { authorization: auth } : {}, payload: payload as never });
const emailOf = (id: string) => `fan-${id.slice(0, 8)}@fanzup.test`;
const invite = (email: string, kind: "provider" | "artist", auth = staff) =>
  api("POST", "/staff/marketplace/invites", auth, { email, kind, name: "Beta guest", note: "From Wayne's network", reason: "Invite to the closed beta" });
const acceptTerms = (auth: string, version: string = POLICY.legal.providerTerms.version) =>
  api("POST", "/me/acceptances", auth, { documents: [{ kind: "provider_terms", version }] });
/** Simulates a new Provider Terms version shipping (the version lives in code, ADR-012). */
async function withTermsVersion(v: string, fn: () => Promise<void>) {
  const terms = POLICY.legal.providerTerms as { version: string };
  const before = terms.version;
  terms.version = v;
  try { await fn(); } finally { terms.version = before; }
}
const profile = { slug: "beta-mixer", displayName: "Beta Mixer", headline: "Mixing for the closed beta", remoteOk: true, categories: ["mixing_mastering"], links: [], contactEmail: "mixer@example.com" };

beforeAll(async () => {
  k = await kit();
  staff = `Bearer ${await tokenWith(ids.reviewer, { aal: "aal2" })}`;
  staffAal1 = `Bearer ${await tokenWith(ids.reviewer)}`;
  artist = `Bearer ${await tokenWith(ids.nova)}`;
  outsider = await createUser(k.sql);
  const p = await createUser(k.sql, { name: "Beta Mixer" });
  prov = { ...p, email: emailOf(p.id) };
  expect((await api("POST", "/staff/flags/marketplace", staff, { on: true, reason: "Open for the closed beta test" })).statusCode).toBe(200);
});
afterAll(async () => k?.close());

describe("FR-MKT-021/024: the default audience is invited people only", () => {
  it("starts as `invited` and the access check says so", async () => {
    const anon = (await api("GET", "/services/access")).json();
    expect(anon).toMatchObject({ audience: "invited", signedIn: false, member: null, canBrowse: false, canRequest: false, canProvide: false });
    expect(anon.providerTerms).toEqual({ version: POLICY.legal.providerTerms.version, approved: POLICY.legal.providerTerms.approved, accepted: false });
    expect((await api("GET", "/services/access", outsider.auth)).json()).toMatchObject({ signedIn: true, canBrowse: false });
    // Staff can look around to vet, but can't request or provide without an invite.
    expect((await api("GET", "/services/access", staff)).json()).toMatchObject({ canBrowse: true, canRequest: false, canProvide: false });
  });
  it("the API refuses outsiders on every route (NFR-MKT-09)", async () => {
    expect((await api("GET", "/services")).statusCode).toBe(401);
    expect((await api("GET", "/services", outsider.auth)).json().error).toBe("invite_only");
    expect((await api("GET", "/services/providers/beta-mixer", outsider.auth)).json().error).toBe("invite_only");
    expect((await api("POST", "/services/requests", artist, { listingId: "00000000-0000-4000-8000-000000000000", brief: "x".repeat(30), shareEmail: false })).json().error).toBe("invite_only");
    await acceptTerms(outsider.auth);
    expect((await api("PUT", "/provider", outsider.auth, { ...profile, slug: "outsider-x" })).json().error).toBe("invite_only");
    expect((await api("GET", "/services", staff)).statusCode).toBe(200);
  });
});

describe("FR-MKT-023: `join` is a reserved provider address", () => {
  it("the shared schema and the database both refuse it", async () => {
    const { ProviderProfileInput, RESERVED_SLUGS } = await import("@fanzup/shared/marketplace");
    expect(RESERVED_SLUGS).toContain("join");
    expect(ProviderProfileInput.safeParse({ ...profile, slug: "join" }).success).toBe(false);
    await expect(asService(k.sql, (tx) => tx`
      insert into public.service_providers (owner_id, slug, display_name, headline, categories, contact_email)
      values (${outsider.id}, 'join', 'Joiner', 'A reserved address', '{other}', 'j@example.com')`)).rejects.toThrow(/service_providers_slug_check/);
  });
});

describe("FR-MKT-022: invites", () => {
  it("needs aal2 staff and a reason, answers the code once and stores only its hash (NFR-MKT-08)", async () => {
    expect((await invite(prov.email, "provider", staffAal1)).statusCode).toBe(403);
    expect((await invite(prov.email, "provider", artist)).statusCode).toBe(403);
    const r = await invite(prov.email, "provider");
    expect(r.statusCode).toBe(201);
    providerCode = r.json().code;
    expect(providerCode).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(r.json().invite).toMatchObject({ email: prov.email, kind: "provider", status: "open" });
    const [row] = await asService(k.sql, (tx) => tx<{ code_hash: string }[]>`select code_hash from public.marketplace_invites where id = ${r.json().invite.id}`);
    expect(row.code_hash).toBe(createHash("sha256").update(providerCode).digest("hex"));
    // The code is nowhere else: not in the privileged action, not in audit events.
    const [leak] = await asService(k.sql, (tx) => tx`
      select 1 from public.privileged_actions where params::text like ${"%" + providerCode + "%"}
      union all select 1 from public.audit_events where data::text like ${"%" + providerCode + "%"}`);
    expect(leak).toBeUndefined();
    const [pa] = await asService(k.sql, (tx) => tx`select 1 from public.privileged_actions where action = 'marketplace.invite' and status = 'executed'`);
    expect(pa).toBeTruthy();
  });
  it("refuses a second open invite for the same email, and lists invites", async () => {
    expect((await invite(prov.email.toUpperCase(), "artist")).json().error).toBe("invite_exists");
    const a = await invite(emailOf(ids.nova), "artist");
    expect(a.statusCode).toBe(201);
    artistInviteId = a.json().invite.id;
    const list = (await api("GET", "/staff/marketplace/invites", staff)).json().items;
    expect(list.map((i: { email: string }) => i.email)).toEqual(expect.arrayContaining([prov.email, emailOf(ids.nova)]));
  });
  it("revokes an open invite once", async () => {
    const x = await invite("someone@example.com", "artist");
    const id = x.json().invite.id;
    const r = await api("POST", `/staff/marketplace/invites/${id}/revoke`, staff, { reason: "Sent to the wrong person" });
    expect(r.json().invite.status).toBe("revoked");
    expect((await api("POST", `/staff/marketplace/invites/${id}/revoke`, staff, { reason: "Sent to the wrong person" })).json().error).toBe("invite_not_open");
    expect((await api("POST", "/services/join", outsider.auth, { code: x.json().code })).json().error).toBe("invite_invalid");
  });
  it("an expired open invite can be replaced", async () => {
    const x = await invite("late@example.com", "provider");
    await asService(k.sql, (tx) => tx`update public.marketplace_invites set expires_at = now() - interval '1 minute' where id = ${x.json().invite.id}`);
    expect((await api("GET", "/staff/marketplace/invites", staff)).json().items.find((i: { id: string }) => i.id === x.json().invite.id).status).toBe("expired");
    expect((await invite("late@example.com", "provider")).statusCode).toBe(201);
  });
});

describe("FR-MKT-023: redeeming", () => {
  it("needs the invited account, refuses bad codes the same way, and is single-use", async () => {
    expect((await api("POST", "/services/join", undefined, { code: providerCode })).statusCode).toBe(401);
    expect((await api("POST", "/services/join", prov.auth, { code: "A".repeat(24) })).json().error).toBe("invite_invalid");
    expect((await api("POST", "/services/join", prov.auth, { code: "short" })).json().error).toBe("invite_invalid");
    const wrong = await api("POST", "/services/join", outsider.auth, { code: providerCode });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("invite_email_mismatch");
    expect(JSON.stringify(wrong.json())).not.toContain(prov.email);
    const ok = await api("POST", "/services/join", prov.auth, { code: providerCode });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().member.kind).toBe("provider");
    expect((await api("POST", "/services/join", prov.auth, { code: providerCode })).json().error).toBe("invite_invalid");
    expect((await api("GET", "/services/access", prov.auth)).json()).toMatchObject({ member: { kind: "provider" }, canBrowse: true, canRequest: true, canProvide: true });
  });
});

describe("FR-MKT-025: Provider Terms acceptance", () => {
  it("is required to create a profile, submit and respond, and checks the version", async () => {
    expect((await api("PUT", "/provider", prov.auth, profile)).json().error).toBe("provider_terms_required");
    expect((await acceptTerms(prov.auth, "1999-01-01")).json().error).toBe("version_not_current");
    expect((await acceptTerms(prov.auth)).statusCode).toBe(201);
    expect((await api("GET", "/services/access", prov.auth)).json().providerTerms.accepted).toBe(true);
    const created = await api("PUT", "/provider", prov.auth, profile);
    expect(created.statusCode).toBe(200);
    await api("PUT", "/provider/listings", prov.auth, [{ category: "mixing_mastering", title: "Beta mix", priceFromMinor: 10_000, priceUnit: "song" }]);
    // A new version blocks submit until it's accepted.
    await withTermsVersion("2026-12-01-test", async () => {
      expect((await api("GET", "/services/access", prov.auth)).json().providerTerms.accepted).toBe(false);
      expect((await api("POST", "/provider/submit", prov.auth)).json().error).toBe("provider_terms_required");
      await acceptTerms(prov.auth);
      expect((await api("POST", "/provider/submit", prov.auth)).json().provider.status).toBe("in_review");
    });
    const [q] = (await api("GET", "/staff/marketplace/providers?status=in_review", staff)).json().items;
    const listed = await api("POST", `/staff/marketplace/providers/${q.id}/review`, staff, { decision: "listed", reason: "Vetted for the closed beta", version: q.version });
    expect(listed.statusCode).toBe(200);
  });
  it("records the acceptance with its version in the append-only consents table", async () => {
    const rows = await asService(k.sql, (tx) => tx<{ version: string }[]>`select version from public.consents where user_id = ${prov.id} and kind = 'provider_terms'`);
    expect(rows.map((r) => r.version)).toContain(POLICY.legal.providerTerms.version);
  });
});

describe("FR-MKT-023/021: an invited artist can request; responding needs the terms", () => {
  it("joins with an artist invite, browses and sends a request", async () => {
    // The earlier invite went to an address that isn't Nova's account email (nova@fanzup.test), so it can't be redeemed by that account.
    await api("POST", `/staff/marketplace/invites/${artistInviteId}/revoke`, staff, { reason: "Reissue the artist invite" });
    const novaInvite = await invite("nova@fanzup.test", "artist");
    expect((await api("POST", "/services/join", artist, { code: novaInvite.json().code })).json().member.kind).toBe("artist");
    const access = (await api("GET", "/services/access", artist)).json();
    expect(access).toMatchObject({ canBrowse: true, canRequest: true, canProvide: false });
    const items = (await api("GET", "/services", artist)).json().items;
    expect(items).toHaveLength(1);
    const r = await api("POST", "/services/requests", artist, { listingId: items[0].id, brief: "Mix our closed-beta single, please.", shareEmail: false });
    expect(r.statusCode).toBe(201);
    // An artist member can't become a provider without a provider invite.
    await acceptTerms(artist);
    expect((await api("PUT", "/provider", artist, { ...profile, slug: "nova-mixes", contactEmail: "n@example.com" })).json().error).toBe("invite_only");
    // Responding needs the current terms.
    await withTermsVersion("2026-12-02-test", async () => {
      expect((await api("POST", `/provider/requests/${r.json().id}/respond`, prov.auth, { decision: "accepted" })).json().error).toBe("provider_terms_required");
    });
    expect((await api("POST", `/provider/requests/${r.json().id}/respond`, prov.auth, { decision: "accepted" })).statusCode).toBe(200);
  });
});

describe("FR-MKT-021: widening the audience", () => {
  it("is a privileged, audited action that needs aal2 and a known audience", async () => {
    expect((await api("POST", "/staff/marketplace/audience", staffAal1, { audience: "open_requests", reason: "Widen the beta to artists" })).statusCode).toBe(403);
    expect((await api("POST", "/staff/marketplace/audience", staff, { audience: "nobody", reason: "Widen the beta to artists" })).statusCode).toBe(400);
    expect((await api("POST", "/staff/marketplace/audience", staff, { audience: "open_requests", reason: "short" })).json().error).toBe("reason_required");
    expect((await api("POST", "/staff/marketplace/audience", staff, { audience: "open_requests", reason: "Widen the beta to artists" })).statusCode).toBe(200);
    expect((await api("GET", "/services/access", outsider.auth)).json()).toMatchObject({ audience: "open_requests", canBrowse: true, canRequest: true, canProvide: false });
    expect((await api("GET", "/services")).statusCode).toBe(401);
    // Browsing in `open_requests` needs a verified account (FR-MKT-021).
    const unverified = await createUser(k.sql, { confirmed: false });
    expect((await api("GET", "/services", unverified.auth)).json().error).toBe("invite_only");
    expect((await api("POST", "/staff/marketplace/audience", staff, { audience: "everyone", reason: "Open the marketplace to all" })).statusCode).toBe(200);
    expect((await api("GET", "/services")).statusCode).toBe(200);
    // An expired or broken token counts as signed out for public reads, so it can't break open browsing.
    expect((await api("GET", "/services", "Bearer not-a-token")).statusCode).toBe(200);
    expect((await api("GET", "/services/access", "Bearer not-a-token")).json().signedIn).toBe(false);
    expect((await api("GET", "/services/access", outsider.auth)).json().canProvide).toBe(true);
    expect((await api("POST", "/staff/marketplace/audience", staff, { audience: "invited", reason: "Back to invited people only" })).statusCode).toBe(200);
  });
});

describe("FR-MKT-027: removing a member", () => {
  it("ends access at once, keeps their data, and staff can't remove themselves", async () => {
    const members = (await api("GET", "/staff/marketplace/members", staff)).json().items;
    expect(members.find((m: { userId: string }) => m.userId === prov.id)).toMatchObject({ kind: "provider", providerStatus: "listed", removedAt: null });
    expect((await api("POST", `/staff/marketplace/members/${ids.reviewer}/remove`, staff, { reason: "Remove myself from the beta" })).json().error).toBe("not_member");
    expect((await api("POST", `/staff/marketplace/members/${ids.nova}/remove`, staff, { reason: "Left the beta at their request" })).statusCode).toBe(200);
    expect((await api("GET", "/services", artist)).json().error).toBe("invite_only");
    // Their own requests stay readable.
    expect((await api("GET", "/services/requests", artist)).json().items.length).toBeGreaterThan(0);
    expect((await api("POST", `/staff/marketplace/members/${ids.nova}/remove`, staff, { reason: "Left the beta at their request" })).json().error).toBe("not_member");
  });
});

describe("FR-MKT-028: beta metrics", () => {
  it("counts members, invites, providers and requests without personal data", async () => {
    const m = (await api("GET", "/staff/marketplace/metrics", staff)).json();
    expect(m.members).toEqual({ provider: 1, artist: 0 });
    expect(m.invites.redeemed).toBe(2);
    expect(m.invites.revoked).toBe(3);
    expect(m.providers.listed).toBe(1);
    expect(m.listedByCategory).toEqual({ mixing_mastering: 1 });
    expect(m.requests.accepted).toBe(1);
    expect(m.acceptanceRate).toBe(1);
    expect(m.requestsLast7Days).toBe(1);
    expect(typeof m.medianResponseHours).toBe("number");
    expect(JSON.stringify(m)).not.toMatch(/@/);
    expect((await api("GET", "/staff/marketplace/metrics", artist)).statusCode).toBe(403);
  });
});

describe("FR-MKT-026: launch guard", () => {
  it("a deployed environment can't open the marketplace until counsel's approval is in the code", async () => {
    await api("POST", "/staff/flags/marketplace", staff, { on: false, reason: "Close before the guard test" });
    const deployed = k.deps.env.deployed;
    k.deps.env.deployed = true;
    try {
      const r = await api("POST", "/staff/flags/marketplace", staff, { on: true, reason: "Try to open in production" });
      if (POLICY.legal.providerTerms.approved && POLICY.legal.privacyCoversMarketplace) {
        expect(r.statusCode).toBe(200);
      } else {
        expect(r.statusCode).toBe(409);
        expect(r.json().error).toBe("legal_not_ready");
        const [failed] = await asService(k.sql, (tx) => tx`select 1 from public.privileged_actions where action = 'flag.set' and status = 'failed'`);
        expect(failed).toBeUndefined();
      }
      // Turning it off is always allowed.
      expect((await api("POST", "/staff/flags/marketplace", staff, { on: false, reason: "Close it again for the test" })).statusCode).toBe(200);
    } finally {
      k.deps.env.deployed = deployed;
    }
    expect((await api("GET", "/services/access")).json().error).toBe("marketplace_disabled");
  });
});
