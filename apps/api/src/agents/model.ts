/**
 * Model boundary for agents (CR-003, FR-AGT-F-006, ADR-008). Agents call `generate` with a fixed system prompt, the
 * input (user-written text marked untrusted) and a zod schema; they get back schema-valid output or an error.
 * The model has no tools in Phase 0.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { POLICY } from "@fanzup/shared/policy";

export interface GenerateRequest<S extends z.ZodType> {
  agent: string;
  system: string;
  input: string;
  schema: S;
  maxTokens?: number;
}
export interface GenerateResult<T> {
  output: T;
  model: string;
  usage: Record<string, number>;
}
export interface ModelClient {
  readonly name: "none" | "fake" | "anthropic";
  generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<GenerateResult<z.infer<S>>>;
}

/** Stable error codes recorded on `agent_runs.error_code` (never the provider's message text). */
export class ModelError extends Error {
  constructor(public code: "model_disabled" | "model_refused" | "model_invalid_output" | "model_truncated" | "model_rate_limited" | "model_unavailable" | "model_error", msg?: string) {
    super(msg ?? code);
  }
}

export class NoModel implements ModelClient {
  readonly name = "none" as const;
  async generate(): Promise<never> {
    throw new ModelError("model_disabled");
  }
}

/** Tests and local runs: returns whatever the handler returns, validated against the schema like the real one. */
export class FakeModel implements ModelClient {
  readonly name = "fake" as const;
  calls: GenerateRequest<z.ZodType>[] = [];
  constructor(private handler: (req: GenerateRequest<z.ZodType>) => unknown | Promise<unknown>) {}
  async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<GenerateResult<z.infer<S>>> {
    this.calls.push(req);
    const raw = await this.handler(req);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new ModelError("model_invalid_output");
    return { output: parsed.data as z.infer<S>, model: "fake", usage: {} };
  }
}

type BetaClient = Pick<Anthropic, "beta">;

export class AnthropicModel implements ModelClient {
  readonly name = "anthropic" as const;
  constructor(private client: BetaClient, private model: string = POLICY.agents.model) {}

  /** The exact request body (exported for the contract test; no network). */
  params<S extends z.ZodType>(req: GenerateRequest<S>) {
    return {
      model: this.model,
      max_tokens: req.maxTokens ?? 16_000,
      system: req.system,
      messages: [{ role: "user" as const, content: req.input }],
      output_config: { effort: "high" as const, format: betaZodOutputFormat(req.schema) },
      // Server-side refusal fallback (routes by refusal category); a fallback answer is still schema-validated.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    };
  }

  async generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<GenerateResult<z.infer<S>>> {
    let res;
    try {
      res = await this.client.beta.messages.parse(this.params(req) as never, { timeout: POLICY.agents.modelTimeoutMs, maxRetries: 1 });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ModelError("model_rate_limited");
      if (e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)) throw new ModelError("model_unavailable");
      if (e instanceof Anthropic.APIError) throw new ModelError("model_error", `status ${e.status}`);
      throw new ModelError("model_invalid_output");
    }
    if (res.stop_reason === "refusal") throw new ModelError("model_refused");
    if (res.stop_reason === "max_tokens") throw new ModelError("model_truncated");
    if (res.parsed_output == null) throw new ModelError("model_invalid_output");
    const checked = req.schema.safeParse(res.parsed_output);
    if (!checked.success) throw new ModelError("model_invalid_output");
    const u = res.usage as unknown as Record<string, unknown>;
    const usage: Record<string, number> = {};
    for (const k of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) if (typeof u?.[k] === "number") usage[k] = u[k] as number;
    return { output: checked.data as z.infer<S>, model: res.model, usage };
  }
}

export function createModel(provider: "none" | "fake" | "anthropic", apiKey?: string, fake?: FakeModel): ModelClient {
  if (provider === "anthropic") return new AnthropicModel(new Anthropic({ apiKey }));
  if (provider === "fake") return fake ?? new FakeModel(() => { throw new ModelError("model_unavailable"); });
  return new NoModel();
}
