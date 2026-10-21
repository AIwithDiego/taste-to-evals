// pnpm chat ["message" ...]: a customer conversation with Ollie's website chatbot, every draft through Gráinne's gate.
import { DEFAULT_CONVERSATION, runConversation } from "./converse.js";

const messages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CONVERSATION;
await runConversation(messages, (e) => {
  if (e.t === "customer") console.log(`\nCustomer   ${e.text}`);
  if (e.t === "draft") console.log(`  draft ${e.attempt}  ${e.reply}`);
  if (e.t === "claims") console.log(`    promises: ${e.lines.length ? e.lines.join("; ") : "nothing"}`);
  if (e.t === "check") console.log(`    ${e.result.skipped ? "·" : e.result.violations.length ? "✗" : "✓"} ${e.result.by === "judge" ? "AI judge" : "code"}  ${e.result.title}${e.result.violations.length ? `: ${e.result.violations.map((v) => v.message).join(" ")}` : e.result.reason && !e.result.skipped ? `: ${e.result.reason}` : ""}`);
  if (e.t === "sent") console.log(`  SENT after ${e.attempts} ${e.attempts === 1 ? "try" : "tries"}: ${e.reply}`);
  if (e.t === "held") console.log(`  HELD for Gráinne after ${e.attempts} tries. Customer sees: ${e.holding}`);
  if (e.t === "done") console.log(`\n${e.sent} sent, ${e.held} held · ${e.calls.length} Claude calls · $${e.costUsd.toFixed(3)} · ${e.runFile}`);
  if (e.t === "error") console.log(`ERROR ${e.message}`);
});
