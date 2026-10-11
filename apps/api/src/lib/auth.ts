import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { FastifyRequest } from "fastify";
import type { Env } from "../env";
import { asService, type Claims, type Sql } from "../db";
import { setActor } from "../context";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * Verifies a Supabase access token. Supports the current asymmetric signing keys (JWKS)
 * and the legacy shared HS256 secret.
 */
export function createVerifier(env: Env) {
  const jwks = env.SUPABASE_URL ? createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`)) : null;
  const secret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;

  return async function verify(token: string): Promise<Claims> {
    let payload: JWTPayload;
    try {
      // Newer Supabase projects sign with asymmetric keys (JWKS); older ones with the shared HS256 secret.
      // Pick by the token's own algorithm so either kind of project works with the same config.
      const { alg } = decodeProtectedHeader(token);
      if (alg === "HS256") {
        if (!secret) throw new Error("HS256 token but no SUPABASE_JWT_SECRET");
        payload = (await jwtVerify(token, secret, { audience: "authenticated" })).payload;
      } else {
        if (!jwks) throw new Error("asymmetric token but no SUPABASE_URL");
        payload = (await jwtVerify(token, jwks, { audience: "authenticated" })).payload;
      }
    } catch {
      throw new HttpError(401, "invalid_token", "Your session has expired. Sign in again.");
    }
    if (!payload.sub) throw new HttpError(401, "invalid_token", "Token has no subject");
    return payload as Claims;
  };
}

export type Verify = ReturnType<typeof createVerifier>;

export async function optionalUser(req: FastifyRequest, verify: Verify): Promise<Claims | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const claims = await verify(h.slice(7));
  // The verified actor and second-factor level come from the token, never from request input (FR-ID-003).
  setActor(claims.sub, "user", typeof claims.aal === "string" ? claims.aal : null);
  return claims;
}

export async function requireUser(req: FastifyRequest, verify: Verify): Promise<Claims> {
  const u = await optionalUser(req, verify);
  if (!u) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return u;
}

/**
 * FR-ID-001 / FR-BCK-002 (card G1-B option 3): a verified email before the first backing. Checked against
 * auth.users on the server, never trusted from the client.
 */
export async function requireVerifiedUser(req: FastifyRequest, verify: Verify, sql: Sql): Promise<Claims> {
  const u = await requireUser(req, verify);
  const [row] = await asService(sql, (tx) => tx<{ confirmed: boolean }[]>`select public.email_confirmed(${u.sub}) as confirmed`);
  if (!row?.confirmed) throw new HttpError(403, "email_unverified", "Verify your email address to continue. We sent you a link when you signed up.");
  return u;
}
