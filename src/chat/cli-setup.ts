// pnpm chat-setup [allergens|discounts|bookings|tone|all]: interview Gráinne about a chatbot rule, write and prove its check.
import { CHAT_RULES } from "./rules.js";
import { runChatSetup } from "./setup.js";
import type { ChatRuleId } from "./examples.js";

const arg = process.argv[2] ?? "all";
const ids = arg === "all" ? CHAT_RULES.map((r) => r.id) : [arg as ChatRuleId];
for (const id of ids) {
  if (!CHAT_RULES.some((r) => r.id === id)) throw new Error(`Unknown chatbot rule "${id}"`);
  await runChatSetup(id, (e) => {
    if (e.t === "line") console.log(`  ${e.line.who === "owner" ? "Gráinne   " : "ShiftGuard"}  ${e.line.text}`);
    if (e.t === "status") console.log(`  … ${e.text}`);
    if (e.t === "rule") console.log(`\n  Captured: ${e.rule.title} (${e.rule.kind})\n  Exactly:  ${e.rule.precise}`);
    if (e.t === "retry") console.log(`  ↻ attempt ${e.attempt} failed:\n${e.feedback}`);
    if (e.t === "outcome") console.log(`  ${e.outcome.ok ? "✓" : "✗"} ${e.outcome.source === "owner" ? "her reply " : "extra test"} ${e.outcome.name.padEnd(28)} ${e.outcome.got === "pass" ? "passes" : `caught: ${e.outcome.violations.map((v) => v.message).join(" ")}`}`);
    if (e.t === "saved") console.log(`  Saved to ${e.file}`);
    if (e.t === "done") console.log(`${e.calls.length} Claude calls · $${e.costUsd.toFixed(3)} · ${e.runFile}\n`);
    if (e.t === "error") console.log(`  ERROR ${e.message}`);
  });
}
