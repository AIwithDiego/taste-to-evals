// Rule setup in the terminal: interview, write the check, prove it on her weeks, printed in plain English.
import type { SetupEvent } from "./events.js";
import { RULES, type RuleId } from "./rules.js";
import { runSetup } from "./setup.js";

function print(e: SetupEvent): void {
  switch (e.t) {
    case "start": return console.log(`\n${e.cafe} · setting up "${e.handwritten}" with ${e.owner}\n`);
    case "status": return console.log(`  … ${e.text}`);
    case "line": return console.log(`  ${e.line.who === "interviewer" ? "ShiftGuard" : "Gráinne   "}  ${e.line.text}`);
    case "rule": return console.log(`\n  Captured: ${e.rule.title}\n  Exactly:  ${e.rule.precise}\n  Checked by ${e.rule.kind === "typed" ? "code" : "AI judgement"}: ${e.rule.whyKind}\n`);
    case "examples": return e.weeks.forEach((w) => console.log(`  ${w.verdict.padEnd(8)}  "${w.said}"`));
    case "retry": return console.log(`  Attempt ${e.attempt} didn't hold up:\n${e.feedback.replace(/^/gm, "    ")}`);
    case "outcome": {
      const o = e.outcome;
      const what = o.got === "pass" ? "passes" : `caught: ${o.violations.map((v) => v.message).join(" ")}`;
      return console.log(`  ${o.ok ? "✓" : "✗"} ${o.source === "owner" ? "owner's week" : "extra test  "} ${o.name.padEnd(34)} ${what}`);
    }
    case "saved": return console.log(`\n  How it works: ${e.howItWorks}\n  Saved to ${e.file} (type-checks clean)`);
    case "done": return console.log(`\n${e.calls.length} Claude calls · $${e.costUsd.toFixed(3)} · record in ${e.runFile}\n`);
    case "error": return console.error(`\nStopped: ${e.message}`);
  }
}

// pnpm rota-setup [rule|all]   e.g. pnpm rota-setup rest
const arg = process.argv[2] ?? "hours";
const ids: RuleId[] = arg === "all" ? RULES.map((r) => r.id) : RULES.filter((r) => r.id === arg).map((r) => r.id);
if (!ids.length) {
  console.error(`Unknown rule "${arg}". Try one of: ${RULES.map((r) => r.id).join(", ")}, all`);
  process.exit(1);
}
for (const id of ids) {
  try {
    await runSetup(id, print);
  } catch {
    process.exitCode = 1;
  }
}
