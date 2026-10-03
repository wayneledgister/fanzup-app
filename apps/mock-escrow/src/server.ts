/**
 * Mock escrow HTTP service (ADR-007). Local development and CI only — refuses to start in a deployed environment.
 *   POST/GET /v1/...   TransactAPI-shaped resources (x-api-key; Idempotency-Key on every POST)
 *   /admin/...         clock (advance), reset, fixtures, state, webhook log (x-api-key)
 * Webhooks are signed (signing.ts) and POSTed to MOCK_ESCROW_WEBHOOK_URL with retries.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { MockError, MockEscrowEngine } from "./engine";

export interface ServerConfig {
  port: number;
  apiKey: string;
  webhookSecret: string;
  webhookUrl: string;
  dbPath: string;
  fixtures?: string;
  tickMs: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV || env.RENDER || env.DEPLOY_ENV === "staging" || env.DEPLOY_ENV === "production") {
    throw new Error("mock-escrow is a local/CI tool and refuses to run in a deployed environment (ADR-007 §6)");
  }
  return {
    port: Number(env.MOCK_ESCROW_PORT ?? 8790),
    apiKey: env.MOCK_ESCROW_API_KEY ?? "mock_escrow_dev_key",
    webhookSecret: env.MOCK_ESCROW_WEBHOOK_SECRET ?? "mock_escrow_dev_webhook_secret",
    webhookUrl: env.MOCK_ESCROW_WEBHOOK_URL ?? "http://localhost:8787/api/v1/webhooks/regcf",
    dbPath: env.MOCK_ESCROW_DB ?? resolve(import.meta.dirname, "../.data/mock-escrow.sqlite"),
    fixtures: env.MOCK_ESCROW_FIXTURES ?? resolve(import.meta.dirname, "../fixtures/layer2-seed.json"),
    tickMs: Number(env.MOCK_ESCROW_TICK_MS ?? 250),
  };
}

export function buildServer(cfg: ServerConfig, engine?: MockEscrowEngine) {
  const eng =
    engine ??
    new MockEscrowEngine({
      db: cfg.dbPath,
      webhookSecret: cfg.webhookSecret,
      deliver: async (body, headers) => {
        const res = await fetch(cfg.webhookUrl, { method: "POST", headers, body }).catch(() => null);
        return !!res && res.status >= 200 && res.status < 300;
      },
    });
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { level: "info" } });
  const key = Buffer.from(cfg.apiKey);

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const given = Buffer.from(String(req.headers["x-api-key"] ?? ""));
    if (given.length !== key.length || !timingSafeEqual(given, key)) return reply.status(401).send({ error: "unauthorized", message: "Invalid API key." });
  });
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof MockError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err.validation || (err.statusCode && err.statusCode < 500)) return reply.status(err.statusCode ?? 400).send({ error: "invalid_request", message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: "mock-escrow error" });
  });

  const idem = (req: FastifyRequest) => req.headers["idempotency-key"] as string | undefined;
  const body = <T>(req: FastifyRequest) => (req.body ?? {}) as T;

  app.get("/health", async () => ({ ok: true, service: "mock-escrow", now: new Date(eng.now()).toISOString() }));

  app.post("/v1/issuers", async (req, reply) => reply.status(201).send(eng.createIssuer(body(req), idem(req))));
  app.post("/v1/offerings", async (req, reply) => reply.status(201).send(eng.createOffering(body(req), idem(req))));
  app.get<{ Params: { id: string } }>("/v1/offerings/:id", async (req) => eng.get("offering", req.params.id));
  app.get<{ Params: { id: string } }>("/v1/offerings/:id/escrow", async (req) => eng.getEscrow(req.params.id));
  app.post<{ Params: { id: string } }>("/v1/offerings/:id/close", async (req) => eng.closeOffering(req.params.id, idem(req)));
  app.post<{ Params: { id: string } }>("/v1/offerings/:id/disbursements", async (req, reply) => reply.status(201).send(eng.disburseToIssuer(req.params.id, body(req), idem(req))));
  app.post("/v1/parties", async (req, reply) => reply.status(201).send(eng.createParty(body(req), idem(req))));
  app.get<{ Params: { id: string } }>("/v1/parties/:id", async (req) => {
    const { lastNameUpper: _hidden, ...p } = eng.get("party", req.params.id);
    return p;
  });
  app.post<{ Params: { id: string } }>("/v1/parties/:id/kyc", async (req) => eng.updatePartyKyc(req.params.id, body<{ kycStatus: "approved" | "rejected" }>(req).kycStatus, idem(req)));
  app.post("/v1/accounts", async (req, reply) => reply.status(201).send(eng.createAccount(body(req), idem(req))));
  app.post("/v1/links", async (req, reply) => reply.status(201).send(eng.createLink(body(req), idem(req))));
  app.post("/v1/trades", async (req, reply) => reply.status(201).send(eng.createTrade(body(req), idem(req))));
  app.get<{ Params: { id: string } }>("/v1/trades/:id", async (req) => eng.getTrade(req.params.id));
  app.post<{ Params: { id: string } }>("/v1/trades/:id/fund", async (req, reply) => reply.status(201).send(eng.fundTrade(req.params.id, body(req), idem(req))));
  app.post<{ Params: { id: string } }>("/v1/trades/:id/refund", async (req, reply) => reply.status(201).send(eng.refundTrade(req.params.id, body(req), idem(req))));
  app.post("/v1/collection-accounts", async (req, reply) => reply.status(201).send(eng.createCollectionAccount(body(req), idem(req))));
  app.get<{ Params: { id: string } }>("/v1/collection-accounts/:id", async (req) => eng.getCollectionAccount(req.params.id));
  app.post<{ Params: { id: string } }>("/v1/collection-accounts/:id/deposits", async (req, reply) => reply.status(201).send(eng.simulateDeposit(req.params.id, body(req), idem(req))));
  app.post<{ Params: { id: string } }>("/v1/collection-accounts/:id/payouts", async (req, reply) => reply.status(201).send(eng.payoutFromCollection(req.params.id, body(req), idem(req))));

  app.post("/admin/advance", async (req) => eng.advance(Number(body<{ seconds?: number }>(req).seconds ?? 0)));
  app.post("/admin/tick", async () => eng.tick());
  app.post("/admin/reset", async (req) => {
    eng.reset();
    if (body<{ fixtures?: boolean }>(req).fixtures && cfg.fixtures) eng.loadFixture(JSON.parse(readFileSync(cfg.fixtures, "utf8")));
    return eng.state();
  });
  app.get("/admin/state", async () => eng.state());
  app.get("/admin/webhooks", async () => ({ webhooks: eng.webhookLog() }));
  app.post<{ Params: { id: string } }>("/admin/webhooks/:id/redeliver", async (req) => ({ delivered: await eng.redeliver(req.params.id) }));
  return { app, engine: eng };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const cfg = configFromEnv();
  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  const { app, engine } = buildServer(cfg);
  if (engine.isEmpty() && cfg.fixtures) {
    try {
      engine.loadFixture(JSON.parse(readFileSync(cfg.fixtures, "utf8")));
      app.log.info({ fixtures: cfg.fixtures }, "mock-escrow.fixtures_loaded");
    } catch (e) {
      app.log.warn({ error: String(e) }, "mock-escrow.fixtures_skipped");
    }
  }
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await engine.tick();
    } catch (e) {
      app.log.error(e);
    } finally {
      running = false;
    }
  }, cfg.tickMs);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => { clearInterval(timer); await app.close(); process.exit(0); });
  await app.listen({ port: cfg.port, host: "0.0.0.0" });
}
