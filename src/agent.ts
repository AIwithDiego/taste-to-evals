// The rota assistant: stands in for any scheduling AI the café might use. It can read the week and the staff
// list and suggest changes. It is NOT given the owner's rules (those live in ShiftGuard, not in the vendor's AI);
// it learns them only when the gate sends a suggestion back. It has no tool that writes anything:
// saving a rota only happens through the owner's Approve (store.ts).
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODEL, client, logCall, withParseRetry } from "./claude.js";
import { shiftHours, type Rota } from "./domain.js";
import { ChangeSchema } from "./generate.js";

export const Proposal = z.object({
  note: z.string().describe("One or two plain sentences to the owner saying what you changed and why"),
  changes: ChangeSchema,
});
export type Proposal = z.infer<typeof Proposal>;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Every tool the assistant has. All of them only read. */
export const READ_TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "read_week", description: "Read this week's current rota: every shift with its id, person, day, kind and times.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "read_staff", description: "Read the staff list: role, whether trained on the coffee machine, contract hours, days they can't work.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
];

function readTool(name: string, rota: Rota): string {
  switch (name) {
    case "read_week":
      return JSON.stringify({
        weekStart: rota.weekStart,
        days: DAYS.map((d, i) => `${i} = ${d}`),
        shiftTimes: { open: "06:30-14:30", mid: "07:30-15:30 (Saturday rush)", close: "12:30-20:30" },
        shifts: rota.shifts.map((s) => ({ id: s.id, staffId: s.staffId, date: s.date, kind: s.kind, start: s.start, end: s.end })),
        hoursThisWeek: Object.fromEntries(rota.staff.map((p) => [p.id, rota.shifts.filter((s) => s.staffId === p.id).reduce((h, s) => h + shiftHours(s), 0)])),
      });
    case "read_staff":
      return JSON.stringify(rota.staff);
    default:
      return JSON.stringify({ error: `No tool called ${name}` });
  }
}

const SYSTEM = `You are the rota assistant at Ollie's, a café in Dublin 2. The owner, Gráinne, asks you to change the week's rota.
You can read the week and the staff list. You cannot save anything: you suggest changes, Gráinne's checks test them, and only she can approve.

Read what you need first, then answer with your suggested changes to the CURRENT week:
- remove: ids of shifts to take off
- add: new shifts (staffId, day 0 = Monday, kind open/mid/close; start/end null for the usual times)
Keep changes to what the request needs. Your note to Gráinne is one or two plain sentences, no jargon.
If her checks send a suggestion back, read what broke and suggest again from the original week (a complete set of changes, not a patch on your last try).`;

export interface AgentHooks {
  read?: (tool: string) => void;
}

/** A running conversation with the assistant, so it can revise after the checks push back. */
export class RotaAssistant {
  private messages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(private readonly rota: Rota) {}

  async propose(request: string, hooks: AgentHooks = {}, step = "agent.propose"): Promise<Proposal> {
    this.messages.push({ role: "user", content: request });
    return this.run(hooks, step);
  }

  async revise(feedback: string, hooks: AgentHooks = {}, step = "agent.revise"): Promise<Proposal> {
    this.messages.push({ role: "user", content: `Gráinne's checks sent it back:\n${feedback}\nSuggest again.` });
    return this.run(hooks, step);
  }

  private async run(hooks: AgentHooks, step: string): Promise<Proposal> {
    let lastProblem = "";
    for (let i = 0; i < 8; i++) {
      const started = Date.now();
      const response = await withParseRetry(() =>
        client.beta.messages.parse({
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: "medium", format: betaZodOutputFormat(Proposal) },
          system: SYSTEM,
          tools: READ_TOOLS,
          messages: this.messages,
        }),
      );
      logCall(`${step}.${i + 1}`, response, started, { system: SYSTEM, messages: this.messages });
      // Keep the whole reply (thinking included) so the conversation stays valid across turns.
      this.messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "tool_use") {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          hooks.read?.(block.name);
          results.push({ type: "tool_result", tool_use_id: block.id, content: readTool(block.name, this.rota) });
        }
        this.messages.push({ role: "user", content: results });
        continue;
      }
      if (response.stop_reason === "refusal") throw new Error("The assistant declined the request");
      if (response.parsed_output) return response.parsed_output;
      // Malformed answer: show it what happened and let it answer again, once per turn budget.
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").slice(0, 400);
      lastProblem = `stop_reason=${response.stop_reason}; text=${text || "(none)"}`;
      this.messages.push({ role: "user", content: "That answer didn't come through in the agreed format. Give your suggestion again as the JSON object only." });
    }
    throw new Error(`The assistant never gave a usable suggestion (${lastProblem || "kept reading"})`);
  }
}
