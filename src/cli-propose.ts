// pnpm propose ["request"]  ·  pnpm approve <proposal id>
import type { ProposeEvent } from "./events.js";
import { runProposal } from "./propose.js";
import { approve } from "./store.js";

function print(e: ProposeEvent): void {
  switch (e.t) {
    case "start": return console.log(`\n${e.from}: "${e.request}"\n`);
    case "status": return console.log(`  … ${e.text}`);
    case "noted": return console.log(`  Noted: ${e.text}`);
    case "read": return console.log(`  · ${e.text}`);
    case "proposal": return console.log(`\n  Round ${e.round} · the assistant suggests: ${e.note}\n${e.lines.map((l) => `    - ${l}`).join("\n")}`);
    case "check": {
      const r = e.result;
      const by = r.by === "judge" ? " (AI judge)" : "";
      if (r.skipped) return console.log(`    · ${r.title}${by}: ${r.reason}`);
      if (r.by === "judge" && !r.violations.length) return console.log(`    ✓ ${r.title}${by}: ${r.reason}`);
      return console.log(`    ${r.violations.length ? "✗" : "✓"} ${r.title}${by}${r.violations.map((v) => `\n        ${v.message}`).join("")}`);
    }
    case "verdict": return console.log(e.passed ? `  Passed every check. Waiting for Gráinne to approve (proposal ${e.proposalId}).` : `  Sent back: ${e.broken.join("; ")}`);
    case "done": return console.log(`\n${e.passed ? `Ready to approve: pnpm approve ${e.proposalId}` : "Didn't pass in time. Nothing changes."} · ${e.rounds} round(s) · ${e.calls.length} Claude calls · $${e.costUsd.toFixed(3)} · ${e.runFile}\n`);
    case "error": return console.error(`\nStopped: ${e.message}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "approve") {
  const id = rest[0];
  if (!id) {
    console.error("Usage: pnpm approve <proposal id>");
    process.exit(1);
  }
  const result = await approve(id, "Gráinne");
  console.log(result.message);
  process.exitCode = result.ok ? 0 : 1;
} else {
  const request = rest.join(" ") || "Sarah's off sick Monday to Thursday. Can you cover her shifts?";
  await runProposal(request, print).catch(() => (process.exitCode = 1));
}
