/**
 * Server-side `layer2` gate (FR-PLT-001 slice; design §2, §9). Two gates:
 *  - `l2Gate` (entry paths: fan and creator routes, staff actions that start something new): a Reg CF provider is
 *    configured (REGCF_PROVIDER=mock, refused when deployed) AND the database flag `flag.layer2` is true.
 *  - `l2MockGate` (completion paths: the investor's cancel and own-investment read, staff queue / money view / recon /
 *    collection state, webhooks, worker steps): the mock provider only. Money already in flight always finishes and
 *    investors keep their 227.304(a) cancellation right while the flag is off.
 * Off answers 404 `layer2_disabled` in both cases.
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

/** Fastify preHandler for Layer 2 entry routes: provider configured and flag on. */
export const l2Gate = (d: L2Deps) => async (_req: FastifyRequest) => {
  if (!(await l2On(d))) throw DISABLED();
};

/** Fastify preHandler for Layer 2 completion routes: provider configured, flag not required. */
export const l2MockGate = (d: L2Deps) => async (_req: FastifyRequest) => {
  if (!d.regcf) throw DISABLED();
};

export function regcfOf(d: L2Deps): RegCfProvider {
  if (!d.regcf) throw DISABLED();
  return d.regcf;
}
