/**
 * Server-side `layer2` gate (FR-PLT-001 slice; design §2). Layer 2 is on only when a Reg CF provider is configured
 * (REGCF_PROVIDER=mock, refused when deployed) AND the database flag `flag.layer2` is true.
 */
import type { FastifyRequest } from "fastify";
import { asService, type Sql } from "../db";
import { HttpError } from "../lib/auth";
import type { RegCfProvider } from "../regcf";

export interface L2Deps {
  sql: Sql;
  regcf?: RegCfProvider;
}

export async function l2On(d: L2Deps): Promise<boolean> {
  if (!d.regcf) return false;
  const [r] = await asService(d.sql, (tx) => tx<{ on: boolean }[]>`select public.l2_enabled() as on`);
  return r.on;
}

export const DISABLED = () => new HttpError(404, "layer2_disabled", "Investing isn't open yet.");

/** Fastify preHandler for every Layer 2 route. */
export const l2Gate = (d: L2Deps) => async (_req: FastifyRequest) => {
  if (!(await l2On(d))) throw DISABLED();
};

export function regcfOf(d: L2Deps): RegCfProvider {
  if (!d.regcf) throw DISABLED();
  return d.regcf;
}
