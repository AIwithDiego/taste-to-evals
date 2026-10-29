// The chatbot's gate: Claude reads the draft for promises, Gráinne's code checks decide on them,
// and the AI judge listens to the tone only once every code check has passed.
import { readFileSync } from "node:fs";
import type { RuleResult } from "../gate.js";
import type { RuleSpec } from "../interview.js";
import type { Rubric } from "../judge.js";
import { compile } from "../sandbox.js";
import { readClaims } from "./claims.js";
import type { Claims, ReplyFacts, Shop, Violation } from "./domain.js";
import { judgeReply } from "./judge.js";
import { TYPED_CHAT_RULES } from "./rules.js";

interface LoadedCheck {
  id: string;
  rule: RuleSpec;
  run: (input: ReplyFacts) => Violation[];
}

let loaded: LoadedCheck[] | undefined;

export async function loadChatChecks(): Promise<LoadedCheck[]> {
  if (loaded) return loaded;
  loaded = await Promise.all(
    TYPED_CHAT_RULES.map(async ({ id }) => {
      const source = readFileSync(`checks/chat-${id}.ts`, "utf8");
      const code = source.replace(/^\/\/.*\nimport type .*\n/, "");
      const rule: RuleSpec = JSON.parse(readFileSync(`checks/chat-${id}.rule.json`, "utf8"));
      return { id, rule, run: await compile<ReplyFacts>(code) };
    }),
  );
  return loaded;
}

/** After a live setup rewrites a check, load the new one next time. */
export function reloadChatChecks(): void {
  loaded = undefined;
}

export interface ChatGateResult {
  passed: boolean;
  claims: Claims;
  results: RuleResult[];
}

export async function runChatGate(
  customer: string,
  reply: string,
  shop: Shop,
  hooks: { claims?: (c: Claims) => void; result?: (r: RuleResult) => void } = {},
  step = "chat",
): Promise<ChatGateResult> {
  const claims = await readClaims(customer, reply, shop, `${step}.claims`);
  hooks.claims?.(claims);
  const results: RuleResult[] = [];
  for (const c of await loadChatChecks()) {
    let r: RuleResult;
    try {
      r = { ruleId: c.id, title: c.rule.title, ownerWords: c.rule.ownerWords, by: "code", violations: c.run({ claims, shop }) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      r = { ruleId: c.id, title: c.rule.title, ownerWords: c.rule.ownerWords, by: "code", violations: [{ message: `This check couldn't run, so the reply can't go out: ${message}` }], error: message };
    }
    results.push(r);
    hooks.result?.(r);
  }
  const tone = loadTone();
  if (!tone) return { passed: results.every((r) => !r.violations.length), claims, results };
  const base = { ruleId: "tone", title: tone.rule.title, ownerWords: tone.rule.ownerWords, by: "judge" as const };
  if (results.some((r) => r.violations.length)) {
    const skipped: RuleResult = { ...base, violations: [], skipped: true, reason: "Waits until the code checks pass." };
    results.push(skipped);
    hooks.result?.(skipped);
    return { passed: false, claims, results };
  }
  const v = await judgeReply(customer, reply, tone.rule, tone.rubric, `${step}.judge`);
  const verdict: RuleResult = { ...base, violations: v.verdict === "fine" ? [] : [{ message: v.reason }], reason: v.reason, confidence: v.confidence };
  results.push(verdict);
  hooks.result?.(verdict);
  return { passed: verdict.violations.length === 0, claims, results };
}

function loadTone(): { rule: RuleSpec; rubric: Rubric } | undefined {
  try {
    return { rule: JSON.parse(readFileSync("checks/chat-tone.rule.json", "utf8")), rubric: JSON.parse(readFileSync("checks/chat-tone.rubric.json", "utf8")) };
  } catch {
    return undefined;
  }
}
