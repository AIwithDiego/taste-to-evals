// The gate: every one of the owner's checks runs on a proposed week. Code checks first; the AI judge last.
import { readFileSync } from "node:fs";
import type { Rota, Violation } from "./domain.js";
import type { RuleSpec } from "./interview.js";
import { TYPED_RULES, type TypedRuleId } from "./rules.js";
import { judge, type Rubric } from "./judge.js";
import { compile } from "./sandbox.js";

export interface RuleResult {
  ruleId: string;
  title: string;
  ownerWords: string;
  by: "code" | "judge";
  violations: Violation[];
  error?: string;
  /** Judge only: its reason, given whether the week is fine or not. */
  reason?: string;
  confidence?: "low" | "medium" | "high";
  /** Judge only: not asked, because a code check already failed. */
  skipped?: boolean;
}

export interface GateResult {
  passed: boolean;
  results: RuleResult[];
}

interface LoadedCheck {
  id: TypedRuleId;
  rule: RuleSpec;
  run: (rota: Rota) => Violation[];
}

let loaded: LoadedCheck[] | undefined;

/** Loads each saved check (the file Claude wrote at setup) into the sandbox. */
export async function loadChecks(): Promise<LoadedCheck[]> {
  if (loaded) return loaded;
  loaded = await Promise.all(
    TYPED_RULES.map(async ({ id }) => {
      const source = readFileSync(`checks/${id}.ts`, "utf8");
      // Drop the header we add on save (comment + type import); the sandbox refuses imports.
      const code = source.replace(/^\/\/.*\nimport type .*\n/, "");
      const rule: RuleSpec = JSON.parse(readFileSync(`checks/${id}.rule.json`, "utf8"));
      return { id, rule, run: await compile(code) };
    }),
  );
  return loaded;
}

export function reloadChecks(): void {
  loaded = undefined;
}

/** Runs every code check on the week. Never throws: a broken check counts as a failure, so nothing slips through. */
export async function runChecks(rota: Rota, onResult: (r: RuleResult) => void = () => {}): Promise<RuleResult[]> {
  const checks = await loadChecks();
  return checks.map((c) => {
    let result: RuleResult;
    try {
      result = { ruleId: c.id, title: c.rule.title, ownerWords: c.rule.ownerWords, by: "code", violations: c.run(rota) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { ruleId: c.id, title: c.rule.title, ownerWords: c.rule.ownerWords, by: "code", violations: [{ message: `This check couldn't run, so the week can't pass: ${message}` }], error: message };
    }
    onResult(result);
    return result;
  });
}

function loadJudgedRule(): { rule: RuleSpec; rubric: Rubric } | undefined {
  try {
    return {
      rule: JSON.parse(readFileSync("checks/fair.rule.json", "utf8")),
      rubric: JSON.parse(readFileSync("checks/fair.rubric.json", "utf8")),
    };
  } catch {
    return undefined;
  }
}

/** The whole gate: code checks first; the AI judge only weighs what code can't decide, and only if code passed. */
export async function runGate(rota: Rota, onResult: (r: RuleResult) => void = () => {}, step = "judge"): Promise<GateResult> {
  const results = await runChecks(rota, onResult);
  const judged = loadJudgedRule();
  if (!judged) return { passed: results.every((r) => !r.violations.length), results };
  const base = { ruleId: "fair", title: judged.rule.title, ownerWords: judged.rule.ownerWords, by: "judge" as const };
  if (results.some((r) => r.violations.length)) {
    const skipped: RuleResult = { ...base, violations: [], skipped: true, reason: "Waits until the code checks pass." };
    onResult(skipped);
    return { passed: false, results: [...results, skipped] };
  }
  const v = await judge(rota, judged.rule, judged.rubric, step);
  const verdict: RuleResult = { ...base, violations: v.verdict === "fine" ? [] : [{ message: v.reason }], reason: v.reason, confidence: v.confidence };
  onResult(verdict);
  return { passed: verdict.violations.length === 0, results: [...results, verdict] };
}
