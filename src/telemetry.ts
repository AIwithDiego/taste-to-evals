// Every run traced in PostHog (EU), in its AI observability format: each Claude call is an $ai_generation,
// each of the owner's checks an $ai_span in the same trace, and each run's outcome a plain event.
// Fire-and-forget: without the key or the internet nothing is sent and the demo carries on.
// Privacy by default (GDPR data minimisation): traces carry structure only, i.e. steps, rules, verdicts,
// tokens, cost and latency. Prompts, replies, rule messages and names stay on the machine unless
// SHIFTGUARD_TELEMETRY_CONTENT=on. The full record of each decision lives in the local evidence PDF.
import { randomUUID } from "node:crypto";

const HOST = process.env["POSTHOG_HOST"] ?? "https://eu.i.posthog.com";
const DISTINCT_ID = "ollies-demo";
const MAX_TEXT = 20_000;

interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

interface Trace {
  id: string;
  name: string;
  started: number;
  input: unknown;
}

const queue: QueuedEvent[] = [];
let current: Trace | undefined;
let lastTraceId: string | undefined;

function key(): string | undefined {
  // Read late: claude.ts loads ~/.claude/.env on import.
  return process.env["POSTHOG_PROJECT_API_KEY"] || undefined;
}

export function enabled(): boolean {
  return key() !== undefined && process.env["SHIFTGUARD_TELEMETRY"] !== "off";
}

/** Whether prompts, replies and free text may leave the machine. Off unless asked for. */
export function sendsContent(): boolean {
  return process.env["SHIFTGUARD_TELEMETRY_CONTENT"] === "on";
}

/** Free text goes out only when content is on; otherwise a marker, so the trace still shows the step. */
function content(value: unknown): unknown {
  return sendsContent() ? clip(value) : "[not sent: SHIFTGUARD_TELEMETRY_CONTENT is off]";
}

// Fields plain events may carry when content is off: ids, counts, verdicts and cost. Anything else
// (a name, a title the owner wrote, free text) is dropped, so a new field can't leak by default.
const STRUCTURE_FIELDS = new Set(["agent", "via", "passed", "attempt", "turn", "tries", "rule", "right", "total", "broken_rules", "proposal_id", "cost_usd", "claude_calls", "sent", "held"]);

function clip(value: unknown): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= MAX_TEXT) return value;
  return `${text.slice(0, MAX_TEXT)}… (${text.length - MAX_TEXT} more characters)`;
}

function push(event: string, properties: Record<string, unknown>): void {
  if (!enabled()) return;
  queue.push({ event, properties: { distinct_id: DISTINCT_ID, $process_person_profile: false, app: "shiftguard", ...properties }, timestamp: new Date().toISOString() });
  if (queue.length >= 25) void flush();
}

/** Starts a trace for one run (a rule setup, a rota proposal, a chat conversation). */
export function startTrace(name: string, input: unknown): string {
  const id = `${name.replace(/[^a-zA-Z0-9]+/g, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}`;
  current = { id, name, started: Date.now(), input };
  lastTraceId = id;
  return id;
}

/** Closes the trace with its outcome and sends everything queued. */
export async function endTrace(output: unknown, error?: string): Promise<void> {
  const t = current;
  current = undefined;
  if (t) {
    push("$ai_trace", {
      $ai_trace_id: t.id,
      $ai_session_id: null,
      $ai_span_name: t.name,
      $ai_input_state: content(t.input),
      $ai_output_state: content(output),
      $ai_latency: (Date.now() - t.started) / 1000,
      $ai_is_error: error !== undefined,
      ...(error ? { $ai_error: sendsContent() ? error : "error (text not sent: SHIFTGUARD_TELEMETRY_CONTENT is off)" } : {}),
    });
  }
  await flush();
}

export function traceId(): string | undefined {
  return current?.id ?? lastTraceId;
}

export interface GenerationRecord {
  step: string;
  model: string;
  system: string;
  messages: unknown[];
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  latencyMs: number;
  stopReason: string | null;
}

/** One Claude call. */
export function generation(g: GenerationRecord): void {
  if (!current) return;
  push("$ai_generation", {
    $ai_trace_id: current.id,
    $ai_session_id: null,
    $ai_span_id: randomUUID(),
    $ai_span_name: g.step,
    $ai_parent_id: current.id,
    $ai_model: g.model,
    $ai_provider: "anthropic",
    $ai_input: sendsContent() ? [{ role: "system", content: clip(g.system) }, ...g.messages.map((m) => clip(m))] : content(null),
    $ai_output_choices: sendsContent() ? [{ role: "assistant", content: clip(g.output) }] : content(null),
    $ai_input_tokens: g.inputTokens,
    $ai_output_tokens: g.outputTokens,
    $ai_input_cost_usd: g.inputCostUsd,
    $ai_output_cost_usd: g.outputCostUsd,
    $ai_total_cost_usd: g.inputCostUsd + g.outputCostUsd,
    $ai_latency: g.latencyMs / 1000,
    $ai_stop_reason: g.stopReason,
    $ai_base_url: "https://api.anthropic.com",
  });
}

/** One of the owner's checks on one try, as a span in the trace plus a flat event for insights
 *  (failure rate by rule, code vs judge). */
export function check(c: { agent: "rota" | "chat"; attempt: number; ruleId: string; title: string; by: "code" | "judge"; skipped: boolean; messages: string[]; reason?: string }): void {
  const passed = !c.skipped && c.messages.length === 0;
  if (current && !c.skipped) {
    push("$ai_span", {
      $ai_trace_id: current.id,
      $ai_session_id: null,
      $ai_span_id: randomUUID(),
      $ai_span_name: `${c.by === "judge" ? "AI judge" : "code check"}: ${sendsContent() ? c.title : c.ruleId}`,
      $ai_parent_id: current.id,
      $ai_input_state: { rule: c.ruleId, try: c.attempt },
      $ai_output_state: sendsContent()
        ? { passed, broken: c.messages, ...(c.reason ? { reason: c.reason } : {}) }
        : { passed, broken_count: c.messages.length },
      $ai_is_error: false,
    });
  }
  push("shiftguard_check", {
    $ai_trace_id: current?.id,
    agent: c.agent,
    rule: c.ruleId,
    ...(sendsContent() ? { rule_title: c.title } : {}),
    checked_by: c.by,
    attempt: c.attempt,
    skipped: c.skipped,
    passed,
    broken_count: c.messages.length,
    ...(sendsContent() ? { first_problem: c.messages[0] } : {}),
  });
}

/** Anything else worth counting: a gate verdict, an approval, a reply sent or held, a rule set up. */
export function capture(event: string, properties: Record<string, unknown>): void {
  const safe = sendsContent() ? properties : Object.fromEntries(Object.entries(properties).filter(([k]) => STRUCTURE_FIELDS.has(k)));
  push(event, { $ai_trace_id: current?.id, ...safe });
}

/** Sends what's queued. Never throws and never waits more than 4 seconds. */
export async function flush(): Promise<void> {
  const apiKey = key();
  if (!apiKey || queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    const res = await fetch(`${HOST}/batch/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, batch }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.warn(`PostHog didn't take ${batch.length} events (${res.status})`);
  } catch {
    // Offline or slow: the demo matters more than the trace.
  }
}
