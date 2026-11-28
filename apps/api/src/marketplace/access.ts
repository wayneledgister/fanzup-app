/**
 * Marketplace closed-beta access (CR-007; specs/marketplace/02-design.md §12.2, ADR-012). FR-MKT-021/024/025.
 *
 * One function decides who may browse, request and provide; every marketplace route calls it (NFR-MKT-09). The
 * `/services/access` route returns the same answer so clients can hide entry points, but clients are never the guard.
 * No money (NFR-MKT-01).
 */
import { POLICY } from "@fanzup/shared/policy";
import { MKT_INVITE_ONLY, type Audience, type MarketplaceAccess, type MemberKind } from "@fanzup/shared/marketplace";
import { asService, type Claims, type Sql, type Tx } from "../db";
import type { FastifyRequest } from "fastify";
import { HttpError, optionalUser, type Verify } from "../lib/auth";

export interface Access extends Omit<MarketplaceAccess, "providerTerms"> {
  staff: boolean;
}

export const INVITE_ONLY = () => new HttpError(403, "invite_only", MKT_INVITE_ONLY);
export const TERMS_REQUIRED = () =>
  new HttpError(409, "provider_terms_required", "Accept the current Provider Terms first. You'll find them at the top of your provider profile.");

export async function accessFor(sql: Sql, user: Claims | null): Promise<Access> {
  const [r] = await asService(sql, (tx) => tx<{ audience: Audience; kind: MemberKind | null; staff: boolean; verified: boolean }[]>`
    select public.marketplace_audience() as audience,
           coalesce(public.email_confirmed(${user?.sub ?? null}::uuid), false) as verified,
           (select m.kind from public.marketplace_members m where m.user_id = ${user?.sub ?? null}::uuid and m.removed_at is null) as kind,
           exists (select 1 from public.staff s where s.user_id = ${user?.sub ?? null}::uuid) as staff`);
  const audience: Audience = (["invited", "open_requests", "everyone"] as const).includes(r.audience) ? r.audience : "invited";
  const signedIn = !!user;
  // `open_requests` lets in any *verified* signed-in user (FR-MKT-021); requests and provider profiles check
  // verification again on their own routes (requireVerifiedUser).
  const verified = signedIn && r.verified;
  const member = r.kind ? { kind: r.kind } : null;
  const provider = member?.kind === "provider";
  // Design §12.2 table.
  const canBrowse = audience === "everyone" || (audience === "open_requests" ? verified : !!member || r.staff);
  const canRequest = signedIn && (audience === "invited" ? !!member : true);
  const canProvide = signedIn && (audience === "everyone" ? true : provider);
  return { audience, signedIn, member, staff: r.staff, canBrowse, canRequest, canProvide };
}

/**
 * The caller for public marketplace reads: a valid token's claims, or anonymous when there's no token or it's no longer
 * valid (an expired session must not break browsing that's open to everyone; PR #31 review). Where the audience needs
 * sign-in, the route then answers 401 and the client signs in again.
 */
export async function viewer(req: FastifyRequest, verify: Verify): Promise<Claims | null> {
  try {
    return await optionalUser(req, verify);
  } catch {
    return null;
  }
}

/** Has the user accepted the current Provider Terms version (FR-MKT-025)? */
export async function hasProviderTerms(tx: Tx, userId: string): Promise<boolean> {
  const [c] = await tx`select 1 from public.consents where user_id = ${userId} and kind = 'provider_terms' and version = ${POLICY.legal.providerTerms.version} limit 1`;
  return !!c;
}
export async function requireProviderTerms(tx: Tx, userId: string): Promise<void> {
  if (!(await hasProviderTerms(tx, userId))) throw TERMS_REQUIRED();
}

/** FR-MKT-026: a deployed environment opens the marketplace only once counsel has approved the documents in code. */
export const legalReady = () => POLICY.legal.providerTerms.approved && POLICY.legal.privacyCoversMarketplace;
