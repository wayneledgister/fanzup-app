import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { FastifyRequest } from "fastify";
import type { Env } from "../env";
import type { Claims } from "../db";

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
  return verify(h.slice(7));
}

export async function requireUser(req: FastifyRequest, verify: Verify): Promise<Claims> {
  const u = await optionalUser(req, verify);
  if (!u) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return u;
}
