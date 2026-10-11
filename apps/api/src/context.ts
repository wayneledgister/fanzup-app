/**
 * Request/job context (ADR-005). Holds the correlation id and the verified actor for the current unit of work.
 * `asUser`/`asService` copy it into Postgres (`fanzup.*` settings) at the start of every transaction, so audit,
 * ledger and outbox rows record it without any SQL function taking extra parameters.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface Ctx {
  correlationId: string;
  /** Verified user id (from the token) or null for system work. Never taken from request input. */
  actorId: string | null;
  /** 'user' | 'staff' | 'system:<component>' */
  actorKind: string;
  /** Authenticator assurance level from the verified token ('aal1' | 'aal2'). */
  aal: string | null;
}

const als = new AsyncLocalStorage<Ctx>();
const CORRELATION_RE = /^[A-Za-z0-9._:-]{8,64}$/;

export const newCorrelationId = () => randomUUID();
export const acceptCorrelationId = (given: unknown): string =>
  typeof given === "string" && CORRELATION_RE.test(given) ? given : newCorrelationId();

export function currentCtx(): Ctx | undefined {
  return als.getStore();
}

/** Run `fn` with a fresh context (jobs) or a derived one. */
export function runWithCtx<T>(ctx: Partial<Omit<Ctx, "correlationId">> & { correlationId?: string | null }, fn: () => T): T {
  const parent = als.getStore();
  return als.run(
    {
      correlationId: ctx.correlationId || parent?.correlationId || newCorrelationId(),
      actorId: ctx.actorId !== undefined ? ctx.actorId : parent?.actorId ?? null,
      actorKind: ctx.actorKind ?? parent?.actorKind ?? "system:api",
      aal: ctx.aal !== undefined ? ctx.aal : parent?.aal ?? null,
    },
    fn,
  );
}

/** Used by the Fastify onRequest hook: the rest of the request runs inside this store. */
export function enterRequest(correlationId: string, done: () => void) {
  als.run({ correlationId, actorId: null, actorKind: "anonymous", aal: null }, done);
}

/** Record the verified actor on the current request (called by the auth helpers). */
export function setActor(actorId: string, actorKind: string, aal: string | null) {
  const s = als.getStore();
  if (s) {
    s.actorId = actorId;
    s.actorKind = actorKind;
    s.aal = aal;
  }
}
