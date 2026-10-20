// The whole setup run for one rule, reported as events: interview, the owner's weeks, the check written and proven.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { callLog } from "./claude.js";
import * as telemetry from "./telemetry.js";
import type { SetupEvent, SetupRecord } from "./events.js";
import { feedbackFor, generate, prove, type Generated, type Outcome } from "./generate.js";
import { interview } from "./interview.js";
import { judge, writeRubric, type Rubric } from "./judge.js";
import { applyChange, type Example } from "./examples.js";
import type { RuleSpec } from "./interview.js";
import { RULES, examplesFor, type RuleId } from "./rules.js";

export async function runSetup(ruleId: RuleId, emit: (e: SetupEvent) => void): Promise<SetupRecord> {
  const def = RULES.find((r) => r.id === ruleId);
  if (!def) throw new Error(`Unknown rule ${ruleId}`);
  const examples = examplesFor(ruleId);
  const started = new Date();
  const events: SetupEvent[] = [];
  const send = (e: SetupEvent) => {
    events.push(e);
    emit(e);
  };
  callLog.length = 0;
  telemetry.startTrace(`rota rule setup ${ruleId}`, { ruleId });

  try {
    send({ t: "start", cafe: "Ollie's, Dublin 2", owner: "Gráinne Nolan", ruleId, handwritten: def.handwritten });
    const { rule } = await interview(def.topic, { line: (line) => send({ t: "line", line }), status: (text) => send({ t: "status", text }) });
    send({ t: "rule", rule });
    send({ t: "examples", weeks: examples.map(({ id, said, verdict }) => ({ id, said, verdict })) });
    if (def.kind === "judged") {
      await setupJudged(ruleId, rule, examples, send);
      return finish(ruleId, started, events, send);
    }

    let gen: Generated | undefined;
    let outcomes: Outcome[] = [];
    let feedback: string | undefined;
    const file = `checks/${ruleId}.ts`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      send({ t: "status", text: attempt === 1 ? "Claude writes the check" : "Claude fixes the check" });
      gen = await generate(rule, examples, feedback);
      send({ t: "status", text: "Testing the check on Gráinne's weeks" });
      try {
        outcomes = await prove(gen, examples);
        feedback = outcomes.every((o) => o.ok) ? undefined : feedbackFor(outcomes);
        if (!feedback) feedback = typecheck(file, rule.title, gen.code, started);
      } catch (err) {
        outcomes = [];
        feedback = err instanceof Error ? err.message : String(err);
      }
      if (!feedback) break;
      send({ t: "retry", attempt, feedback });
    }
    if (!gen || feedback) throw new Error("The check never passed the owner's weeks");

    const extra = new Map(gen.testCases.map((t) => [t.name, t]));
    for (const outcome of outcomes) send({ t: "outcome", outcome, short: extra.get(outcome.name)?.short, why: extra.get(outcome.name)?.why });

    writeFileSync(file.replace(/\.ts$/, ".rule.json"), JSON.stringify({ ...rule, howItWorks: gen.howItWorks }, null, 2));
    send({ t: "saved", howItWorks: gen.howItWorks, code: gen.code, file });

    return finish(ruleId, started, events, send);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await telemetry.endTrace(undefined, message);
    send({ t: "error", message });
    throw err;
  }
}

/** Saves the check as a TypeScript file and type-checks it. Returns the compiler's complaint, or undefined if clean. */
function typecheck(file: string, title: string, code: string, started: Date): string | undefined {
  mkdirSync("checks", { recursive: true });
  writeFileSync(file, `// Written by Claude from the interview on ${started.toISOString().slice(0, 10)}. Rule: ${title}\nimport type { Role, Rota, Shift, ShiftKind, Staff, Violation } from "../src/domain.js";\n\n${code.trim()}\n`);
  try {
    execFileSync("node_modules/.bin/tsc", ["--noEmit"], { stdio: "pipe" });
    return undefined;
  } catch (err) {
    const out = err instanceof Error && "stdout" in err ? String(err.stdout) : String(err);
    return `The TypeScript compiler rejected the check:\n${out.trim()}`;
  }
}

function finish(ruleId: RuleId, started: Date, events: SetupEvent[], send: (e: SetupEvent) => void): SetupRecord {
  const runFile = `runs/setup-${ruleId}-${started.toISOString().replace(/[:.]/g, "-")}.json`;
  const outcomes = events.filter((e): e is Extract<SetupEvent, { t: "outcome" }> => e.t === "outcome");
  const right = outcomes.filter((e) => e.outcome.ok).length;
  const costUsd = callLog.reduce((s, c) => s + c.costUsd, 0);
  telemetry.capture("shiftguard_rule_setup", { agent: "rota", rule: ruleId, right, total: outcomes.length, cost_usd: costUsd });
  void telemetry.endTrace({ ruleId, right, total: outcomes.length, costUsd });
  send({ t: "done", costUsd, calls: [...callLog], runFile });
  const record: SetupRecord = { started: started.toISOString(), events };
  mkdirSync("runs", { recursive: true });
  writeFileSync(runFile, JSON.stringify(record, null, 2));
  return record;
}

/** A rule code can't decide: write a rubric, and prove the judge agrees with the owner on her weeks. */
async function setupJudged(ruleId: RuleId, rule: RuleSpec, examples: Example[], send: (e: SetupEvent) => void): Promise<void> {
  let rubric: Rubric | undefined;
  let outcomes: Outcome[] = [];
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    send({ t: "status", text: attempt === 1 ? "Claude writes what the judge should weigh" : "Claude sharpens what the judge should weigh" });
    rubric = await writeRubric(rule, examples, feedback);
    send({ t: "status", text: "The judge tries it on Gráinne's weeks" });
    const current = rubric;
    outcomes = await Promise.all(
      examples.map(async (ex, i): Promise<Outcome> => {
        const v = await judge(applyChange(ex.change), rule, current, `judge.example${i + 1}`);
        const expected = ex.verdict === "fine" ? "pass" : "fail";
        const got = v.verdict === "fine" ? "pass" : "fail";
        return { name: ex.id, source: "owner", expected, got, violations: got === "fail" ? [{ message: v.reason }] : [], ok: got === expected };
      }),
    );
    feedback = outcomes.every((o) => o.ok) ? undefined : feedbackFor(outcomes);
    if (!feedback) break;
    send({ t: "retry", attempt, feedback });
  }
  if (!rubric || feedback) throw new Error("The judge never agreed with the owner on her weeks");
  for (const outcome of outcomes) send({ t: "outcome", outcome });
  const file = `checks/${ruleId}.rubric.json`;
  writeFileSync(file, JSON.stringify(rubric, null, 2));
  writeFileSync(`checks/${ruleId}.rule.json`, JSON.stringify({ ...rule, kind: "judged", howItWorks: `${rubric.fineWhen} ${rubric.notFineWhen}` }, null, 2));
  send({ t: "saved", howItWorks: `${rubric.fineWhen} ${rubric.notFineWhen}`, code: JSON.stringify(rubric, null, 2), file });
}
