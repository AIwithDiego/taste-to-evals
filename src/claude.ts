// One place that talks to Claude. Every call returns typed output and is logged with its cost,
// so the report and PostHog can show exactly what each step cost.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "dotenv";
import type { z } from "zod";
import { generation } from "./telemetry.js";

config({ quiet: true }); // ANTHROPIC_API_KEY and the optional PostHog settings, from .env (see .env.example)

// Haiku 5.5 for every call: fast and cheap enough to run the whole demo live. Prices are for prompts up to 100K tokens; ours are far smaller.
export const MODEL = "claude-haiku-5-5";
const PRICE_PER_MTOK = { input: 0.1, output: 0.5 }; // USD, Claude Haiku 5.5

export const client = new Anthropic();

export interface CallRecord {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export const callLog: CallRecord[] = [];

export async function ask<S extends z.ZodType>(opts: {
  step: string;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: S;
  effort: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  const started = Date.now();
  // Haiku has no server-side fallback: a declined request stops the run with a clear message (below).
  const response = await withParseRetry(() =>
    client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: opts.messages,
    }),
  );
  logCall(opts.step, response, started, { system: opts.system, messages: opts.messages });
  if (response.stop_reason === "refusal") throw new Error(`${opts.step}: Claude declined (${response.stop_details?.category ?? "no category"})`);
  if (response.stop_reason === "max_tokens") throw new Error(`${opts.step}: answer was cut off`);
  if (response.parsed_output === null || response.parsed_output === undefined) throw new Error(`${opts.step}: answer didn't match the expected shape`);
  return response.parsed_output;
}

type LoggedResponse = {
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
  content?: Anthropic.Beta.BetaContentBlock[];
};

/** Records one Claude call's tokens, cost and time, and traces it in PostHog with what went in and came out. */
export function logCall(step: string, response: LoggedResponse, started: number, request?: { system: string; messages: unknown[] }): void {
  const { input_tokens, output_tokens } = response.usage;
  const inputCostUsd = (input_tokens * PRICE_PER_MTOK.input) / 1e6;
  const outputCostUsd = (output_tokens * PRICE_PER_MTOK.output) / 1e6;
  const ms = Date.now() - started;
  callLog.push({ step, model: response.model, inputTokens: input_tokens, outputTokens: output_tokens, costUsd: inputCostUsd + outputCostUsd, ms });
  if (!request) return;
  const output = (response.content ?? []).flatMap((b): unknown[] =>
    b.type === "text" ? [b.text] : b.type === "tool_use" ? [{ tool: b.name, input: b.input }] : [],
  );
  generation({
    step, model: response.model, system: request.system, messages: [...request.messages], output: output.length === 1 ? output[0] : output,
    inputTokens: input_tokens, outputTokens: output_tokens, inputCostUsd, outputCostUsd, latencyMs: ms, stopReason: response.stop_reason ?? null,
  });
}

/** The SDK throws when the model's JSON is malformed (rare, but it happens). Ask again rather than stop the run. */
export async function withParseRetry<T>(call: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (err) {
      const malformed = err instanceof Error && /Failed to parse structured output/.test(err.message);
      if (!malformed || i >= tries) throw err;
    }
  }
}
