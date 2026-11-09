import assert from "node:assert/strict";
import { test } from "node:test";
import * as telemetry from "./telemetry.js";

// Sends one run's worth of events and returns everything that would have left the machine.
async function sentPayload(contentOn: boolean): Promise<string> {
  const env = { ...process.env };
  process.env["SHIFTGUARD_TELEMETRY"] = "on";
  process.env["POSTHOG_PROJECT_API_KEY"] = "phc_test";
  if (contentOn) process.env["SHIFTGUARD_TELEMETRY_CONTENT"] = "on";
  else delete process.env["SHIFTGUARD_TELEMETRY_CONTENT"];
  const bodies: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    telemetry.startTrace("rota proposal", { request: "Sarah Byrne is off sick, she has the dentist" });
    telemetry.generation({
      step: "propose", model: "claude-haiku-5-5", system: "You draft rotas for Ollie's.",
      messages: [{ role: "user", content: "Sarah Byrne is off sick" }], output: "Tom covers Sarah",
      inputTokens: 10, outputTokens: 5, inputCostUsd: 0.0001, outputCostUsd: 0.0001, latencyMs: 300, stopReason: "end_turn",
    });
    telemetry.check({ agent: "rota", attempt: 1, ruleId: "hours", title: "Max 40 hours a week", by: "code", skipped: false, messages: ["Tom Kavanagh would work 48 hours"] });
    telemetry.capture("shiftguard_approved", { agent: "rota", proposal_id: "p1", approved_by: "Gráinne", note: "a field added later" });
    await telemetry.endTrace({ passed: true, note: "Tom covers Sarah" }, "Couldn't place Sarah Byrne on Tuesday");
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
  return bodies.join("\n");
}

test("by default no prompt, reply, rule message or name leaves the machine", async () => {
  const sent = await sentPayload(false);
  for (const personal of ["Sarah", "Tom", "dentist", "Gráinne", "48 hours", "Ollie's", "Max 40 hours", "a field added later"]) {
    assert.ok(!sent.includes(personal), `"${personal}" was sent`);
  }
  // The structure is still there: tokens, cost, the rule and its verdict.
  assert.ok(sent.includes('"$ai_input_tokens":10'));
  assert.ok(sent.includes('"rule":"hours"'));
  assert.ok(sent.includes('"broken_count":1'));
});

test("content goes out only when SHIFTGUARD_TELEMETRY_CONTENT=on", async () => {
  const sent = await sentPayload(true);
  assert.ok(sent.includes("Sarah Byrne is off sick"));
  assert.ok(sent.includes("Gráinne"));
});
