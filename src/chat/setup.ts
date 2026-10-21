// Setting up one chatbot rule, reported as events (the same events as a rota rule, so the screen can play either):
// interview, her example replies, the check written and proven on them, saved.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { callLog } from "../claude.js";
import * as telemetry from "../telemetry.js";
import type { SetupEvent, SetupRecord } from "../events.js";
import { feedbackFor, type Outcome } from "../generate.js";
import { CHAT_SUBJECT, interview, type RuleSpec } from "../interview.js";
import type { Rubric } from "../judge.js";
import { generateChatCheck, proveChatCheck, readExamples, type ChatGenerated, type Proven } from "./generate.js";
import { judgeReply, writeToneRubric } from "./judge.js";
import type { ChatExample, ChatRuleId } from "./examples.js";
import { CHAT_RULES, chatExamplesFor } from "./rules.js";
import { loadShop } from "./shop.js";

export async function runChatSetup(ruleId: ChatRuleId, emit: (e: SetupEvent) => void): Promise<SetupRecord> {
  const def = CHAT_RULES.find((r) => r.id === ruleId);
  if (!def) throw new Error(`Unknown chatbot rule ${ruleId}`);
  const examples = chatExamplesFor(ruleId);
  const shop = loadShop();
  const started = new Date();
  const events: SetupEvent[] = [];
  const send = (e: SetupEvent) => {
    events.push(e);
    emit(e);
  };
  callLog.length = 0;
  telemetry.startTrace(`chat rule setup ${ruleId}`, { ruleId });

  try {
    send({ t: "start", cafe: "Ollie's, Dublin 2", owner: "Gráinne Nolan", ruleId, handwritten: def.handwritten });
    const { rule } = await interview(def.topic, { line: (line) => send({ t: "line", line }), status: (text) => send({ t: "status", text }) }, CHAT_SUBJECT);
    send({ t: "rule", rule });
    send({ t: "examples", weeks: examples.map(({ id, said, verdict, customer, reply }) => ({ id, said, verdict, customer, reply })) });
    if (def.kind === "judged") {
      await setupTone(ruleId, rule, examples, send);
      return finish(ruleId, started, events, send);
    }

    send({ t: "status", text: "Claude reads what each of her example replies promises" });
    const read: Proven[] = await readExamples(examples, shop);
    let gen: ChatGenerated | undefined;
    let outcomes: Outcome[] = [];
    let feedback: string | undefined;
    const file = `checks/chat-${ruleId}.ts`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      send({ t: "status", text: attempt === 1 ? "Claude writes the check" : "Claude fixes the check" });
      gen = await generateChatCheck(rule, read, shop, feedback);
      send({ t: "status", text: "Testing the check on Gráinne's replies" });
      try {
        outcomes = await proveChatCheck(gen, read, shop);
        feedback = outcomes.every((o) => o.ok) ? undefined : feedbackFor(outcomes);
        if (!feedback) feedback = typecheck(file, rule.title, gen.code, started);
      } catch (err) {
        outcomes = [];
        feedback = err instanceof Error ? err.message : String(err);
      }
      if (!feedback) break;
      send({ t: "retry", attempt, feedback });
    }
    if (!gen || feedback) throw new Error("The check never agreed with Gráinne on her replies");

    const extra = new Map(gen.testCases.map((t) => [t.name, t]));
    for (const outcome of outcomes) send({ t: "outcome", outcome, short: extra.get(outcome.name)?.short, why: extra.get(outcome.name)?.why });
    // Code decides this rule (Claude only reads the reply for promises), whatever the interview called it.
    writeFileSync(`checks/chat-${ruleId}.rule.json`, JSON.stringify({ ...rule, kind: "typed", howItWorks: gen.howItWorks }, null, 2));
    send({ t: "saved", howItWorks: gen.howItWorks, code: gen.code, file });
    return finish(ruleId, started, events, send);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await telemetry.endTrace(undefined, message);
    send({ t: "error", message });
    throw err;
  }
}

function typecheck(file: string, title: string, code: string, started: Date): string | undefined {
  mkdirSync("checks", { recursive: true });
  writeFileSync(file, `// Written by Claude from the interview on ${started.toISOString().slice(0, 10)}. Chatbot rule: ${title}\nimport type { Allergen, AllergenEntry, Claims, ReplyFacts, Shop, Violation } from "../src/chat/domain.js";\n\n${code.trim()}\n`);
  try {
    execFileSync("node_modules/.bin/tsc", ["--noEmit"], { stdio: "pipe" });
    return undefined;
  } catch (err) {
    const out = err instanceof Error && "stdout" in err ? String(err.stdout) : String(err);
    return `The TypeScript compiler rejected the check:\n${out.trim()}`;
  }
}

function finish(ruleId: string, started: Date, events: SetupEvent[], send: (e: SetupEvent) => void): SetupRecord {
  const runFile = `runs/chat-setup-${ruleId}-${started.toISOString().replace(/[:.]/g, "-")}.json`;
  const outcomes = events.filter((e): e is Extract<SetupEvent, { t: "outcome" }> => e.t === "outcome");
  const right = outcomes.filter((e) => e.outcome.ok).length;
  const costUsd = callLog.reduce((s, c) => s + c.costUsd, 0);
  telemetry.capture("shiftguard_rule_setup", { agent: "chat", rule: ruleId, right, total: outcomes.length, cost_usd: costUsd });
  void telemetry.endTrace({ ruleId, right, total: outcomes.length, costUsd });
  send({ t: "done", costUsd, calls: [...callLog], runFile });
  const record: SetupRecord = { started: started.toISOString(), events };
  mkdirSync("runs", { recursive: true });
  writeFileSync(runFile, JSON.stringify(record, null, 2));
  return record;
}

async function setupTone(ruleId: ChatRuleId, rule: RuleSpec, examples: ChatExample[], send: (e: SetupEvent) => void): Promise<void> {
  let rubric: Rubric | undefined;
  let outcomes: Outcome[] = [];
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    send({ t: "status", text: attempt === 1 ? "Claude writes what the judge should listen for" : "Claude sharpens what the judge should listen for" });
    rubric = await writeToneRubric(rule, examples, feedback);
    send({ t: "status", text: "The judge tries it on Gráinne's replies" });
    const current = rubric;
    outcomes = await Promise.all(
      examples.map(async (ex, i): Promise<Outcome> => {
        const v = await judgeReply(ex.customer, ex.reply, rule, current, `chat.judge.example${i + 1}`);
        const expected = ex.verdict === "fine" ? "pass" : "fail";
        const got = v.verdict === "fine" ? "pass" : "fail";
        return { name: ex.id, source: "owner", expected, got, violations: got === "fail" ? [{ message: v.reason }] : [], ok: got === expected };
      }),
    );
    feedback = outcomes.every((o) => o.ok) ? undefined : feedbackFor(outcomes);
    if (!feedback) break;
    send({ t: "retry", attempt, feedback });
  }
  if (!rubric || feedback) throw new Error("The judge never agreed with Gráinne on her replies");
  for (const outcome of outcomes) send({ t: "outcome", outcome });
  const file = `checks/chat-${ruleId}.rubric.json`;
  writeFileSync(file, JSON.stringify(rubric, null, 2));
  writeFileSync(`checks/chat-${ruleId}.rule.json`, JSON.stringify({ ...rule, kind: "judged", howItWorks: `${rubric.fineWhen} ${rubric.notFineWhen}` }, null, 2));
  send({ t: "saved", howItWorks: `${rubric.fineWhen} ${rubric.notFineWhen}`, code: JSON.stringify(rubric, null, 2), file });
}
