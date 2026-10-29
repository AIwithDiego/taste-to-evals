// Turns a captured rule into a check, then proves it: it must pass every week the owner called fine,
// catch every week they called not fine, and agree with two extra test weeks it wrote itself.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ask } from "./claude.js";
import type { Violation } from "./domain.js";
import { applyChange, type Example } from "./examples.js";
import type { RuleSpec } from "./interview.js";
import { baseWeek } from "./ollies.js";
import { compile } from "./sandbox.js";

export const ChangeSchema = z.object({
  add: z
    .array(
      z.object({
        staffId: z.string(),
        day: z.number().int().describe("0 = Monday ... 6 = Sunday"),
        kind: z.enum(["open", "mid", "close"]),
        start: z.string().nullable().describe("HH:MM, or null for the usual start"),
        end: z.string().nullable().describe("HH:MM, or null for the usual end"),
      }),
    )
    .describe("Shifts to add to the normal week"),
  remove: z.array(z.string()).describe("Shift ids to remove from the normal week"),
});

const Generated = z.object({
  code: z.string().describe("TypeScript source defining `export function check(rota: Rota): Violation[]`"),
  howItWorks: z.string().describe("Two plain sentences a café owner would understand"),
  testCases: z
    .array(
      z.object({
        name: z.string(),
        short: z.string().describe("One line in the owner's voice, max 12 words, like: 'Tom stays 15 minutes late on Saturday.'"),
        why: z.string().describe("What edge this week tests, in plain words"),
        change: ChangeSchema,
        expect: z.enum(["pass", "fail"]),
      }),
    )
    .describe("Exactly two extra test weeks that probe the edges of the rule"),
});
export type Generated = z.infer<typeof Generated>;

export interface Outcome {
  name: string;
  source: "owner" | "generated";
  expected: "pass" | "fail";
  got: "pass" | "fail" | "error";
  violations: Violation[];
  error?: string;
  ok: boolean;
}

const SYSTEM = `You write rota checks for ShiftGuard. A check is one pure TypeScript function:

  export function check(rota: Rota): Violation[]

It returns [] when the week keeps the rule, or one Violation per broken instance.

Hard limits (the code is screened and run in a sandbox; breaking these means it is refused):
- No imports, no require, no globals beyond plain JavaScript (Math, Number, String, Array, Object, Map, Set, JSON, Date).
- Do not use the words: process, globalThis, global, eval, Function, fetch, constructor, prototype, __proto__, Reflect, Proxy, setTimeout, setInterval.
- No loops that could run forever. Deterministic. Do not mutate the input.
- The types Rota, Violation, Staff, Shift, ShiftKind and Role are provided (do not redeclare them). The functions in domain.ts (toMinutes, shiftHours) are NOT available at run time: write any helper you need yourself, in the same source.

Violation messages are read out to a café owner on a big screen. Make them plain and specific:
use the person's name (from rota.staff), the number, and the limit. Example: "Tom Kavanagh would work 48 hours. Your limit is 40."
Say amounts the way a person would: "40 and a half hours", "40 hours and 15 minutes", never "40.5" or "40.25".
No codes, ids or jargon in messages. Put the staff id and date (if relevant) in the staffId/date fields instead.

The data model:
<domain.ts>
${readFileSync(new URL("./domain.ts", import.meta.url), "utf8")}
</domain.ts>`;

function exampleBrief(examples: Example[]): string {
  return examples
    .map((e) => `- ${e.id} (${e.verdict}): "${e.said}" Change from the normal week: ${JSON.stringify(e.change)}`)
    .join("\n");
}

export async function generate(rule: RuleSpec, examples: Example[], feedback?: string): Promise<Generated> {
  const content = `The rule, as captured in the interview:
${JSON.stringify(rule, null, 2)}

The normal week at the café (every example below is this week with a small change):
${JSON.stringify(baseWeek())}

Weeks the owner showed us, with their verdict:
${exampleBrief(examples)}

Write the check, explain it in two plain sentences, and write exactly two extra test weeks (as changes to the normal week) that probe the edges of the rule the owner's examples don't already cover.${feedback ? `\n\nYour previous attempt failed. Fix it:\n${feedback}` : ""}`;
  return ask({ step: feedback ? "generate.retry" : "generate", system: SYSTEM, messages: [{ role: "user", content }], schema: Generated, effort: "high" });
}

export async function prove(gen: Generated, examples: Example[]): Promise<Outcome[]> {
  const check = await compile(gen.code);
  const cases = [
    ...examples.map((e) => ({ name: e.id, source: "owner" as const, expected: e.verdict === "fine" ? ("pass" as const) : ("fail" as const), change: e.change })),
    ...gen.testCases.map((t) => ({
      name: t.name,
      source: "generated" as const,
      expected: t.expect,
      change: {
        remove: t.change.remove,
        add: t.change.add.map((a) => ({ staffId: a.staffId, day: a.day, kind: a.kind, start: a.start ?? undefined, end: a.end ?? undefined })),
      },
    })),
  ];
  return cases.map((c): Outcome => {
    try {
      const violations = check(applyChange(c.change));
      const got = violations.length === 0 ? "pass" : "fail";
      return { name: c.name, source: c.source, expected: c.expected, got, violations, ok: got === c.expected };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { name: c.name, source: c.source, expected: c.expected, got: "error", violations: [], error, ok: false };
    }
  });
}

export function feedbackFor(outcomes: Outcome[]): string {
  return outcomes
    .filter((o) => !o.ok)
    .map((o) => `- ${o.name}: expected ${o.expected}, got ${o.got}${o.error ? ` (${o.error})` : ""}${o.violations.length ? `; said: ${o.violations.map((v) => v.message).join(" | ")}` : ""}`)
    .join("\n");
}
