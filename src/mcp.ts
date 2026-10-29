// ShiftGuard as an MCP server: any agent (Claude Desktop, ChatGPT, a script) can read Gráinne's rules and must
// pass her gate before acting. Every tool only reads or checks. There is no tool that saves a rota or sends a
// reply: saving stays behind the owner's Approve in ShiftGuard. Run over stdio: `pnpm mcp`.
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Claude Desktop starts us from anywhere; the checks, data and store live relative to the project.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { runGate } = await import("./gate.js");
const { applyChange } = await import("./examples.js");
const { baseWeek } = await import("./ollies.js");
const { withAbsences } = await import("./request.js");
const { describe } = await import("./propose.js");
const { RULES } = await import("./rules.js");
const { CHAT_RULES } = await import("./chat/rules.js");
const { runChatGate } = await import("./chat/gate.js");
const { describeClaims } = await import("./chat/claims.js");
const { loadShop } = await import("./chat/shop.js");
const telemetry = await import("./telemetry.js");
const { readFileSync, existsSync } = await import("node:fs");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: "shiftguard", version: "1.0.0" }, {
  instructions: "ShiftGuard holds the rules of Gráinne Nolan, owner of Ollie's café in Dublin 2, and checks work against them. Before suggesting a rota change or sending a customer reply, call the matching check tool and only present work that passes. You cannot save a rota or send a reply: Gráinne approves rotas herself in ShiftGuard.",
});

server.registerTool("read_rules", {
  title: "Read Gráinne's rules",
  description: "Gráinne's rules for her rota and her website chat, in her words, and whether code or the AI judge checks each one.",
  annotations: READ_ONLY,
}, async () => {
  const spec = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
  return text({
    rota: RULES.map((r) => {
      const s = spec(`checks/${r.id}.rule.json`);
      return { rule: s?.title ?? r.handwritten, inHerWords: s?.ownerWords, checkedBy: r.kind === "judged" ? "AI judge" : "code" };
    }),
    websiteChat: CHAT_RULES.map((r) => {
      const s = spec(`checks/chat-${r.id}.rule.json`);
      return { rule: s?.title ?? r.handwritten, inHerWords: s?.ownerWords, checkedBy: r.kind === "judged" ? "AI judge" : "code" };
    }),
  });
});

server.registerTool("read_week", {
  title: "Read this week's rota",
  description: "The current rota for the week of 26 October: every shift with its id, person, day and times. Shift kinds: open 06:30-14:30, close 12:30-20:30, mid 07:30-15:30 (Saturday rush).",
  annotations: READ_ONLY,
}, async () => {
  const week = baseWeek();
  return text({
    weekStart: week.weekStart,
    days: DAYS.map((d, i) => `${i} = ${d}`),
    shifts: week.shifts.map((s) => ({ id: s.id, staffId: s.staffId, date: s.date, kind: s.kind, start: s.start, end: s.end })),
  });
});

server.registerTool("read_staff", {
  title: "Read the staff list",
  description: "Ollie's staff: role, whether trained on the coffee machine, contract hours, and days each person has said they can't work.",
  annotations: READ_ONLY,
}, async () => text(baseWeek().staff));

server.registerTool("check_rota_change", {
  title: "Check a rota change against Gráinne's rules",
  description: "Checks a suggested change to this week's rota against all of Gráinne's rules (code checks first, then the AI judge for fair weekends). Returns whether it passes and, if not, exactly what broke. Nothing is saved: only Gráinne can approve a rota, in ShiftGuard.",
  inputSchema: {
    absences: z.array(z.object({
      staffId: z.string(),
      dates: z.array(z.string()).describe("ISO dates in the week of 2026-10-26"),
      reason: z.string(),
    })).default([]).describe("People who can't work days this week that aren't already on the staff list (e.g. someone off sick)"),
    remove: z.array(z.string()).default([]).describe("Ids of shifts to take off the week"),
    add: z.array(z.object({
      staffId: z.string(),
      day: z.number().int().min(0).max(6).describe("0 = Monday ... 6 = Sunday"),
      kind: z.enum(["open", "mid", "close"]),
      start: z.string().optional().describe("HH:MM, only if not the usual start"),
      end: z.string().optional().describe("HH:MM, only if not the usual end"),
    })).default([]).describe("Shifts to add"),
  },
  annotations: { ...READ_ONLY, openWorldHint: true },
}, async ({ absences, remove, add }) => {
  const week = withAbsences(baseWeek(), absences.map((a) => ({ ...a, name: a.staffId })));
  let rota;
  try {
    rota = applyChange({ remove, add }, week);
  } catch (err) {
    return text({ passed: false, problem: `The change couldn't be applied: ${err instanceof Error ? err.message : String(err)}` });
  }
  telemetry.startTrace("mcp rota check", { absences, remove, add });
  const gate = await runGate(rota, (r) => telemetry.check({ agent: "rota", attempt: 1, ruleId: r.ruleId, title: r.title, by: r.by, skipped: r.skipped === true, messages: r.violations.map((v) => v.message), ...(r.reason ? { reason: r.reason } : {}) }), "mcp.judge");
  const broken = gate.results.filter((r) => r.violations.length);
  telemetry.capture("shiftguard_gate_run", { agent: "rota", via: "mcp", passed: gate.passed, broken_rules: broken.map((r) => r.ruleId) });
  await telemetry.endTrace({ passed: gate.passed });
  return text({
    passed: gate.passed,
    changes: describe(week, rota),
    broken: broken.map((r) => ({ rule: r.title, checkedBy: r.by === "judge" ? "AI judge" : "code", problems: r.violations.map((v) => v.message) })),
    ...(gate.passed ? { next: "This change keeps every rule. Only Gráinne can approve it, in ShiftGuard." } : { next: "Fix what broke and check again. Don't present this change as it is." }),
  });
});

server.registerTool("check_chat_reply", {
  title: "Check a website chat reply against Gráinne's rules",
  description: "Before a reply goes to a customer: reads what the reply promises (allergens, discounts, bookings) and checks those promises against Gráinne's rules, then her tone with the AI judge. Returns whether it may be sent and what broke. Nothing is sent.",
  inputSchema: {
    customer: z.string().describe("The customer's message"),
    reply: z.string().describe("The reply you want to send"),
  },
  annotations: { ...READ_ONLY, openWorldHint: true },
}, async ({ customer, reply }) => {
  const shop = loadShop();
  telemetry.startTrace("mcp chat check", { customer, reply });
  const gate = await runChatGate(customer, reply, shop, {
    result: (r) => telemetry.check({ agent: "chat", attempt: 1, ruleId: r.ruleId, title: r.title, by: r.by, skipped: r.skipped === true, messages: r.violations.map((v) => v.message), ...(r.reason ? { reason: r.reason } : {}) }),
  }, "mcp.chat");
  const broken = gate.results.filter((r) => r.violations.length);
  telemetry.capture("shiftguard_gate_run", { agent: "chat", via: "mcp", passed: gate.passed, broken_rules: broken.map((r) => r.ruleId) });
  await telemetry.endTrace({ passed: gate.passed });
  return text({
    mayBeSent: gate.passed,
    promises: describeClaims(gate.claims, shop),
    broken: broken.map((r) => ({ rule: r.title, checkedBy: r.by === "judge" ? "AI judge" : "code", problems: r.violations.map((v) => v.message) })),
  });
});

await server.connect(new StdioServerTransport());
